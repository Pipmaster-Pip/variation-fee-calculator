<?php
/**
 * Admin page: upload an updated vfc-data.js (produced locally by convert.py
 * from a new Excel file) instead of replacing the file via FTP.
 *
 * Deliberately does NOT parse .xlsx files itself — it only accepts the
 * already-converted vfc-data.js, keeping the tested, documented Python
 * conversion (convert.py) as the single source of truth for the Excel ->
 * fee-data mapping. This avoids re-implementing that mapping (and its many
 * special cases, see convert.py's docstring) a second time in PHP.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'VFC_DATA_FILE', VFC_PLUGIN_DIR . 'assets/js/vfc-data.js' );
define( 'VFC_DATA_FILE_BAK', VFC_PLUGIN_DIR . 'assets/js/vfc-data.js.bak' );

function vfc_admin_menu() {
	add_options_page(
		'Variation Fee Calculator',
		'Variation Fee Calculator',
		'manage_options',
		'vfc-settings',
		'vfc_render_admin_page'
	);
}
add_action( 'admin_menu', 'vfc_admin_menu' );

/**
 * Pulls the "last updated" date out of an already-generated vfc-data.js for
 * display purposes, without needing a JS engine: the IMPRINT array is plain
 * JSON (produced by Python's json.dumps), so a simple regex on its first
 * entry is enough.
 */
function vfc_extract_last_updated( $file_path ) {
	if ( ! file_exists( $file_path ) ) {
		return null;
	}
	$content = file_get_contents( $file_path );
	if ( $content === false ) {
		return null;
	}
	if ( preg_match( '/IMPRINT:\s*\[\{"date":"(\d{4}-\d{2}-\d{2})"/', $content, $m ) ) {
		return $m[1];
	}
	return null;
}

/**
 * The three "Last updated" dates shown in the Lookup's reference headers (Classification /
 * Grouping / Timetables) -- manually maintained by whoever last checked that section's content
 * against its official source, kept as one WordPress option so an admin can update them from
 * wp-admin instead of needing a code change. Falls back to the dates baked into vcl-data.js/
 * vcl-app.js (as of the last content update) until the option is first saved.
 */
function vcl_get_last_updated() {
	$defaults = array(
		'classification' => '2026-07-10',
		'grouping'       => '2026-07-03',
		'timetables'     => '2026-07-03',
	);
	$saved = get_option( 'vcl_last_updated', array() );
	if ( ! is_array( $saved ) ) {
		$saved = array();
	}
	return wp_parse_args( $saved, $defaults );
}

/**
 * Free-text guideline reference shown next to each "Last updated" date (e.g. "C/2025/5045,
 * applicable from 2026-01-15"). Kept editable from wp-admin -- unlike the date above, this isn't
 * a fixed format, since guideline numbers/revisions/titles occasionally change on the official
 * side and the displayed text should be correctable without a code change. Defaults mirror the
 * guideline references currently hardcoded in vcl-data.js/vcl-app.js.
 */
function vcl_get_reference_text() {
	$defaults = array(
		'classification' => 'C/2025/5045, applicable from 2026-01-15',
		'grouping'       => 'CMDh/173/2010, Rev. 25 (March 2026)',
		'timetables'     => 'CMDh Best Practice Guide, Chapters 3–5',
	);
	$saved = get_option( 'vcl_reference_text', array() );
	if ( ! is_array( $saved ) ) {
		$saved = array();
	}
	return wp_parse_args( $saved, $defaults );
}

