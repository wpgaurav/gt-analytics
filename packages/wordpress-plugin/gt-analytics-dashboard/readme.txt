=== GT Analytics Dashboard ===
Contributors: wpgaurav
Tags: analytics, dashboard, realtime, privacy
Requires at least: 6.5
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: MIT
License URI: https://opensource.org/license/mit/

Show GT Analytics real-time and seven-day statistics in the WordPress dashboard.

== Description ==

GT Analytics Dashboard connects WordPress to an account-scoped GT Analytics API key. It adds a compact dashboard widget with active visitors, recent views, seven-day visitors and views, bounce rate, average visit duration, a seven-day chart, and live pages.

The API key remains server-side. Browser JavaScript calls a nonce-protected WordPress AJAX action and never receives the upstream credential. Full reports remain in the GT Analytics website.

== Installation ==

1. Upload and activate the plugin.
2. Create an API key in GT Analytics under Account & API.
3. Open Settings > GT Analytics in WordPress.
4. Save the analytics URL and API key, choose a site, and test the connection.
5. View the GT Analytics widget on Dashboard > Home.

For stronger secret handling, define `GT_ANALYTICS_API_URL`, `GT_ANALYTICS_API_KEY`, and `GT_ANALYTICS_SITE_ID` in `wp-config.php`.

== External services ==

This plugin connects to the GT Analytics installation URL configured by the site administrator. It sends the saved API key in an Authorization header and the selected GT Analytics site ID as a query parameter to retrieve read-only site, analytics, and real-time data. No request is made until an administrator configures the plugin.

GT Analytics is self-hostable software. Its source, documentation, privacy notes, and license are available at https://github.com/wpgaurav/gt-analytics. Data handling is governed by the operator of the configured GT Analytics installation.

== Changelog ==

= 1.0.0 =
* Initial real-time and seven-day WordPress dashboard integration.
