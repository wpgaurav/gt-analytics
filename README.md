# GT Analytics

Self-hosted, cookieless web analytics running on Cloudflare Workers.

A hard fork of [Counterscale](https://github.com/benvinegar/counterscale) 3.4.1 that keeps the
edge-collection core and adds what it lacked: real referral attribution, conversion tracking, and
a dashboard that links straight back to the page it is reporting on.

Deployed as the Cloudflare Worker `counterscale-gauravtiwari` at `stats.gauravtiwari.org`.

## What this fork adds

| | |
|---|---|
| **Referral attribution** | Upstream stored the raw referrer string and nothing else. This derives a normalised source host, a channel, and any ad-platform click ID at collection time — so `google.com` and `www.google.com` stop splitting, AI assistants are their own bucket, and traffic whose referrer was stripped is still attributable. |
| **First-touch sessions** | Without it only a session's landing page carries a referrer and everything after it looks like direct traffic. The origin is remembered per tab in `sessionStorage`. |
| **Conversions** | `gta('conversion', 'signup', { value: 4900, currency: 'INR' })`. Sent with `sendBeacon`, so it survives the page unloading. Recorded to a separate events dataset. |
| **Multiple sites** | Managed in the UI, not in config. Adding one needs no redeploy. |
| **Clickable reports** | Every recorded path links back to the live page. |
| **Core Forms Design System** | The dashboard is dressed in [CFDS](https://github.com/wpgaurav/core-forms-design-system) — no Tailwind, no shadcn. |

**No plugin, no cookies, no cross-session identifier.** Visits are counted with a rotating cache
header. Click IDs are stored by *name* (`gclid`), never by value, because the value identifies an
individual click.

## Layout

```
packages/server    React Router v7 on Workers — collector, dashboard, JSON API
packages/tracker   the browser tracker (tracker.js + npm module)
packages/cli       install / auth / storage commands
```

## Development

Requires Node 20+ and pnpm 9+.

```bash
pnpm install
pnpm build
pnpm --filter @counterscale/server test
```

Local dev reads production Analytics Engine data but does not record writes.

```bash
pnpm dev
```

Deploy — always via the workspace binary, never a bare `wrangler`:

```bash
pnpm --filter @counterscale/server exec wrangler deploy --config wrangler.json
```

## Configuration

Secrets are Wrangler secrets, never committed. `.dev.vars` is gitignored; copy
`packages/server/.dev.vars.example` to start.

| Variable | Purpose |
|---|---|
| `CF_ACCOUNT_ID` | Cloudflare account |
| `CF_BEARER_TOKEN` | scoped Account Analytics Read token |
| `CF_AE_DATASET` | Analytics Engine dataset the SQL layer reads from |
| `CF_EVENTS_DATASET` | Analytics Engine dataset holding conversions and custom events |
| `CF_AUTH_ENABLED` | `true` / `false`; unset means enabled when hash + secret both exist |
| `CF_PASSWORD_HASH` | bcrypt hash of the dashboard password |
| `CF_JWT_SECRET` | signs the session cookie |
| `CF_API_TOKEN` | bearer token for machine access to the JSON API |
| `CF_STORAGE_ENABLED` | nightly R2 Arrow archival; unset means enabled |

## License

MIT. This fork inherits Counterscale's MIT license — see [`LICENSE`](LICENSE) and
[`NOTICE.md`](NOTICE.md) for attribution and third-party assets.
