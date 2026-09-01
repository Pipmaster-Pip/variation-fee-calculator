<?php
/**
 * Fee editor: type the fee table in the browser instead of in Excel.
 *
 * Storage model — deliberately an OVERLAY, not a replacement. The plugin's
 * assets/js/vcl-calc-data.js stays the baseline; what is typed here is saved as
 * a sparse map of the cells that differ, in the option vcl_fee_overrides, and
 * applied on top of the baseline at runtime (see applyOverrides() in
 * vcl-calc-app.js). Three reasons:
 *
 *  - A plugin update never silently discards the edits, and never freezes them
 *    either: unedited amounts keep tracking the shipped file.
 *  - Ionos and NAS hold their own option, so the two environments can differ
 *    while running the same plugin build.
 *  - The saved payload is small and human-readable, which is what makes the
 *    export/import and the version history (still to come) straightforward.
 *
 * What is edited are the AMOUNTS. The calculation rule of a row still lives in
 * that row's formula in the fee table.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const VCL_FEE_OVERRIDES_OPTION = 'vcl_fee_overrides';

/** Amount columns of the fee table, in each of the three notations a row can
 * be maintained in: euro (F), local currency (F_lc), points (F_pt). */
function vcl_fee_editable_fields() {
	$fields = array();
	foreach ( array( 'F', 'G', 'H', 'I', 'J', 'K', 'T', 'U', 'V' ) as $col ) {
		$fields[] = $col;
		$fields[] = $col . '_lc';
		$fields[] = $col . '_pt';
	}
	return $fields;
}

/**
 * The saved overrides, always in the shape
 * array( 'rows' => array( '<rowNo>' => array( '<field>' => float ) ),
 *        'points' => array( '<cc>' => float ), 'updated' => ..., 'by' => ... ).
 */
function vcl_get_fee_overrides() {
	$saved = get_option( VCL_FEE_OVERRIDES_OPTION, array() );
	if ( ! is_array( $saved ) ) {
		$saved = array();
	}
	return wp_parse_args( $saved, array(
		'rows'    => array(),
		'points'  => array(),
		'updated' => '',
		'by'      => '',
	) );
}

/**
 * Validates a posted payload down to "row number => field => finite number".
 * Anything unrecognised is dropped rather than rejected: a stray key from an
 * older plugin build should not block a save of the values that are still
 * valid. Returns array( $clean, $dropped ).
 */
function vcl_sanitize_fee_overrides( $payload ) {
	$allowed = array_flip( vcl_fee_editable_fields() );
	$clean   = array( 'rows' => array(), 'points' => array() );
	$dropped = 0;

	if ( isset( $payload['rows'] ) && is_array( $payload['rows'] ) ) {
		foreach ( $payload['rows'] as $row => $fields ) {
			if ( ! ctype_digit( (string) $row ) || ! is_array( $fields ) ) {
				$dropped++;
				continue;
			}
			$row_clean = array();
			foreach ( $fields as $field => $value ) {
				if ( ! isset( $allowed[ $field ] ) || ! is_numeric( $value ) ) {
					$dropped++;
					continue;
				}
				$num = (float) $value;
				if ( ! is_finite( $num ) || $num < 0 ) {
					$dropped++;
					continue;
				}
				$row_clean[ $field ] = $num;
			}
			if ( $row_clean ) {
				$clean['rows'][ (string) (int) $row ] = $row_clean;
			}
		}
	}

	if ( isset( $payload['points'] ) && is_array( $payload['points'] ) ) {
		foreach ( $payload['points'] as $cc => $value ) {
			$code = sanitize_text_field( (string) $cc );
			if ( $code === '' || ! is_numeric( $value ) ) {
				$dropped++;
				continue;
			}
			$num = (float) $value;
			if ( ! is_finite( $num ) || $num <= 0 ) {
				$dropped++;
				continue;
			}
			$clean['points'][ $code ] = $num;
		}
	}

	return array( $clean, $dropped );
}

/** Total number of overridden cells, for the "n Werte geändert" line. */
function vcl_count_fee_overrides( $overrides ) {
	$n = count( $overrides['points'] );
	foreach ( $overrides['rows'] as $fields ) {
		$n += count( $fields );
	}
	return $n;
}

// ---------------------------------------------------------------------------
// Admin page
// ---------------------------------------------------------------------------

function vcl_fee_editor_menu() {
	add_options_page(
		'Variation Toolbox — Gebühren',
		'Variation Toolbox — Gebühren',
		'manage_options',
		'vcl-fee-editor',
		'vcl_render_fee_editor'
	);
}
add_action( 'admin_menu', 'vcl_fee_editor_menu' );

