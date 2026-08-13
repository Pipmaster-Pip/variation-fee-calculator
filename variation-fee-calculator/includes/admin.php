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

define( 'VFC_DATA_FILE', VFC_PLUGIN_DIR . 'assets/js/vcl-calc-data.js' );
define( 'VFC_DATA_FILE_BAK', VFC_PLUGIN_DIR . 'assets/js/vcl-calc-data.js.bak' );

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
 * The "Last updated" dates shown in the Lookup's reference headers (Classification / Grouping /
 * Precise Scope Wording / Timetables / Workload Planning) -- manually maintained by whoever last checked that section's content
 * against its official source, kept as one WordPress option so an admin can update them from
 * wp-admin instead of needing a code change. Falls back to the dates baked into vcl-data.js/
 * vcl-app.js (as of the last content update) until the option is first saved.
 */
function vcl_get_last_updated() {
	$defaults = array(
		'classification' => '2026-07-10',
		'grouping'       => '2026-07-03',
		'precisescope'   => '2026-07-13',
		'qa'             => '2026-07-17',
		'art5'           => '2026-07-17',
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
		'precisescope'   => 'EMA/220707/2017, Rev. 1.1 (10 July 2026)',
		'qa'             => 'CMDh/132/2009, Rev. 66 (June 2026)',
		'art5'           => 'CMDh/172/2010, Rev. 17 (October 2025)',
		'timetables'     => 'CMDh Best Practice Guide, Chapters 3–5',
	);
	$saved = get_option( 'vcl_reference_text', array() );
	if ( ! is_array( $saved ) ) {
		$saved = array();
	}
	return wp_parse_args( $saved, $defaults );
}

/**
 * The URL of the downloadable Excel workbook offered in the Fee Calculator. It
 * changes on every WordPress re-upload of the file, hence an editable field
 * rather than a hardcoded path. Empty string = no download link shown.
 */
function vcl_get_calc_excel_url() {
	return (string) get_option( 'vcl_calc_excel_url', '' );
}

/**
 * The URL of the downloadable Excel workbook behind Workload Planning's RA-hours
 * factors and timings -- the workbook the tool's "How this estimate is built"
 * panel documents. Same reasoning as vcl_get_calc_excel_url() above: WordPress
 * mints a new URL on every re-upload, so this is an editable field rather than a
 * hardcoded path. Empty string = no download link shown.
 */
function vcl_get_workload_excel_url() {
	return (string) get_option( 'vcl_workload_excel_url', '' );
}

/**
 * Where feedback should go when the settings field is left empty. Deliberately NOT
 * WordPress's admin_email: that is whoever installed the site, which is not
 * necessarily where variation feedback belongs -- an empty field silently routing
 * mail to the wrong inbox is worse than no link at all.
 */
const VCL_DEFAULT_CONTACT_EMAIL = 'info@pharmazulassung.de';

/**
 * The address behind the toolbox's "Suggest an improvement" links: the settings
 * field if one is saved, otherwise VCL_DEFAULT_CONTACT_EMAIL, so the links work
 * out of the box. Returns '' if neither is a valid address, which makes the links
 * disappear rather than render a broken mailto:.
 */
function vcl_get_contact_email() {
	$email = trim( (string) get_option( 'vcl_contact_email', '' ) );
	if ( $email === '' ) {
		$email = VCL_DEFAULT_CONTACT_EMAIL;
	}
	return is_email( $email ) ? $email : '';
}

/**
 * The contact address split into local part and domain, which is the shape handed
 * to the front end. wp_localize_script() prints VCL_CONFIG into the page as plain
 * JSON, so shipping the address whole would put a literal "name@domain.tld" in the
 * HTML for any address harvester grepping for /\S+@\S+/ to pick up. Split, it is
 * only ever joined at runtime in vcl-app.js. Mild deterrence, not real protection --
 * anyone who executes the page's JavaScript still gets the address.
 */
