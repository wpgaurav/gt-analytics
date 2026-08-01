# GT Analytics Dashboard for WordPress

This package builds the installable WordPress plugin that adds a top-level
**GT Analytics** menu with a complete native analytics dashboard. It also keeps
the compact preview under **Dashboard > Home**.

## Requirements

- WordPress 6.5 or newer
- PHP 7.4 or newer
- A GT Analytics API key with `analytics:read` and `realtime:read`

## Configure

Create a site-scoped key in GT Analytics, activate the plugin, then open
**GT Analytics > Settings** and save the installation root and key. The site is
derived from the key and the credential is used only in server-side requests.

For production, keep credentials outside the WordPress options table:

```php
define( 'GT_ANALYTICS_API_URL', 'https://stats.example.com' );
define( 'GT_ANALYTICS_API_KEY', 'gta_...' );
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