function vfc_render_admin_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$status  = isset( $_GET['vfc_status'] ) ? sanitize_key( $_GET['vfc_status'] ) : '';
	$message = isset( $_GET['vfc_msg'] ) ? sanitize_text_field( wp_unslash( $_GET['vfc_msg'] ) ) : '';

	$vcl_status = isset( $_GET['vcl_status'] ) ? sanitize_key( $_GET['vcl_status'] ) : '';
	$vcl_dates  = vcl_get_last_updated();
	$vcl_refs   = vcl_get_reference_text();

	$last_updated = vfc_extract_last_updated( VFC_DATA_FILE );
	$file_exists  = file_exists( VFC_DATA_FILE );
	$file_size    = $file_exists ? size_format( filesize( VFC_DATA_FILE ) ) : '–';
	$file_mtime   = $file_exists ? date_i18n( 'd.m.Y H:i', filemtime( VFC_DATA_FILE ) ) : '–';
	$public_url   = VFC_PLUGIN_URL . 'assets/js/vfc-data.js';
	?>
	<div class="wrap">
		<h1>Variation Fee Calculator — Gebührendaten aktualisieren</h1>

		<?php if ( $status === 'success' ) : ?>
			<div class="notice notice-success is-dismissible"><p>Gebührendaten erfolgreich aktualisiert.</p></div>
		<?php elseif ( $status === 'error' ) : ?>
			<div class="notice notice-error is-dismissible"><p>Fehler: <?php echo esc_html( $message ); ?></p></div>
		<?php endif; ?>

		<h2>Aktueller Stand</h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row">Gebühren zuletzt aktualisiert (laut Excel-Änderungshistorie)</th>
				<td><?php echo $last_updated ? esc_html( date_i18n( 'd.m.Y', strtotime( $last_updated ) ) ) : '–'; ?></td>
			</tr>
			<tr>
				<th scope="row">Datei zuletzt hochgeladen</th>
				<td><?php echo esc_html( $file_mtime ); ?> (<?php echo esc_html( $file_size ); ?>)</td>
			</tr>
			<tr>
				<th scope="row">Aktuelle Datei ansehen</th>
				<td><a href="<?php echo esc_url( $public_url ); ?>" target="_blank" rel="noopener">vfc-data.js öffnen</a></td>
			</tr>
		</table>

		<h2>Neue Gebührendaten hochladen</h2>
		<p>
			So aktualisierst Du die Gebühren, wenn sich die Excel-Tabelle geändert hat:
		</p>
		<ol>
			<li>Lokal auf Deinem Rechner (einmalig <code>pip install openpyxl</code>):
				<br><code>cd variation-fee-calculator</code>
				<br><code>python3 convert.py pfad/zur/Variation-Fee-Calculator-EU.xlsx</code>
				<br>Das erzeugt die Datei <code>assets/js/vfc-data.js</code> neu.</li>
			<li>Genau diese eine Datei hier hochladen (kein FTP mehr nötig):</li>
		</ol>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data">
			<?php wp_nonce_field( 'vfc_upload_data_action', 'vfc_upload_data_nonce' ); ?>
			<input type="hidden" name="action" value="vfc_upload_data">
			<input type="file" name="vfc_data_file" accept=".js" required>
			<?php submit_button( 'Hochladen und aktivieren' ); ?>
		</form>

		<p class="description">
			Vor jedem Hochladen wird automatisch eine Sicherungskopie der bisherigen
			Datei als <code>vfc-data.js.bak</code> im Plugin-Ordner angelegt.
		</p>

		<hr>

		<h1 id="vcl-last-updated">Variations Reference Guide — "Zuletzt aktualisiert"-Daten</h1>

		<?php if ( $vcl_status === 'success' ) : ?>
			<div class="notice notice-success is-dismissible"><p>Daten gespeichert.</p></div>
		<?php endif; ?>

		<p>
			Diese Angaben erscheinen im Tool „Variations Reference Guide“ als kleiner Hinweis unter
			„Classification of Variations“, „Grouping of Variations“ und „Timetables for
			Variations“: die Guideline-Referenz (Freitext, z. B. Nummer/Revision/Titel der
			Quelle — da sich diese gelegentlich ändern) sowie das Datum, wann der jeweilige
			Inhalt zuletzt gegen die offizielle Quelle geprüft wurde (nicht zu verwechseln mit
			dem Datum der Quelle selbst). Der eigentliche Inhalt (Klassifizierungscodes,
			Grouping-Beispiele, Verfahrens-Zeitpläne) wird hier nicht bearbeitet — Änderungen
			daran laufen weiter über eine Entwicklungs-Session, da sie eine sorgfältige
			Übertragung der jeweiligen Guideline erfordern.
		</p>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<?php wp_nonce_field( 'vcl_save_dates_action', 'vcl_save_dates_nonce' ); ?>
			<input type="hidden" name="action" value="vcl_save_dates">
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">Classification of Variations</th>
					<td>
						<label for="vcl_reference_classification">Reference</label><br>
						<input type="text" id="vcl_reference_classification" name="vcl_reference_text[classification]" value="<?php echo esc_attr( $vcl_refs['classification'] ); ?>" class="regular-text">
						<p class="description" style="margin-top:8px;">
							<label for="vcl_last_updated_classification">Last updated in Variations Reference Guide</label><br>
							<input type="date" id="vcl_last_updated_classification" name="vcl_last_updated[classification]" value="<?php echo esc_attr( $vcl_dates['classification'] ); ?>">
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">Grouping of Variations</th>
					<td>
						<label for="vcl_reference_grouping">Reference</label><br>
						<input type="text" id="vcl_reference_grouping" name="vcl_reference_text[grouping]" value="<?php echo esc_attr( $vcl_refs['grouping'] ); ?>" class="regular-text">
						<p class="description" style="margin-top:8px;">
							<label for="vcl_last_updated_grouping">Last updated in Variations Reference Guide</label><br>
							<input type="date" id="vcl_last_updated_grouping" name="vcl_last_updated[grouping]" value="<?php echo esc_attr( $vcl_dates['grouping'] ); ?>">
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">Timetables for Variations</th>
					<td>
						<label for="vcl_reference_timetables">Reference</label><br>
						<input type="text" id="vcl_reference_timetables" name="vcl_reference_text[timetables]" value="<?php echo esc_attr( $vcl_refs['timetables'] ); ?>" class="regular-text">
						<p class="description" style="margin-top:8px;">
							<label for="vcl_last_updated_timetables">Last updated in Variations Reference Guide</label><br>
							<input type="date" id="vcl_last_updated_timetables" name="vcl_last_updated[timetables]" value="<?php echo esc_attr( $vcl_dates['timetables'] ); ?>">
						</p>
					</td>
				</tr>
			</table>
			<?php submit_button( 'Daten speichern' ); ?>
		</form>
	</div>
	<?php
}

