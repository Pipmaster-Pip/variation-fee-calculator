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

/** The set replaced by the last import, so a wrong file can be undone. */
const VCL_FEE_OVERRIDES_PREVIOUS_OPTION = 'vcl_fee_overrides_previous';

/** Bumped only when the exported shape changes in a way an older import
 * could not read correctly. */
const VCL_FEE_EXPORT_FORMAT = 1;

/** An export of all 421 rows is a few dozen KB; anything far past that is not
 * one of our files. */
const VCL_FEE_IMPORT_MAX_BYTES = 2097152;

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
 *        'points' => array( '<cc>' => float ),
 *        'countries' => array( '<CC>' => array( 'checked' => 'Y-m-d',
 *                                               'source' => string,
 *                                               'updated' => 'Y-m-d' ) ),
 *        'updated' => ..., 'by' => ... ).
 */
function vcl_get_fee_overrides() {
	$saved = get_option( VCL_FEE_OVERRIDES_OPTION, array() );
	if ( ! is_array( $saved ) ) {
		$saved = array();
	}
	return wp_parse_args( $saved, array(
		'rows'      => array(),
		'points'    => array(),
		'countries' => array(),
		'updated'   => '',
		'by'        => '',
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
	$clean   = array( 'rows' => array(), 'points' => array(), 'countries' => array() );
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

	// Per-country provenance: a checked date the user maintains by hand, the
	// free-text source reference, and an edited date we stamp on save. Anything
	// that is not a date or a string is dropped, like everywhere else here.
	if ( isset( $payload['countries'] ) && is_array( $payload['countries'] ) ) {
		foreach ( $payload['countries'] as $cc => $fields ) {
			if ( ! is_array( $fields ) ) {
				$dropped++;
				continue;
			}
			$code  = sanitize_text_field( (string) $cc );
			$entry = array();

			foreach ( array( 'checked', 'updated' ) as $key ) {
				if ( empty( $fields[ $key ] ) ) {
					continue;
				}
				if ( ! is_scalar( $fields[ $key ] ) ) {
					$dropped++;
					continue;
				}
				$date = sanitize_text_field( (string) $fields[ $key ] );
				if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date ) ) {
					$entry[ $key ] = $date;
				} else {
					$dropped++;
				}
			}
			if ( ! empty( $fields['source'] ) ) {
				if ( is_scalar( $fields['source'] ) ) {
					$entry['source'] = sanitize_text_field( (string) $fields['source'] );
				} else {
					$dropped++;
				}
			}
			if ( $entry ) {
				$clean['countries'][ $code ] = $entry;
			}
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
	// The per-country provenance counts too: on an installation where only
	// checked dates and sources were maintained there is still something to
	// export, to clear and to report. The 'updated' stamp is written by the
	// save rather than typed, so it is not a maintained value.
	if ( ! empty( $overrides['countries'] ) && is_array( $overrides['countries'] ) ) {
		foreach ( $overrides['countries'] as $fields ) {
			foreach ( array( 'checked', 'source' ) as $key ) {
				if ( ! empty( $fields[ $key ] ) ) {
					$n++;
				}
			}
		}
	}
	return $n;
}

// ---------------------------------------------------------------------------
// Admin page
// ---------------------------------------------------------------------------

/**
 * Top-level menu entry, not a Settings submenu: the fee maintenance is the most
 * frequently used admin screen of this plugin, so it gets its own icon in the
 * sidebar instead of hiding two clicks deep under Settings. The page slug is
 * deliberately unchanged ('vcl-fee-editor') so saved bookmarks that carry it,
 * and the post-save redirect, keep pointing at the same page. Capability is
 * unchanged as well ('manage_options').
 *
 * Position 58 puts it just below Settings and above the plugin-added block at
 * 60+, i.e. in the tools/settings neighbourhood rather than among the content
 * menus.
 */
function vcl_fee_editor_menu() {
	add_menu_page(
		'Variation Toolbox — Gebühren',
		'Toolbox-Gebühren',
		'manage_options',
		'vcl-fee-editor',
		'vcl_render_fee_editor',
		'dashicons-money-alt',
		58
	);
}
add_action( 'admin_menu', 'vcl_fee_editor_menu' );

/**
 * Compatibility for the old location (Settings -> Variation Toolbox — Gebühren):
 * bookmarks and any stale redirect still requesting
 * options-general.php?page=vcl-fee-editor are forwarded to the new top-level
 * page, query string intact, instead of running into WordPress' "not allowed to
 * access this page" screen.
 */
function vcl_fee_editor_legacy_redirect() {
	global $pagenow;
	if ( 'options-general.php' !== $pagenow ) {
		return;
	}
	if ( ! isset( $_GET['page'] ) || 'vcl-fee-editor' !== $_GET['page'] ) {
		return;
	}
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$args = $_GET;
	unset( $args['page'] );
	wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php?page=vcl-fee-editor' ) ) );
	exit;
}
add_action( 'admin_init', 'vcl_fee_editor_legacy_redirect' );

/**
 * The editor drives the real calculator: it loads vcl-calc-data.js and
 * vcl-calc-app.js and prices its live example through window.VCLCALC.
 * vcl-calc-app.js expects the calculator's own container elements to exist, so
 * the page renders the same hidden stubs the test harness uses. Re-using the
 * engine is the point — a second implementation of the fee logic here could
 * drift from the one the site actually runs.
 */
function vcl_fee_editor_assets( $hook ) {
	// Top-level menu page, so the hook suffix is 'toplevel_page_...', not
	// 'settings_page_...' as it was while the editor lived under Settings.
	if ( $hook !== 'toplevel_page_vcl-fee-editor' ) {
		return;
	}

	$dir = VFC_PLUGIN_DIR . 'assets/';
	$url = VFC_PLUGIN_URL . 'assets/';
	$ver = function ( $rel ) use ( $dir ) {
		$path = $dir . $rel;
		return file_exists( $path ) ? filemtime( $path ) : VFC_VERSION;
	};

	wp_enqueue_style( 'vcl-fee-editor-fonts',
		'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap',
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
			'rows'      => (object) $overrides['rows'],
			'points'    => (object) $overrides['points'],
			'countries' => (object) $overrides['countries'],
		) ) . ';', 'after' );
	wp_localize_script( 'vcl-fee-editor', 'VCLFE_CONFIG', array(
		'overrides'    => array(
			'rows'      => (object) $overrides['rows'],
			'points'    => (object) $overrides['points'],
			'countries' => (object) $overrides['countries'],
		),
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
	$imported_count = isset( $_GET['vclfe_count'] ) ? absint( $_GET['vclfe_count'] ) : 0;
	$has_previous   = is_array( get_option( VCL_FEE_OVERRIDES_PREVIOUS_OPTION, null ) );
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
		<?php elseif ( $status === 'imported' ) : ?>
			<div class="notice notice-success is-dismissible"><p>
				Gebühren importiert — <?php echo (int) $imported_count; ?> Werte gelten jetzt<?php
				echo $dropped ? ', ' . (int) $dropped . ' unbrauchbare wurden verworfen' : ''; ?>.
				Der vorherige Stand liegt bereit und kann unten zurückgeholt werden.
			</p></div>
		<?php elseif ( $status === 'undone' ) : ?>
			<div class="notice notice-success is-dismissible"><p>Der Stand vor dem Import gilt wieder.</p></div>
		<?php elseif ( $status === 'import_format' ) : ?>
			<div class="notice notice-error is-dismissible"><p>Diese Datei ist keine Gebühren-Sicherung dieses Plugins. Es wurde nichts geändert.</p></div>
		<?php elseif ( $status === 'import_error' ) : ?>
			<div class="notice notice-error is-dismissible"><p>Die Datei konnte nicht gelesen werden. Es wurde nichts geändert.</p></div>
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

			<section class="vclfe-maintain">
				<h3>Sichern, übertragen, zurücksetzen</h3>
				<p>
					Die eingetippten Beträge liegen in der WordPress-Datenbank (Option
					<code>vcl_fee_overrides</code>) und sind damit in jeder Datenbanksicherung enthalten.
					Ein Plugin-Update rührt sie nicht an. Der Export unten ist die Datei, mit der Du
					denselben Stand in die andere Umgebung bringst — oder einfach neben dem Plugin
					aufbewahrst.
				</p>

				<div class="vclfe-maintain__row">
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<?php wp_nonce_field( 'vclfe_export_action', 'vclfe_export_nonce' ); ?>
						<input type="hidden" name="action" value="vclfe_export">
						<button type="submit" class="vclfe-btn"<?php disabled( ! $count ); ?>>
							Exportieren<?php echo $count ? ' (' . (int) $count . ' Werte)' : ''; ?>
						</button>
					</form>

					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data">
						<?php wp_nonce_field( 'vclfe_import_action', 'vclfe_import_nonce' ); ?>
						<input type="hidden" name="action" value="vclfe_import">
						<input type="file" name="vclfe_import_file" accept=".json,application/json" required>
						<button type="submit" class="vclfe-btn"
							onclick="return confirm('Der Import ersetzt alle gespeicherten Beträge durch die aus der Datei. Fortfahren?');">
							Importieren
						</button>
					</form>
				</div>

				<div class="vclfe-maintain__row">
					<?php if ( $has_previous ) : ?>
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
							<?php wp_nonce_field( 'vclfe_undo_action', 'vclfe_undo_nonce' ); ?>
							<input type="hidden" name="action" value="vclfe_undo_import">
							<button type="submit" class="vclfe-btn">Stand vor dem letzten Import zurückholen</button>
						</form>
					<?php endif; ?>

					<?php if ( $count ) : ?>
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
							<?php wp_nonce_field( 'vclfe_clear_action', 'vclfe_clear_nonce' ); ?>
							<input type="hidden" name="action" value="vclfe_clear">
							<button type="submit" class="vclfe-btn vclfe-btn--danger"
								onclick="return confirm('Wirklich alle <?php echo (int) $count; ?> gespeicherten Änderungen löschen? Danach gelten wieder die Beträge aus der Gebührentabelle des Plugins.');">
								Alle gespeicherten Änderungen löschen
							</button>
						</form>
					<?php endif; ?>
				</div>
			</section>
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
	// Follows the menu move: the editor is a top-level page now (same slug).
	wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php?page=vcl-fee-editor' ) ) );
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
		'rows'      => $clean['rows'],
		'points'    => $clean['points'],
		'countries' => $clean['countries'],
		'updated'   => current_time( 'mysql' ),
		'by'        => $user ? $user->display_name : '',
	), false );

	vcl_fee_editor_redirect( array( 'vclfe_status' => 'saved', 'vclfe_dropped' => $dropped ) );
}
add_action( 'admin_post_vclfe_save', 'vcl_handle_save_fee_overrides' );

