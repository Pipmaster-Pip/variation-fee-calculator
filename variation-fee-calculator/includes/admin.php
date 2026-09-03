<?php
/**
 * Admin screens of the Variation Toolbox other than the fee editor itself: the
 * "Datenstand & Quellen" and "Einstellungen" tabs of the plugin's top-level
 * page. The page, its menu entry and the tab router live in
 * includes/fee-editor.php, which owns the slug.
 *
 * There is deliberately no upload form for assets/js/vcl-calc-data.js here any
 * more: that file is maintained by hand (it carries POINT_VALUES and the T/U/V
 * columns convert.py does not emit -- see convert.py's WARNING), so an upload
 * path inviting admins to replace it with freshly converted output was a way to
 * silently lose data and break Slovenia. Fee amounts are edited in the fee
 * editor, whose overrides lie on top of the file without touching it.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'VFC_DATA_FILE', VFC_PLUGIN_DIR . 'assets/js/vcl-calc-data.js' );

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
 * The URL of the downloadable Excel workbook behind Workload Planning's RA-hours
 * factors and timings -- the workbook the tool's "How this estimate is built"
 * panel documents. WordPress mints a new URL on every re-upload of the file, hence
 * an editable field rather than a hardcoded path. Empty string = no download link
 * shown.
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

// ---------------------------------------------------------------------------
// Tab: Datenstand & Quellen
// ---------------------------------------------------------------------------

/**
 * Renders the "Datenstand & Quellen" tab: a read-only summary of the fee table
 * shipping with the plugin, plus the editable guideline reference and
 * "last checked" date per Toolbox chapter.
 */
function vcl_render_sources_tab() {
	$vcl_status = isset( $_GET['vcl_status'] ) ? sanitize_key( $_GET['vcl_status'] ) : '';
	$vcl_dates  = vcl_get_last_updated();
	$vcl_refs   = vcl_get_reference_text();

	$last_updated = vfc_extract_last_updated( VFC_DATA_FILE );
	$file_exists  = file_exists( VFC_DATA_FILE );
	$file_size    = $file_exists ? size_format( filesize( VFC_DATA_FILE ) ) : '–';
	$file_mtime   = $file_exists ? date_i18n( 'd.m.Y H:i', filemtime( VFC_DATA_FILE ) ) : '–';
	$public_url   = VFC_PLUGIN_URL . 'assets/js/vcl-calc-data.js';

	// Label plus optional hint per chapter; the hint carries markup on purpose
	// (script names in <code>), hence the escaping exception where it is printed.
	$sections = array(
		'classification' => array( 'Classification of Variations', '' ),
		'grouping'       => array( 'Grouping of Variations', '' ),
		'precisescope'   => array( 'Precise Scope Wording', '' ),
		'qa'             => array(
			'Q&amp;A on Variations',
			'Der Q&amp;A-Inhalt selbst wird aus dem Quell-PDF erzeugt (<code>python extract_qa.py &lt;pdf&gt;</code> &rarr; <code>assets/js/vcl-qa-data.js</code>). Eine neue Revision heißt: Skript neu laufen lassen, nicht hier Text ändern.',
		),
		'art5'           => array(
			'Art. 5 Recommendations',
			'Wird aus der CMDh-Tracking-Tabelle (.xls) erzeugt (<code>python extract_art5.py &lt;xls&gt;</code> &rarr; <code>assets/js/vcl-art5-data.js</code>). Eine neue Revision heißt: Skript neu laufen lassen, nicht hier Werte ändern.',
		),
		'timetables'     => array( 'Timetables for Variations', '' ),
	);
	?>
	<h2>Gebührentabelle des Plugins</h2>
	<p class="description" style="max-width:46em;">
		Die Grundtabelle wird mit dem Plugin ausgeliefert und hier nicht bearbeitet. Einzelne
		Beträge änderst Du im Tab <b>Gebühren</b> — die Eingaben liegen als Ergänzung darüber
		und überleben ein Plugin-Update.
	</p>
	<table class="form-table" role="presentation">
		<tr>
			<th scope="row">Gebühren zuletzt aktualisiert (laut Excel-Änderungshistorie)</th>
			<td><?php echo $last_updated ? esc_html( date_i18n( 'd.m.Y', strtotime( $last_updated ) ) ) : '–'; ?></td>
		</tr>
		<tr>
			<th scope="row">Ausgelieferte Datei</th>
			<td>
				<?php echo esc_html( $file_mtime ); ?> (<?php echo esc_html( $file_size ); ?>)
				&nbsp;·&nbsp;
				<a href="<?php echo esc_url( $public_url ); ?>" target="_blank" rel="noopener">vcl-calc-data.js öffnen</a>
			</td>
		</tr>
	</table>

	<hr>

	<h2 id="vcl-last-updated">„Zuletzt aktualisiert“-Daten</h2>

	<?php if ( $vcl_status === 'success' ) : ?>
		<div class="notice notice-success is-dismissible"><p>Daten gespeichert.</p></div>
	<?php endif; ?>

	<p style="max-width:46em;">
		Diese Angaben erscheinen in der Toolbox als kleiner Hinweis unter dem jeweiligen Kapitel:
		die Guideline-Referenz (Freitext, z. B. Nummer/Revision/Titel der Quelle — da sich diese
		gelegentlich ändern) sowie das Datum, wann der Inhalt zuletzt gegen die offizielle Quelle
		geprüft wurde (nicht zu verwechseln mit dem Datum der Quelle selbst). Der eigentliche
		Inhalt (Klassifizierungscodes, Grouping-Beispiele, Verfahrens-Zeitpläne) wird hier nicht
		bearbeitet — Änderungen daran laufen weiter über eine Entwicklungs-Session, da sie eine
		sorgfältige Übertragung der jeweiligen Guideline erfordern.
	</p>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<?php wp_nonce_field( 'vcl_save_dates_action', 'vcl_save_dates_nonce' ); ?>
		<input type="hidden" name="action" value="vcl_save_dates">
		<table class="form-table" role="presentation">
			<?php foreach ( $sections as $key => $section ) : ?>
				<tr>
					<th scope="row"><?php echo $section[0]; // phpcs:ignore WordPress.Security.EscapeOutput -- fixed label from $sections above, carries intentional entities ?></th>
					<td>
						<label for="vcl_reference_<?php echo esc_attr( $key ); ?>">Reference</label><br>
						<input type="text" id="vcl_reference_<?php echo esc_attr( $key ); ?>" name="vcl_reference_text[<?php echo esc_attr( $key ); ?>]" value="<?php echo esc_attr( $vcl_refs[ $key ] ); ?>" class="regular-text">
						<p class="description" style="margin-top:8px;">
							<label for="vcl_last_updated_<?php echo esc_attr( $key ); ?>">Last updated in Variation Toolbox</label><br>
							<input type="date" id="vcl_last_updated_<?php echo esc_attr( $key ); ?>" name="vcl_last_updated[<?php echo esc_attr( $key ); ?>]" value="<?php echo esc_attr( $vcl_dates[ $key ] ); ?>">
						</p>
						<?php if ( $section[1] ) : ?>
							<p class="description"><?php echo $section[1]; // phpcs:ignore WordPress.Security.EscapeOutput -- fixed hint from $sections above, carries intentional markup ?></p>
						<?php endif; ?>
					</td>
				</tr>
			<?php endforeach; ?>
		</table>
		<?php submit_button( 'Daten speichern' ); ?>
	</form>
	<?php
}

