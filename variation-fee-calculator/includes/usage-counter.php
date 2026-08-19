<?php
/**
 * Anonymous usage counter for the Variation Toolbox. A public REST endpoint
 * increments per-tool integer counters (started / finished / handoff). No IP,
 * no timestamp, no personal data -- GDPR-uncritical by design. Mirrors the
 * proven Regenwald-Quiz counter.
 *
 * @package Variation_Fee_Calculator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Tools that accept a 'start' event (all six).
 *
 * @return string[]
 */
function vfc_usage_start_tools() {
	return array( 'classification', 'guidance', 'timelines', 'calculator', 'workflow', 'budget' );
}

/**
 * Tools that additionally accept 'finish' and 'handoff' (the three run-through tools).
 *
 * @return string[]
 */
function vfc_usage_result_tools() {
	return array( 'calculator', 'workflow', 'budget' );
}

/**
 * Maps a tool+event pair to its wp_options counter name, or null if the pair is
 * not allowed. Pure -- no WordPress calls -- so it stays trivially reviewable.
 *
 * @param string $tool  Tool key.
 * @param string $event 'start' | 'finish' | 'handoff'.
 * @return string|null  Option name, or null when the pair is invalid.
 */
function vfc_usage_option_name( $tool, $event ) {
	if ( 'start' === $event ) {
		if ( ! in_array( $tool, vfc_usage_start_tools(), true ) ) {
			return null;
		}
		return 'vfc_usage_' . $tool . '_started';
	}
	if ( 'finish' === $event || 'handoff' === $event ) {
		if ( ! in_array( $tool, vfc_usage_result_tools(), true ) ) {
			return null;
		}
		$suffix = ( 'finish' === $event ) ? '_finished' : '_handoff';
		return 'vfc_usage_' . $tool . $suffix;
	}
	return null;
}

/**
 * Registers POST /wp-json/vfc/v1/count. Open + nonce-free on purpose: anonymous,
 * possibly cached pages must be able to count, and the action only ever adds 1 to
 * a whitelisted counter.
 */
function vfc_usage_register_count_route() {
	register_rest_route(
		'vfc/v1',
		'/count',
		array(
			'methods'             => 'POST',
			'callback'            => 'vfc_usage_count_callback',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'rest_api_init', 'vfc_usage_register_count_route' );

/**
 * Handles a count request: validates tool+event against the whitelist and
 * increments the matching integer option.
 *
 * @param WP_REST_Request $request Request object.
 * @return WP_REST_Response|WP_Error
 */
function vfc_usage_count_callback( $request ) {
	$tool  = (string) $request->get_param( 'tool' );
	$event = (string) $request->get_param( 'event' );

	$option = vfc_usage_option_name( $tool, $event );
	if ( null === $option ) {
		return new WP_Error( 'vfc_bad_count', 'Invalid tool/event.', array( 'status' => 400 ) );
	}

	$value = (int) get_option( $option, 0 ) + 1;
	update_option( $option, $value, false );

	return new WP_REST_Response( array( 'ok' => true ), 200 );
}