/**
 * The editor drives the real calculator: it loads vcl-calc-data.js and
 * vcl-calc-app.js and prices its live example through window.VCLCALC.
 * vcl-calc-app.js expects the calculator's own container elements to exist, so
 * the page renders the same hidden stubs the test harness uses. Re-using the
 * engine is the point — a second implementation of the fee logic here could
 * drift from the one the site actually runs.
 */
function vcl_fee_editor_assets( $hook ) {
	if ( $hook !== 'settings_page_vcl-fee-editor' ) {
		return;
	}

	$dir = VFC_PLUGIN_DIR . 'assets/';
	$url = VFC_PLUGIN_URL . 'assets/';
	$ver = function ( $rel ) use ( $dir ) {
		$path = $dir . $rel;
		return file_exists( $path ) ? filemtime( $path ) : VFC_VERSION;
	};

	wp_enqueue_style( 'vcl-fee-editor-fonts',
		'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
		array(), null );
	wp_enqueue_style( 'vcl-fee-editor', $url . 'css/vcl-fee-editor.css',
		array( 'vcl-fee-editor-fonts' ), $ver( 'css/vcl-fee-editor.css' ) );

	wp_enqueue_script( 'vcl-calc-data', $url . 'js/vcl-calc-data.js',
		array(), $ver( 'js/vcl-calc-data.js' ), true );
	wp_enqueue_script( 'vcl-calc-app', $url . 'js/vcl-calc-app.js',
		array( 'vcl-calc-data' ), $ver( 'js/vcl-calc-app.js' ), true );
	wp_enqueue_script( 'vcl-fee-editor', $url . 'js/vcl-fee-editor.js',
		array( 'vcl-calc-app' ), $ver( 'js/vcl-fee-editor.js' ), true );

	$overrides = vcl_get_fee_overrides();
	// Hand the saved overrides to the engine before it boots, so the page opens
	// showing the amounts that are actually live.
	wp_add_inline_script( 'vcl-calc-data',
		'window.VCLCALC_OVERRIDES = ' . wp_json_encode( array(
			'rows'   => (object) $overrides['rows'],
			'points' => (object) $overrides['points'],
		) ) . ';', 'after' );
	wp_localize_script( 'vcl-fee-editor', 'VCLFE_CONFIG', array(
		'overrides'    => array(
			'rows'   => (object) $overrides['rows'],
			'points' => (object) $overrides['points'],
		),
		// Which shape the country picker takes: tabs | pills | select.
		'picker'       => 'tabs',
		'startCountry' => isset( $_GET['cc'] ) ? sanitize_text_field( wp_unslash( $_GET['cc'] ) ) : '',
	) );
}
add_action( 'admin_enqueue_scripts', 'vcl_fee_editor_assets' );

