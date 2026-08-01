<?php
/**
 * WordPress admin integration.
 *
 * @package GT_Analytics_Dashboard
 */

namespace GT_Analytics_Dashboard;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Admin {
	const SETTINGS_GROUP = 'gt_analytics_dashboard';
	const MENU_PAGE      = 'gt-analytics';
	const SETTINGS_PAGE  = 'gt-analytics-settings';
	const AJAX_ACTION    = 'gt_analytics_dashboard_refresh';
	const NONCE_ACTION   = 'gt_analytics_dashboard_refresh';

	/** @var API_Client */
	private $client;

	/** @var Data_Service */
	private $service;

	/** @var string */
	private $settings_hook = '';

	/** @var string */
	private $dashboard_hook = '';

	public function __construct( API_Client $client, Data_Service $service ) {
		$this->client  = $client;
		$this->service = $service;
	}

	/**
	 * Registers all admin hooks.
	 *
	 * @return void
	 */
	public function register() {
		add_action( 'admin_menu', array( $this, 'add_menu_pages' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'wp_dashboard_setup', array( $this, 'register_dashboard_widget' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'wp_ajax_' . self::AJAX_ACTION, array( $this, 'ajax_refresh' ) );
		add_action( 'admin_post_gt_analytics_dashboard_test', array( $this, 'test_connection' ) );
	}

	/**
	 * Adds a first-class analytics menu with dashboard and settings screens.
	 *
	 * @return void
	 */
	public function add_menu_pages() {
		$this->dashboard_hook = add_menu_page(
			__( 'GT Analytics', 'gt-analytics-dashboard' ),
			__( 'GT Analytics', 'gt-analytics-dashboard' ),
			$this->capability(),
			self::MENU_PAGE,
			array( $this, 'render_analytics_page' ),
			'dashicons-chart-bar',
			25
		);
		add_submenu_page(
			self::MENU_PAGE,
			__( 'Analytics Dashboard', 'gt-analytics-dashboard' ),
			__( 'Dashboard', 'gt-analytics-dashboard' ),
			$this->capability(),
			self::MENU_PAGE,
			array( $this, 'render_analytics_page' )
		);
		$this->settings_hook = add_submenu_page(
			self::MENU_PAGE,
			__( 'GT Analytics Settings', 'gt-analytics-dashboard' ),
			__( 'Settings', 'gt-analytics-dashboard' ),
			$this->capability(),
			self::SETTINGS_PAGE,
			array( $this, 'render_settings_page' )
		);
	}

	/**
	 * Registers one array option using the WordPress Settings API.
	 *
	 * @return void
	 */
	public function register_settings() {
		register_setting(
			self::SETTINGS_GROUP,
			API_Client::OPTION_NAME,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize_settings' ),
				'default'           => array(
					'base_url' => API_Client::DEFAULT_BASE_URL,
					'api_key'  => '',
					'timezone' => 'UTC',
				),
			)
		);

		add_settings_section(
			'gtad_connection',
			__( 'Connection', 'gt-analytics-dashboard' ),
			array( $this, 'render_connection_intro' ),
			self::SETTINGS_PAGE
		);

		add_settings_field( 'gtad_base_url', __( 'Analytics URL', 'gt-analytics-dashboard' ), array( $this, 'render_base_url_field' ), self::SETTINGS_PAGE, 'gtad_connection' );
		add_settings_field( 'gtad_api_key', __( 'API key', 'gt-analytics-dashboard' ), array( $this, 'render_api_key_field' ), self::SETTINGS_PAGE, 'gtad_connection' );
		add_settings_field( 'gtad_timezone', __( 'Report timezone', 'gt-analytics-dashboard' ), array( $this, 'render_timezone_field' ), self::SETTINGS_PAGE, 'gtad_connection' );
	}

	/**
	 * Validates settings without ever echoing the API key back into markup.
	 *
	 * @param mixed $input Submitted setting value.
	 * @return array<string, string>
	 */
	public function sanitize_settings( $input ) {
		$old   = get_option( API_Client::OPTION_NAME, array() );
		$old   = is_array( $old ) ? $old : array();
		$input = is_array( $input ) ? wp_unslash( $input ) : array();

		$output = array(
			'base_url' => isset( $old['base_url'] ) ? $old['base_url'] : API_Client::DEFAULT_BASE_URL,
			'api_key'  => isset( $old['api_key'] ) ? $old['api_key'] : '',
			'timezone' => isset( $old['timezone'] ) ? $old['timezone'] : 'UTC',
		);

		if ( ! defined( 'GT_ANALYTICS_API_URL' ) ) {
			$base_url = isset( $input['base_url'] ) ? esc_url_raw( trim( (string) $input['base_url'] ) ) : '';
			$base_url = preg_replace( '#/api/v1/?$#i', '', $base_url );
			$parts    = wp_parse_url( $base_url );
			if ( ! is_array( $parts ) || empty( $parts['host'] ) || 'https' !== strtolower( isset( $parts['scheme'] ) ? $parts['scheme'] : '' ) ) {
				add_settings_error( API_Client::OPTION_NAME, 'invalid_url', __( 'Use the HTTPS root URL of your GT Analytics installation.', 'gt-analytics-dashboard' ) );
			} else {
				$output['base_url'] = untrailingslashit( $base_url );
			}
		}

		if ( ! defined( 'GT_ANALYTICS_API_KEY' ) ) {
			$clear_key = ! empty( $input['clear_api_key'] );
			$new_key   = isset( $input['api_key'] ) ? sanitize_text_field( (string) $input['api_key'] ) : '';
			if ( $clear_key ) {
				$output['api_key'] = '';
			} elseif ( '' !== $new_key ) {
				$output['api_key'] = substr( $new_key, 0, 512 );
			}
		}

		$timezone = isset( $input['timezone'] ) ? sanitize_text_field( (string) $input['timezone'] ) : 'UTC';
		if ( in_array( $timezone, timezone_identifiers_list(), true ) ) {
			$output['timezone'] = $timezone;
		} else {
			add_settings_error( API_Client::OPTION_NAME, 'invalid_timezone', __( 'Select a valid IANA timezone.', 'gt-analytics-dashboard' ) );
		}

		return $output;
	}

	/** @return void */
	public function render_connection_intro() {
		echo '<p>' . esc_html__( 'Create an API key for this specific site in GT Analytics. The key is used only in server-side WordPress requests and cannot read another site.', 'gt-analytics-dashboard' ) . '</p>';
	}

	/** @return void */
	public function render_base_url_field() {
		if ( defined( 'GT_ANALYTICS_API_URL' ) ) {
			echo '<code>' . esc_html( $this->client->get_base_url() ) . '</code><p class="description">' . esc_html__( 'Defined by GT_ANALYTICS_API_URL in wp-config.php.', 'gt-analytics-dashboard' ) . '</p>';
			return;
		}

		printf(
			'<input class="regular-text" type="url" name="%1$s[base_url]" value="%2$s" required><p class="description">%3$s</p>',
			esc_attr( API_Client::OPTION_NAME ),
			esc_attr( $this->client->get_base_url() ),
			esc_html__( 'Installation root, for example https://stats.example.com. Do not include /api/v1.', 'gt-analytics-dashboard' )
		);
	}

	/** @return void */
	public function render_api_key_field() {
		if ( defined( 'GT_ANALYTICS_API_KEY' ) ) {
			echo '<strong>' . esc_html__( 'Configured securely in wp-config.php', 'gt-analytics-dashboard' ) . '</strong>';
			return;
		}

		$settings = get_option( API_Client::OPTION_NAME, array() );
		$has_key  = is_array( $settings ) && ! empty( $settings['api_key'] );
		printf(
			'<input class="regular-text" type="password" name="%1$s[api_key]" value="" autocomplete="off" placeholder="%2$s"><p class="description">%3$s</p>',
			esc_attr( API_Client::OPTION_NAME ),
			esc_attr( $has_key ? __( 'Saved key — leave blank to keep it', 'gt-analytics-dashboard' ) : __( 'gta_…', 'gt-analytics-dashboard' ) ),
			esc_html__( 'For best protection, define GT_ANALYTICS_API_KEY in wp-config.php instead of storing it in the database.', 'gt-analytics-dashboard' )
		);
		if ( $has_key ) {
			printf(
				'<label><input type="checkbox" name="%1$s[clear_api_key]" value="1"> %2$s</label>',
				esc_attr( API_Client::OPTION_NAME ),
				esc_html__( 'Remove the saved key', 'gt-analytics-dashboard' )
			);
		}
	}

	/** @return void */
	public function render_timezone_field() {
		printf( '<select name="%s[timezone]">', esc_attr( API_Client::OPTION_NAME ) );
		echo wp_timezone_choice( $this->client->get_timezone(), get_user_locale() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Core returns option elements.
		echo '</select>';
	}

	/**
	 * Renders the settings page.
	 *
	 * @return void
	 */
	public function render_settings_page() {
		if ( ! current_user_can( $this->capability() ) ) {
			wp_die( esc_html__( 'You are not allowed to manage GT Analytics.', 'gt-analytics-dashboard' ) );
		}

		$notice = get_transient( 'gtad_notice_' . get_current_user_id() );
		if ( false !== $notice ) {
			delete_transient( 'gtad_notice_' . get_current_user_id() );
		}
		?>
		<div class="wrap gtad-settings">
			<h1><?php esc_html_e( 'GT Analytics Settings', 'gt-analytics-dashboard' ); ?></h1>
			<p class="gtad-settings__lede"><?php esc_html_e( 'Connect WordPress with an API key created specifically for this site. The key determines the site automatically.', 'gt-analytics-dashboard' ); ?></p>
			<?php if ( is_array( $notice ) && isset( $notice['message'] ) ) : ?>
				<div class="notice notice-<?php echo esc_attr( ! empty( $notice['success'] ) ? 'success' : 'error' ); ?> is-dismissible"><p><?php echo esc_html( $notice['message'] ); ?></p></div>
			<?php endif; ?>
			<?php settings_errors( API_Client::OPTION_NAME ); ?>
			<form action="options.php" method="post">
				<?php
				settings_fields( self::SETTINGS_GROUP );
				do_settings_sections( self::SETTINGS_PAGE );
				submit_button( __( 'Save connection', 'gt-analytics-dashboard' ) );
				?>
			</form>
			<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post" class="gtad-test-form">
				<input type="hidden" name="action" value="gt_analytics_dashboard_test">
				<?php wp_nonce_field( 'gt_analytics_dashboard_test' ); ?>
				<?php submit_button( __( 'Test connection', 'gt-analytics-dashboard' ), 'secondary', 'submit', false ); ?>
			</form>
			<div class="gtad-settings__constants">
				<h2><?php esc_html_e( 'Optional wp-config.php constants', 'gt-analytics-dashboard' ); ?></h2>
				<pre><code>define( 'GT_ANALYTICS_API_URL', 'https://stats.example.com' );
define( 'GT_ANALYTICS_API_KEY', 'gta_...' );</code></pre>
			</div>
		</div>
		<?php
	}

	/** @return void */
	public function render_analytics_page() {
		if ( ! current_user_can( $this->capability() ) ) {
			wp_die( esc_html__( 'You are not allowed to view GT Analytics.', 'gt-analytics-dashboard' ) );
		}
		$interval = $this->request_interval();
		$filters  = $this->request_filters();
		?>
		<div class="wrap gtad-admin-page">
			<div class="gtad-admin-page__head">
				<div><h1><?php esc_html_e( 'GT Analytics', 'gt-analytics-dashboard' ); ?></h1><p><?php esc_html_e( 'Complete read-only analytics for this WordPress site, including real-time activity.', 'gt-analytics-dashboard' ); ?></p></div>
				<a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=' . self::SETTINGS_PAGE ) ); ?>"><?php esc_html_e( 'Settings', 'gt-analytics-dashboard' ); ?></a>
			</div>
			<div id="gt_analytics_dashboard_page" data-gtad-root data-gtad-view="dashboard">
				<?php echo $this->render_dashboard_inner( $this->service->get_snapshot( false, $interval, $filters ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Renderer escapes all dynamic values. ?>
			</div>
		</div>
		<?php
	}

	/**
	 * Tests the configured key and redirects back with a one-time notice.
	 *
	 * @return void
	 */
	public function test_connection() {
		if ( ! current_user_can( $this->capability() ) ) {
			wp_die( esc_html__( 'You are not allowed to test this connection.', 'gt-analytics-dashboard' ) );
		}
		check_admin_referer( 'gt_analytics_dashboard_test' );

		$sites = $this->service->get_sites( true );
		if ( is_wp_error( $sites ) ) {
			$notice = array( 'success' => false, 'message' => $sites->get_error_message() );
		} else {
			$notice = array(
				'success' => true,
				'message' => isset( $sites[0]['label'] )
					? sprintf( __( 'Connection successful. This key is restricted to %s.', 'gt-analytics-dashboard' ), (string) $sites[0]['label'] )
					: __( 'Connection successful. The site-scoped key is valid.', 'gt-analytics-dashboard' ),
			);
		}

		set_transient( 'gtad_notice_' . get_current_user_id(), $notice, MINUTE_IN_SECONDS );
		wp_safe_redirect( admin_url( 'admin.php?page=' . self::SETTINGS_PAGE ) );
		exit;
	}

	/** @return void */
	public function register_dashboard_widget() {
		if ( ! current_user_can( $this->capability() ) ) {
			return;
		}
		wp_add_dashboard_widget(
			'gt_analytics_dashboard_widget',
			__( 'GT Analytics', 'gt-analytics-dashboard' ),
			array( $this, 'render_dashboard_widget' )
		);
	}

	/** @return void */
	public function render_dashboard_widget() {
		echo '<div data-gtad-root data-gtad-view="widget">';
		echo $this->render_widget_inner( $this->service->get_snapshot() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Every dynamic value is escaped in the renderer.
		echo '</div>';
	}

	/**
	 * Loads assets only on WordPress Home and the plugin's own screens.
	 *
	 * @param string $hook_suffix Current admin screen hook.
	 * @return void
	 */
	public function enqueue_assets( $hook_suffix ) {
		if ( 'index.php' !== $hook_suffix && $this->dashboard_hook !== $hook_suffix && $this->settings_hook !== $hook_suffix ) {
			return;
		}

		wp_enqueue_style( 'gt-analytics-dashboard', GT_ANALYTICS_DASHBOARD_URL . 'assets/admin.css', array(), GT_ANALYTICS_DASHBOARD_VERSION );
		if ( 'index.php' === $hook_suffix || $this->dashboard_hook === $hook_suffix ) {
			wp_enqueue_script( 'gt-analytics-dashboard', GT_ANALYTICS_DASHBOARD_URL . 'assets/admin.js', array(), GT_ANALYTICS_DASHBOARD_VERSION, true );
			wp_localize_script(
				'gt-analytics-dashboard',
				'gtAnalyticsDashboard',
				array(
					'ajaxUrl' => admin_url( 'admin-ajax.php' ),
					'action'  => self::AJAX_ACTION,
					'nonce'   => wp_create_nonce( self::NONCE_ACTION ),
				)
			);
		}
	}

	/**
	 * Refreshes widget markup without exposing the upstream key.
	 *
	 * @return void
	 */
	public function ajax_refresh() {
		check_ajax_referer( self::NONCE_ACTION, 'nonce' );
		if ( ! current_user_can( $this->capability() ) ) {
			wp_send_json_error( array( 'message' => __( 'You are not allowed to view these analytics.', 'gt-analytics-dashboard' ) ), 403 );
		}

		$view     = isset( $_POST['view'] ) ? sanitize_key( wp_unslash( $_POST['view'] ) ) : 'widget';
		$interval = isset( $_POST['interval'] ) ? $this->sanitize_interval( wp_unslash( $_POST['interval'] ) ) : '30d';
		$filters  = $this->request_filters( $_POST );
		wp_send_json_success(
			array(
				'html' => 'dashboard' === $view
					? $this->render_dashboard_inner( $this->service->get_snapshot( true, $interval, $filters ) )
					: $this->render_widget_inner( $this->service->get_snapshot( true, $interval, $filters ) ),
			)
		);
	}

	/**
	 * Builds escaped widget content for initial and AJAX rendering.
	 *
	 * @param array<string, mixed>|\WP_Error $snapshot Analytics snapshot.
	 * @return string
	 */
	private function render_widget_inner( $snapshot ) {
		ob_start();
		if ( is_wp_error( $snapshot ) ) {
			$this->render_error_state( $snapshot->get_error_message() );
			return (string) ob_get_clean();
		}

		$analytics = isset( $snapshot['analytics'] ) && is_array( $snapshot['analytics'] ) ? $snapshot['analytics'] : array();
		$realtime  = isset( $snapshot['realtime'] ) && is_array( $snapshot['realtime'] ) ? $snapshot['realtime'] : array();
		$summary   = isset( $analytics['summary'] ) && is_array( $analytics['summary'] ) ? $analytics['summary'] : array();
		$errors    = isset( $snapshot['errors'] ) && is_array( $snapshot['errors'] ) ? $snapshot['errors'] : array();
		$site      = isset( $snapshot['site'] ) && is_array( $snapshot['site'] ) ? $snapshot['site'] : array();
		$site_id   = isset( $site['id'] ) ? (string) $site['id'] : ( isset( $analytics['site'] ) ? (string) $analytics['site'] : '' );
		$site_name = isset( $site['label'] ) && '' !== $site['label'] ? (string) $site['label'] : $site_id;
		$base_url  = isset( $site['baseUrl'] ) ? (string) $site['baseUrl'] : '';
		$interval  = isset( $snapshot['interval'] ) ? (string) $snapshot['interval'] : '30d';
		?>
		<div class="gtad-widget">
			<div class="gtad-widget__bar">
				<div><strong><?php echo esc_html( $site_name ); ?></strong><span><?php echo esc_html( sprintf( __( 'Realtime + %s', 'gt-analytics-dashboard' ), $this->interval_label( $interval ) ) ); ?></span></div>
				<div class="gtad-widget__actions"><select data-gtad-interval aria-label="<?php esc_attr_e( 'Report range', 'gt-analytics-dashboard' ); ?>"><option value="1d" <?php selected( $interval, '1d' ); ?>>1d</option><option value="7d" <?php selected( $interval, '7d' ); ?>>7d</option><option value="30d" <?php selected( $interval, '30d' ); ?>>30d</option><option value="90d" <?php selected( $interval, '90d' ); ?>>90d</option></select><button type="button" class="button-link gtad-refresh" data-gtad-refresh aria-label="<?php esc_attr_e( 'Refresh analytics', 'gt-analytics-dashboard' ); ?>"><span class="dashicons dashicons-update" aria-hidden="true"></span></button></div>
			</div>

			<?php if ( ! empty( $errors ) ) : ?>
				<div class="gtad-inline-error" role="status"><?php echo esc_html( implode( ' ', array_map( 'strval', $errors ) ) ); ?></div>
			<?php endif; ?>

			<div class="gtad-kpis">
				<?php $this->render_metric( __( 'Active now', 'gt-analytics-dashboard' ), $this->integer_value( $realtime, 'activeVisitors' ), 'is-live' ); ?>
				<?php $this->render_metric( __( 'Views · 1 min', 'gt-analytics-dashboard' ), $this->integer_value( $realtime, 'viewsLastMinute' ) ); ?>
				<?php $this->render_metric( __( 'Visitors', 'gt-analytics-dashboard' ), $this->integer_value( $summary, 'visitors' ) ); ?>
				<?php $this->render_metric( __( 'Views', 'gt-analytics-dashboard' ), $this->integer_value( $summary, 'views' ) ); ?>
				<?php $this->render_metric( __( 'Bounce rate', 'gt-analytics-dashboard' ), $this->format_percentage( isset( $summary['bounceRate'] ) ? $summary['bounceRate'] : null ) ); ?>
				<?php $this->render_metric( __( 'Avg. time', 'gt-analytics-dashboard' ), $this->format_duration( isset( $summary['avgDurationSeconds'] ) ? $summary['avgDurationSeconds'] : null ) ); ?>
			</div>

			<?php $this->render_series( isset( $analytics['series'] ) && is_array( $analytics['series'] ) ? $analytics['series'] : array() ); ?>
			<?php $this->render_top_paths( isset( $realtime['topPaths'] ) && is_array( $realtime['topPaths'] ) ? $realtime['topPaths'] : array(), $base_url ); ?>

			<div class="gtad-widget__footer">
				<span aria-live="polite"><?php echo esc_html( $this->generated_label( $analytics, $realtime ) ); ?></span>
				<a class="button button-secondary" href="<?php echo esc_url( $this->client->get_dashboard_url( $site_id ) ); ?>" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'Open GT Analytics website', 'gt-analytics-dashboard' ); ?></a>
			</div>
		</div>
		<?php
		return (string) ob_get_clean();
	}

	/**
	 * Builds the complete native WordPress analytics screen.
	 *
	 * @param array<string, mixed>|\WP_Error $snapshot Analytics snapshot.
	 * @return string
	 */
	private function render_dashboard_inner( $snapshot ) {
		ob_start();
		if ( is_wp_error( $snapshot ) ) {
			$this->render_error_state( $snapshot->get_error_message() );
			return (string) ob_get_clean();
		}

		$analytics = isset( $snapshot['analytics'] ) && is_array( $snapshot['analytics'] ) ? $snapshot['analytics'] : array();
		$realtime  = isset( $snapshot['realtime'] ) && is_array( $snapshot['realtime'] ) ? $snapshot['realtime'] : array();
		$summary   = isset( $analytics['summary'] ) && is_array( $analytics['summary'] ) ? $analytics['summary'] : array();
		$errors    = isset( $snapshot['errors'] ) && is_array( $snapshot['errors'] ) ? $snapshot['errors'] : array();
		$site      = isset( $snapshot['site'] ) && is_array( $snapshot['site'] ) ? $snapshot['site'] : array();
		$site_id   = isset( $site['id'] ) ? (string) $site['id'] : ( isset( $analytics['site'] ) ? (string) $analytics['site'] : '' );
		$site_name = isset( $site['label'] ) && '' !== $site['label'] ? (string) $site['label'] : $site_id;
		$base_url  = isset( $site['baseUrl'] ) ? (string) $site['baseUrl'] : '';
		$interval  = isset( $snapshot['interval'] ) ? (string) $snapshot['interval'] : '30d';
		$filters   = isset( $snapshot['filters'] ) && is_array( $snapshot['filters'] ) ? $snapshot['filters'] : array();
		$range     = $this->interval_label( $interval );
		?>
		<div class="gtad-dashboard">
			<div class="gtad-dashboard__bar">
				<div><strong><?php echo esc_html( $site_name ); ?></strong><span><?php echo esc_html( $site_id ); ?> · <?php echo esc_html( $range ); ?></span></div>
				<div class="gtad-dashboard__actions"><button type="button" class="button gtad-refresh" data-gtad-refresh><span class="dashicons dashicons-update" aria-hidden="true"></span> <?php esc_html_e( 'Refresh', 'gt-analytics-dashboard' ); ?></button><a class="button button-primary" href="<?php echo esc_url( $this->client->get_dashboard_url( $site_id ) ); ?>" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'Open website analytics', 'gt-analytics-dashboard' ); ?></a></div>
			</div>

			<?php $this->render_report_controls( $interval, $filters ); ?>

			<?php if ( ! empty( $errors ) ) : ?><div class="gtad-inline-error" role="status"><?php echo esc_html( implode( ' ', array_map( 'strval', $errors ) ) ); ?></div><?php endif; ?>

			<div class="gtad-kpis gtad-kpis--page">
				<?php $this->render_metric( __( 'Active now', 'gt-analytics-dashboard' ), $this->integer_value( $realtime, 'activeVisitors' ), 'is-live' ); ?>
				<?php $this->render_metric( __( 'Views · 1 min', 'gt-analytics-dashboard' ), $this->integer_value( $realtime, 'viewsLastMinute' ) ); ?>
				<?php $this->render_metric( sprintf( __( 'Visitors · %s', 'gt-analytics-dashboard' ), $range ), $this->integer_value( $summary, 'visitors' ) ); ?>
				<?php $this->render_metric( sprintf( __( 'Views · %s', 'gt-analytics-dashboard' ), $range ), $this->integer_value( $summary, 'views' ) ); ?>
				<?php $this->render_metric( __( 'Bounce rate', 'gt-analytics-dashboard' ), $this->format_percentage( isset( $summary['bounceRate'] ) ? $summary['bounceRate'] : null ) ); ?>
				<?php $this->render_metric( __( 'Avg. time', 'gt-analytics-dashboard' ), $this->format_duration( isset( $summary['avgDurationSeconds'] ) ? $summary['avgDurationSeconds'] : null ) ); ?>
			</div>

			<section class="gtad-panel gtad-panel--wide"><h2><?php esc_html_e( 'Traffic trend', 'gt-analytics-dashboard' ); ?></h2><?php $this->render_series( isset( $analytics['series'] ) && is_array( $analytics['series'] ) ? $analytics['series'] : array() ); ?></section>

			<div class="gtad-dashboard-grid">
				<?php $this->render_pages_table( isset( $analytics['pages'] ) && is_array( $analytics['pages'] ) ? $analytics['pages'] : array(), $base_url ); ?>
				<?php $this->render_tuple_card( __( 'Live pages', 'gt-analytics-dashboard' ), isset( $realtime['topPaths'] ) && is_array( $realtime['topPaths'] ) ? $realtime['topPaths'] : array(), 'path', $base_url ); ?>
				<?php $this->render_tuple_card( __( 'Live channels', 'gt-analytics-dashboard' ), isset( $realtime['topChannels'] ) && is_array( $realtime['topChannels'] ) ? $realtime['topChannels'] : array() ); ?>
				<?php $this->render_tuple_card( __( 'Live referrers', 'gt-analytics-dashboard' ), isset( $realtime['topReferrers'] ) && is_array( $realtime['topReferrers'] ) ? $realtime['topReferrers'] : array(), 'referrerHost' ); ?>
				<?php $this->render_tuple_card( __( 'Live countries', 'gt-analytics-dashboard' ), isset( $realtime['topCountries'] ) && is_array( $realtime['topCountries'] ) ? $realtime['topCountries'] : array() ); ?>
				<?php $this->render_referrers_table( isset( $analytics['referrers'] ) && is_array( $analytics['referrers'] ) ? $analytics['referrers'] : array(), $range ); ?>
				<?php $this->render_events_table( isset( $analytics['events'] ) && is_array( $analytics['events'] ) ? $analytics['events'] : array(), isset( $analytics['eventDetails'] ) && is_array( $analytics['eventDetails'] ) ? $analytics['eventDetails'] : array(), $range, $base_url ); ?>
			</div>

			<?php $this->render_dimensions( isset( $analytics['dimensions'] ) && is_array( $analytics['dimensions'] ) ? $analytics['dimensions'] : array() ); ?>
			<?php $this->render_live_feed( isset( $realtime['feed'] ) && is_array( $realtime['feed'] ) ? $realtime['feed'] : array(), isset( $realtime['now'] ) ? (int) $realtime['now'] : (int) round( microtime( true ) * 1000 ), $base_url ); ?>

			<div class="gtad-dashboard__footer"><span aria-live="polite"><?php echo esc_html( $this->generated_label( $analytics, $realtime ) ); ?></span><span><?php esc_html_e( 'The API key is restricted to this site.', 'gt-analytics-dashboard' ); ?></span></div>
		</div>
		<?php
		return (string) ob_get_clean();
	}

	/** @return void */
	private function render_pages_table( array $pages, $base_url = '' ) {
		?>
		<section class="gtad-panel gtad-panel--wide"><h2><?php esc_html_e( 'Top pages', 'gt-analytics-dashboard' ); ?></h2><div class="gtad-table-wrap"><table class="widefat striped"><thead><tr><th><?php esc_html_e( 'Page', 'gt-analytics-dashboard' ); ?></th><th><?php esc_html_e( 'Visitors', 'gt-analytics-dashboard' ); ?></th><th><?php esc_html_e( 'Views', 'gt-analytics-dashboard' ); ?></th><th><?php esc_html_e( 'Bounce', 'gt-analytics-dashboard' ); ?></th><th><?php esc_html_e( 'Avg. time', 'gt-analytics-dashboard' ); ?></th></tr></thead><tbody>
		<?php if ( empty( $pages ) ) : ?><tr><td colspan="5"><?php esc_html_e( 'No page data yet.', 'gt-analytics-dashboard' ); ?></td></tr><?php else : foreach ( array_slice( $pages, 0, 20 ) as $page ) : ?>
			<?php $path = isset( $page['path'] ) ? (string) $page['path'] : '/'; $url = $this->page_url( $base_url, $path ); ?>
			<tr><td class="gtad-truncate" title="<?php echo esc_attr( $path ); ?>"><?php if ( $url ) : ?><a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html( $path ); ?></a><?php else : echo esc_html( $path ); endif; ?></td><td><?php echo esc_html( number_format_i18n( isset( $page['visitors'] ) ? (int) $page['visitors'] : 0 ) ); ?></td><td><?php echo esc_html( number_format_i18n( isset( $page['views'] ) ? (int) $page['views'] : 0 ) ); ?></td><td><?php echo esc_html( $this->format_percentage( isset( $page['bounceRate'] ) ? $page['bounceRate'] : null ) ); ?></td><td><?php echo esc_html( $this->format_duration( isset( $page['avgDurationSeconds'] ) ? $page['avgDurationSeconds'] : null ) ); ?></td></tr>
		<?php endforeach; endif; ?></tbody></table></div></section>
		<?php
	}

	/** @return void */
	private function render_tuple_card( $title, array $rows, $kind = '', $base_url = '' ) {
		?>
		<section class="gtad-panel"><h2><?php echo esc_html( $title ); ?></h2><ol class="gtad-ranked-list">
		<?php if ( empty( $rows ) ) : ?><li><span><?php esc_html_e( 'No activity yet.', 'gt-analytics-dashboard' ); ?></span></li><?php else : foreach ( array_slice( $rows, 0, 10 ) as $row ) : ?>
			<?php $value = isset( $row[0] ) && '' !== $row[0] ? (string) $row[0] : '—'; $url = 'path' === $kind ? $this->page_url( $base_url, $value ) : ( 'referrerHost' === $kind && '—' !== $value ? 'https://' . $value : '' ); ?>
			<li><span class="gtad-truncate" title="<?php echo esc_attr( $value ); ?>"><?php if ( $url ) : ?><a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html( $value ); ?></a><?php else : echo esc_html( $value ); endif; ?></span><strong><?php echo esc_html( number_format_i18n( isset( $row[1] ) ? (int) $row[1] : 0 ) ); ?></strong></li>
		<?php endforeach; endif; ?></ol></section>
		<?php
	}

	/** @return void */
	private function render_referrers_table( array $rows, $range = '' ) {
		?>
		<section class="gtad-panel"><h2><?php echo esc_html( sprintf( __( 'Top referrers · %s', 'gt-analytics-dashboard' ), $range ) ); ?></h2><ol class="gtad-ranked-list">
		<?php if ( empty( $rows ) ) : ?><li><span><?php esc_html_e( 'No referrals yet.', 'gt-analytics-dashboard' ); ?></span></li><?php else : foreach ( array_slice( $rows, 0, 10 ) as $row ) : ?>
			<?php $host = ! empty( $row['host'] ) ? (string) $row['host'] : ''; $urls = isset( $row['urls'] ) && is_array( $row['urls'] ) ? $row['urls'] : array(); ?>
			<li><?php if ( ! empty( $urls ) ) : ?><details class="gtad-referrer"><summary><span class="gtad-truncate"><?php echo esc_html( $host ? $host : __( 'Direct / unknown', 'gt-analytics-dashboard' ) ); ?></span><strong><?php echo esc_html( number_format_i18n( isset( $row['views'] ) ? (int) $row['views'] : 0 ) ); ?></strong></summary><ol><?php foreach ( array_slice( $urls, 0, 20 ) as $item ) : $ref_url = ! empty( $item['url'] ) ? (string) $item['url'] : ''; ?><li><a class="gtad-truncate" href="<?php echo esc_url( $ref_url ); ?>" target="_blank" rel="noopener noreferrer" title="<?php echo esc_attr( $ref_url ); ?>"><?php echo esc_html( $ref_url ); ?></a><strong><?php echo esc_html( number_format_i18n( isset( $item['views'] ) ? (int) $item['views'] : 0 ) ); ?></strong></li><?php endforeach; ?></ol></details><?php else : ?><span class="gtad-truncate"><?php if ( $host ) : ?><a href="<?php echo esc_url( 'https://' . $host ); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html( $host ); ?></a><?php else : esc_html_e( 'Direct / unknown', 'gt-analytics-dashboard' ); endif; ?></span><strong><?php echo esc_html( number_format_i18n( isset( $row['views'] ) ? (int) $row['views'] : 0 ) ); ?></strong><?php endif; ?></li>
		<?php endforeach; endif; ?></ol></section>
		<?php
	}

	/** @return void */
	private function render_events_table( array $rows, array $details = array(), $range = '', $base_url = '' ) {
		$groups = array(
			'conversion' => __( 'Conversions', 'gt-analytics-dashboard' ),
			'event'      => __( 'Events', 'gt-analytics-dashboard' ),
		);
		foreach ( $groups as $type => $title ) {
			$group_rows = array_values( array_filter( $rows, function ( $row ) use ( $type ) { return is_array( $row ) && isset( $row['type'] ) && $type === (string) $row['type']; } ) );
			?>
			<section class="gtad-panel"><h2><?php echo esc_html( sprintf( __( '%1$s · %2$s', 'gt-analytics-dashboard' ), $title, $range ) ); ?></h2><ol class="gtad-ranked-list gtad-event-list">
			<?php if ( empty( $group_rows ) ) : ?><li><span><?php echo esc_html( 'conversion' === $type ? __( 'No conversions yet.', 'gt-analytics-dashboard' ) : __( 'No events yet.', 'gt-analytics-dashboard' ) ); ?></span></li><?php else : foreach ( array_slice( $group_rows, 0, 10 ) as $row ) :
				$name     = isset( $row['name'] ) ? (string) $row['name'] : '—';
				$matching = array_values( array_filter( $details, function ( $detail ) use ( $name, $type ) { return is_array( $detail ) && isset( $detail['name'], $detail['type'] ) && $name === (string) $detail['name'] && $type === (string) $detail['type']; } ) );
				?>
				<li><details class="gtad-event"><summary><span><strong><?php echo esc_html( $name ); ?></strong><small><?php echo esc_html( count( $matching ) . ' ' . __( 'contexts', 'gt-analytics-dashboard' ) ); ?></small></span><span class="gtad-event__total"><?php echo esc_html( number_format_i18n( isset( $row['count'] ) ? (int) $row['count'] : 0 ) ); ?><?php if ( ! empty( $row['value'] ) ) : ?><small><?php echo esc_html( number_format_i18n( (float) $row['value'], 2 ) ); ?></small><?php endif; ?></span></summary><?php if ( ! empty( $matching ) ) : ?><ol class="gtad-event__details"><?php foreach ( array_slice( $matching, 0, 25 ) as $detail ) : $path = ! empty( $detail['path'] ) ? (string) $detail['path'] : '/'; $url = $this->page_url( $base_url, $path ); $meta = array_filter( array( isset( $detail['channel'] ) ? $detail['channel'] : '', isset( $detail['referrerHost'] ) ? $detail['referrerHost'] : '', isset( $detail['utmCampaign'] ) && $detail['utmCampaign'] ? 'campaign: ' . $detail['utmCampaign'] : '', isset( $detail['utmSource'] ) && $detail['utmSource'] ? 'source: ' . $detail['utmSource'] : '', isset( $detail['utmMedium'] ) && $detail['utmMedium'] ? 'medium: ' . $detail['utmMedium'] : '', isset( $detail['country'] ) ? $detail['country'] : '' ) ); ?><li><span><strong><?php echo esc_html( ! empty( $detail['label'] ) ? (string) $detail['label'] : $path ); ?></strong><small><?php if ( $url ) : ?><a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html( $path ); ?></a><?php else : echo esc_html( $path ); endif; ?><?php echo $meta ? ' · ' . esc_html( implode( ' · ', array_map( 'strval', $meta ) ) ) : ''; ?></small></span><span><strong><?php echo esc_html( number_format_i18n( isset( $detail['count'] ) ? (int) $detail['count'] : 0 ) ); ?></strong><?php if ( ! empty( $detail['value'] ) ) : ?><small><?php echo esc_html( number_format_i18n( (float) $detail['value'], 2 ) . ( ! empty( $detail['currency'] ) ? ' ' . $detail['currency'] : '' ) ); ?></small><?php endif; ?></span></li><?php endforeach; ?></ol><?php endif; ?></details></li>
			<?php endforeach; endif; ?></ol></section>
			<?php
		}
	}

	/** @return void */
	private function render_dimensions( array $dimensions ) {
		$labels = array(
			'referrerHost' => __( 'Referrer hosts', 'gt-analytics-dashboard' ), 'channel' => __( 'Channels', 'gt-analytics-dashboard' ), 'country' => __( 'Countries', 'gt-analytics-dashboard' ), 'browserName' => __( 'Browsers', 'gt-analytics-dashboard' ), 'browserVersion' => __( 'Browser versions', 'gt-analytics-dashboard' ), 'deviceType' => __( 'Device types', 'gt-analytics-dashboard' ), 'deviceModel' => __( 'Device models', 'gt-analytics-dashboard' ), 'utmSource' => __( 'UTM sources', 'gt-analytics-dashboard' ), 'utmMedium' => __( 'UTM media', 'gt-analytics-dashboard' ), 'utmCampaign' => __( 'UTM campaigns', 'gt-analytics-dashboard' ), 'utmTerm' => __( 'UTM terms', 'gt-analytics-dashboard' ), 'utmContent' => __( 'UTM content', 'gt-analytics-dashboard' ),
		);
		?>
		<section class="gtad-dimensions"><h2><?php esc_html_e( 'Audience and acquisition', 'gt-analytics-dashboard' ); ?></h2><div class="gtad-dashboard-grid">
		<?php foreach ( $labels as $key => $label ) : $rows = isset( $dimensions[ $key ] ) && is_array( $dimensions[ $key ] ) ? $dimensions[ $key ] : array(); ?>
			<section class="gtad-panel"><h3><?php echo esc_html( $label ); ?></h3><ol class="gtad-ranked-list">
			<?php if ( empty( $rows ) ) : ?><li><span>—</span></li><?php else : foreach ( array_slice( $rows, 0, 10 ) as $row ) : $value = isset( $row['value'] ) && '' !== $row['value'] ? (string) $row['value'] : __( 'Unknown', 'gt-analytics-dashboard' ); ?><li><button type="button" class="button-link gtad-filter-link gtad-truncate" data-gtad-filter-key="<?php echo esc_attr( $key ); ?>" data-gtad-filter-value="<?php echo esc_attr( $value ); ?>"><?php echo esc_html( $value ); ?></button><strong><?php echo esc_html( number_format_i18n( isset( $row['views'] ) ? (int) $row['views'] : 0 ) ); ?></strong></li><?php endforeach; endif; ?>
			</ol></section>
		<?php endforeach; ?></div></section>
		<?php
	}

	/** @return void */
	private function render_live_feed( array $feed, $now, $base_url = '' ) {
		?>
		<section class="gtad-panel gtad-panel--wide"><h2><?php esc_html_e( 'Live activity feed', 'gt-analytics-dashboard' ); ?></h2><ol class="gtad-live-feed">
		<?php if ( empty( $feed ) ) : ?><li><?php esc_html_e( 'No activity in the current real-time window.', 'gt-analytics-dashboard' ); ?></li><?php else : foreach ( array_slice( $feed, 0, 20 ) as $item ) : $then = isset( $item['t'] ) ? (int) $item['t'] : $now; ?>
			<?php $is_conversion = isset( $item['kind'] ) && 'conversion' === $item['kind']; $path = isset( $item['path'] ) ? (string) $item['path'] : '/'; $url = $this->page_url( $base_url, $path ); $label = $is_conversion ? ( isset( $item['name'] ) ? (string) $item['name'] : __( 'Conversion', 'gt-analytics-dashboard' ) ) : $path; ?>
			<li><span class="gtad-truncate"><strong><?php if ( ! $is_conversion && $url ) : ?><a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html( $label ); ?></a><?php else : echo esc_html( $label ); endif; ?></strong><small><?php $referrer = isset( $item['referrerHost'] ) && '' !== $item['referrerHost'] ? (string) $item['referrerHost'] : ''; ?><?php if ( $referrer ) : ?><a href="<?php echo esc_url( 'https://' . $referrer ); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html( $referrer ); ?></a><?php else : echo esc_html( isset( $item['channel'] ) ? (string) $item['channel'] : 'direct' ); endif; ?><?php echo ! empty( $item['country'] ) ? ' · ' . esc_html( (string) $item['country'] ) : ''; ?></small></span><time><?php echo esc_html( $this->relative_time( $then, $now ) ); ?></time></li>
		<?php endforeach; endif; ?></ol></section>
		<?php
	}

	/** @return void */
	private function render_report_controls( $interval, array $filters ) {
		$presets = array(
			'today'     => __( 'Today', 'gt-analytics-dashboard' ),
			'yesterday' => __( 'Yesterday', 'gt-analytics-dashboard' ),
			'1d'        => __( '1 day', 'gt-analytics-dashboard' ),
			'7d'        => __( '7 days', 'gt-analytics-dashboard' ),
			'30d'       => __( '30 days', 'gt-analytics-dashboard' ),
			'90d'       => __( '90 days', 'gt-analytics-dashboard' ),
			'180d'      => __( '6 months', 'gt-analytics-dashboard' ),
			'365d'      => __( '12 months', 'gt-analytics-dashboard' ),
		);
		$is_custom = false !== strpos( $interval, '..' );
		$dates     = $is_custom ? explode( '..', $interval, 2 ) : array( '', '' );
		$channels  = array( '' => __( 'All traffic', 'gt-analytics-dashboard' ), 'ai' => __( 'AI assistants', 'gt-analytics-dashboard' ), 'search' => __( 'Search', 'gt-analytics-dashboard' ), 'social' => __( 'Social', 'gt-analytics-dashboard' ), 'paid' => __( 'Paid', 'gt-analytics-dashboard' ), 'referral' => __( 'Referrals', 'gt-analytics-dashboard' ), 'direct' => __( 'Direct', 'gt-analytics-dashboard' ) );
		?>
		<div class="gtad-report-controls">
			<div class="gtad-range-control"><label for="gtad-interval"><?php esc_html_e( 'Range', 'gt-analytics-dashboard' ); ?></label><select id="gtad-interval" data-gtad-interval data-gtad-current-interval="<?php echo esc_attr( $interval ); ?>"><?php foreach ( $presets as $value => $label ) : ?><option value="<?php echo esc_attr( $value ); ?>" <?php selected( $is_custom ? '' : $interval, $value ); ?>><?php echo esc_html( $label ); ?></option><?php endforeach; ?><option value="custom" <?php selected( $is_custom ); ?>><?php esc_html_e( 'Custom range…', 'gt-analytics-dashboard' ); ?></option></select><span class="gtad-custom-range<?php echo $is_custom ? ' is-visible' : ''; ?>"><input type="date" value="<?php echo esc_attr( $dates[0] ); ?>" data-gtad-range-start aria-label="<?php esc_attr_e( 'Start date', 'gt-analytics-dashboard' ); ?>"><span>–</span><input type="date" value="<?php echo esc_attr( $dates[1] ); ?>" data-gtad-range-end aria-label="<?php esc_attr_e( 'End date', 'gt-analytics-dashboard' ); ?>"><button type="button" class="button" data-gtad-range-apply><?php esc_html_e( 'Apply', 'gt-analytics-dashboard' ); ?></button></span></div>
			<nav class="gtad-channel-tabs" aria-label="<?php esc_attr_e( 'Traffic view', 'gt-analytics-dashboard' ); ?>"><?php foreach ( $channels as $value => $label ) : ?><button type="button" class="<?php echo esc_attr( ( isset( $filters['channel'] ) ? $filters['channel'] : '' ) === $value ? 'is-active' : '' ); ?>" data-gtad-channel="<?php echo esc_attr( $value ); ?>"><?php echo esc_html( $label ); ?></button><?php endforeach; ?></nav>
			<?php if ( ! empty( $filters ) ) : ?><div class="gtad-filter-badges" aria-label="<?php esc_attr_e( 'Active filters', 'gt-analytics-dashboard' ); ?>"><?php foreach ( $filters as $key => $value ) : ?><span data-gtad-active-filter data-filter-key="<?php echo esc_attr( $key ); ?>" data-filter-value="<?php echo esc_attr( $value ); ?>"><small><?php echo esc_html( $key ); ?></small> <?php echo esc_html( $value ); ?><button type="button" data-gtad-filter-remove="<?php echo esc_attr( $key ); ?>" aria-label="<?php echo esc_attr( sprintf( __( 'Remove %s filter', 'gt-analytics-dashboard' ), $key ) ); ?>">×</button></span><?php endforeach; ?><button type="button" class="button-link" data-gtad-filters-clear><?php esc_html_e( 'Clear all', 'gt-analytics-dashboard' ); ?></button></div><?php endif; ?>
		</div>
		<?php
	}

	/** @return string */
	private function request_interval() {
		return isset( $_GET['interval'] ) ? $this->sanitize_interval( wp_unslash( $_GET['interval'] ) ) : '30d';
	}

	/** @return string */
	private function sanitize_interval( $value ) {
		$value = sanitize_text_field( (string) $value );
		if ( in_array( $value, array( 'today', 'yesterday', '1d', '7d', '30d', '90d', '180d', '365d' ), true ) ) return $value;
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/', $value ) ) return $value;
		return '30d';
	}

	/** @return array<string, string> */
	private function request_filters( $source = null ) {
		$source  = is_array( $source ) ? $source : $_GET;
		$allowed = array( 'path', 'referrer', 'deviceModel', 'deviceType', 'country', 'browserName', 'browserVersion', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'channel', 'referrerHost' );
		$out     = array();
		foreach ( $allowed as $key ) {
			if ( ! isset( $source[ $key ] ) ) continue;
			$value = sanitize_text_field( wp_unslash( $source[ $key ] ) );
			if ( '' !== $value && strlen( $value ) <= 500 && false === strpos( $value, "'" ) ) $out[ $key ] = $value;
		}
		return $out;
	}

	/** @return string */
	private function interval_label( $interval ) {
		$labels = array( 'today' => __( 'Today', 'gt-analytics-dashboard' ), 'yesterday' => __( 'Yesterday', 'gt-analytics-dashboard' ), '1d' => __( '1 day', 'gt-analytics-dashboard' ), '7d' => __( '7 days', 'gt-analytics-dashboard' ), '30d' => __( '30 days', 'gt-analytics-dashboard' ), '90d' => __( '90 days', 'gt-analytics-dashboard' ), '180d' => __( '6 months', 'gt-analytics-dashboard' ), '365d' => __( '12 months', 'gt-analytics-dashboard' ) );
		return isset( $labels[ $interval ] ) ? $labels[ $interval ] : str_replace( '..', ' to ', (string) $interval );
	}

	/** @return string */
	private function page_url( $base_url, $path ) {
		$base_url = untrailingslashit( (string) $base_url );
		if ( '' === $base_url || ! preg_match( '#^https://#i', $base_url ) ) return '';
		return $base_url . '/' . ltrim( (string) $path, '/' );
	}

	/** @return string */
	private function relative_time( $then, $now ) {
		$seconds = max( 0, (int) round( ( $now - $then ) / 1000 ) );
		if ( $seconds < 5 ) return __( 'now', 'gt-analytics-dashboard' );
		if ( $seconds < 60 ) return sprintf( __( '%ds ago', 'gt-analytics-dashboard' ), $seconds );
		return sprintf( __( '%dm ago', 'gt-analytics-dashboard' ), (int) floor( $seconds / 60 ) );
	}

	/** @return void */
	private function render_error_state( $message ) {
		?>
		<div class="gtad-empty">
			<p><?php echo esc_html( $message ); ?></p>
			<a class="button button-primary" href="<?php echo esc_url( admin_url( 'admin.php?page=' . self::SETTINGS_PAGE ) ); ?>"><?php esc_html_e( 'Connect GT Analytics', 'gt-analytics-dashboard' ); ?></a>
		</div>
		<?php
	}

	/** @return void */
	private function render_metric( $label, $value, $class = '' ) {
		printf(
			'<div class="gtad-metric %1$s"><strong>%2$s</strong><span>%3$s</span></div>',
			esc_attr( $class ),
			esc_html( (string) $value ),
			esc_html( $label )
		);
	}

	/** @return void */
	private function render_series( array $series ) {
		$series = array_slice( $series, -366 );
		$max    = 0;
		foreach ( $series as $point ) {
			$max = max( $max, is_array( $point ) && isset( $point['views'] ) ? (int) $point['views'] : 0 );
		}
		if ( empty( $series ) ) {
			return;
		}
		?>
		<div class="gtad-series-wrap"><div class="gtad-series-legend"><span><i class="is-visitors"></i><?php esc_html_e( 'Visitors', 'gt-analytics-dashboard' ); ?></span><span><i class="is-views"></i><?php esc_html_e( 'Views', 'gt-analytics-dashboard' ); ?></span></div><div class="gtad-series" style="--gtad-points: <?php echo esc_attr( count( $series ) ); ?>" aria-label="<?php esc_attr_e( 'Visitors and views during the selected period', 'gt-analytics-dashboard' ); ?>">
			<?php foreach ( $series as $point ) :
				$views  = is_array( $point ) && isset( $point['views'] ) ? (int) $point['views'] : 0;
				$visitors = is_array( $point ) && isset( $point['visitors'] ) ? (int) $point['visitors'] : 0;
				$date   = is_array( $point ) && isset( $point['date'] ) ? strtotime( (string) $point['date'] ) : false;
				$height = $max > 0 ? max( 4, (int) round( ( $views / $max ) * 100 ) ) : 0;
				$date_label = $date ? wp_date( 'F j, Y', $date ) : __( 'Unknown date', 'gt-analytics-dashboard' );
				$summary = sprintf(
					/* translators: 1: Date, 2: Visitor count, 3: View count. */
					__( '%1$s: %2$s visitors, %3$s views', 'gt-analytics-dashboard' ),
					$date_label,
					number_format_i18n( $visitors ),
					number_format_i18n( $views )
				);
				?>
				<div class="gtad-series__day" role="img" tabindex="0" aria-label="<?php echo esc_attr( $summary ); ?>">
					<span class="gtad-series__values" aria-hidden="true"><span><i class="is-visitors"></i><?php esc_html_e( 'Visitors', 'gt-analytics-dashboard' ); ?> <b><?php echo esc_html( number_format_i18n( $visitors ) ); ?></b></span><span><i class="is-views"></i><?php esc_html_e( 'Views', 'gt-analytics-dashboard' ); ?> <b><?php echo esc_html( number_format_i18n( $views ) ); ?></b></span></span>
					<span class="gtad-series__bar"><i style="--gtad-height: <?php echo esc_attr( $height ); ?>%"></i></span>
					<small><?php echo esc_html( $date ? wp_date( count( $series ) > 7 ? 'M j' : 'D', $date ) : '—' ); ?></small>
				</div>
			<?php endforeach; ?>
		</div></div>
		<?php
	}

	/** @return void */
	private function render_top_paths( array $paths, $base_url = '' ) {
		$paths = array_slice( $paths, 0, 3 );
		if ( empty( $paths ) ) {
			return;
		}
		?>
		<div class="gtad-paths"><h3><?php esc_html_e( 'Live pages', 'gt-analytics-dashboard' ); ?></h3><ol>
			<?php foreach ( $paths as $row ) :
				$path  = is_array( $row ) && isset( $row[0] ) ? (string) $row[0] : '/';
				$count = is_array( $row ) && isset( $row[1] ) ? (int) $row[1] : 0;
				?>
				<li><span title="<?php echo esc_attr( $path ); ?>"><?php $url = $this->page_url( $base_url, $path ); if ( $url ) : ?><a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html( $path ); ?></a><?php else : echo esc_html( $path ); endif; ?></span><strong><?php echo esc_html( number_format_i18n( $count ) ); ?></strong></li>
			<?php endforeach; ?>
		</ol></div>
		<?php
	}

	/** @return string */
	private function integer_value( array $data, $key ) {
		return isset( $data[ $key ] ) && is_numeric( $data[ $key ] ) ? number_format_i18n( (int) $data[ $key ] ) : '—';
	}

	/** @return string */
	private function format_percentage( $value ) {
		return is_numeric( $value ) ? number_format_i18n( (float) $value * 100, 1 ) . '%' : '—';
	}

	/** @return string */
	private function format_duration( $value ) {
		if ( ! is_numeric( $value ) ) {
			return '—';
		}
		$seconds = max( 0, (int) round( (float) $value ) );
		return $seconds >= 60 ? sprintf( '%dm %02ds', (int) floor( $seconds / 60 ), $seconds % 60 ) : sprintf( '%ds', $seconds );
	}

	/** @return string */
	private function generated_label( array $analytics, array $realtime ) {
		$timestamp = isset( $realtime['now'] ) && is_numeric( $realtime['now'] )
			? (int) floor( (float) $realtime['now'] / 1000 )
			: ( isset( $analytics['generatedAt'] ) ? strtotime( (string) $analytics['generatedAt'] ) : false );
		return $timestamp ? sprintf( __( 'Updated %s ago', 'gt-analytics-dashboard' ), human_time_diff( $timestamp, time() ) ) : __( 'Updated just now', 'gt-analytics-dashboard' );
	}

	/** @return string */
	private function capability() {
		return (string) apply_filters( 'gt_analytics_dashboard_capability', 'manage_options' );
	}
}
