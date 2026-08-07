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
| `tryairp.com` | Advocate UI + API (proxy to `127.0.0.1:8790`; legacy `tryaidp.com` / `dev.tryaidp.com` aliases) |
| `airegister.uk`, `www.airegister.uk` | Serving register document via Alias into the repo |
| `api.honestmodel.win` | Reverse proxy to mock provider on `127.0.0.1:8821` |
| `api.cheapai.win` | Reverse proxy to mock provider on `127.0.0.1:8822` |
| `honestmodel.win`, `cheapai.win` | Static holding pages under `$AIRP_SITES_ROOT/<domain>` |

It does **not** replace the `airp-daemon` PM2 process. The advocate UI is served at
`tryairp.com` (with legacy `tryaidp.com` / `dev.tryaidp.com` aliases) by reverse-proxying
that daemon.

## Register Alias (no copy)

```
/airp/register.json      ->  data/register/serving-register.json
/airp/register.json.sig  ->  data/register/serving-register.sig
/airp/register.substituted-keys.json      ->  data/register/serving-register.substituted-keys.json
/airp/register.substituted-keys.json.sig  ->  data/register/serving-register.substituted-keys.sig
```

The document is served out of the repository so a re-minted register cannot drift
from what Apache publishes. The `.sig` suffix is the detached-signature location
intended for draft `-01`; the current draft does not yet define where a detached
signature lives when a document is fetched from an `r=` URL.

The substituted-keys document verifies against the same pinned registrar key but
replaces the sealing key on `honestmodel.win.entry`. Point the daemon at it with
`AIRP_REGISTER_DOCUMENT` / `AIRP_REGISTER_SIGNATURE` (or the matching
`registerDocumentPath` setup options) to show a live `key_set_digest_mismatch`
refusal. Regenerate with `node tools/build-substituted-keys-register.mjs`.

**The reference client still loads the register from local storage.** Publishing
these URLs makes the DNS `r=` tag resolve to a real document. Nothing in this
repository fetches that URL yet. HTTPS fetch with `maxAge` caching is separate
work.

## Key set digest (`k` tag)

```bash
npm run key-set-digest
```

Prints the §4.8 digests for every entry with `identityDomain` and the full
`_airp` TXT lines ready to paste into Cloudflare. TTL 300. This script does not
edit DNS. Re-run after any key change so the published value stays regenerable
from the register rather than a number someone once wrote down.

## Mock providers

PM2 process `airp-public-mocks` runs `packages/demo/dist/public-mock-servers.js`
(Node 22+), listening on loopback ports 8821 and 8822 only. Saved into the PM2
dump so the host PM2 systemd unit brings them back after reboot. Not opened in
ufw.

## SSE-safe proxy settings

API vhosts force HTTP/1.1, disable gzip/brotli on the proxy path, set
`ProxyPass ... flushpackets=on`, and send `Cache-Control: no-store`. The public
mocks emit `text/event-stream` when the request sets `stream: true`, with an
`event: airp-seal` terminal-seal event after the content deltas.

Acceptance:

```bash
node deploy/verify-public-seal.mjs     # non-streamed
node deploy/verify-public-stream.mjs   # streamed terminal seal through Apache
```

The streamed proof is the one that catches proxy buffering: a mangled stream
presents as a signature mismatch, not as a proxy error.

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
