=== GT Analytics Dashboard ===
Contributors: wpgaurav
Tags: analytics, dashboard, realtime, privacy
Requires at least: 6.5
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.2.2
License: MIT
License URI: https://opensource.org/license/mit/

Show the complete read-only GT Analytics experience in the WordPress dashboard.

== Description ==

GT Analytics Dashboard connects WordPress to a site-scoped GT Analytics API key. It adds a top-level GT Analytics admin screen with full read-only reporting, real-time data, linked pages and referrers, range and traffic filters, and detailed conversions, plus a compact Dashboard Home widget.

The API key remains server-side. Browser JavaScript calls a nonce-protected WordPress AJAX action and never receives the upstream credential. The WordPress screen exposes the complete read-only report, while account and tracking changes remain in the GT Analytics website.

== Installation ==

1. Upload and activate the plugin.
2. Create an API key in GT Analytics under Account & API.
3. Open GT Analytics > Settings in WordPress.
4. Save the analytics URL and site-scoped API key, then test the connection.
5. Open GT Analytics > Dashboard for the complete report or view the compact widget on Dashboard > Home.

For stronger secret handling, define `GT_ANALYTICS_API_URL` and `GT_ANALYTICS_API_KEY` in `wp-config.php`.

== External services ==

This plugin connects to the GT Analytics installation URL configured by the site administrator. It sends the saved site-scoped API key in an Authorization header to retrieve read-only site, analytics, and real-time data. No request is made until an administrator configures the plugin.

GT Analytics is self-hostable software. Its source, documentation, privacy notes, and license are available at https://github.com/wpgaurav/gt-analytics. Data handling is governed by the operator of the configured GT Analytics installation.

== Changelog ==

= 1.2.2 =
* Added active pages now and corrected real-time pageview labels.

= 1.2.1 =
* Show visitor and view counts only in hover and keyboard-focus tooltips.

= 1.2.0 =
* Added complete read-only reports with 30-day default, preset and custom ranges, filters, linked URLs, labeled visitor/view charts, and expandable conversion attribution.

= 1.1.0 =
* Require a site-scoped API key and derive the site automatically.
* Add a top-level GT Analytics menu with the complete native dashboard.
* Keep the compact Dashboard Home widget for quick checks.

= 1.0.0 =
* Initial real-time and seven-day WordPress dashboard integration.
