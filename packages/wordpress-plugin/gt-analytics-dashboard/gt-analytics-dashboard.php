<?php
/**
 * Plugin Name: GT Analytics Dashboard
 * Plugin URI:  https://github.com/wpgaurav/gt-analytics
 * Description: Shows the complete read-only GT Analytics dashboard inside WordPress.
 * Version:     1.2.1
 * Author:      Gaurav Tiwari
 * Author URI:  https://gauravtiwari.org/
 * License:     MIT
 * License URI: https://opensource.org/license/mit/
 * Text Domain: gt-analytics-dashboard
 * Requires at least: 6.5
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'GT_ANALYTICS_DASHBOARD_VERSION', '1.2.1' );
define( 'GT_ANALYTICS_DASHBOARD_FILE', __FILE__ );
define( 'GT_ANALYTICS_DASHBOARD_DIR', plugin_dir_path( __FILE__ ) );
define( 'GT_ANALYTICS_DASHBOARD_URL', plugin_dir_url( __FILE__ ) );

require_once GT_ANALYTICS_DASHBOARD_DIR . 'includes/class-api-client.php';
require_once GT_ANALYTICS_DASHBOARD_DIR . 'includes/class-data-service.php';
require_once GT_ANALYTICS_DASHBOARD_DIR . 'includes/class-admin.php';
require_once GT_ANALYTICS_DASHBOARD_DIR . 'includes/class-plugin.php';

/**
 * Starts the plugin after all active plugins are available.
 *
 * @return void
 */
function gt_analytics_dashboard_boot() {
	$plugin = new GT_Analytics_Dashboard\Plugin();
	$plugin->register();
}

add_action( 'plugins_loaded', 'gt_analytics_dashboard_boot' );