function vfc_handle_upload() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vfc_upload_data_action', 'vfc_upload_data_nonce' );

	$redirect_base = admin_url( 'options-general.php?page=vfc-settings' );

	if ( empty( $_FILES['vfc_data_file'] ) || ! isset( $_FILES['vfc_data_file']['error'] ) || $_FILES['vfc_data_file']['error'] !== UPLOAD_ERR_OK ) {
		wp_safe_redirect( add_query_arg( array( 'vfc_status' => 'error', 'vfc_msg' => rawurlencode( 'Kein gültiger Datei-Upload empfangen.' ) ), $redirect_base ) );
		exit;
	}

	$tmp_name = $_FILES['vfc_data_file']['tmp_name'];
	$orig_name = sanitize_file_name( $_FILES['vfc_data_file']['name'] );

	if ( ! is_uploaded_file( $tmp_name ) ) {
		wp_safe_redirect( add_query_arg( array( 'vfc_status' => 'error', 'vfc_msg' => rawurlencode( 'Ungültiger Upload.' ) ), $redirect_base ) );
		exit;
	}

	if ( strtolower( pathinfo( $orig_name, PATHINFO_EXTENSION ) ) !== 'js' ) {
		wp_safe_redirect( add_query_arg( array( 'vfc_status' => 'error', 'vfc_msg' => rawurlencode( 'Bitte die von convert.py erzeugte .js-Datei hochladen (nicht die .xlsx).' ) ), $redirect_base ) );
		exit;
	}

	$content = file_get_contents( $tmp_name );
	if ( $content === false || strlen( $content ) < 100 ) {
		wp_safe_redirect( add_query_arg( array( 'vfc_status' => 'error', 'vfc_msg' => rawurlencode( 'Datei konnte nicht gelesen werden oder ist leer.' ) ), $redirect_base ) );
		exit;
	}

	// Lightweight sanity check on the expected structure (no JS engine available
	// in PHP, so we check for the wrapper and all expected top-level keys).
	$required_markers = array( 'window.VFC_DATA', 'FEE_ROWS', 'COUNTRY_NAMES', 'IMPRINT', 'HA_WEBSITES', 'CC_TO_CURRENCY', 'STATIC_FX_RATES' );
	foreach ( $required_markers as $marker ) {
		if ( strpos( $content, $marker ) === false ) {
			wp_safe_redirect( add_query_arg( array( 'vfc_status' => 'error', 'vfc_msg' => rawurlencode( "Datei sieht nicht wie eine gültige vfc-data.js aus (erwarteter Bestandteil '$marker' fehlt). Bitte prüfen, ob wirklich die von convert.py erzeugte Datei hochgeladen wurde." ) ), $redirect_base ) );
			exit;
		}
	}

	// Back up the currently active file before overwriting it.
	if ( file_exists( VFC_DATA_FILE ) ) {
		if ( ! @copy( VFC_DATA_FILE, VFC_DATA_FILE_BAK ) ) {
			wp_safe_redirect( add_query_arg( array( 'vfc_status' => 'error', 'vfc_msg' => rawurlencode( 'Backup der bisherigen Datei fehlgeschlagen — Ordner assets/js/ ist evtl. nicht beschreibbar. Nichts wurde geändert.' ) ), $redirect_base ) );
			exit;
		}
	}

	if ( file_put_contents( VFC_DATA_FILE, $content ) === false ) {
		wp_safe_redirect( add_query_arg( array( 'vfc_status' => 'error', 'vfc_msg' => rawurlencode( 'Datei konnte nicht geschrieben werden — Ordner assets/js/ ist evtl. nicht beschreibbar (Dateirechte prüfen).' ) ), $redirect_base ) );
		exit;
	}

	wp_safe_redirect( add_query_arg( array( 'vfc_status' => 'success' ), $redirect_base ) );
	exit;
}
add_action( 'admin_post_vfc_upload_data', 'vfc_handle_upload' );