/**
 * Export: the saved amounts as a JSON file, named with the site host and the
 * date. This is the file that carries a set of fees from NAS to Ionos or the
 * other way round, and it is small enough to keep next to the plugin in git.
 *
 * Sent as a download rather than shown on screen, because the point is to hand
 * it to the other environment unchanged -- copy-pasting JSON out of a textarea
 * is where whitespace and quote mangling creep in.
 */
function vcl_handle_export_fee_overrides() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vclfe_export_action', 'vclfe_export_nonce' );

	$overrides = vcl_get_fee_overrides();
	$payload   = array(
		'format'    => VCL_FEE_EXPORT_FORMAT,
		'plugin'    => VFC_VERSION,
		'site'      => home_url(),
		'exported'  => current_time( 'mysql' ),
		'updated'   => $overrides['updated'],
		'by'        => $overrides['by'],
		'rows'      => (object) $overrides['rows'],
		'points'    => (object) $overrides['points'],
		'countries' => (object) $overrides['countries'],
	);

	$host = wp_parse_url( home_url(), PHP_URL_HOST );
	$name = 'variation-fees-' . sanitize_file_name( $host ? $host : 'site' )
		. '-' . gmdate( 'Y-m-d' ) . '.json';

	nocache_headers();
	header( 'Content-Type: application/json; charset=utf-8' );
	header( 'Content-Disposition: attachment; filename="' . $name . '"' );
	echo wp_json_encode( $payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
	exit;
}
add_action( 'admin_post_vclfe_export', 'vcl_handle_export_fee_overrides' );

