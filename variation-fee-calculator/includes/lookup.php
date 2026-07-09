<?php
/**
 * Variation Classification Lookup -- a companion tool to the fee calculator,
 * bundled into this same plugin so the two can eventually hand data to each
 * other, but rendered on its own dedicated page via a separate shortcode.
 *
 * Registers (but does not enqueue) its assets; enqueuing happens from the
 * shortcode callback below, so the (large) classification data set is only
 * ever loaded on the one page that actually contains the Lookup.
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

	wp_register_style(
		'vcl-style',
		VFC_PLUGIN_URL . 'assets/css/vcl-style.css',
		array( 'vcl-fonts' ),
		VFC_VERSION
	);

	wp_register_script(
		'vcl-docx',
		'https://cdn.jsdelivr.net/npm/docx@9.7.1/dist/index.iife.min.js',
		array(),
		'9.7.1',
		true
	);

	// Version by file modification time so an updated classification data
	// file immediately busts any browser/CDN cache for visitors.
	$data_file = VFC_PLUGIN_DIR . 'assets/js/vcl-data.js';
	$data_ver  = file_exists( $data_file ) ? filemtime( $data_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-data',
		VFC_PLUGIN_URL . 'assets/js/vcl-data.js',
		array(),
		$data_ver,
		true
	);

	wp_register_script(
		'vcl-app',
		VFC_PLUGIN_URL . 'assets/js/vcl-app.js',
		array( 'vcl-data', 'vcl-docx' ),
		VFC_VERSION,
		true
	);
}
add_action( 'wp_enqueue_scripts', 'vcl_register_assets' );

/**
 * Shortcode: [variation_classification_lookup]
 * Renders the lookup markup directly into the page (no iframe) and enqueues
 * its assets. Intended for use on its own dedicated page -- .vcl-app breaks
 * out to the full viewport width, which would look wrong mixed in with
 * normal article content on a shared page.
 */
function vcl_shortcode() {
	wp_enqueue_style( 'vcl-style' );
	wp_enqueue_script( 'vcl-app' );

	ob_start();
	?>
	<div class="vcl-app" id="vcl-app">

	<div class="page-shell">

	<header class="app-header">
	  <p class="app-header__eyebrow">Variation Fee Calculator &mdash; companion tool</p>
	  <h1>Variation Classification Lookup</h1>
	  <p class="app-header__copyright">&copy; Dr. Tom Deutschle</p>
	  <p>
	    Search or browse variation codes from the EU Variation Classification Guideline. Pick a matching entry to see
	    the conditions, required documentation and resulting procedure type. Guideline
	    <strong id="vcl-guidelineRef"></strong>, applicable from <strong id="vcl-applicableFrom"></strong>.
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
	    <div class="detail-empty" id="vcl-detailEmpty">
	      Select an entry from the list to see its conditions, required documentation and procedure type. Tick off
	      conditions as you confirm them to see whether the change qualifies for the listed type.
	    </div>
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
	  </div>
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
