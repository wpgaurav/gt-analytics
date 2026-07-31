<?php
/**
 * Plugin Name: GT Analytics — purchase value
 * Description: Records the exact order total as a GT Analytics conversion.
 *
 * The JavaScript records that a purchase happened but deliberately not what it
 * was worth: the receipt page renders the total as formatted currency, and
 * turning "$1,499.00" back into a number means guessing at symbol, locale and
 * separators. Getting it wrong is worse than not having it, because a revenue
 * figure looks authoritative whatever it says.
 *
 * Fluent Cart already solves the harder half. `fluent_cart/order/receipt_viewed`
 * fires only on the first view of a paid order -- the plugin flips
 * `sales_recorded` itself -- so a customer who reloads the receipt, or opens it
 * again from the confirmation e-mail, cannot inflate revenue.
 *
 * Install as an mu-plugin:
 *   wp-content/mu-plugins/gt-analytics-purchase-value.php
 *
 * With this active, remove the `purchase` block from the JavaScript file or
 * every order is counted twice.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'fluent_cart/order/receipt_viewed',
	function ( $data ) {
		$order = is_array( $data ) ? ( $data['order'] ?? null ) : null;
		if ( ! $order ) {
			return;
		}

		// Fluent Cart stores money in the smallest currency unit: an order of
		// ₹16,999.00 is held as 1699900.
		//
		// total_paid is preferred because it is net of refunds, but it is 0 on
		// orders that have not settled, and `??` would not catch that -- it
		// only falls back on null. So the check is on the value, not on
		// whether the property exists.
		$paid     = (float) ( $order->total_paid ?? 0 );
		$total    = ( $paid > 0 ? $paid : (float) ( $order->total_amount ?? 0 ) ) / 100;

		// Read from the order, not from store settings: the store default is
		// USD while these orders are billed in INR.
		$currency = (string) ( $order->currency ?? '' );
		$label    = (string) ( $order->invoice_no ?? $order->uuid ?? '' );

		if ( $total <= 0 ) {
			return;
		}

		// Printed rather than enqueued: this runs inside the receipt shortcode,
		// which is well past wp_enqueue_scripts.
		printf(
			'<script>window.gta&&window.gta("conversion","purchase",%s);</script>',
			wp_json_encode(
				array(
					'value'    => round( $total, 2 ),
					'currency' => $currency,
					'label'    => $label,
				)
			)
		);
	},
	10,
	1
);
