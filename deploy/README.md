# AIRP public site deploy

Idempotent Apache + TLS + mock-provider setup for the three public AIRP domains.
Re-run on demo morning:

```bash
cp deploy/local.env.example deploy/local.env   # first time only; fill in host paths
./deploy/setup-airp-sites.sh
```

## Host-local config (not in git)

`deploy/local.env` holds machine paths, ServerAdmin, and Certbot email. It is
gitignored. The committed Apache files under `deploy/apache/` are templates with
`@AIRP_*@` placeholders; the script renders them into `/etc/apache2` at install
time. The repository checkout path is detected from the script location and is
never written into committed files.

Required keys are documented in `deploy/local.env.example`.

## What it installs

| Hostname | Role |
| --- | --- |
| `airegister.uk`, `www.airegister.uk` | Serving register document via Alias into the repo |
| `api.honestmodel.win` | Reverse proxy to mock provider on `127.0.0.1:8821` |
| `api.cheapai.win` | Reverse proxy to mock provider on `127.0.0.1:8822` |
| `honestmodel.win`, `cheapai.win` | Static holding pages under `$AIRP_SITES_ROOT/<domain>` |

It does **not** touch `tryaidp.com`, `tryairp.com`, `dev.tryaidp.com`, or the
`aidp-daemon` PM2 process.

## Register Alias (no copy)

```
/airp/register.json      ->  data/register/serving-register.json
/airp/register.json.sig  ->  data/register/serving-register.sig
```

The document is served out of the repository so a re-minted register cannot drift
from what Apache publishes. The `.sig` suffix is the detached-signature location
intended for draft `-01`; the current draft does not yet define where a detached
signature lives when a document is fetched from an `r=` URL.

**The reference client still loads the register from local storage.** Publishing
these URLs makes the DNS `r=` tag resolve to a real document. Nothing in this
repository fetches that URL yet. HTTPS fetch with `maxAge` caching is separate
work.

## Mock providers

PM2 process `airp-public-mocks` runs `packages/demo/dist/public-mock-servers.js`
(Node 22+), listening on loopback ports 8821 and 8822 only. Saved into the PM2
dump so the host PM2 systemd unit brings them back after reboot. Not opened in
ufw.

## SSE-safe proxy settings

API vhosts force HTTP/1.1, disable gzip/brotli on the proxy path, set
`ProxyPass ... flushpackets=on`, and send `Cache-Control: no-store`. Those
settings are in place before the mock gains a streaming path. Acceptance for
this deploy is a **non-streamed** sealed exchange through the proxy. Streamed
verification is a follow-up task.

## Trust fabric

Public register entries `honestmodel.win.entry` and `cheapai.win.entry` were
added with an additive re-sign (`tools/add-public-provider-entries.mjs`). The
registrar key and every existing `demo.*` provider key stay byte-identical.
Do not run `npm run keys` on a live demo host unless you intend to regenerate
the entire demo fabric.

## CAA

After certificates issue, add CAA `0 issue "letsencrypt.org"` on
`airegister.uk`, `honestmodel.win`, and `cheapai.win` in Cloudflare. This script
does not change DNS.

## Layout and safety

DocumentRoot is `$AIRP_SITES_ROOT/<hostname>`. Alias targets are the register
directory inside the checkout. Neither DocumentRoot nor Alias may point at
`$AIRP_SITES_ROOT` or any other path listed in `AIRP_DENY_ROOTS` (rendered into
`airp-deny-home-root.conf`). If the sites parent is a symlink into a home
directory, include that home path in `AIRP_DENY_ROOTS`.
