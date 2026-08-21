<?php
/**
 * Admin dashboard widget: Variation-Toolbox usage overview. Pure display of the
 * counters written by includes/usage-counter.php, plus a reset. No new data
 * collection.
 *
 * @package Variation_Fee_Calculator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The six tools in display order: key, label, and whether they carry
 * finished/handoff columns (only the three run-through tools do).
 *
 * @return array[]
 */
function vfc_usage_rows_meta() {
	return array(
		array( 'key' => 'classification', 'label' => 'Classification',  'result' => false, 'download' => false ),
		array( 'key' => 'guidance',       'label' => 'Guidance',        'result' => false, 'download' => false ),
		array( 'key' => 'timelines',      'label' => 'Timelines',       'result' => false, 'download' => false ),
		array( 'key' => 'calculator',     'label' => 'Calculator',      'result' => true,  'download' => true ),
		array( 'key' => 'workflow',       'label' => 'Guided Workflow', 'result' => true,  'download' => false ),
		array( 'key' => 'budget',         'label' => 'Budget Planning', 'result' => true,  'download' => false ),
	);
}

/**
 * All counter option names (used by the widget and the reset handler).
 *
 * @return string[]
 */
function vfc_usage_all_options() {
	$names = array();
	foreach ( vfc_usage_rows_meta() as $row ) {
		$names[] = 'vfc_usage_' . $row['key'] . '_started';
		if ( $row['result'] ) {
			$names[] = 'vfc_usage_' . $row['key'] . '_finished';
			$names[] = 'vfc_usage_' . $row['key'] . '_handoff';
		}
		if ( $row['download'] ) {
			$names[] = 'vfc_usage_' . $row['key'] . '_download';
		}
	}
	return $names;
}

/**
 * Formats finished/started as a percentage, or an en dash when there is nothing
 * to divide by.
 *
 * @param int $started  Number of starts.
 * @param int $finished Number of completions.
 * @return string
 */
function vfc_usage_rate( $started, $finished ) {
	if ( $started <= 0 ) {
		return '–';
	}
	return round( $finished / $started * 100 ) . ' %';
}

/**
 * Returns the localised "last reset" line, or an empty string if never reset.
 * Uses the site's configured date+time format and local timezone.
 *
 * @return string
 */
function vfc_usage_last_reset_text() {
	$raw = get_option( 'vfc_usage_reset_at', '' );
	if ( empty( $raw ) ) {
		return '';
	}
	// The value is stored in local time (current_time), so read it as-is.
	$ts = strtotime( $raw );
	if ( ! $ts ) {
		return '';
	}
	$format = get_option( 'date_format' ) . ' ' . get_option( 'time_format' );
	return sprintf( 'Zuletzt zurückgesetzt: %s', date_i18n( $format, $ts ) );
}

/**
 * Registers the two dashboard widgets (admins only): all-time counters with
 * reset, and today's counters as its own draggable/collapsible widget so the
 * combined view no longer forces one very tall box.
 */
function vfc_usage_add_dashboard_widget() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	wp_add_dashboard_widget(
		'vfc_usage_counts',
		'Variation Toolbox – Nutzung',
		'vfc_usage_render_dashboard_widget'
	);
	wp_add_dashboard_widget(
		'vfc_usage_today',
		'Variation Toolbox – Heute',
		'vfc_usage_render_today_widget'
	);
}
add_action( 'wp_dashboard_setup', 'vfc_usage_add_dashboard_widget' );

/**
 * Renders the widget: per-tool table, totals, and a reset button.
 */
