<?php
require_once __DIR__ . '/bootstrap.php';

use GT_Analytics_Dashboard\API_Client;
use GT_Analytics_Dashboard\Data_Service;

$tests = array();

function gtad_test( $name, $callback ) {
	global $tests;
	$tests[] = array( $name, $callback );
}

function gtad_assert( $condition, $message ) {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
}

function gtad_response( $data, $status = 200 ) {
	return array(
		'response' => array( 'code' => $status ),
		'body'     => json_encode( array( 'data' => $data ) ),
	);
}

function gtad_client() {
	return new API_Client(
		array(
			'base_url' => 'https://stats.example.com',
			'api_key'  => 'gta_prefix_secret',
			'site_id'  => 'example.com',
			'timezone' => 'Asia/Kolkata',
		)
	);
}

gtad_test(
	'sends the API key only in the server-side Authorization header',
	function () {
		$captured = array();
		$GLOBALS['gtad_http_callback'] = function ( $url, $args ) use ( &$captured ) {
			$captured = array( $url, $args );
			return gtad_response( array( array( 'id' => 'example.com' ) ) );
		};

		$sites = gtad_client()->get_sites();
		gtad_assert( ! is_wp_error( $sites ), 'Sites request should succeed.' );
		gtad_assert( 'https://stats.example.com/api/v1/sites' === $captured[0], 'Sites endpoint is incorrect.' );
		gtad_assert( 'Bearer gta_prefix_secret' === $captured[1]['headers']['Authorization'], 'Bearer header is missing.' );
		gtad_assert( false === strpos( $captured[0], 'gta_prefix_secret' ), 'API key leaked into the URL.' );
	}
);

gtad_test(
	'requests the selected site, seven-day interval, and timezone',
	function () {
		$url = '';
		$GLOBALS['gtad_http_callback'] = function ( $request_url ) use ( &$url ) {
			$url = $request_url;
			return gtad_response( array( 'summary' => array() ) );
		};

		gtad_client()->get_seven_day_analytics();
		parse_str( parse_url( $url, PHP_URL_QUERY ), $query );
		gtad_assert( 'example.com' === $query['site'], 'Site ID was not sent.' );
		gtad_assert( '7d' === $query['interval'], 'Seven-day interval was not sent.' );
		gtad_assert( 'Asia/Kolkata' === $query['timezone'], 'Timezone was not sent.' );
	}
);

gtad_test(
	'returns a safe actionable error for rejected credentials',
	function () {
		$GLOBALS['gtad_http_callback'] = function () {
			return array( 'response' => array( 'code' => 401 ), 'body' => '{"error":"unauthorized"}' );
		};

		$result = gtad_client()->get_realtime();
		gtad_assert( is_wp_error( $result ), 'Unauthorized request should return WP_Error.' );
		gtad_assert( 'gtad_unauthorized' === $result->get_error_code(), 'Unauthorized error code is incorrect.' );
		gtad_assert( false === strpos( $result->get_error_message(), 'gta_prefix_secret' ), 'Error exposed the key.' );
	}
);

gtad_test(
	'caches seven-day data and allows an explicit realtime refresh',
	function () {
		$GLOBALS['gtad_transients'] = array();
		$calls = array( 'analytics' => 0, 'realtime' => 0 );
		$GLOBALS['gtad_http_callback'] = function ( $url ) use ( &$calls ) {
			if ( false !== strpos( $url, '/analytics?' ) ) {
				++$calls['analytics'];
				return gtad_response( array( 'summary' => array( 'views' => 10 ) ) );
			}
			++$calls['realtime'];
			return gtad_response( array( 'activeVisitors' => 2 ) );
		};

		$service = new Data_Service( gtad_client() );
		$service->get_snapshot();
		$service->get_snapshot();
		gtad_assert( 1 === $calls['analytics'], 'Seven-day data should be cached.' );
		gtad_assert( 1 === $calls['realtime'], 'Realtime data should use its short cache.' );
		$service->get_snapshot( true );
		gtad_assert( 1 === $calls['analytics'], 'Realtime refresh must not refetch seven-day data.' );
		gtad_assert( 2 === $calls['realtime'], 'Forced realtime refresh did not call the API.' );
	}
);

$failures = 0;
foreach ( $tests as $test ) {
	try {
		call_user_func( $test[1] );
		echo "PASS {$test[0]}\n";
	} catch ( Throwable $error ) {
		++$failures;
		fwrite( STDERR, "FAIL {$test[0]}: {$error->getMessage()}\n" );
	}
}

echo sprintf( "%d tests, %d failures\n", count( $tests ), $failures );
exit( $failures > 0 ? 1 : 0 );