function vcl_render_fee_editor() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$status    = isset( $_GET['vclfe_status'] ) ? sanitize_key( $_GET['vclfe_status'] ) : '';
	$dropped   = isset( $_GET['vclfe_dropped'] ) ? absint( $_GET['vclfe_dropped'] ) : 0;
	$overrides = vcl_get_fee_overrides();
	$count     = vcl_count_fee_overrides( $overrides );
	?>
	<div class="wrap">
		<h1>Variation Toolbox — Gebühren bearbeiten</h1>

		<?php if ( $status === 'saved' ) : ?>
			<div class="notice notice-success is-dismissible"><p>
				Gebühren gespeichert<?php echo $dropped ? ' — ' . (int) $dropped . ' unbrauchbare Werte wurden dabei verworfen.' : '.'; ?>
			</p></div>
		<?php elseif ( $status === 'cleared' ) : ?>
			<div class="notice notice-success is-dismissible"><p>Alle Änderungen zurückgesetzt — es gelten wieder die Beträge aus der Gebührentabelle des Plugins.</p></div>
		<?php elseif ( $status === 'error' ) : ?>
			<div class="notice notice-error is-dismissible"><p>Die Daten konnten nicht gelesen werden. Es wurde nichts gespeichert.</p></div>
		<?php endif; ?>

		<div id="vclfe-root">

			<div class="vclfe-note">
				<span class="vclfe-note__tag">Hinweis</span>
				<div>
					<b>Hier werden Beträge gepflegt, keine Rechenwege.</b>
					Wie die Sätze einer Zeile zusammengerechnet werden (Staffelung, Gruppenpauschale,
					Deckel), steht weiterhin in der Formel dieser Zeile. Geänderte Beträge werden als
					Ergänzung zur Gebührentabelle des Plugins gespeichert — die Datei selbst bleibt
					unangetastet, ein Plugin-Update überschreibt die Eingaben also nicht.
					<?php if ( $count ) : ?>
						Aktuell gespeichert: <b><?php echo (int) $count; ?></b> geänderte Werte<?php
						echo $overrides['updated'] ? ' (zuletzt ' . esc_html( date_i18n( 'd.m.Y H:i', strtotime( $overrides['updated'] ) ) ) . ( $overrides['by'] ? ', ' . esc_html( $overrides['by'] ) : '' ) . ')' : ''; ?>.
					<?php endif; ?>
				</div>
			</div>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'vclfe_save_action', 'vclfe_save_nonce' ); ?>
				<input type="hidden" name="action" value="vclfe_save">
				<input type="hidden" name="vclfe_payload" id="vclfe-payload" value="">

				<nav id="vclfe-picker" class="vclfe-picker" aria-label="Land wählen"></nav>

				<header class="vclfe-masthead">
					<div>
						<h2 id="vclfe-title">—</h2>
						<p class="vclfe-meta" id="vclfe-meta"></p>
					</div>
					<div class="vclfe-actions">
						<span class="vclfe-dirty" id="vclfe-editcount"></span>
						<button type="button" class="vclfe-btn" id="vclfe-reset">Verwerfen</button>
						<button type="submit" class="vclfe-btn vclfe-btn--primary">Speichern</button>
					</div>
				</header>

				<div class="vclfe-layout">
					<main id="vclfe-main"></main>
				</div>
			</form>

			<?php if ( $count ) : ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:22px">
					<?php wp_nonce_field( 'vclfe_clear_action', 'vclfe_clear_nonce' ); ?>
					<input type="hidden" name="action" value="vclfe_clear">
					<button type="submit" class="vclfe-btn"
						onclick="return confirm('Wirklich alle <?php echo (int) $count; ?> gespeicherten Änderungen löschen? Danach gelten wieder die Beträge aus der Gebührentabelle des Plugins.');">
						Alle gespeicherten Änderungen löschen
					</button>
				</form>
			<?php endif; ?>
		</div>

		<?php
		// vcl-calc-app.js binds these on load; without them it stops before it
		// exposes window.VCLCALC, which the live example needs.
		$stub_ids = array( 'app', 'rail', 'stepContent', 'fxStatus', 'headerTag', 'typeCounters',
			'countryDetailList', 'specialPanel', 'specialBlocks', 'changelogPanel',
			'haWebsitesPanel', 'strengthsNote' );
		$stub_buttons = array( 'selectAll', 'resetSelection', 'restart', 'strengthsReset',
			'toStep2', 'toStep3', 'toResult', 'back1', 'back2', 'back3',
			'toggleChangelog', 'toggleHaWebsites' );
		?>
		<div hidden aria-hidden="true">
			<?php foreach ( $stub_ids as $id ) : ?>
				<div id="vclcalc-<?php echo esc_attr( $id ); ?>"></div>
			<?php endforeach; ?>
			<input id="vclcalc-countrySearch">
			<?php foreach ( $stub_buttons as $id ) : ?>
				<button type="button" id="vclcalc-<?php echo esc_attr( $id ); ?>"></button>
			<?php endforeach; ?>
		</div>
	</div>
	<?php
}

// ---------------------------------------------------------------------------
// Save handlers
// ---------------------------------------------------------------------------

function vcl_fee_editor_redirect( $args ) {
	wp_safe_redirect( add_query_arg( $args, admin_url( 'options-general.php?page=vcl-fee-editor' ) ) );
	exit;
}

function vcl_handle_save_fee_overrides() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vclfe_save_action', 'vclfe_save_nonce' );

	$raw = isset( $_POST['vclfe_payload'] ) ? wp_unslash( $_POST['vclfe_payload'] ) : '';
	$payload = json_decode( (string) $raw, true );
	if ( ! is_array( $payload ) ) {
		vcl_fee_editor_redirect( array( 'vclfe_status' => 'error' ) );
	}

	list( $clean, $dropped ) = vcl_sanitize_fee_overrides( $payload );

	$user = wp_get_current_user();
	update_option( VCL_FEE_OVERRIDES_OPTION, array(
		'rows'    => $clean['rows'],
		'points'  => $clean['points'],
		'updated' => current_time( 'mysql' ),
		'by'      => $user ? $user->display_name : '',
	) );

	vcl_fee_editor_redirect( array( 'vclfe_status' => 'saved', 'vclfe_dropped' => $dropped ) );
}
add_action( 'admin_post_vclfe_save', 'vcl_handle_save_fee_overrides' );

function vcl_handle_clear_fee_overrides() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vclfe_clear_action', 'vclfe_clear_nonce' );

	delete_option( VCL_FEE_OVERRIDES_OPTION );
	vcl_fee_editor_redirect( array( 'vclfe_status' => 'cleared' ) );
}
add_action( 'admin_post_vclfe_clear', 'vcl_handle_clear_fee_overrides' );
