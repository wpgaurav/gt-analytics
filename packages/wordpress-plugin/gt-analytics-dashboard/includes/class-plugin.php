<?php
/**
 * Plugin loader.
 *
 * @package GT_Analytics_Dashboard
 */

namespace GT_Analytics_Dashboard;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Plugin {
	/**
	 * Registers the admin-only integration.
	 *
	 * @return void
	 */
	public function register() {
		if ( ! is_admin() ) {
			return;
		}

		$settings = get_option( API_Client::OPTION_NAME, array() );
		$client   = new API_Client( is_array( $settings ) ? $settings : array() );
		$service  = new Data_Service( $client );
		$admin    = new Admin( $client, $service );
		$admin->register();
	}
}
