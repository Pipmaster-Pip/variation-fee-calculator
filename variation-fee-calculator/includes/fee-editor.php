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
/** A history line is one sentence; the workbook's longest runs to ~150 characters. */
const VCL_FEE_IMPRINT_MAX_CHARS = 300;
/** The workbook ships 75 lines; this many again is far more than anyone will add by hand. */
const VCL_FEE_IMPRINT_MAX_ENTRIES = 200;

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
 * Which annual-fee tariffs the plugin ships, as
 * array( '<CC>' => array( '<tariffId>' => bool ) ) where the bool says whether
 * that tariff scales with the number of strengths (addStrength !== null).
 *
 * Read from assets/data/annual-fees.json, written by the same converter run as
 * assets/js/vcl-annual-data.js -- PHP cannot read the generated .js, and a second
 * hand-maintained list here would drift from it within a release or two.
 *
 * Cached per request only. The file changes with a plugin update, and a longer
 * cache would then validate against tariffs that no longer exist; reading a
 * ~30 KB file once per request is cheaper than getting that wrong.
 */
function vcl_annual_fee_structure() {
	static $structure = null;
	if ( $structure !== null ) {
		return $structure;
	}

	$structure = array();
	$path      = VFC_PLUGIN_DIR . 'assets/data/annual-fees.json';
	if ( ! file_exists( $path ) ) {
		return $structure;
	}

	$raw  = file_get_contents( $path );
	$data = json_decode( (string) $raw, true );
	if ( ! is_array( $data ) || empty( $data['countries'] ) || ! is_array( $data['countries'] ) ) {
		return $structure;
	}

	foreach ( $data['countries'] as $country ) {
		if ( ! is_array( $country ) || empty( $country['cc'] ) ) {
			continue;
		}
		$tariffs = array();
		if ( ! empty( $country['tariffs'] ) && is_array( $country['tariffs'] ) ) {
			foreach ( $country['tariffs'] as $tariff ) {
				if ( ! is_array( $tariff ) || ! isset( $tariff['id'] ) ) {
					continue;
				}
				$tariffs[ (string) $tariff['id'] ] =
					array_key_exists( 'addStrength', $tariff ) && $tariff['addStrength'] !== null;
			}
		}
		$structure[ (string) $country['cc'] ] = $tariffs;
	}

	return $structure;
}

/**
 * The saved overrides, always in the shape
 * array( 'rows' => array( '<rowNo>' => array( '<field>' => float ) ),
 *        'points' => array( '<cc>' => float ),
 *        'countries' => array( '<CC>' => array( 'checked' => 'Y-m-d',
 *                                               'source' => string,
 *                                               'updated' => 'Y-m-d' ) ),
 *        'annual' => array( '<CC>' => array( '<tariffId>' => array( 'base' => float,
 *                                                                   'addStrength' => float ) ) ),
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
		'imprint'   => array(),
		'annual'    => array(),
		'updated'   => '',
		'by'        => '',
	) );
}

/**
 * Validates a posted payload down to "row number => field => finite number",
 * plus the per-country provenance, the imprint history, and the annual-fee
 * amounts (validated against vcl_annual_fee_structure(); its key is left out
 * of $clean entirely when that structure is unavailable -- see the comment
 * below). Anything unrecognised is dropped rather than rejected: a stray key
 * from an older plugin build should not block a save of the values that are
 * still valid. Returns array( $clean, $dropped ).
 */
