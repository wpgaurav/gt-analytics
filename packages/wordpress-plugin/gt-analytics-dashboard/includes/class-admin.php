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
	const SETTINGS_PAGE  = 'gt-analytics-dashboard';
	const AJAX_ACTION    = 'gt_analytics_dashboard_refresh';
	const NONCE_ACTION   = 'gt_analytics_dashboard_refresh';

	/** @var API_Client */
	private $client;

	/** @var Data_Service */
	private $service;

	/** @var string */
	private $settings_hook = '';

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
		add_action( 'admin_menu', array( $this, 'add_settings_page' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'wp_dashboard_setup', array( $this, 'register_dashboard_widget' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'wp_ajax_' . self::AJAX_ACTION, array( $this, 'ajax_refresh' ) );
		add_action( 'admin_post_gt_analytics_dashboard_test', array( $this, 'test_connection' ) );
	}

	/**
	 * Adds the settings screen below Settings.
	 *
	 * @return void
	 */
	public function add_settings_page() {
		$this->settings_hook = add_options_page(
			__( 'GT Analytics', 'gt-analytics-dashboard' ),
			__( 'GT Analytics', 'gt-analytics-dashboard' ),
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
					'site_id'  => '',
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
		add_settings_field( 'gtad_site_id', __( 'Site', 'gt-analytics-dashboard' ), array( $this, 'render_site_field' ), self::SETTINGS_PAGE, 'gtad_connection' );
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
			'site_id'  => isset( $old['site_id'] ) ? $old['site_id'] : '',
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

		if ( ! defined( 'GT_ANALYTICS_SITE_ID' ) ) {
			$site_id = isset( $input['site_id'] ) ? sanitize_text_field( (string) $input['site_id'] ) : '';
			if ( strlen( $site_id ) > 200 || preg_match( '/[\x00-\x1F\x7F]/', $site_id ) ) {
				add_settings_error( API_Client::OPTION_NAME, 'invalid_site', __( 'Select a valid GT Analytics site.', 'gt-analytics-dashboard' ) );
			} else {
				$output['site_id'] = $site_id;
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
		echo '<p>' . esc_html__( 'Create an account-scoped API key with analytics and real-time read access. The key is used only in server-side WordPress requests.', 'gt-analytics-dashboard' ) . '</p>';
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
	public function render_site_field() {
		if ( defined( 'GT_ANALYTICS_SITE_ID' ) ) {
			echo '<code>' . esc_html( $this->client->get_site_id() ) . '</code><p class="description">' . esc_html__( 'Defined by GT_ANALYTICS_SITE_ID in wp-config.php.', 'gt-analytics-dashboard' ) . '</p>';
			return;
		}

		$current = $this->client->get_site_id();
		$sites   = $this->service->get_sites();
		if ( is_wp_error( $sites ) ) {
			printf(
				'<input class="regular-text" type="text" name="%1$s[site_id]" value="%2$s"><p class="description">%3$s</p>',
				esc_attr( API_Client::OPTION_NAME ),
				esc_attr( $current ),
				esc_html( $sites->get_error_message() )
			);
			return;
		}

		printf( '<select name="%s[site_id]">', esc_attr( API_Client::OPTION_NAME ) );
		echo '<option value="">' . esc_html__( 'Select a site', 'gt-analytics-dashboard' ) . '</option>';
		foreach ( $sites as $site ) {
			$id    = isset( $site['id'] ) ? (string) $site['id'] : '';
			$label = isset( $site['label'] ) && '' !== $site['label'] ? (string) $site['label'] : $id;
			printf( '<option value="%1$s"%2$s>%3$s</option>', esc_attr( $id ), selected( $current, $id, false ), esc_html( $label . ' — ' . $id ) );
		}
		echo '</select>';
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
			<h1><?php esc_html_e( 'GT Analytics', 'gt-analytics-dashboard' ); ?></h1>
			<p class="gtad-settings__lede"><?php esc_html_e( 'Connect this site to an account-scoped GT Analytics API key. WordPress shows a quick preview; detailed reports stay in GT Analytics.', 'gt-analytics-dashboard' ); ?></p>
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
define( 'GT_ANALYTICS_API_KEY', 'gta_...' );
define( 'GT_ANALYTICS_SITE_ID', 'example.com' );</code></pre>
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
				'message' => sprintf(
					/* translators: %d: number of sites available to the API key. */
					_n( 'Connection successful. The key can access %d site.', 'Connection successful. The key can access %d sites.', count( $sites ), 'gt-analytics-dashboard' ),
					count( $sites )
				),
			);
		}

		set_transient( 'gtad_notice_' . get_current_user_id(), $notice, MINUTE_IN_SECONDS );
		wp_safe_redirect( admin_url( 'options-general.php?page=' . self::SETTINGS_PAGE ) );
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
		echo $this->render_widget_inner( $this->service->get_snapshot() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Every dynamic value is escaped in the renderer.
	}

	/**
	 * Loads assets only on the dashboard and this plugin's settings screen.
	 *
	 * @param string $hook_suffix Current admin screen hook.
	 * @return void
	 */
	public function enqueue_assets( $hook_suffix ) {
		if ( 'index.php' !== $hook_suffix && $this->settings_hook !== $hook_suffix ) {
			return;
		}

		wp_enqueue_style( 'gt-analytics-dashboard', GT_ANALYTICS_DASHBOARD_URL . 'assets/admin.css', array(), GT_ANALYTICS_DASHBOARD_VERSION );
		if ( 'index.php' === $hook_suffix ) {
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

		wp_send_json_success(
			array( 'html' => $this->render_widget_inner( $this->service->get_snapshot( true ) ) )
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
		?>
		<div class="gtad-widget" data-gtad-widget>
			<div class="gtad-widget__bar">
				<div><strong><?php echo esc_html( $this->client->get_site_id() ); ?></strong><span><?php esc_html_e( 'Realtime + last 7 days', 'gt-analytics-dashboard' ); ?></span></div>
				<button type="button" class="button-link gtad-refresh" data-gtad-refresh aria-label="<?php esc_attr_e( 'Refresh analytics', 'gt-analytics-dashboard' ); ?>"><span class="dashicons dashicons-update" aria-hidden="true"></span></button>
			</div>

			<?php if ( ! empty( $errors ) ) : ?>
				<div class="gtad-inline-error" role="status"><?php echo esc_html( implode( ' ', array_map( 'strval', $errors ) ) ); ?></div>
			<?php endif; ?>

			<div class="gtad-kpis">
				<?php $this->render_metric( __( 'Active now', 'gt-analytics-dashboard' ), $this->integer_value( $realtime, 'activeVisitors' ), 'is-live' ); ?>
				<?php $this->render_metric( __( 'Views · 1 min', 'gt-analytics-dashboard' ), $this->integer_value( $realtime, 'viewsLastMinute' ) ); ?>
				<?php $this->render_metric( __( 'Visitors · 7 days', 'gt-analytics-dashboard' ), $this->integer_value( $summary, 'visitors' ) ); ?>
				<?php $this->render_metric( __( 'Views · 7 days', 'gt-analytics-dashboard' ), $this->integer_value( $summary, 'views' ) ); ?>
				<?php $this->render_metric( __( 'Bounce rate', 'gt-analytics-dashboard' ), $this->format_percentage( isset( $summary['bounceRate'] ) ? $summary['bounceRate'] : null ) ); ?>
				<?php $this->render_metric( __( 'Avg. time', 'gt-analytics-dashboard' ), $this->format_duration( isset( $summary['avgDurationSeconds'] ) ? $summary['avgDurationSeconds'] : null ) ); ?>
			</div>

			<?php $this->render_series( isset( $analytics['series'] ) && is_array( $analytics['series'] ) ? $analytics['series'] : array() ); ?>
			<?php $this->render_top_paths( isset( $realtime['topPaths'] ) && is_array( $realtime['topPaths'] ) ? $realtime['topPaths'] : array() ); ?>

			<div class="gtad-widget__footer">
				<span aria-live="polite"><?php echo esc_html( $this->generated_label( $analytics, $realtime ) ); ?></span>
				<a class="button button-secondary" href="<?php echo esc_url( $this->client->get_dashboard_url() ); ?>" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'Open full analytics', 'gt-analytics-dashboard' ); ?></a>
			</div>
		</div>
		<?php
		return (string) ob_get_clean();
	}

	/** @return void */
	private function render_error_state( $message ) {
		?>
		<div class="gtad-empty">
			<p><?php echo esc_html( $message ); ?></p>
			<a class="button button-primary" href="<?php echo esc_url( admin_url( 'options-general.php?page=' . self::SETTINGS_PAGE ) ); ?>"><?php esc_html_e( 'Connect GT Analytics', 'gt-analytics-dashboard' ); ?></a>
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
		$series = array_slice( $series, -7 );
		$max    = 0;
		foreach ( $series as $point ) {
			$max = max( $max, is_array( $point ) && isset( $point['views'] ) ? (int) $point['views'] : 0 );
		}
		if ( empty( $series ) ) {
			return;
		}
		?>
		<div class="gtad-series" aria-label="<?php esc_attr_e( 'Views during the last seven days', 'gt-analytics-dashboard' ); ?>">
			<?php foreach ( $series as $point ) :
				$views  = is_array( $point ) && isset( $point['views'] ) ? (int) $point['views'] : 0;
				$date   = is_array( $point ) && isset( $point['date'] ) ? strtotime( (string) $point['date'] ) : false;
				$height = $max > 0 ? max( 4, (int) round( ( $views / $max ) * 100 ) ) : 0;
				?>
				<div class="gtad-series__day" title="<?php echo esc_attr( sprintf( __( '%s views', 'gt-analytics-dashboard' ), number_format_i18n( $views ) ) ); ?>">
					<span class="gtad-series__bar"><i style="--gtad-height: <?php echo esc_attr( $height ); ?>%"></i></span>
					<small><?php echo esc_html( $date ? wp_date( 'D', $date ) : '—' ); ?></small>
				</div>
			<?php endforeach; ?>
		</div>
		<?php
	}

	/** @return void */
	private function render_top_paths( array $paths ) {
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
				<li><span title="<?php echo esc_attr( $path ); ?>"><?php echo esc_html( $path ); ?></span><strong><?php echo esc_html( number_format_i18n( $count ) ); ?></strong></li>
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
