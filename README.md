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
| **Multiple accounts and sites**     | Gives every account its own settings, users, passkeys, API keys, saved views, and managed sites. New accounts use expiring, single-use invitations. Site IDs remain globally unique because they are the tracker attribution key. |
| **Remembered site selection**       | Keeps the selected property while moving between dashboard views and applies saved reports to the site currently being inspected.                                                                       |
| **Saved report presets**            | Provides one-click Today, Last 7 days, AI, Search, Social, Paid, Referral, and Direct views, plus custom presets stored in D1.                                                                          |
| **Pages report**                    | Adds a dedicated sortable page-performance view with views, visitors, bounce rate, average duration, conversions, conversion rate, and links back to the live page.                                     |
| **Better dashboard metrics**        | Adds bounce rate, per-page engagement duration, conversion cards, grouped referrers with favicons, pagination, filters, and timezone-aware date ranges.                                                 |
| **Long-term history**               | Archives daily Analytics Engine data to R2 as Apache Arrow, imports older data, and transparently merges archive history with the live 90-day Analytics Engine window.                                  |
| **Passwords and passkeys**          | Supports username/password login, opaque revocable sessions, and discoverable WebAuthn passkeys with device-level user verification. Existing installs bootstrap the first `owner` from their current password. |
| **Account-scoped read API**         | Provides versioned sites, seven-day/full analytics, real-time snapshot, and OpenAPI endpoints for WordPress, automations, third-party clients, and AI tools. API keys are hashed, revocable, and account-scoped. |
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
| `CF_AUTH_ENABLED`    | `true` / `false`; unset means enabled when the legacy hash exists   |
| `CF_PASSWORD_HASH`   | legacy bcrypt hash used once to bootstrap the first `owner` account |
| `CF_API_TOKEN`       | optional legacy token mapped to the default account                 |
| `CF_STORAGE_ENABLED` | nightly R2 Arrow archival; unset means enabled                      |

## Accounts and sign-in

After upgrading an existing deployment, sign in once with username `owner` and
the current dashboard password. GT Analytics creates the default owner and
moves future sessions into D1 as opaque, revocable credentials. The deployment
password remains only as a bootstrap fallback when the users table is empty.

The system administrator can create a seven-day, single-use invitation from
**Account & API**. Send the generated link to the account owner; GT Analytics
stores only its SHA-256 hash. The owner chooses their own username and password,
and the link becomes unusable as soon as it is accepted. Invitations can also
be revoked before use. There is no public signup route without a valid invite.

Each account has its own name, timezone, sites, saved views, passkeys, and API
keys. Usernames and tracker site IDs are deployment-wide unique. Owners can add
a passkey from the same screen and then use **Sign in with a passkey** without
entering a username or password.

## Read API

Create a key under **Account & API** and copy it when shown. Only its SHA-256
hash is stored. Send the key in the server-side `Authorization` header:

```bash
curl -H 'Authorization: Bearer gta_…' \
  'https://stats.example.com/api/v1/analytics?site=example.com&interval=7d&timezone=UTC'
```

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/sites` | Sites owned by the key's account |
| `GET /api/v1/analytics?site=…&interval=7d` | Summary, time series, pages and duration, referrers, events, and every supported traffic dimension |
| `GET /api/v1/realtime?site=…` | Current active visitors, rolling views/conversions, top lists, and live feed |
| `GET /api/v1/openapi` | OpenAPI 3.1 document for clients and AI tools |

The default interval is seven days. `today`, `yesterday`, `1d`, `7d`, `30d`,
`90d`, `180d`, `365d`, and bounded `YYYY-MM-DD..YYYY-MM-DD` ranges are
accepted. Existing dashboard filters such as `path`, `channel`, `country`,
`browserName`, `deviceType`, and UTM fields can be sent as query parameters.
Requests for a site outside the key's account return `404` rather than
revealing whether another account owns it.

### WordPress dashboard preview

Keep the API key in a server-side WordPress option or secret. Do not print it
into JavaScript. A dashboard widget can fetch the seven-day and real-time
payloads with the WordPress HTTP API:

```php
$base = 'https://stats.example.com/api/v1';
$site = rawurlencode('example.com');
$args = [
    'timeout' => 8,
    'headers' => [
        'Authorization' => 'Bearer ' . get_option('gt_analytics_api_key'),
        'Accept' => 'application/json',
    ],
];

$seven_days = wp_remote_get("{$base}/analytics?site={$site}&interval=7d", $args);
$realtime   = wp_remote_get("{$base}/realtime?site={$site}", $args);
```

Use those responses for a compact WordPress preview and link the widget to the
full GT Analytics website for report exploration. The API intentionally adds
no analytics capability beyond the full website; it exposes the existing data
in a stable, read-only shape.

## License

MIT. This fork inherits Counterscale's MIT license. See [`LICENSE`](LICENSE)
and [`NOTICE.md`](NOTICE.md) for attribution and third-party assets.