function vcl_sanitize_fee_overrides( $payload ) {
	$allowed = array_flip( vcl_fee_editable_fields() );
	$clean   = array( 'rows' => array(), 'points' => array(), 'countries' => array(), 'imprint' => array() );
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

	// Change-history entries added in this editor. They sit in front of the lines
	// the workbook ships, so the newest one also drives "Last updated in Variation
	// Toolbox" above the calculator. A list, not a map: two entries may share a
	// date, and the workbook's own history does exactly that (three lines dated
	// 2021-10-17). Newest first, same order the front end renders.
	if ( isset( $payload['imprint'] ) && is_array( $payload['imprint'] ) ) {
		foreach ( $payload['imprint'] as $entry ) {
			if ( ! is_array( $entry ) || empty( $entry['date'] ) || empty( $entry['topic'] )
				|| ! is_scalar( $entry['date'] ) || ! is_scalar( $entry['topic'] ) ) {
				$dropped++;
				continue;
			}
			$date  = sanitize_text_field( (string) $entry['date'] );
			$topic = sanitize_text_field( (string) $entry['topic'] );
			if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date ) || $topic === '' ) {
				$dropped++;
				continue;
			}
			$clean['imprint'][] = array(
				'date'  => $date,
				'topic' => mb_substr( $topic, 0, VCL_FEE_IMPRINT_MAX_CHARS ),
			);
			if ( count( $clean['imprint'] ) >= VCL_FEE_IMPRINT_MAX_ENTRIES ) {
				break;
			}
		}
		usort( $clean['imprint'], function ( $a, $b ) {
			return strcmp( $b['date'], $a['date'] );
		} );
	}

	// Annual maintenance fees. Only amounts are editable, and only for tariffs the
	// plugin actually ships: an unknown country or tariff id is a leftover from an
	// older build, and addStrength on a tariff that does not scale with strengths
	// would change the structure rather than a value.
	if ( isset( $payload['annual'] ) && is_array( $payload['annual'] ) ) {
		$structure = vcl_annual_fee_structure();
		if ( empty( $structure ) ) {
			// assets/data/annual-fees.json is missing or unreadable (a plugin ZIP
			// that shipped incomplete has happened before). There is then nothing
			// to validate the incoming annual amounts against, so $clean['annual']
			// is left unset rather than written as an empty array: the callers
			// that persist $clean fall back to the stored/previous 'annual' branch
			// in that case, instead of a save or import that cannot judge annual
			// fees erasing every annual fee maintained so far.
			//
			// 'annual_unverifiable' tells the callers *why* $clean['annual'] is
			// unset: the structure could not be read, as opposed to the payload
			// simply not carrying an 'annual' key at all (an export from before
			// this feature existed). Save and import react differently to that
			// distinction -- see the comments where each reads this flag. The key
			// is consumed by the callers only; it is never written to the option
			// and never counted by vcl_count_fee_overrides().
			$clean['annual_unverifiable'] = true;
			// The incoming values still can't be trusted, so they count toward
			// $dropped per amount (base/addStrength), the same unit the branch
			// below drops values in -- not per country, which would undercount
			// whenever a country carries more than one tariff or field.
			foreach ( $payload['annual'] as $tariffs ) {
				if ( ! is_array( $tariffs ) ) {
					$dropped++;
					continue;
				}
				foreach ( $tariffs as $fields ) {
					$dropped += is_array( $fields ) ? count( $fields ) : 1;
				}
			}
		} else {
			$clean['annual'] = array();
			foreach ( $payload['annual'] as $cc => $tariffs ) {
				$code = sanitize_text_field( (string) $cc );
				if ( ! isset( $structure[ $code ] ) || ! is_array( $tariffs ) ) {
					$dropped++;
					continue;
				}
				$cc_clean = array();
				foreach ( $tariffs as $tariff_id => $fields ) {
					$tid = sanitize_text_field( (string) $tariff_id );
					if ( ! isset( $structure[ $code ][ $tid ] ) || ! is_array( $fields ) ) {
						$dropped++;
						continue;
					}
					$entry = array();
					foreach ( array( 'base', 'addStrength' ) as $key ) {
						if ( ! isset( $fields[ $key ] ) ) {
							continue;
						}
						if ( 'addStrength' === $key && ! $structure[ $code ][ $tid ] ) {
							$dropped++;
							continue;
						}
						if ( ! is_numeric( $fields[ $key ] ) ) {
							$dropped++;
							continue;
						}
						$num = (float) $fields[ $key ];
						if ( ! is_finite( $num ) || $num < 0 ) {
							$dropped++;
							continue;
						}
						$entry[ $key ] = $num;
					}
					if ( $entry ) {
						$cc_clean[ $tid ] = $entry;
					}
				}
				if ( $cc_clean ) {
					$clean['annual'][ $code ] = $cc_clean;
				}
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
	// Annual fees count like any other maintained amount: an installation whose
	// only edit is a Danish annual fee still has something to export and to clear.
	if ( ! empty( $overrides['annual'] ) && is_array( $overrides['annual'] ) ) {
		foreach ( $overrides['annual'] as $tariffs ) {
			foreach ( (array) $tariffs as $fields ) {
				$n += count( (array) $fields );
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
	// The annual fees are maintained on this page too, so the editor needs the
	// reference data and the overlay that lays the saved amounts over it.
	wp_enqueue_script( 'vcl-annual-data', $url . 'js/vcl-annual-data.js',
		array(), $ver( 'js/vcl-annual-data.js' ), true );
	wp_enqueue_script( 'vcl-annual-overrides', $url . 'js/vcl-annual-overrides.js',
		array( 'vcl-annual-data', 'vcl-calc-data' ), $ver( 'js/vcl-annual-overrides.js' ), true );
	wp_enqueue_script( 'vcl-fee-editor', $url . 'js/vcl-fee-editor.js',
		array( 'vcl-calc-app', 'vcl-annual-overrides' ), $ver( 'js/vcl-fee-editor.js' ), true );

	$overrides = vcl_get_fee_overrides();
	// Hand the saved overrides to the engine before it boots, so the page opens
	// showing the amounts that are actually live.
	wp_add_inline_script( 'vcl-calc-data',
		'window.VCLCALC_OVERRIDES = ' . wp_json_encode( array(
			'rows'      => (object) $overrides['rows'],
			'points'    => (object) $overrides['points'],
			'countries' => (object) $overrides['countries'],
			'imprint'   => array_values( $overrides['imprint'] ),
			'annual'    => (object) $overrides['annual'],
		) ) . ';', 'after' );
	wp_localize_script( 'vcl-fee-editor', 'VCLFE_CONFIG', array(
		'overrides'    => array(
			'rows'      => (object) $overrides['rows'],
			'points'    => (object) $overrides['points'],
			'countries' => (object) $overrides['countries'],
			'imprint'   => array_values( $overrides['imprint'] ),
			'annual'    => (object) $overrides['annual'],
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

				<!-- Filled by vcl-fee-editor.js as soon as this session has changed
				     something, and empty otherwise. -->
				<div id="vclfe-savebar"></div>

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
	// $clean['annual'] is unset in two situations (see vcl_sanitize_fee_overrides()):
	// the shipped tariff structure could not be read, or the posted payload never
	// carried an 'annual' key at all. Either way, this save could not judge the
	// annual fees, so it must not touch them -- keep whatever is already stored
	// rather than let an unrelated save wipe them out. (A client that deliberately
	// clears the branch sends 'annual' as {}, which decodes to an array and lands
	// in $clean['annual'] as array() -- that case does not hit this fallback.)
	$stored_annual = vcl_get_fee_overrides()['annual'];
	// Read above, done with -- drop it so a future generic pass of $clean into
	// the option (this file has lost a key that way before) can't write this
	// internal-only flag into vcl_fee_overrides.
	unset( $clean['annual_unverifiable'] );
	update_option( VCL_FEE_OVERRIDES_OPTION, array(
		'rows'      => $clean['rows'],
		'points'    => $clean['points'],
		'countries' => $clean['countries'],
		'imprint'   => $clean['imprint'],
		'annual'    => isset( $clean['annual'] ) ? $clean['annual'] : ( is_array( $stored_annual ) ? $stored_annual : array() ),
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
		'imprint'   => array_values( $overrides['imprint'] ),
		'annual'    => (object) $overrides['annual'],
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
	// $clean['annual'] is unset in two situations (see vcl_sanitize_fee_overrides()),
	// and import -- unlike save -- must tell them apart, because import replaces
	// rather than merges (see the doc comment above this function):
	// - the shipped tariff structure could not be read ('annual_unverifiable' is
	//   set): this import cannot judge the annual fees in the file, so it must not
	//   erase the annual fees already stored -- keep what $previous had.
	// - the file simply has no 'annual' key at all (an export from before this
	//   feature existed): that is a real answer, not a gap, and a replacing import
	//   must carry it through -- the branch is cleared.
	if ( isset( $clean['annual'] ) ) {
		$annual = $clean['annual'];
	} elseif ( ! empty( $clean['annual_unverifiable'] ) ) {
		$annual = ( is_array( $previous ) && isset( $previous['annual'] ) && is_array( $previous['annual'] ) )
			? $previous['annual'] : array();
	} else {
		$annual = array();
	}
	// Read above, done with -- drop it so a future generic pass of $clean into
	// the option (this file has lost a key that way before) can't write this
	// internal-only flag into vcl_fee_overrides.
	unset( $clean['annual_unverifiable'] );
	update_option( VCL_FEE_OVERRIDES_OPTION, array(
		'rows'      => $clean['rows'],
		'points'    => $clean['points'],
		'countries' => $clean['countries'],
		'imprint'   => $clean['imprint'],
		'annual'    => $annual,
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
