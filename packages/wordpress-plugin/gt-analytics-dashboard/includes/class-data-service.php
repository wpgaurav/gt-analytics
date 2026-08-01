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
	 * @param bool                  $force_realtime Skip the short real-time cache.
	 * @param string                $interval       Historical report interval.
	 * @param array<string, string> $filters        Historical report filters.
	 * @return array<string, mixed>|\WP_Error
	 */
	public function get_snapshot( $force_realtime = false, $interval = '30d', array $filters = array() ) {
		if ( ! $this->client->is_configured() ) {
			return new \WP_Error( 'gtad_not_configured', __( 'Connect a site-scoped GT Analytics API key to display analytics.', 'gt-analytics-dashboard' ) );
		}

		$sites     = $this->get_sites();
		$cache_key = 'analytics_' . substr( hash( 'sha256', $interval . '|' . json_encode( $filters ) ), 0, 16 );
		$analytics = $this->remember(
			$cache_key,
			self::ANALYTICS_TTL,
			function () use ( $interval, $filters ) {
				return $this->client->get_analytics( $interval, $filters );
			}
		);
		$realtime  = $this->remember( 'realtime', self::REALTIME_TTL, array( $this->client, 'get_realtime' ), $force_realtime );
		$site      = ! is_wp_error( $sites ) && isset( $sites[0] ) && is_array( $sites[0] ) ? $sites[0] : array();

		return array(
			'site'      => $site,
			'analytics' => is_wp_error( $analytics ) ? null : $analytics,
			'realtime'  => is_wp_error( $realtime ) ? null : $realtime,
			'errors'    => array_values(
				array_filter(
					array(
						is_wp_error( $sites ) ? $sites->get_error_message() : null,
						is_wp_error( $analytics ) ? $analytics->get_error_message() : null,
						is_wp_error( $realtime ) ? $realtime->get_error_message() : null,
					)
				)
			),
			'interval'  => $interval,
			'filters'   => $filters,
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
