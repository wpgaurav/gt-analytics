<?php
/**
 * Server-side GT Analytics API client.
 *
 * @package GT_Analytics_Dashboard
 */

namespace GT_Analytics_Dashboard;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class API_Client {
	const OPTION_NAME      = 'gt_analytics_dashboard_settings';
	const DEFAULT_BASE_URL = 'https://stats.gauravtiwari.org';

	/** @var array<string, string> */
	private $settings;

	/**
	 * @param array<string, string> $settings Saved plugin settings.
	 */
	public function __construct( array $settings ) {
		$this->settings = $settings;
	}

	/**
	 * Returns the configured analytics website root.
	 *
	 * @return string
	 */
	public function get_base_url() {
		$value = defined( 'GT_ANALYTICS_API_URL' )
			? constant( 'GT_ANALYTICS_API_URL' )
			: ( isset( $this->settings['base_url'] ) ? $this->settings['base_url'] : self::DEFAULT_BASE_URL );

		return untrailingslashit( (string) $value );
	}

	/**
	 * Returns the report timezone.
	 *
	 * @return string
	 */
	public function get_timezone() {
		$value = isset( $this->settings['timezone'] ) ? $this->settings['timezone'] : 'UTC';
		return in_array( $value, timezone_identifiers_list(), true ) ? $value : 'UTC';
	}

	/**
	 * Indicates whether the minimum credentials are present.
	 *
	 * @return bool
	 */
	public function is_configured() {
		return '' !== $this->get_api_key();
	}

	/**
	 * Returns an opaque cache namespace without exposing the key.
	 *
	 * @return string
	 */
	public function get_fingerprint() {
		return hash( 'sha256', $this->get_base_url() . '|' . $this->get_timezone() . '|' . $this->get_api_key() );
	}

	/**
	 * Returns the full dashboard URL for the selected site.
	 *
	 * @return string
	 */
	public function get_dashboard_url( $site_id = '' ) {
		$query = array( 'interval' => '30d' );
		if ( '' !== $site_id ) {
			$query['site'] = $site_id;
		}
		return add_query_arg(
			$query,
			$this->get_base_url() . '/dashboard'
		);
	}

	/**
	 * Gets sites available to the API key.
	 *
	 * @return array<int, array<string, mixed>>|\WP_Error
	 */
	public function get_sites() {
		$data = $this->request( 'sites' );
		return is_wp_error( $data ) ? $data : array_values( $data );
	}

	/**
	 * Gets a complete read-only report for the requested range and filters.
	 *
	 * @param string               $interval Report interval.
	 * @param array<string, string> $filters  Optional dashboard filters.
	 * @return array<string, mixed>|\WP_Error
	 */
	public function get_analytics( $interval = '30d', array $filters = array() ) {
		$allowed_filters = array( 'path', 'referrer', 'deviceModel', 'deviceType', 'country', 'browserName', 'browserVersion', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'channel', 'referrerHost' );
		$query           = array(
			'interval' => $this->normalize_interval( $interval ),
			'timezone' => $this->get_timezone(),
			'limit'    => 20,
		);
		foreach ( $allowed_filters as $key ) {
			if ( isset( $filters[ $key ] ) && '' !== $filters[ $key ] ) {
				$query[ $key ] = substr( (string) $filters[ $key ], 0, 500 );
			}
		}
		return $this->request(
			'analytics',
			$query
		);
	}

	/** @return string */
	private function normalize_interval( $interval ) {
		$value = (string) $interval;
		if ( in_array( $value, array( 'today', 'yesterday', '1d', '7d', '30d', '90d', '180d', '365d' ), true ) ) {
			return $value;
		}
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/', $value ) ) {
			return $value;
		}
		return '30d';
	}

	/**
	 * Gets the current real-time snapshot.
	 *
	 * @return array<string, mixed>|\WP_Error
	 */
	public function get_realtime() {
		return $this->request( 'realtime' );
	}

	/**
	 * Performs one authenticated API request entirely on the server.
	 *
	 * @param string               $endpoint Endpoint below /api/v1.
	 * @param array<string, mixed> $query    Query parameters.
	 * @return array<string, mixed>|array<int, mixed>|\WP_Error
	 */
	private function request( $endpoint, array $query = array() ) {
		$key = $this->get_api_key();
		if ( '' === $key ) {
			return new \WP_Error( 'gtad_missing_key', __( 'Add a GT Analytics API key in the plugin settings.', 'gt-analytics-dashboard' ) );
		}

		$base_url = $this->get_base_url();
		$parts    = wp_parse_url( $base_url );
		if ( ! is_array( $parts ) || empty( $parts['host'] ) || 'https' !== strtolower( isset( $parts['scheme'] ) ? $parts['scheme'] : '' ) ) {
			return new \WP_Error( 'gtad_invalid_url', __( 'The GT Analytics URL must be a valid HTTPS address.', 'gt-analytics-dashboard' ) );
		}

		$url = add_query_arg( $query, $base_url . '/api/v1/' . ltrim( $endpoint, '/' ) );
		$args = array(
			'timeout'             => 8,
			'redirection'         => 2,
			'limit_response_size' => 1024 * 1024,
			'headers'             => array(
				'Authorization' => 'Bearer ' . $key,
				'Accept'        => 'application/json',
			),
		);

		/**
		 * Filters outbound HTTP arguments without exposing them to browser code.
		 *
		 * @param array<string, mixed> $args HTTP request arguments.
		 * @param string               $url  API request URL.
		 */
		$args     = apply_filters( 'gt_analytics_dashboard_http_args', $args, $url );
		$response = wp_safe_remote_get( $url, $args );

		if ( is_wp_error( $response ) ) {
			return new \WP_Error( 'gtad_http_error', __( 'GT Analytics could not be reached. Try again shortly.', 'gt-analytics-dashboard' ) );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$body   = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( 401 === $status || 403 === $status ) {
			return new \WP_Error( 'gtad_unauthorized', __( 'The API key is invalid or lacks analytics and real-time read access.', 'gt-analytics-dashboard' ) );
		}
		if ( 404 === $status ) {
			return new \WP_Error( 'gtad_site_not_found', __( 'The site assigned to this API key is unavailable.', 'gt-analytics-dashboard' ) );
		}
		if ( $status < 200 || $status >= 300 || ! is_array( $body ) ) {
			return new \WP_Error( 'gtad_api_error', __( 'GT Analytics returned an unexpected response.', 'gt-analytics-dashboard' ) );
		}
		if ( ! isset( $body['data'] ) || ! is_array( $body['data'] ) ) {
			return new \WP_Error( 'gtad_invalid_response', __( 'GT Analytics returned an invalid data payload.', 'gt-analytics-dashboard' ) );
		}

		return $body['data'];
	}

	/**
	 * Returns the API key from a constant or the saved option.
	 *
	 * @return string
	 */
	private function get_api_key() {
		$value = defined( 'GT_ANALYTICS_API_KEY' )
			? constant( 'GT_ANALYTICS_API_KEY' )
			: ( isset( $this->settings['api_key'] ) ? $this->settings['api_key'] : '' );

		return trim( (string) $value );
	}
}
