# GT Analytics Dashboard for WordPress

This package builds the installable WordPress plugin that shows a compact GT
Analytics preview under **Dashboard > Home**. It displays real-time activity
and the existing seven-day report, then links to the full GT Analytics website.

## Requirements

- WordPress 6.5 or newer
- PHP 7.4 or newer
- A GT Analytics API key with `analytics:read` and `realtime:read`

## Configure

Activate the plugin, open **Settings > GT Analytics**, save the installation
root and API key, then choose one of the sites returned by the key. The key is
used only in server-side WordPress HTTP requests.

For production, keep credentials outside the WordPress options table:

```php
define( 'GT_ANALYTICS_API_URL', 'https://stats.example.com' );
define( 'GT_ANALYTICS_API_KEY', 'gta_...' );
define( 'GT_ANALYTICS_SITE_ID', 'example.com' );
```

The browser talks only to a capability-checked, nonce-protected WordPress AJAX
action. It never receives the API key.

## Build and test

From the repository root:

```bash
pnpm --filter @gt-analytics/wordpress-plugin lint
pnpm --filter @gt-analytics/wordpress-plugin test
pnpm --filter @gt-analytics/wordpress-plugin build
```

The ZIP is written to `packages/wordpress-plugin/dist/`.
