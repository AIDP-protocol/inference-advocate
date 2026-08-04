#!/usr/bin/env bash
# Idempotent deploy of the AIRP public demo surfaces.
#
# Brings up tryairp.com (advocate UI via the local daemon), airegister.uk (register
# document), api.honestmodel.win / api.cheapai.win (mock providers behind Apache),
# and apex holding pages. Legacy tryaidp.com hostnames stay as aliases.
#
# Host-specific paths and emails live in deploy/local.env (gitignored). Copy
# deploy/local.env.example and fill it in before the first run.
#
# Re-runnable on demo morning. Safe to run more than once.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$ROOT/deploy"
APACHE_SRC="$DEPLOY/apache"
LOCAL_ENV="$DEPLOY/local.env"

SITE_NAMES=(tryairp.com airegister.uk honestmodel.win cheapai.win)
HTTP_SITES=(tryairp.com.conf airegister.uk.conf honestmodel.win.conf cheapai.win.conf)
SSL_SITES=(tryairp.com-le-ssl.conf airegister.uk-le-ssl.conf honestmodel.win-le-ssl.conf cheapai.win-le-ssl.conf)

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

load_local_env() {
  if [[ ! -f "$LOCAL_ENV" ]]; then
    die "missing $LOCAL_ENV (copy deploy/local.env.example and set host paths)"
  fi
  # shellcheck disable=SC1090
  set -a
  source "$LOCAL_ENV"
  set +a

  : "${AIRP_SITES_ROOT:?set AIRP_SITES_ROOT in deploy/local.env}"
  : "${AIRP_DENY_ROOTS:?set AIRP_DENY_ROOTS in deploy/local.env}"
  : "${AIRP_SERVER_ADMIN:?set AIRP_SERVER_ADMIN in deploy/local.env}"
  : "${CERTBOT_EMAIL:?set CERTBOT_EMAIL in deploy/local.env}"

  AIRP_REPO_ROOT="$ROOT"
  NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
  NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"
  PM2_BIN="${PM2_BIN:-$(command -v pm2 || true)}"

  [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || die 'node not found (set NODE_BIN in deploy/local.env)'
  [[ -n "$NPM_BIN" && -x "$NPM_BIN" ]] || die 'npm not found (set NPM_BIN in deploy/local.env)'
  [[ -n "$PM2_BIN" && -x "$PM2_BIN" ]] || die 'pm2 not found (set PM2_BIN in deploy/local.env)'
}

# Substitute @PLACEHOLDER@ tokens. Repo and host paths never live in the committed templates.
render_template() {
  local src="$1"
  local dest="$2"
  # Use # as the sed delimiter so paths and AIRP_DENY_ROOTS pipes do not collide.
  sed \
    -e "s#@AIRP_REPO_ROOT@#${AIRP_REPO_ROOT}#g" \
    -e "s#@AIRP_SITES_ROOT@#${AIRP_SITES_ROOT}#g" \
    -e "s#@AIRP_DENY_ROOTS@#${AIRP_DENY_ROOTS}#g" \
    -e "s#@AIRP_SERVER_ADMIN@#${AIRP_SERVER_ADMIN}#g" \
    "$src" | sudo tee "$dest" >/dev/null
}

assert_not_locking_ssh() {
  if command -v ufw >/dev/null 2>&1; then
    if ! sudo ufw status | grep -Eq '^(22|22/tcp).*ALLOW'; then
      die 'ufw does not show 22/tcp ALLOW; refusing to continue'
    fi
  fi
}

ensure_apache_modules() {
  local mods=(ssl rewrite headers proxy proxy_http)
  for m in "${mods[@]}"; do
    if ! apache2ctl -M 2>/dev/null | grep -q "${m}_module"; then
      log "enabling apache module $m"
      sudo a2enmod "$m" >/dev/null
    fi
  done
  if apache2ctl -M 2>/dev/null | grep -q 'http2_module'; then
    log 'note: mod_http2 is loaded; API vhosts force Protocols http/1.1'
  fi
}

ensure_site_dirs() {
  local name
  for name in "${SITE_NAMES[@]}"; do
    local dir="$AIRP_SITES_ROOT/$name"
    mkdir -p "$dir"
    if [[ "$name" == "airegister.uk" ]]; then
      if [[ ! -f "$dir/index.html" ]]; then
        cat >"$dir/index.html" <<'HTML'
<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>airegister.uk</title></head>
<body><p>AIRP serving register: <a href="/airp/register.json">/airp/register.json</a></p></body></html>
HTML
      fi
    elif [[ "$name" == "tryairp.com" ]]; then
      # DocumentRoot exists for ACME only; / is proxied to the daemon.
      mkdir -p "$dir/.well-known/acme-challenge"
    else
      cp -f "$DEPLOY/holding/index.html" "$dir/index.html"
    fi
  done
}

retire_legacy_tryaidp_site_names() {
  # Old enabled filenames from before tryairp.com was the primary name.
  for f in dev.tryaidp.com.conf dev.tryaidp.com-le-ssl.conf; do
    if [[ -e "/etc/apache2/sites-enabled/$f" ]]; then
      log "disabling legacy site $f"
      sudo a2dissite "$f" >/dev/null || true
    fi
  done
}

install_apache_configs() {
  log 'installing rendered Apache configs (paths from deploy/local.env)'
  render_template "$APACHE_SRC/airp-deny-home-root.conf" \
    /etc/apache2/conf-available/airp-deny-home-root.conf
  sudo a2enconf airp-deny-home-root >/dev/null

  local f
  for f in "${HTTP_SITES[@]}" "${SSL_SITES[@]}"; do
    log "installing $f"
    render_template "$APACHE_SRC/$f" "/etc/apache2/sites-available/$f"
  done

  for f in "${HTTP_SITES[@]}"; do
    sudo a2ensite "$f" >/dev/null
  done
}

cert_exists() {
  local name="$1"
  sudo test -f "/etc/letsencrypt/live/$name/fullchain.pem" \
    && sudo test -f "/etc/letsencrypt/live/$name/privkey.pem"
}

ensure_certs() {
  need_cmd certbot
  local pairs=(
    "tryairp.com|${AIRP_SITES_ROOT}/tryairp.com|tryairp.com,tryaidp.com,dev.tryaidp.com"
    "airegister.uk|${AIRP_SITES_ROOT}/airegister.uk|airegister.uk,www.airegister.uk"
    "honestmodel.win|${AIRP_SITES_ROOT}/honestmodel.win|honestmodel.win,api.honestmodel.win"
    "cheapai.win|${AIRP_SITES_ROOT}/cheapai.win|cheapai.win,api.cheapai.win"
  )
  local entry name webroot domains domain_args d
  for entry in "${pairs[@]}"; do
    IFS='|' read -r name webroot domains <<<"$entry"
    if cert_exists "$name"; then
      log "certificate present for $name"
      continue
    fi
    # tryairp.com may already exist under the legacy cert name from before the rename.
    if [[ "$name" == "tryairp.com" ]] && cert_exists "dev.tryaidp.com"; then
      log "issuing tryairp.com certificate (replacing legacy dev.tryaidp.com name coverage)"
    else
      log "requesting certificate for $domains"
    fi
    domain_args=()
    IFS=',' read -ra ds <<<"$domains"
    for d in "${ds[@]}"; do
      domain_args+=(-d "$d")
    done
    sudo certbot certonly \
      --webroot -w "$webroot" \
      --non-interactive --agree-tos -m "$CERTBOT_EMAIL" \
      --cert-name "$name" \
      "${domain_args[@]}"
  done

  local f
  for f in "${SSL_SITES[@]}"; do
    sudo a2ensite "$f" >/dev/null
  done

  # Drop the old filenames only after the tryairp.com cert and SSL vhost are in place.
  retire_legacy_tryaidp_site_names

  if systemctl is-enabled certbot.timer >/dev/null 2>&1; then
    log 'certbot.timer is enabled'
  else
    log 'enabling certbot.timer'
    sudo systemctl enable --now certbot.timer
  fi
  systemctl list-timers certbot.timer --no-pager | head -n 5 || true
}

reload_apache() {
  log 'apache2 configtest'
  sudo apache2ctl configtest
  log 'reloading apache2'
  sudo systemctl reload apache2
}

ensure_ufw() {
  assert_not_locking_ssh
  if ! command -v ufw >/dev/null 2>&1; then
    log 'ufw not installed; skipping'
    return
  fi
  sudo ufw allow OpenSSH >/dev/null
  sudo ufw allow 'Apache Full' >/dev/null
  log 'ufw: OpenSSH and Apache Full allowed; mock ports not published'
}

build_and_start_mocks() {
  log 'building @airp/demo (public mocks)'
  (cd "$ROOT" && "$NPM_BIN" run build --workspace @airp/core && "$NPM_BIN" run build --workspace @airp/demo)

  local script="$ROOT/packages/demo/dist/public-mock-servers.js"
  [[ -f "$script" ]] || die "missing $script after build"

  if "$PM2_BIN" describe airp-public-mocks >/dev/null 2>&1; then
    log 'restarting PM2 process airp-public-mocks'
    "$PM2_BIN" restart airp-public-mocks --update-env
  else
    log 'starting PM2 process airp-public-mocks'
    (cd "$ROOT" && "$PM2_BIN" start "$script" --name airp-public-mocks --interpreter "$NODE_BIN")
  fi
  "$PM2_BIN" save
  log 'PM2 dump saved (survives reboot via the host PM2 systemd unit)'
}

verify_register_bytes() {
  local url="https://airegister.uk/airp/register.json"
  local tmp
  tmp="$(mktemp)"
  curl -fsS "$url" -o "$tmp"
  if ! cmp -s "$tmp" "$ROOT/data/register/serving-register.json"; then
    rm -f "$tmp"
    die "served register bytes differ from data/register/serving-register.json"
  fi
  rm -f "$tmp"
  log 'register bytes match the repo file'
}

verify_register_sig() {
  "$NODE_BIN" "$DEPLOY/verify-register-sig.mjs"
}

verify_seal_through_proxy() {
  "$NODE_BIN" "$DEPLOY/verify-public-seal.mjs"
  "$NODE_BIN" "$DEPLOY/verify-public-stream.mjs"
}

verify_existing_demo() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' https://tryairp.com/)"
  [[ "$code" == "200" ]] || die "tryairp.com returned HTTP $code"
  # Legacy name kept as an alias during the rename.
  code="$(curl -s -o /dev/null -w '%{http_code}' https://tryaidp.com/)"
  [[ "$code" == "200" ]] || die "tryaidp.com (legacy alias) returned HTTP $code"
  if ! "$PM2_BIN" describe aidp-daemon 2>/dev/null | grep -q 'status.*online'; then
    die 'aidp-daemon is not online under PM2'
  fi
  log 'advocate demo (tryairp.com / aidp-daemon) still healthy'
}

