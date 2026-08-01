<?php
/**
 * Minimal WordPress function stubs for isolated API client tests.
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'MINUTE_IN_SECONDS', 60 );

class WP_Error {
	private $code;
	private $message;

	public function __construct( $code = '', $message = '' ) {
		$this->code    = $code;
		$this->message = $message;
	}

	public function get_error_code() {
		return $this->code;
	}

	public function get_error_message() {
		return $this->message;
	}
}

$GLOBALS['gtad_http_callback'] = null;
$GLOBALS['gtad_transients']    = array();

function __( $text ) {
	return $text;
}

function untrailingslashit( $value ) {
	return rtrim( $value, '/\\' );
}

function wp_parse_url( $url ) {
	return parse_url( $url );
}

function add_query_arg( $args, $url ) {
	$separator = false === strpos( $url, '?' ) ? '?' : '&';
	return $url . ( empty( $args ) ? '' : $separator . http_build_query( $args ) );
}

function apply_filters( $hook, $value ) {
	return $value;
}

function wp_safe_remote_get( $url, $args ) {
	return call_user_func( $GLOBALS['gtad_http_callback'], $url, $args );
}

function wp_remote_retrieve_response_code( $response ) {
	return isset( $response['response']['code'] ) ? $response['response']['code'] : 0;
}

function wp_remote_retrieve_body( $response ) {
	return isset( $response['body'] ) ? $response['body'] : '';
}

function is_wp_error( $value ) {
	return $value instanceof WP_Error;
}

function get_transient( $key ) {
	return array_key_exists( $key, $GLOBALS['gtad_transients'] ) ? $GLOBALS['gtad_transients'][ $key ] : false;
}

function set_transient( $key, $value ) {
	$GLOBALS['gtad_transients'][ $key ] = $value;
	return true;
}

require_once dirname( __DIR__ ) . '/gt-analytics-dashboard/includes/class-api-client.php';
require_once dirname( __DIR__ ) . '/gt-analytics-dashboard/includes/class-data-service.php';
