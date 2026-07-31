# GT Analytics

Self-hosted, WordPress-aware web analytics running on Cloudflare Workers.

A hard fork of [Counterscale](https://github.com/benvinegar/counterscale) 3.4.1 that keeps the
edge-collection core and adds the thing Counterscale has no concept of: **a post**. Every hit is
joined to a real WordPress post ID at collection time, so the dashboard reports on content —
titles, post types, categories, authors, publish cohorts — instead of bare URL paths.

Deployed as the Cloudflare Worker `counterscale-gauravtiwari` at `stats.gauravtiwari.org`.

## What this fork adds

| | |
|---|---|
| **Post-ID matching** | A scheduled job mirrors the WordPress REST API into D1 and projects a path→post index into KV. The collector resolves it in-isolate and writes the post ID straight into Analytics Engine, so grouping by post, type, category or author is a native `GROUP BY` with no join. |
| **Four sites, one dashboard** | gauravtiwari.org, gatilab.com, anantamias.com, thedewlab.com. |
| **Affiliate click tracking** | `/go/{slug}` links are 301s, so server-side analytics never sees them. The tracker captures the click and joins it to the product. |
| **Content decay + cohorts** | Window-over-window deltas per post: what is dying, what is ramping, how content performs by age, category and author. |
| **Engagement signals** | Scroll depth and engaged-time, recorded to a separate events dataset. |
| **Core Forms Design System** | The dashboard is dressed in [CFDS](https://github.com/wpgaurav/core-forms-design-system) — no Tailwind, no shadcn. |

**Zero WordPress plugin code is required for collection.** The content map is built entirely
Worker-side from the public REST API. An optional read-only mu-plugin surfaces view counts in
wp-admin, but nothing about data capture depends on it.

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
| `CF_AUTH_ENABLED` | `true` / `false`; unset means enabled when hash + secret both exist |
| `CF_PASSWORD_HASH` | bcrypt hash of the dashboard password |
| `CF_JWT_SECRET` | signs the session cookie |
| `CF_API_TOKEN` | bearer token for machine access to the JSON API |
| `CF_STORAGE_ENABLED` | nightly R2 Arrow archival; unset means enabled |

## License

MIT. This fork inherits Counterscale's MIT license — see [`LICENSE`](LICENSE) and
[`NOTICE.md`](NOTICE.md) for attribution and third-party assets.
