<?php
/**
 * Cached analytics data service.
 *
 * @package GT_Analytics_Dashboard
 */

namespace GT_Analytics_Dashboard;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Data_Service {
	const ANALYTICS_TTL = 5 * MINUTE_IN_SECONDS;
	const REALTIME_TTL  = 15;
	const SITES_TTL     = 5 * MINUTE_IN_SECONDS;

	/** @var API_Client */
	private $client;

	public function __construct( API_Client $client ) {
		$this->client = $client;
	}

	/**
	 * Returns the sites belonging to the configured key.
	 *
	 * @param bool $force Skip the transient cache.
	 * @return array<int, array<string, mixed>>|\WP_Error
	 */
	public function get_sites( $force = false ) {
		return $this->remember( 'sites', self::SITES_TTL, array( $this->client, 'get_sites' ), $force );
	}

	/**
	 * Returns both report windows while allowing partial failures.
	 *
	 * @param bool $force_realtime Skip the short real-time cache.
	 * @return array<string, mixed>|\WP_Error
	 */
	public function get_snapshot( $force_realtime = false ) {
		if ( ! $this->client->is_configured() ) {
			return new \WP_Error( 'gtad_not_configured', __( 'Connect GT Analytics and select a site to display this widget.', 'gt-analytics-dashboard' ) );
		}

		$analytics = $this->remember( 'analytics', self::ANALYTICS_TTL, array( $this->client, 'get_seven_day_analytics' ) );
		$realtime  = $this->remember( 'realtime', self::REALTIME_TTL, array( $this->client, 'get_realtime' ), $force_realtime );

		return array(
			'analytics' => is_wp_error( $analytics ) ? null : $analytics,
			'realtime'  => is_wp_error( $realtime ) ? null : $realtime,
			'errors'    => array_values(
				array_filter(
					array(
						is_wp_error( $analytics ) ? $analytics->get_error_message() : null,
						is_wp_error( $realtime ) ? $realtime->get_error_message() : null,
					)
				)
			),
		);
	}

	/**
	 * Caches successful results only.
	 *
	 * @param string   $bucket   Cache namespace.
	 * @param int      $ttl      Cache lifetime in seconds.
	 * @param callable $callback Fetch callback.
	 * @param bool     $force    Skip any cached value.
	 * @return mixed
	 */
	private function remember( $bucket, $ttl, $callback, $force = false ) {
		$key = 'gtad_' . $bucket . '_' . substr( $this->client->get_fingerprint(), 0, 24 );
		if ( ! $force ) {
			$cached = get_transient( $key );
			if ( false !== $cached ) {
				return $cached;
			}
		}

		$value = call_user_func( $callback );
		if ( ! is_wp_error( $value ) ) {
			set_transient( $key, $value, $ttl );
		}

		return $value;
	}
}