/**
 * Import: reads a file produced by the export above and REPLACES the saved
 * amounts with it. Replaces rather than merges on purpose -- merging two sets of
 * fees would leave a state that exists in neither environment, and no one could
 * say afterwards which amount came from where.
 *
 * The previous set is kept in vcl_fee_overrides_previous first, so an import of
 * the wrong file is one click away from being undone.
 */
function vcl_handle_import_fee_overrides() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vclfe_import_action', 'vclfe_import_nonce' );

	if ( empty( $_FILES['vclfe_import_file'] ) || ! isset( $_FILES['vclfe_import_file']['error'] )
		|| $_FILES['vclfe_import_file']['error'] !== UPLOAD_ERR_OK
		|| ! is_uploaded_file( $_FILES['vclfe_import_file']['tmp_name'] ) ) {
		vcl_fee_editor_redirect( array( 'vclfe_status' => 'import_error' ) );
	}

	$raw = file_get_contents( $_FILES['vclfe_import_file']['tmp_name'] );
	if ( $raw === false || strlen( $raw ) > VCL_FEE_IMPORT_MAX_BYTES ) {
		vcl_fee_editor_redirect( array( 'vclfe_status' => 'import_error' ) );
	}

	$payload = json_decode( $raw, true );
	if ( ! is_array( $payload ) || ! isset( $payload['format'] )
		|| (int) $payload['format'] !== VCL_FEE_EXPORT_FORMAT ) {
		vcl_fee_editor_redirect( array( 'vclfe_status' => 'import_format' ) );
	}

	list( $clean, $dropped ) = vcl_sanitize_fee_overrides( $payload );

	$previous = get_option( VCL_FEE_OVERRIDES_OPTION, array() );
	if ( is_array( $previous ) ) {
		update_option( VCL_FEE_OVERRIDES_PREVIOUS_OPTION, $previous, false );
	}

	$user = wp_get_current_user();
	update_option( VCL_FEE_OVERRIDES_OPTION, array(
		'rows'      => $clean['rows'],
		'points'    => $clean['points'],
		'countries' => $clean['countries'],
		'updated'   => current_time( 'mysql' ),
		'by'        => ( $user ? $user->display_name : '' ) . ' (Import)',
	), false );

	vcl_fee_editor_redirect( array(
		'vclfe_status'  => 'imported',
		'vclfe_count'   => vcl_count_fee_overrides( vcl_get_fee_overrides() ),
		'vclfe_dropped' => $dropped,
	) );
}
add_action( 'admin_post_vclfe_import', 'vcl_handle_import_fee_overrides' );

/**
 * Puts back whatever was saved before the last import.
 */
function vcl_handle_undo_import() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vclfe_undo_action', 'vclfe_undo_nonce' );

	$previous = get_option( VCL_FEE_OVERRIDES_PREVIOUS_OPTION, null );
	if ( ! is_array( $previous ) ) {
		vcl_fee_editor_redirect( array( 'vclfe_status' => 'import_error' ) );
	}
	update_option( VCL_FEE_OVERRIDES_OPTION, $previous, false );
	delete_option( VCL_FEE_OVERRIDES_PREVIOUS_OPTION );

	vcl_fee_editor_redirect( array( 'vclfe_status' => 'undone' ) );
}
add_action( 'admin_post_vclfe_undo_import', 'vcl_handle_undo_import' );

function vcl_handle_clear_fee_overrides() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vclfe_clear_action', 'vclfe_clear_nonce' );

	delete_option( VCL_FEE_OVERRIDES_OPTION );
	vcl_fee_editor_redirect( array( 'vclfe_status' => 'cleared' ) );
}
add_action( 'admin_post_vclfe_clear', 'vcl_handle_clear_fee_overrides' );