// ---------------------------------------------------------------------------
// Tab: Einstellungen
// ---------------------------------------------------------------------------

/**
 * Renders the "Einstellungen" tab: the feedback contact address and the
 * download link to the workbook behind Workload Planning's RA hours.
 */
function vcl_render_settings_tab() {
	$vcl_status         = isset( $_GET['vcl_status'] ) ? sanitize_key( $_GET['vcl_status'] ) : '';
	$workload_excel_url = vcl_get_workload_excel_url();
	$contact_email      = (string) get_option( 'vcl_contact_email', '' );
	$contact_effective  = vcl_get_contact_email();
	?>
	<h2>Kontakt für Verbesserungsvorschläge</h2>

	<?php if ( $vcl_status === 'contact_saved' ) : ?>
		<div class="notice notice-success is-dismissible"><p>Kontaktadresse gespeichert.</p></div>
	<?php endif; ?>

	<p style="max-width:46em;">
		Die Toolbox zeigt im Kopfbereich einen dezenten Link „Suggest an improvement“ und im
		Workload-Abschnitt „How this estimate is built“ einen Hinweis, falls jemandem eine Zahl
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

	<h2>Workload Planning — Excel-Datei zum Download</h2>

	<?php if ( $vcl_status === 'wl_excel_saved' ) : ?>
		<div class="notice notice-success is-dismissible"><p>Workload-Excel-Download-Link gespeichert.</p></div>
	<?php endif; ?>

	<p style="max-width:46em;">
		Dies ist die Arbeitsmappe hinter den RA-Stunden und Zeiten des Workload-Planning-Tools
		(<code>RA-CMC-hours.xlsx</code>) — dieselbe Mappe, die der Abschnitt
		„How this estimate is built“ im Tool erklärt. Lade sie in die Mediathek hoch, kopiere
		ihre Datei-URL und trage sie hier ein; das Tool zeigt dann einen Download-Link darauf.
		Feld leer lassen = kein Link.
	</p>
	<p style="max-width:46em;">
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
	<?php
}

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

	$redirect_base = vcl_toolbox_page_url( 'sources' );

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
 * Saves Workload Planning's downloadable-Excel URL (see vcl_get_workload_excel_url).
 */
function vcl_handle_save_workload_excel() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Keine Berechtigung.' );
	}
	check_admin_referer( 'vcl_save_workload_excel_action', 'vcl_save_workload_excel_nonce' );

	$url = isset( $_POST['vcl_workload_excel_url'] ) ? esc_url_raw( trim( wp_unslash( $_POST['vcl_workload_excel_url'] ) ) ) : '';
	update_option( 'vcl_workload_excel_url', $url );

	wp_safe_redirect( add_query_arg( array( 'vcl_status' => 'wl_excel_saved' ), vcl_toolbox_page_url( 'settings' ) ) );
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

	wp_safe_redirect( add_query_arg( array( 'vcl_status' => 'contact_saved' ), vcl_toolbox_page_url( 'settings' ) ) );
	exit;
}
add_action( 'admin_post_vcl_save_contact', 'vcl_handle_save_contact' );
