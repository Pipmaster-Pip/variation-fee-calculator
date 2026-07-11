<?php
/**
 * Variations Reference Guide -- a companion tool to the fee calculator,
 * bundled into this same plugin so the two can eventually hand data to each
 * other, but rendered on its own dedicated page via a separate shortcode.
 *
 * Registers (but does not enqueue) its assets; enqueuing happens from the
 * shortcode callback below, so the (large) classification data set is only
 * ever loaded on the one page that actually contains the Guide.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

function vcl_register_assets() {
	wp_register_style(
		'vcl-fonts',
		'https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap',
		array(),
		null
	);

	// Versioned by file modification time (not the static VFC_VERSION) so an update to
	// either file immediately busts any browser/CDN cache for visitors -- VFC_VERSION never
	// gets bumped in day-to-day edits, so relying on it here left every vcl-style.css/
	// vcl-app.js change invisible to anyone with a previously cached copy.
	$style_file = VFC_PLUGIN_DIR . 'assets/css/vcl-style.css';
	$style_ver  = file_exists( $style_file ) ? filemtime( $style_file ) : VFC_VERSION;

	wp_register_style(
		'vcl-style',
		VFC_PLUGIN_URL . 'assets/css/vcl-style.css',
		array( 'vcl-fonts' ),
		$style_ver
	);

	wp_register_script(
		'vcl-docx',
		'https://cdn.jsdelivr.net/npm/docx@9.7.1/dist/index.iife.min.js',
		array(),
		'9.7.1',
		true
	);

	$data_file = VFC_PLUGIN_DIR . 'assets/js/vcl-data.js';
	$data_ver  = file_exists( $data_file ) ? filemtime( $data_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-data',
		VFC_PLUGIN_URL . 'assets/js/vcl-data.js',
		array(),
		$data_ver,
		true
	);

	$app_file = VFC_PLUGIN_DIR . 'assets/js/vcl-app.js';
	$app_ver  = file_exists( $app_file ) ? filemtime( $app_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-app',
		VFC_PLUGIN_URL . 'assets/js/vcl-app.js',
		array( 'vcl-data', 'vcl-docx' ),
		$app_ver,
		true
	);
}
add_action( 'wp_enqueue_scripts', 'vcl_register_assets' );

/**
 * Shortcode: [variation_classification_lookup calculator_url="/gebuehrenrechner/"]
 * Renders the lookup markup directly into the page (no iframe) and enqueues
 * its assets. Intended for use on its own dedicated page -- .vcl-app breaks
 * out to the full viewport width, which would look wrong mixed in with
 * normal article content on a shared page.
 *
 * calculator_url points the Summary's "Export to Variation Fee Calculator" button at
 * the page carrying [variation_fee_calculator]; leave unset to hide/disable that button.
 */
function vcl_shortcode( $atts ) {
	$atts = shortcode_atts( array( 'calculator_url' => '' ), $atts, 'variation_classification_lookup' );

	wp_enqueue_style( 'vcl-style' );
	wp_enqueue_script( 'vcl-app' );
	wp_localize_script( 'vcl-app', 'VCL_CONFIG', array(
		'calculatorUrl' => $atts['calculator_url'],
		// Admin-editable via the "Variations Reference Guide" section on the plugin's settings
		// page (see vcl_get_last_updated() in includes/admin.php) -- falls back to the dates
		// baked into vcl-data.js/vcl-app.js if never saved there.
		'lastUpdated'   => vcl_get_last_updated(),
		// Same admin-editable/fallback pattern for the free-text guideline reference shown
		// next to it (see vcl_get_reference_text() in includes/admin.php).
		'referenceText' => vcl_get_reference_text(),
	) );

	ob_start();
	?>
	<div class="vcl-app" id="vcl-app">

	<div class="page-shell">

	<header class="app-header">
	  <h1>Variations Reference Guide</h1>
	  <p class="app-header__copyright">&copy; Dr. Tom Deutschle</p>
	  <p>
	    One companion tool for the EU Variation Classification Guideline: look up how a change is classified, check
	    which changes may be <strong>grouped</strong> together, and see the day-by-day procedure <strong>timetable</strong>.
	  </p>
	</header>

	<div class="layout">
	  <div class="browse-col" id="vcl-browseCol">
	    <div class="search-box">
	      <input type="text" id="vcl-searchInput" placeholder="Search by code, keyword, or describe the change…" autocomplete="off" />
	    </div>
	    <div class="browse-tree" id="vcl-browseTree"></div>
	  </div>

	  <div class="detail-col" id="vcl-detailCol">
	    <!-- Populated by vcl-app.js (needs CLASSIFICATION_META for the reference text).
	         vcl-detailHead stays visible in both states (nothing selected / entry selected) so
	         the Reference/Last-updated note doesn't disappear once an entry is opened. -->
	    <div class="classification-head" id="vcl-detailHead"></div>
	    <div class="detail-empty" id="vcl-detailEmpty"></div>
	    <div class="hidden" id="vcl-detailPanel"></div>
	  </div>

	  <div class="summary-col hidden" id="vcl-summaryCol">
	    <div class="summary-header">
	      <div>
	        <h2 class="summary-header__title">Summary of Variations</h2>
	        <p class="summary-header__count" id="vcl-summaryCount"></p>
	      </div>
	      <div class="summary-header__actions">
	        <button type="button" id="vcl-summaryExpandAll">Expand all</button>
	        <button type="button" id="vcl-summaryCollapseAll">Collapse all</button>
	        <button type="button" id="vcl-summaryExportDocx">Export to .docx</button>
	        <button type="button" id="vcl-summaryPrint">Print</button>
	      </div>
	    </div>
	    <div class="summary-list" id="vcl-summaryList"></div>
	    <div class="summary-footer">
	      <button type="button" id="vcl-summaryExportCalculator" class="summary-footer__button">Export to Variation Fee Calculator &rarr;</button>
	    </div>
	  </div>

	  <div class="grouping-col hidden" id="vcl-groupingCol"></div>

	  <div class="timetables-col hidden" id="vcl-timetablesCol"></div>
	</div>

	</div>

	<div class="selection-bar hidden" id="vcl-selectionBar">
	  <div class="selection-bar__summary">
	    <button class="selection-bar__toggle" id="vcl-selectionToggle" aria-expanded="false">
	      <span class="selection-bar__chevron" id="vcl-selectionChevron">&#9656;</span>
	      <span id="vcl-selectionCount"></span>
	    </button>
	    <div class="selection-bar__buttons">
	      <button class="selection-bar__link" id="vcl-selectionViewSummary">Open summary →</button>
	      <button class="selection-bar__clear" id="vcl-selectionClear">Clear all</button>
	    </div>
	  </div>
	  <div class="selection-bar__list hidden" id="vcl-selectionList"></div>
	</div>

	</div>
	<?php
	return ob_get_clean();
}
add_shortcode( 'variation_classification_lookup', 'vcl_shortcode' );