print_verification_curls() {
  echo
  log 'verification curls'
  echo '--- curl -sI https://airegister.uk/airp/register.json'
  curl -sI https://airegister.uk/airp/register.json || true
  echo '--- curl -s https://airegister.uk/airp/register.json | head -c 200'
  curl -s https://airegister.uk/airp/register.json | head -c 200
  echo
  echo '--- curl -sI https://api.honestmodel.win/'
  curl -sI https://api.honestmodel.win/ || true
  echo '--- curl -sI https://api.cheapai.win/'
  curl -sI https://api.cheapai.win/ || true
  echo
  log 'CAA reminder (Cloudflare, not applied by this script):'
  echo '  Add CAA records 0 issue "letsencrypt.org" on airegister.uk, honestmodel.win, and cheapai.win.'
}

main() {
  need_cmd curl
  need_cmd apache2ctl
  load_local_env
  assert_not_locking_ssh
  ensure_ufw
  ensure_apache_modules
  ensure_site_dirs
  install_apache_configs
  sudo apache2ctl configtest
  sudo systemctl reload apache2
  ensure_certs
  reload_apache
  build_and_start_mocks
  sleep 1
  print_verification_curls
  verify_register_bytes
  verify_register_sig
  verify_seal_through_proxy
  verify_existing_demo
  log 'deploy complete'
}

main "$@"