function vcl_get_contact_parts() {
	$email = vcl_get_contact_email();
	if ( $email === '' ) {
		return array();
	}
	$at = strrpos( $email, '@' );
	if ( $at === false ) {
		return array();
	}
	return array(
		'user'   => substr( $email, 0, $at ),
		'domain' => substr( $email, $at + 1 ),
	);
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
	$calc_excel_url     = vcl_get_calc_excel_url();
	$workload_excel_url = vcl_get_workload_excel_url();
	$contact_email      = (string) get_option( 'vcl_contact_email', '' );
	$contact_effective  = vcl_get_contact_email();

	$last_updated = vfc_extract_last_updated( VFC_DATA_FILE );
	$file_exists  = file_exists( VFC_DATA_FILE );
	$file_size    = $file_exists ? size_format( filesize( VFC_DATA_FILE ) ) : '–';
	$file_mtime   = $file_exists ? date_i18n( 'd.m.Y H:i', filemtime( VFC_DATA_FILE ) ) : '–';
	$public_url   = VFC_PLUGIN_URL . 'assets/js/vcl-calc-data.js';
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
				<td><a href="<?php echo esc_url( $public_url ); ?>" target="_blank" rel="noopener">vcl-calc-data.js öffnen</a></td>
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
				<br>Das erzeugt die Datei <code>assets/js/vcl-calc-data.js</code> neu.</li>
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
			Datei als <code>vcl-calc-data.js.bak</code> im Plugin-Ordner angelegt.
		</p>

		<hr>

		<h1>Variation Fee Calculator — Excel-Datei zum Download</h1>

		<?php if ( $vcl_status === 'excel_saved' ) : ?>
			<div class="notice notice-success is-dismissible"><p>Excel-Download-Link gespeichert.</p></div>
		<?php endif; ?>

		<p>
			Manche Nutzer arbeiten lieber mit der Excel-Datei des Calculators. Lade sie in die
			WordPress-Mediathek hoch, kopiere ihre Datei-URL und trage sie hier ein — der
			Calculator zeigt dann in seinem Kopfbereich einen Download-Link darauf. Die URL
			ändert sich bei jedem erneuten Hochladen, daher nach einem Update hier bitte
			aktualisieren. Feld leer lassen = kein Link.
		</p>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<?php wp_nonce_field( 'vcl_save_calc_excel_action', 'vcl_save_calc_excel_nonce' ); ?>
			<input type="hidden" name="action" value="vcl_save_calc_excel">
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="vcl_calc_excel_url">Excel-Datei-URL</label></th>
					<td>
						<input type="url" id="vcl_calc_excel_url" name="vcl_calc_excel_url" value="<?php echo esc_attr( $calc_excel_url ); ?>" class="regular-text" placeholder="https://…/wp-content/uploads/…/Variation-Fee-Calculator.xlsx">
						<?php if ( $calc_excel_url ) : ?>
							<p class="description" style="margin-top:8px;">Aktueller Link: <a href="<?php echo esc_url( $calc_excel_url ); ?>" target="_blank" rel="noopener"><?php echo esc_html( $calc_excel_url ); ?></a></p>
						<?php endif; ?>
					</td>
				</tr>
			</table>
			<?php submit_button( 'Excel-Link speichern' ); ?>
		</form>

		<hr>

		<h1>Workload Planning — Excel-Datei zum Download</h1>

		<?php if ( $vcl_status === 'wl_excel_saved' ) : ?>
			<div class="notice notice-success is-dismissible"><p>Workload-Excel-Download-Link gespeichert.</p></div>
		<?php endif; ?>

		<p>
			Dies ist die Arbeitsmappe hinter den RA-Stunden und Zeiten des Workload-Planning-Tools
			(<code>RA-CMC-hours.xlsx</code>) — dieselbe Mappe, die der Abschnitt
			„How this estimate is built" im Tool erklärt. Lade sie in die Mediathek hoch, kopiere
			ihre Datei-URL und trage sie hier ein; das Tool zeigt dann einen Download-Link darauf.
			Feld leer lassen = kein Link.
		</p>
		<p>
			<strong>Wichtig:</strong> Die Faktoren stehen im Code (<code>assets/js/vcl-workload-hours-data.js</code>),
			sie werden <em>nicht</em> aus dieser Datei gelesen. Wenn Du hier eine geänderte Mappe
			verlinkst, müssen die Zahlen im Code nachgezogen und das Generierungsdatum
			(<code>VCL_WORKLOAD_HD.meta.generated</code>) aktualisiert werden — sonst zeigt das Tool
			etwas anderes an als die Datei, die daneben zum Download steht.
		</p>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<?php wp_nonce_field( 'vcl_save_workload_excel_action', 'vcl_save_workload_excel_nonce' ); ?>
			<input type="hidden" name="action" value="vcl_save_workload_excel">
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="vcl_workload_excel_url">Excel-Datei-URL</label></th>
					<td>
						<input type="url" id="vcl_workload_excel_url" name="vcl_workload_excel_url" value="<?php echo esc_attr( $workload_excel_url ); ?>" class="regular-text" placeholder="https://…/wp-content/uploads/…/RA-CMC-hours.xlsx">
						<?php if ( $workload_excel_url ) : ?>
							<p class="description" style="margin-top:8px;">Aktueller Link: <a href="<?php echo esc_url( $workload_excel_url ); ?>" target="_blank" rel="noopener"><?php echo esc_html( $workload_excel_url ); ?></a></p>
						<?php endif; ?>
					</td>
				</tr>
			</table>
			<?php submit_button( 'Excel-Link speichern' ); ?>
		</form>

		<hr>

		<h1>Variation Toolbox — Kontakt für Verbesserungsvorschläge</h1>

		<?php if ( $vcl_status === 'contact_saved' ) : ?>
			<div class="notice notice-success is-dismissible"><p>Kontaktadresse gespeichert.</p></div>
		<?php endif; ?>

		<p>
			Die Toolbox zeigt im Kopfbereich einen dezenten Link „Suggest an improvement" und im
			Workload-Abschnitt „How this estimate is built" einen Hinweis, falls jemandem eine Zahl
			falsch vorkommt. Beide öffnen eine E-Mail an diese Adresse, mit vorausgefülltem Betreff
			inklusive des Tools, aus dem der Vorschlag kommt.
		</p>
		<p>
			Leer lassen = Standardadresse <code><?php echo esc_html( VCL_DEFAULT_CONTACT_EMAIL ); ?></code>.
			Aktuell verwendet: <code><?php echo esc_html( $contact_effective !== '' ? $contact_effective : 'keine — die Links werden ausgeblendet' ); ?></code>
		</p>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<?php wp_nonce_field( 'vcl_save_contact_action', 'vcl_save_contact_nonce' ); ?>
			<input type="hidden" name="action" value="vcl_save_contact">
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="vcl_contact_email">E-Mail-Adresse</label></th>
					<td>
						<input type="email" id="vcl_contact_email" name="vcl_contact_email" value="<?php echo esc_attr( $contact_email ); ?>" class="regular-text" placeholder="<?php echo esc_attr( VCL_DEFAULT_CONTACT_EMAIL ); ?>">
						<p class="description" style="margin-top:8px;">
							Die Adresse steht nicht im Quelltext der Seite — sie wird geteilt ausgeliefert
							und erst im Browser zusammengesetzt. Das hält einfache Adress-Sammler ab, ist
							aber kein echter Schutz.
						</p>
					</td>
				</tr>
			</table>
			<?php submit_button( 'Kontaktadresse speichern' ); ?>
		</form>

		<hr>

		<h1 id="vcl-last-updated">Variation Toolbox — "Zuletzt aktualisiert"-Daten</h1>

		<?php if ( $vcl_status === 'success' ) : ?>
			<div class="notice notice-success is-dismissible"><p>Daten gespeichert.</p></div>
		<?php endif; ?>

		<p>
			Diese Angaben erscheinen im Tool „Variation Toolbox“ als kleiner Hinweis unter
			„Classification of Variations“, „Grouping of Variations“, „Precise Scope Wording“,
			„Timetables for Variations“ und „Workload Planning“: die Guideline-Referenz (Freitext, z. B. Nummer/Revision/Titel der
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
							<label for="vcl_last_updated_classification">Last updated in Variation Toolbox</label><br>
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
							<label for="vcl_last_updated_grouping">Last updated in Variation Toolbox</label><br>
							<input type="date" id="vcl_last_updated_grouping" name="vcl_last_updated[grouping]" value="<?php echo esc_attr( $vcl_dates['grouping'] ); ?>">
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">Precise Scope Wording</th>
					<td>
						<label for="vcl_reference_precisescope">Reference</label><br>
						<input type="text" id="vcl_reference_precisescope" name="vcl_reference_text[precisescope]" value="<?php echo esc_attr( $vcl_refs['precisescope'] ); ?>" class="regular-text">
						<p class="description" style="margin-top:8px;">
							<label for="vcl_last_updated_precisescope">Last updated in Variation Toolbox</label><br>
							<input type="date" id="vcl_last_updated_precisescope" name="vcl_last_updated[precisescope]" value="<?php echo esc_attr( $vcl_dates['precisescope'] ); ?>">
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">Q&amp;A on Variations</th>
					<td>
						<label for="vcl_reference_qa">Reference</label><br>
						<input type="text" id="vcl_reference_qa" name="vcl_reference_text[qa]" value="<?php echo esc_attr( $vcl_refs['qa'] ); ?>" class="regular-text">
						<p class="description" style="margin-top:8px;">
							<label for="vcl_last_updated_qa">Last updated in Variation Toolbox</label><br>
							<input type="date" id="vcl_last_updated_qa" name="vcl_last_updated[qa]" value="<?php echo esc_attr( $vcl_dates['qa'] ); ?>">
						</p>
						<p class="description">
							The Q&amp;A content itself is generated from the source PDF by <code>extract_qa.py</code>
							(<code>python extract_qa.py &lt;pdf&gt;</code> &rarr; <code>assets/js/vcl-qa-data.js</code>).
							A new revision means re-running that script, not editing text here.
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">Art. 5 Recommendations</th>
					<td>
						<label for="vcl_reference_art5">Reference</label><br>
						<input type="text" id="vcl_reference_art5" name="vcl_reference_text[art5]" value="<?php echo esc_attr( $vcl_refs['art5'] ); ?>" class="regular-text">
						<p class="description" style="margin-top:8px;">
							<label for="vcl_last_updated_art5">Last updated in Variation Toolbox</label><br>
							<input type="date" id="vcl_last_updated_art5" name="vcl_last_updated[art5]" value="<?php echo esc_attr( $vcl_dates['art5'] ); ?>">
						</p>
						<p class="description">
							Generated from the CMDh tracking table (.xls) by <code>extract_art5.py</code>
							(<code>python extract_art5.py &lt;xls&gt;</code> &rarr; <code>assets/js/vcl-art5-data.js</code>).
							A new revision means re-running that script, not editing values here.
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">Timetables for Variations</th>
					<td>
						<label for="vcl_reference_timetables">Reference</label><br>
						<input type="text" id="vcl_reference_timetables" name="vcl_reference_text[timetables]" value="<?php echo esc_attr( $vcl_refs['timetables'] ); ?>" class="regular-text">
						<p class="description" style="margin-top:8px;">
							<label for="vcl_last_updated_timetables">Last updated in Variation Toolbox</label><br>
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
	$required_markers = array( 'window.VCLCALC_DATA', 'FEE_ROWS', 'COUNTRY_NAMES', 'IMPRINT', 'HA_WEBSITES', 'CC_TO_CURRENCY', 'STATIC_FX_RATES' );
	foreach ( $required_markers as $marker ) {
		if ( strpos( $content, $marker ) === false ) {
			wp_safe_redirect( add_query_arg( array( 'vfc_status' => 'error', 'vfc_msg' => rawurlencode( "Datei sieht nicht wie eine gültige vcl-calc-data.js aus (erwarteter Bestandteil '$marker' fehlt). Bitte prüfen, ob wirklich die von convert.py erzeugte Datei hochgeladen wurde." ) ), $redirect_base ) );
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
	foreach ( array( 'classification', 'grouping', 'precisescope', 'qa', 'art5', 'timetables' ) as $key ) {
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

/**
 * Saves the Fee Calculator's downloadable-Excel URL (see vcl_get_calc_excel_url).
 */
function vcl_handle_save_calc_excel() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vcl_save_calc_excel_action', 'vcl_save_calc_excel_nonce' );

	$url = isset( $_POST['vcl_calc_excel_url'] ) ? esc_url_raw( trim( wp_unslash( $_POST['vcl_calc_excel_url'] ) ) ) : '';
	update_option( 'vcl_calc_excel_url', $url );

	wp_safe_redirect( add_query_arg( array( 'vcl_status' => 'excel_saved' ), admin_url( 'options-general.php?page=vfc-settings' ) ) );
	exit;
}
add_action( 'admin_post_vcl_save_calc_excel', 'vcl_handle_save_calc_excel' );

/**
 * Saves Workload Planning's downloadable-Excel URL (see vcl_get_workload_excel_url).
 */
function vcl_handle_save_workload_excel() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vcl_save_workload_excel_action', 'vcl_save_workload_excel_nonce' );

	$url = isset( $_POST['vcl_workload_excel_url'] ) ? esc_url_raw( trim( wp_unslash( $_POST['vcl_workload_excel_url'] ) ) ) : '';
	update_option( 'vcl_workload_excel_url', $url );

	wp_safe_redirect( add_query_arg( array( 'vcl_status' => 'wl_excel_saved' ), admin_url( 'options-general.php?page=vfc-settings' ) ) );
	exit;
}
add_action( 'admin_post_vcl_save_workload_excel', 'vcl_handle_save_workload_excel' );

/**
 * Saves the feedback contact address (see vcl_get_contact_email). Stored empty when
 * cleared or invalid, which falls the front end back to VCL_DEFAULT_CONTACT_EMAIL.
 */
function vcl_handle_save_contact() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vcl_save_contact_action', 'vcl_save_contact_nonce' );

	$raw   = isset( $_POST['vcl_contact_email'] ) ? trim( wp_unslash( $_POST['vcl_contact_email'] ) ) : '';
	$email = sanitize_email( $raw );
	update_option( 'vcl_contact_email', is_email( $email ) ? $email : '' );

	wp_safe_redirect( add_query_arg( array( 'vcl_status' => 'contact_saved' ), admin_url( 'options-general.php?page=vfc-settings' ) ) );
	exit;
}
add_action( 'admin_post_vcl_save_contact', 'vcl_handle_save_contact' );
