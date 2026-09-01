<?php
/**
 * Variation Toolbox -- a companion tool to the fee calculator,
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
		'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
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

	// Q&A on Variations -- generated from the source PDF by extract_qa.py, so it lives in its
	// own file rather than in the hand-maintained vcl-data.js (same split as vcl-calc-data.js).
	// vcl-app.js treats window.VCL_QA_DATA as optional and simply omits the view without it.
	$qa_data_file = VFC_PLUGIN_DIR . 'assets/js/vcl-qa-data.js';
	$qa_data_ver  = file_exists( $qa_data_file ) ? filemtime( $qa_data_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-qa-data',
		VFC_PLUGIN_URL . 'assets/js/vcl-qa-data.js',
		array(),
		$qa_data_ver,
		true
	);

	// Art. 5 tracking table -- generated from the source .xls by extract_art5.py, its own file
	// for the same reason as the Q&A data. vcl-app.js treats window.VCL_ART5_DATA as optional.
	$art5_data_file = VFC_PLUGIN_DIR . 'assets/js/vcl-art5-data.js';
	$art5_data_ver  = file_exists( $art5_data_file ) ? filemtime( $art5_data_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-art5-data',
		VFC_PLUGIN_URL . 'assets/js/vcl-art5-data.js',
		array(),
		$art5_data_ver,
		true
	);

	$usage_file = VFC_PLUGIN_DIR . 'assets/js/vcl-usage.js';
	$usage_ver  = file_exists( $usage_file ) ? filemtime( $usage_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-usage',
		VFC_PLUGIN_URL . 'assets/js/vcl-usage.js',
		array(),
		$usage_ver,
		true
	);

	$app_file = VFC_PLUGIN_DIR . 'assets/js/vcl-app.js';
	$app_ver  = file_exists( $app_file ) ? filemtime( $app_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-app',
		VFC_PLUGIN_URL . 'assets/js/vcl-app.js',
		array( 'vcl-data', 'vcl-qa-data', 'vcl-art5-data', 'vcl-docx' ),
		$app_ver,
		true
	);

	// Workload assets -- style and RA-hours data/engine, registered separately from vcl-app.js/
	// vcl-style.css. The standalone Workload Planning tool that used to consume these has been
	// removed; they are kept because the Guided Workflow still reuses the shared .workload-col
	// style and the RA-hours engine.
	$workload_style_file = VFC_PLUGIN_DIR . 'assets/css/vcl-workload-style.css';
	$workload_style_ver  = file_exists( $workload_style_file ) ? filemtime( $workload_style_file ) : VFC_VERSION;

	wp_register_style(
		'vcl-workload-style',
		VFC_PLUGIN_URL . 'assets/css/vcl-workload-style.css',
		array( 'vcl-style' ),
		$workload_style_ver
	);

	$workload_data_file = VFC_PLUGIN_DIR . 'assets/js/vcl-workload-data.js';
	$workload_data_ver  = file_exists( $workload_data_file ) ? filemtime( $workload_data_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-workload-data',
		VFC_PLUGIN_URL . 'assets/js/vcl-workload-data.js',
		array(),
		$workload_data_ver,
		true
	);

	// Additive workload-hours DATA (window.VCL_WORKLOAD_HD), generated from RA-CMC-hours.xlsx by
	// convert-workload.py. No dependencies; the additive engine (vcl-workload-hours) reads it, so
	// it is registered before that module and listed as its dependency.
	$workload_hd_file = VFC_PLUGIN_DIR . 'assets/js/vcl-workload-hours-data.js';
	$workload_hd_ver  = file_exists( $workload_hd_file ) ? filemtime( $workload_hd_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-workload-hours-data',
		VFC_PLUGIN_URL . 'assets/js/vcl-workload-hours-data.js',
		array(),
		$workload_hd_ver,
		true
	);

	// Workload pure hour helpers (window.VCL_WORKLOAD_HOURS), incl. the additive model. Depends on
	// the generated data above so window.VCL_WORKLOAD_HD is ready when the engine is called.
	$workload_hours_file = VFC_PLUGIN_DIR . 'assets/js/vcl-workload-hours.js';
	$workload_hours_ver  = file_exists( $workload_hours_file ) ? filemtime( $workload_hours_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-workload-hours',
		VFC_PLUGIN_URL . 'assets/js/vcl-workload-hours.js',
		array( 'vcl-workload-hours-data' ),
		$workload_hours_ver,
		true
	);

	// Guided Workflow -- the 8th tool. Self-contained (window.VCL_WORKFLOW), reuses the
	// shared classification data and, once loaded, the fee engine (vcl-calc-app) and workload
	// factors. Loaded after them so those globals exist by the time it renders.
	$workflow_style_file = VFC_PLUGIN_DIR . 'assets/css/vcl-workflow-style.css';
	$workflow_style_ver  = file_exists( $workflow_style_file ) ? filemtime( $workflow_style_file ) : VFC_VERSION;

	wp_register_style(
		'vcl-workflow-style',
		VFC_PLUGIN_URL . 'assets/css/vcl-workflow-style.css',
		array( 'vcl-style' ),
		$workflow_style_ver
	);

	$guide_style_file = VFC_PLUGIN_DIR . 'assets/css/vcl-guide-style.css';
	$guide_style_ver  = file_exists( $guide_style_file ) ? filemtime( $guide_style_file ) : VFC_VERSION;

	wp_register_style(
		'vcl-guide-style',
		VFC_PLUGIN_URL . 'assets/css/vcl-guide-style.css',
		array( 'vcl-style' ),
		$guide_style_ver
	);

	// Super-Grouping / Annual Update pure-logic module (window.VCL_SG_LOGIC). No dependencies;
	// registered before vcl-workflow so its global is ready by the time that script runs.
	$sg_logic_file = VFC_PLUGIN_DIR . 'assets/js/vcl-sg-logic.js';
	$sg_logic_ver  = file_exists( $sg_logic_file ) ? filemtime( $sg_logic_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-sg-logic',
		VFC_PLUGIN_URL . 'assets/js/vcl-sg-logic.js',
		array(),
		$sg_logic_ver,
		true
	);

	$timeline_file = VFC_PLUGIN_DIR . 'assets/js/vcl-timeline.js';
	$timeline_ver  = file_exists( $timeline_file ) ? filemtime( $timeline_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-timeline',
		VFC_PLUGIN_URL . 'assets/js/vcl-timeline.js',
		array(),
		$timeline_ver,
		true
	);

	// Pure fee/hours orchestration for a canonical Submission object (window.VCL_SUBMISSION),
	// shared by the Guided Workflow and the Budget tool. No dependencies; registered before
	// vcl-workflow so its global is ready by the time that script runs.
	$submission_file = VFC_PLUGIN_DIR . 'assets/js/vcl-submission.js';
	$submission_ver  = file_exists( $submission_file ) ? filemtime( $submission_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-submission',
		VFC_PLUGIN_URL . 'assets/js/vcl-submission.js',
		array(),
		$submission_ver,
		true
	);

	$workflow_app_file = VFC_PLUGIN_DIR . 'assets/js/vcl-workflow.js';
	$workflow_app_ver  = file_exists( $workflow_app_file ) ? filemtime( $workflow_app_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-workflow',
		VFC_PLUGIN_URL . 'assets/js/vcl-workflow.js',
		array( 'vcl-sg-logic', 'vcl-data', 'vcl-timeline', 'vcl-workload-data', 'vcl-workload-hours', 'vcl-calc-app', 'vcl-submission' ),
		$workflow_app_ver,
		true
	);

	$guide_app_file = VFC_PLUGIN_DIR . 'assets/js/vcl-guide.js';
	$guide_app_ver  = file_exists( $guide_app_file ) ? filemtime( $guide_app_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-guide',
		VFC_PLUGIN_URL . 'assets/js/vcl-guide.js',
		array(),
		$guide_app_ver,
		true
	);

	$annual_data_file = VFC_PLUGIN_DIR . 'assets/js/vcl-annual-data.js';
	wp_register_script(
		'vcl-annual-data',
		VFC_PLUGIN_URL . 'assets/js/vcl-annual-data.js',
		array(),
		file_exists( $annual_data_file ) ? filemtime( $annual_data_file ) : false,
		true
	);

	$budget_engine_file = VFC_PLUGIN_DIR . 'assets/js/vcl-budget-engine.js';
	$budget_engine_ver  = file_exists( $budget_engine_file ) ? filemtime( $budget_engine_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-budget-engine',
		VFC_PLUGIN_URL . 'assets/js/vcl-budget-engine.js',
		array( 'vcl-annual-data' ),
		$budget_engine_ver,
		true
	);

	$budget_app_file = VFC_PLUGIN_DIR . 'assets/js/vcl-budget.js';
	$budget_app_ver  = file_exists( $budget_app_file ) ? filemtime( $budget_app_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-budget',
		VFC_PLUGIN_URL . 'assets/js/vcl-budget.js',
		array( 'vcl-data', 'vcl-calc-app', 'vcl-workload-hours', 'vcl-workload-hours-data', 'vcl-annual-data', 'vcl-budget-engine', 'vcl-submission', 'vcl-sg-logic' ),
		$budget_app_ver,
		true
	);

	$budget_style_file = VFC_PLUGIN_DIR . 'assets/css/vcl-budget-style.css';
	$budget_style_ver  = file_exists( $budget_style_file ) ? filemtime( $budget_style_file ) : VFC_VERSION;

	wp_register_style(
		'vcl-budget-style',
		VFC_PLUGIN_URL . 'assets/css/vcl-budget-style.css',
		array( 'vcl-style' ),
		$budget_style_ver
	);

	// Fee Calculator embedded into the Guide -- self-contained vcl-calc-* assets
	// (originally copied from the retired standalone calculator; prefixes renamed
	// vfc- -> vclcalc-, own header dropped). The fee data (vcl-calc-data.js) is
	// updated via the admin page (see includes/admin.php).
	wp_register_script(
		'vclcalc-xlsx',
		'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
		array(),
		'0.18.5',
		true
	);

	$calc_style_file = VFC_PLUGIN_DIR . 'assets/css/vcl-calc-style.css';
	$calc_style_ver  = file_exists( $calc_style_file ) ? filemtime( $calc_style_file ) : VFC_VERSION;

	wp_register_style(
		'vcl-calc-style',
		VFC_PLUGIN_URL . 'assets/css/vcl-calc-style.css',
		array( 'vcl-style' ),
		$calc_style_ver
	);

	$calc_data_file = VFC_PLUGIN_DIR . 'assets/js/vcl-calc-data.js';
	$calc_data_ver  = file_exists( $calc_data_file ) ? filemtime( $calc_data_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-calc-data',
		VFC_PLUGIN_URL . 'assets/js/vcl-calc-data.js',
		array(),
		$calc_data_ver,
		true
	);

	// Amounts typed into the fee editor (wp-admin -> Variation Toolbox -> Gebühren)
	// ride along with the fee data as a sparse overlay; vcl-calc-app.js lays them
	// over the shipped table before it resolves a single cell. Nothing is printed
	// while nobody has edited anything.
	$vcl_fee_overrides = vcl_get_fee_overrides();
	if ( $vcl_fee_overrides['rows'] || $vcl_fee_overrides['points'] || $vcl_fee_overrides['countries'] ) {
		wp_add_inline_script(
			'vcl-calc-data',
			'window.VCLCALC_OVERRIDES = ' . wp_json_encode( array(
				'rows'      => (object) $vcl_fee_overrides['rows'],
				'points'    => (object) $vcl_fee_overrides['points'],
				'countries' => (object) $vcl_fee_overrides['countries'],
			) ) . ';',
			'after'
		);
	}

	$calc_app_file = VFC_PLUGIN_DIR . 'assets/js/vcl-calc-app.js';
	$calc_app_ver  = file_exists( $calc_app_file ) ? filemtime( $calc_app_file ) : VFC_VERSION;

	wp_register_script(
		'vcl-calc-app',
		VFC_PLUGIN_URL . 'assets/js/vcl-calc-app.js',
		array( 'vcl-calc-data', 'vclcalc-xlsx' ),
		$calc_app_ver,
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
	wp_enqueue_style( 'vcl-workload-style' );
	wp_enqueue_style( 'vcl-workflow-style' );
	wp_enqueue_style( 'vcl-guide-style' );
	wp_enqueue_style( 'vcl-calc-style' );
	wp_enqueue_style( 'vcl-budget-style' );
	wp_enqueue_script( 'vcl-usage' );
	wp_enqueue_script( 'vcl-app' );
	wp_enqueue_script( 'vcl-timeline' );
	wp_enqueue_script( 'vcl-submission' );
	wp_enqueue_script( 'vcl-workflow' );
	wp_enqueue_script( 'vcl-guide' );
	wp_enqueue_script( 'vcl-calc-app' );
	wp_enqueue_script( 'vcl-annual-data' );
	wp_enqueue_script( 'vcl-budget-engine' );
	wp_enqueue_script( 'vcl-budget' );
	wp_localize_script( 'vcl-app', 'VCL_CONFIG', array(
		'calculatorUrl' => $atts['calculator_url'],
		// Admin-editable via the "Variation Toolbox" section on the plugin's settings
		// page (see vcl_get_last_updated() in includes/admin.php) -- falls back to the dates
		// baked into vcl-data.js/vcl-app.js if never saved there.
		'lastUpdated'   => vcl_get_last_updated(),
		// Same admin-editable/fallback pattern for the free-text guideline reference shown
		// next to it (see vcl_get_reference_text() in includes/admin.php).
		'referenceText' => vcl_get_reference_text(),
		// Optional download link to the calculator's source Excel workbook, shown in the
		// embedded Fee Calculator's heading (see vcl_get_calc_excel_url() in admin.php).
		'calcExcelUrl'  => vcl_get_calc_excel_url(),
		// Same, for the workbook behind Workload Planning's RA-hours factors -- shown in that
		// tool's "How this estimate is built" panel (see vcl_get_workload_excel_url()).
		'workloadExcelUrl' => vcl_get_workload_excel_url(),
		// Feedback address for the "Suggest an improvement" links, handed over split into
		// user/domain rather than whole -- see vcl_get_contact_parts() for why. Empty array
		// when no valid address is configured, which hides the links.
		'contact'          => vcl_get_contact_parts(),
		'countUrl'         => rest_url( 'vfc/v1/count' ),
	) );

	ob_start();
	?>
	<div class="vcl-app" id="vcl-app">

	<div class="page-shell">

	<header class="app-header">
	  <div class="app-header__actions">
	    <button type="button" class="app-header__summary hidden" id="vcl-summaryHeaderBtn" aria-label="Show the summary of selected variations" title="Summary of selected variations">
	      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h11"/><path d="M8 12h11"/><path d="M8 18h11"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/></svg>
	      <span>Summary</span>
	      <span class="app-header__summary-count" id="vcl-summaryHeaderCount">0</span>
	    </button>
	    <button type="button" class="app-header__guide" id="vcl-guideBtn" aria-label="How to use this toolbox" title="How to use this toolbox">
	      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.7-2.4 3.4"/><path d="M12 17h.01"/></svg>
	      <span>How to use</span>
	    </button>
	    <button type="button" class="app-header__home" id="vcl-homeBtn" aria-label="Back to start" title="Back to start">
	      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>
	      <span>Start</span>
	    </button>
	  </div>
	  <h1>Variation Toolbox</h1>
	  <p class="app-header__copyright">
	    &copy; Dr. Tom Deutschle
	    <!-- Filled by vcl-app.js (fillContactSlots): the address is assembled in the browser
	         so it never appears literally in the served HTML. Stays empty if none is set. -->
	    <span id="vcl-contactSlot"></span>
	  </p>
	  <p>
	    One toolbox for the full variation lifecycle &mdash; classification, grouping, timetables, RA
	    workload and official fees across EU-27, EMA, CH, IS, NO, UK and RS, plus portfolio-level
	    budget planning.
	  </p>
	</header>

	<nav class="tool-bar" id="vcl-toolBar" aria-label="Tools"></nav>

	<div class="layout">
	  <!-- Collapsed-tree rail: holds the "Show list" control while the browse column is hidden,
	       so re-opening the list never costs vertical space above the content. -->
	  <div class="tree-rail" id="vcl-treeRail"></div>

	  <div class="browse-col" id="vcl-browseCol">
	    <!-- Header row of the list: section label + the Hide-list toggle. Lives inside the column
	         (not in a row of its own above the grid) so collapsing the list never moves the
	         content up or down. Filled by renderTreeToggle() in vcl-app.js. -->
	    <div class="browse-col__head" id="vcl-browseColHead"></div>
	    <div class="search-box">
	      <input type="text" id="vcl-searchInput" placeholder="Search by code or keyword (i. e. shape, shelf, leaflet) ..." autocomplete="off" />
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
	      <div class="summary-header__top">
	        <div class="summary-header__info">
	          <h2 class="summary-header__title">Summary of Variations</h2>
	          <p class="summary-header__count" id="vcl-summaryCount"></p>
	        </div>
	        <div class="summary-header__actions">
	          <button type="button" id="vcl-summaryExpandAll">Expand all</button>
	          <button type="button" id="vcl-summaryCollapseAll">Collapse all</button>
	          <button type="button" id="vcl-summaryClearAll" class="summary-header__clear">Clear all</button>
	          <button type="button" id="vcl-summaryExportDocx">Export to .docx</button>
	          <button type="button" id="vcl-summaryPrint">Print</button>
	        </div>
	      </div>
	      <p class="summary-header__hint">Expand an item to review its conditions, documentation and &mdash; where available &mdash; an example wording for the application form's 'Precise scope' field.</p>
	    </div>
	    <div class="summary-list" id="vcl-summaryList"></div>
	    <div class="summary-footer">
	      <button type="button" id="vcl-summaryExportWorkflow" class="summary-footer__button summary-footer__button--workflow">Export to Guided Workflow &rarr;</button>
	      <button type="button" id="vcl-summaryExportBudget" class="summary-footer__button summary-footer__button--budget">Export to Budget Planning Tool &rarr;</button>
	      <button type="button" id="vcl-summaryExportCalculator" class="summary-footer__button">Export to Variation Fee Calculator &rarr;</button>
	    </div>
	  </div>

	  <div class="grouping-col hidden" id="vcl-groupingCol"></div>

	  <div class="grouping-col hidden" id="vcl-preciseScopeCol"></div>

	  <!-- Q&A on Variations: reuses .grouping-col (same grid cell, same one-of-many
	       visibility rule) -- only its inner qa-* markup is its own. -->
	  <div class="grouping-col hidden" id="vcl-qaCol"></div>

	  <!-- Art. 5 recommendations: the fifth Classification chapter, same shared grid cell. -->
	  <div class="grouping-col hidden" id="vcl-art5Col"></div>

	  <div class="timetables-col hidden" id="vcl-timetablesCol"></div>

	  <div class="workload-col hidden" id="vcl-workflowCol"></div>

	  <div class="budget-col hidden" id="vcl-budgetCol"></div>

	  <!-- Fee Calculator (embedded copy). The guide-style heading is rendered into
	       vcl-calcHead by vcl-app.js; the .vclcalc-app block below is the copied
	       calculator scaffold with its own header intentionally omitted. -->
	  <div class="calculator-col hidden" id="vcl-calculatorCol">
	    <!-- Shares the shared reference-header shape, but carries the Calculator's own gold
	         identity instead of the Classification blue (see .classification-head--calc). -->
	    <div class="classification-head classification-head--calc" id="vcl-calcHead"></div>
	    <div class="vclcalc-app" id="vclcalc-app">
	      <div class="rail" id="vclcalc-rail"></div>
	      <div id="vclcalc-stepContent"></div>
	      <div class="src">
	        <div class="fx-status-row">
	          <span id="vclcalc-fxStatus" style="font-family:var(--mono); font-size:11px; color:var(--ink-faint);"></span>
	        </div>
	      </div>
	    </div>
	  </div>
	</div>


	  <!-- Colophon: shown under every tool, since the whole app is one page. The version comes
	       from VFC_VERSION, so it is never maintained by hand; the copyright year opens at 2026
	       (the year the toolbox was written) and becomes a span once the current year moves on. -->
	  <p class="app-colophon">
	    <?php
	    $vcl_year_now = (int) date_i18n( 'Y' );
	    // En dash, not a hyphen: it is a range. Built from an int, so esc_html has nothing to
	    // strip -- it is here because every echo in this file goes through an escaper.
	    $vcl_years    = $vcl_year_now > 2026 ? '2026–' . $vcl_year_now : '2026';
	    echo '&copy; ' . esc_html( $vcl_years ) . ' Dr. Tom Deutschle';
	    ?>
	    <span class="app-colophon__sep">&middot;</span>
	    Variation Toolbox <span class="app-colophon__ver">v<?php echo esc_html( VFC_VERSION ); ?></span>
	  </p>
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

	<div class="hidden" id="vcl-guideModal"></div>

	</div>
	<?php
	return ob_get_clean();
}
add_shortcode( 'variation_classification_lookup', 'vcl_shortcode' );
