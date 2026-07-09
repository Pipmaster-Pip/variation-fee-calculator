<?php
/**
 * Plugin Name: Variation Fee Calculator
 * Description: Berechnet amtliche Behördengebühren für Variations (Typ IA/IB/II) in der Pharma-Zulassung für EU-27, EMA, CH, IS, NO, UK und RS. Einbindung per Shortcode [variation_fee_calculator]. Enthält außerdem das Variation Classification Lookup (Nachschlagewerk zur EU Variation Classification Guideline) als eigene Seite via Shortcode [variation_classification_lookup] -- braucht die volle Seitenbreite, daher am besten auf einer eigenen Seite ohne Sidebar verwenden.
 * Version: 1.0.0
 * Author: Dr. Tom Deutschle
 * License: proprietary
 * Text Domain: variation-fee-calculator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

define( 'VFC_VERSION', '1.0.0' );
define( 'VFC_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'VFC_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );

require_once VFC_PLUGIN_DIR . 'includes/admin.php';
require_once VFC_PLUGIN_DIR . 'includes/lookup.php';

/**
 * Registers (but does not enqueue) the calculator's assets. Actual
 * enqueuing happens from the shortcode callback below, so the fee-table
 * data (several hundred KB) is only ever loaded on pages that actually
 * contain the calculator.
 */
function vfc_register_assets() {
	wp_register_style(
		'vfc-style',
		VFC_PLUGIN_URL . 'assets/css/vfc-style.css',
		array(),
		VFC_VERSION
	);

	wp_register_script(
		'vfc-xlsx',
		'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
		array(),
		'0.18.5',
		true
	);

	// Version by file modification time (not the static plugin version) so
	// that an admin-panel data upload immediately busts any browser/CDN
	// cache, instead of visitors keeping a stale fee table until the plugin
	// itself is next updated.
	$data_file = VFC_PLUGIN_DIR . 'assets/js/vfc-data.js';
	$data_ver  = file_exists( $data_file ) ? filemtime( $data_file ) : VFC_VERSION;

	wp_register_script(
		'vfc-data',
		VFC_PLUGIN_URL . 'assets/js/vfc-data.js',
		array(),
		$data_ver,
		true
	);

	wp_register_script(
		'vfc-app',
		VFC_PLUGIN_URL . 'assets/js/vfc-app.js',
		array( 'vfc-data', 'vfc-xlsx' ),
		VFC_VERSION,
		true
	);
}
add_action( 'wp_enqueue_scripts', 'vfc_register_assets' );

/**
 * Shortcode: [variation_fee_calculator]
 * Renders the calculator markup directly into the page (no iframe) and
 * enqueues its assets. Use this shortcode only once per page — the
 * calculator keeps a single global JS state (appState).
 */
function vfc_shortcode() {
	wp_enqueue_style( 'vfc-style' );
	wp_enqueue_script( 'vfc-app' );

	ob_start();
	?>
	<div class="vfc-app" id="vfc-app">
	  <div class="app-head">
	    <h1>Variation Fee Calculator</h1>
	    <span class="tag" id="vfc-headerTag">last updated: –</span>
	  </div>
	  <p class="copyright">© Dr. Tom Deutschle</p>
	  <p class="subhead">Calculates the official regulatory fees for variation applications (Type IA / IB / II) in one or more countries, including EU 27, EMA, CH, IS, NO, UK (national/CMS) and RS.</p>

	  <div class="rail" id="vfc-rail"></div>
	  <div id="vfc-stepContent"></div>

	  <div class="src">
	    <div class="fx-status-row">
	      <span id="vfc-fxStatus" style="font-family:var(--mono); font-size:11px; color:var(--ink-faint);"></span>
	    </div>
	  </div>
	</div>
	<?php
	return ob_get_clean();
}
add_shortcode( 'variation_fee_calculator', 'vfc_shortcode' );