function vfc_usage_render_dashboard_widget() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$rows           = array();
	$total_started  = 0;
	$total_finished = 0;
	$total_handoff  = 0;
	$total_download = 0;

	foreach ( vfc_usage_rows_meta() as $meta ) {
		$s = (int) get_option( 'vfc_usage_' . $meta['key'] . '_started', 0 );
		$f = $meta['result'] ? (int) get_option( 'vfc_usage_' . $meta['key'] . '_finished', 0 ) : null;
		$h = $meta['result'] ? (int) get_option( 'vfc_usage_' . $meta['key'] . '_handoff', 0 ) : null;
		$d = $meta['download'] ? (int) get_option( 'vfc_usage_' . $meta['key'] . '_download', 0 ) : null;

		$total_started += $s;
		if ( null !== $f ) {
			$total_finished += $f;
		}
		if ( null !== $h ) {
			$total_handoff += $h;
		}
		if ( null !== $d ) {
			$total_download += $d;
		}
		$rows[] = array( 'label' => $meta['label'], 's' => $s, 'f' => $f, 'h' => $h, 'd' => $d );
	}
	?>
	<p style="font-size:13px; margin:0 0 8px;">
		<strong><?php echo (int) $total_started; ?></strong> gestartet ·
		<strong><?php echo (int) $total_finished; ?></strong> abgeschlossen ·
		<?php echo esc_html( vfc_usage_rate( $total_started, $total_finished ) ); ?> Abschlussquote
	</p>
	<table class="widefat striped">
		<thead>
			<tr>
				<th>Tool</th>
				<th style="text-align:right;">Gestartet</th>
				<th style="text-align:right;">Abgeschlossen</th>
				<th style="text-align:right;">Quote</th>
				<th style="text-align:right;">Aus Classification übergeben</th>
				<th style="text-align:right;">Excel-Download</th>
			</tr>
		</thead>
		<tbody>
			<?php foreach ( $rows as $r ) : ?>
				<tr>
					<td><?php echo esc_html( $r['label'] ); ?></td>
					<td style="text-align:right;"><?php echo (int) $r['s']; ?></td>
					<td style="text-align:right;"><?php echo ( null === $r['f'] ) ? '–' : (int) $r['f']; ?></td>
					<td style="text-align:right;"><?php echo ( null === $r['f'] ) ? '–' : esc_html( vfc_usage_rate( $r['s'], $r['f'] ) ); ?></td>
					<td style="text-align:right;"><?php echo ( null === $r['h'] ) ? '–' : (int) $r['h']; ?></td>
					<td style="text-align:right;"><?php echo ( null === $r['d'] ) ? '–' : (int) $r['d']; ?></td>
				</tr>
			<?php endforeach; ?>
		</tbody>
		<tfoot>
			<tr>
				<th>Gesamt</th>
				<th style="text-align:right;"><?php echo (int) $total_started; ?></th>
				<th style="text-align:right;"><?php echo (int) $total_finished; ?></th>
				<th style="text-align:right;"><?php echo esc_html( vfc_usage_rate( $total_started, $total_finished ) ); ?></th>
				<th style="text-align:right;"><?php echo (int) $total_handoff; ?></th>
				<th style="text-align:right;"><?php echo (int) $total_download; ?></th>
			</tr>
		</tfoot>
	</table>
	<?php $reset_text = vfc_usage_last_reset_text(); ?>
	<?php if ( $reset_text ) : ?>
		<p style="margin:8px 0 0; color:#646970; font-size:12px;"><?php echo esc_html( $reset_text ); ?></p>
	<?php endif; ?>
	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin:8px 0 0;"
		onsubmit="return confirm('Alle Nutzungszähler der Variation Toolbox auf 0 zurücksetzen?');">
		<input type="hidden" name="action" value="vfc_reset_usage">
		<?php wp_nonce_field( 'vfc_reset_usage' ); ?>
		<button type="submit" class="button-link" style="color:#b32d2e;">Zähler zurücksetzen</button>
	</form>
	<?php
}

/**
 * Renders the second dashboard widget: today's counters only. No reset button
 * here -- the option clears itself lazily at midnight (vfc_usage_bump_today_count()).
 */
function vfc_usage_render_today_widget() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	vfc_usage_render_today_table();
}

/**
 * Renders the "today" table: same columns as the all-time table, but sourced
 * from the vfc_usage_today_counts option and limited to rows with activity
 * today. Read-only -- never writes the option.
 */
