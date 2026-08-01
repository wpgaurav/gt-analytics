# GT Analytics

Self-hosted, cookieless web analytics running entirely on Cloudflare.

GT Analytics is a hard fork of
[Counterscale](https://github.com/benvinegar/counterscale) 3.4.1. It keeps the
small edge collector and near-zero operating model, then adds the reporting,
attribution, realtime, conversion, multi-site, and long-term history features I
needed to use it across production sites.

Deployed as the Cloudflare Worker `counterscale-gauravtiwari` at `stats.gauravtiwari.org`.

## What this fork adds

| Feature                             | What it does                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Real referral attribution**       | Normalizes source hosts, groups referrers, classifies direct, search, social, paid, referral, email, and AI traffic, and records ad-platform click ID names without retaining their identifying values. |
| **First-touch sessions**            | Remembers the landing source per browser tab in `sessionStorage`, so later pageviews in the same visit do not become false direct traffic.                                                              |
| **Full campaign reporting**         | Captures and reports UTM source, medium, campaign, term, and content alongside referrer host, channel, entry page, country, browser, and device.                                                        |
| **Conversions and custom events**   | Records `gta('conversion', 'signup', { value: 4900, currency: 'INR' })` and other named events in a separate Analytics Engine dataset using `sendBeacon`.                                               |
| **Commerce and lead recipe**        | Includes a reusable browser integration for outbound clicks, downloads, affiliate links, Fluent Cart add-to-cart, checkout and purchase events, and Core Forms leads.                                   |
| **Realtime analytics**              | Uses one Durable Object per site for a rolling 30-minute window, five-minute active visitors, views, conversions, top paths, channels, countries, referrers, and a live event feed.                     |
| **All-site realtime view**          | Shows every managed site's current activity together instead of hiding the estate behind a site dropdown.                                                                                               |
| **Multiple sites**                  | Adds, edits, enables, and removes tracked properties in the dashboard. Site IDs, labels, origins, timezones, and history cutover dates live in D1, so adding a site does not require a redeploy.        |
| **Remembered site selection**       | Keeps the selected property while moving between dashboard views and applies saved reports to the site currently being inspected.                                                                       |
| **Saved report presets**            | Provides one-click Today, Last 7 days, AI, Search, Social, Paid, Referral, and Direct views, plus custom presets stored in D1.                                                                          |
| **Pages report**                    | Adds a dedicated sortable page-performance view with views, visitors, bounce rate, average duration, conversions, conversion rate, and links back to the live page.                                     |
| **Better dashboard metrics**        | Adds bounce rate, per-page engagement duration, conversion cards, grouped referrers with favicons, pagination, filters, and timezone-aware date ranges.                                                 |
| **Long-term history**               | Archives daily Analytics Engine data to R2 as Apache Arrow, imports older data, and transparently merges archive history with the live 90-day Analytics Engine window.                                  |
| **Authenticated dashboard and API** | Supports password-protected sessions for people and a separate bearer token for machine-readable resource routes.                                                                                       |
| **Production deployment**           | Includes GitHub Actions deployment, explicit Cloudflare bindings, migrations, scheduled archival, and a one-command installer that provisions a fresh account.                                          |
| **Core Forms Design System**        | Rebuilds the interface with [CFDS](https://github.com/wpgaurav/core-forms-design-system), bundled open fonts, and Lucide icons. No Tailwind or shadcn dependency is required.                           |

**No plugin, no cookies, and no cross-session identifier.** Visits are counted
with a rotating cache header. Click IDs are stored by name (`gclid`, for
example), never by value, because the value identifies an individual click.

## One-command Cloudflare install

Requirements:

- macOS or Linux
- Git and Node.js 20+
- a Cloudflare account with Workers and Analytics Engine enabled
- an Account Analytics Read API token

Run the public installer:

```bash
curl -fsSL https://raw.githubusercontent.com/wpgaurav/gt-analytics/main/install-cloudflare.sh | bash
```

The installer clones the repository when necessary, installs the pinned pnpm
workspace, builds the application, opens Wrangler login, provisions D1 and R2,
creates the Analytics Engine and Durable Object bindings, applies migrations,
sets Worker secrets, enables dashboard authentication by default, and deploys
to a `workers.dev` URL. It deliberately does not copy the maintainer's custom
domain or Cloudflare resource IDs.

To inspect the script first or install from an existing checkout:

```bash
./install-cloudflare.sh --help
./install-cloudflare.sh --dry-run
./install-cloudflare.sh
```

Resource names can be overridden with the environment variables shown by
`--help`. The reusable generated configuration is saved locally at
`.gt-analytics/wrangler.json` and is excluded from Git.

## Layout

```text
packages/server    React Router on Workers: collector, dashboard, API, history
packages/tracker   browser and server trackers plus integration tests
packages/cli       interactive install, authentication, and storage commands
examples           production-oriented conversion tracking recipes
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

Deploy the checked-in production configuration through the workspace binary:

```bash
pnpm --filter @counterscale/server exec wrangler deploy --config wrangler.json
```

## Configuration

Secrets are Wrangler secrets, never committed. `.dev.vars` is gitignored; copy
`packages/server/.dev.vars.example` to start.

| Variable             | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `CF_ACCOUNT_ID`      | Cloudflare account                                                  |
| `CF_BEARER_TOKEN`    | scoped Account Analytics Read token                                 |
| `CF_AE_DATASET`      | Analytics Engine dataset the SQL layer reads from                   |
| `CF_EVENTS_DATASET`  | Analytics Engine dataset holding conversions and custom events      |
| `CF_AUTH_ENABLED`    | `true` / `false`; unset means enabled when hash + secret both exist |
| `CF_PASSWORD_HASH`   | bcrypt hash of the dashboard password                               |
| `CF_JWT_SECRET`      | signs the session cookie                                            |
| `CF_API_TOKEN`       | bearer token for machine access to the JSON API                     |
| `CF_STORAGE_ENABLED` | nightly R2 Arrow archival; unset means enabled                      |

## License

MIT. This fork inherits Counterscale's MIT license. See [`LICENSE`](LICENSE)
and [`NOTICE.md`](NOTICE.md) for attribution and third-party assets.