/**
 * Saves the three "Last updated" dates (see vcl_get_last_updated()) and the three free-text
 * guideline references (see vcl_get_reference_text()) as two array options. Dates: silently
 * drops any field that isn't a plain YYYY-MM-DD string rather than erroring out -- the
 * <input type="date"> already constrains the format client-side, this is just a server-side
 * backstop. References: plain sanitize_text_field(), no format constraint since it's free text.
 */
function vcl_handle_save_dates() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vcl_save_dates_action', 'vcl_save_dates_nonce' );

	$redirect_base = admin_url( 'options-general.php?page=vfc-settings' );

	$date_input = isset( $_POST['vcl_last_updated'] ) && is_array( $_POST['vcl_last_updated'] ) ? wp_unslash( $_POST['vcl_last_updated'] ) : array();
	$dates      = array();
	$ref_input  = isset( $_POST['vcl_reference_text'] ) && is_array( $_POST['vcl_reference_text'] ) ? wp_unslash( $_POST['vcl_reference_text'] ) : array();
	$refs       = array();
	foreach ( array( 'classification', 'grouping', 'timetables' ) as $key ) {
		$date_value = isset( $date_input[ $key ] ) ? sanitize_text_field( $date_input[ $key ] ) : '';
		if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date_value ) ) {
			$dates[ $key ] = $date_value;
		}
		if ( isset( $ref_input[ $key ] ) ) {
			$refs[ $key ] = sanitize_text_field( $ref_input[ $key ] );
		}
	}

	update_option( 'vcl_last_updated', $dates );
	update_option( 'vcl_reference_text', $refs );

	wp_safe_redirect( add_query_arg( array( 'vcl_status' => 'success' ), $redirect_base ) . '#vcl-last-updated' );
	exit;
}
add_action( 'admin_post_vcl_save_dates', 'vcl_handle_save_dates' );
