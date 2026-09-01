<?php
/**
 * Plugin Name: Variation Toolbox
 * Description: Werkzeugkasten für Variations in der Pharma-Zulassung: Klassifizierung nach der EU Variation Classification Guideline, Grouping- und Precise-Scope-Guidance, Verfahrens-Timetables, Workload-Planning sowie der eingebettete Variation Fee Calculator (amtliche Behördengebühren für Typ IA/IB/II in EU-27, EMA, CH, IS, NO, UK, RS). Einbindung per Shortcode [variation_classification_lookup] -- braucht die volle Seitenbreite, daher am besten auf einer eigenen Seite ohne Sidebar verwenden.
 * Version: 1.13.1
 * Author: Dr. Tom Deutschle
 * License: proprietary
 * Text Domain: variation-fee-calculator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

define( 'VFC_VERSION', '1.13.1' );
define( 'VFC_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'VFC_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );

require_once VFC_PLUGIN_DIR . 'includes/admin.php';
require_once VFC_PLUGIN_DIR . 'includes/fee-editor.php';
require_once VFC_PLUGIN_DIR . 'includes/lookup.php';
require_once VFC_PLUGIN_DIR . 'includes/usage-counter.php';
require_once VFC_PLUGIN_DIR . 'includes/usage-dashboard.php';

// The Variation Fee Calculator is now embedded inside the Variation Toolbox
// (see includes/lookup.php: the "Variation Fee Calculator" nav hero and the
// vcl-calc-* assets). The former standalone [variation_fee_calculator]
// shortcode and its vfc-* assets have been retired.