function vfc_usage_render_today_table() {
	$data  = get_option( 'vfc_usage_today_counts', array() );
	$today = current_time( 'Y-m-d' );

	$has_data = is_array( $data ) && isset( $data['date'], $data['counts'] ) && $today === $data['date'] && ! empty( $data['counts'] );

	$date_format = get_option( 'date_format' );
	$heading     = sprintf( 'Heute (%s)', wp_date( $date_format ) );

	echo '<p style="font-size:13px; margin:0 0 8px; color:#646970;">' . esc_html( $heading ) . '</p>';

	if ( ! $has_data ) {
		echo '<p style="font-size:13px; margin:0; color:#646970;">Heute wurde noch nichts genutzt.</p>';
		return;
	}

	$labels = array();
	$downloadable = array();
	foreach ( vfc_usage_rows_meta() as $meta ) {
		$labels[ $meta['key'] ]       = $meta['label'];
		$downloadable[ $meta['key'] ] = $meta['download'];
	}

	$rows           = array();
	$total_started  = 0;
	$total_finished = 0;
	$total_handoff  = 0;
	$total_download = 0;

	foreach ( $data['counts'] as $key => $counts ) {
		if ( ! is_array( $counts ) ) {
			continue;
		}
		$s = (int) $counts['s'];
		$f = (int) $counts['f'];
		$h = (int) $counts['h'];
		$d = isset( $counts['d'] ) ? (int) $counts['d'] : 0;
		if ( 0 === $s && 0 === $f && 0 === $h && 0 === $d ) {
			continue;
		}

		$label     = isset( $labels[ $key ] ) ? $labels[ $key ] : $key;
		$has_d_col = ! empty( $downloadable[ $key ] );

		$total_started  += $s;
		$total_finished += $f;
		$total_handoff  += $h;
		$total_download += $d;
		$rows[]          = array(
			'label' => $label,
			's'     => $s,
			'f'     => $f,
			'h'     => $h,
			'd'     => $has_d_col ? $d : null,
		);
	}

	if ( empty( $rows ) ) {
		echo '<p style="font-size:13px; margin:0; color:#646970;">Heute wurde noch nichts genutzt.</p>';
		return;
	}
	?>
	<table class="widefat striped">
		<thead>
			<tr>
				<th>Tool</th>
				<th style="text-align:right;">Gestartet</th>
				<th style="text-align:right;">Abgeschlossen</th>
				<th style="text-align:right;">Quote</th>
				<th style="text-align:right;">Aus Classification übergeben</th>
				<th style="text-align:right;">Excel-Download</th>
			</tr>
		</thead>
		<tbody>
			<?php foreach ( $rows as $r ) : ?>
				<tr>
					<td><?php echo esc_html( $r['label'] ); ?></td>
					<td style="text-align:right;"><?php echo (int) $r['s']; ?></td>
					<td style="text-align:right;"><?php echo (int) $r['f']; ?></td>
					<td style="text-align:right;"><?php echo esc_html( vfc_usage_rate( $r['s'], $r['f'] ) ); ?></td>
					<td style="text-align:right;"><?php echo (int) $r['h']; ?></td>
					<td style="text-align:right;"><?php echo ( null === $r['d'] ) ? '–' : (int) $r['d']; ?></td>
				</tr>
			<?php endforeach; ?>
		</tbody>
		<tfoot>
			<tr>
				<th>Gesamt heute</th>
				<th style="text-align:right;"><?php echo (int) $total_started; ?></th>
				<th style="text-align:right;"><?php echo (int) $total_finished; ?></th>
				<th style="text-align:right;"><?php echo esc_html( vfc_usage_rate( $total_started, $total_finished ) ); ?></th>
				<th style="text-align:right;"><?php echo (int) $total_handoff; ?></th>
				<th style="text-align:right;"><?php echo (int) $total_download; ?></th>
			</tr>
		</tfoot>
	</table>
	<?php
}

/**
 * Resets every usage counter to zero. Admin-only, nonce-checked.
 */
function vfc_usage_handle_reset() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Insufficient permissions.' );
	}
	check_admin_referer( 'vfc_reset_usage' );

	foreach ( vfc_usage_all_options() as $name ) {
		update_option( $name, 0, false );
	}
	// Remember when the counters were last cleared, for display in the backend.
	update_option( 'vfc_usage_reset_at', current_time( 'mysql' ), false );

	wp_safe_redirect( admin_url( 'index.php' ) );
	exit;
}
add_action( 'admin_post_vfc_reset_usage', 'vfc_usage_handle_reset' );
