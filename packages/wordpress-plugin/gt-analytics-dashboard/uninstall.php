<?php
/**
 * Removes plugin-owned configuration on uninstall.
 *
 * @package GT_Analytics_Dashboard
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'gt_analytics_dashboard_settings' );

if ( is_multisite() ) {
	$site_ids = get_sites( array( 'fields' => 'ids' ) );
	foreach ( $site_ids as $site_id ) {
		switch_to_blog( (int) $site_id );
		delete_option( 'gt_analytics_dashboard_settings' );
		restore_current_blog();
	}
}
