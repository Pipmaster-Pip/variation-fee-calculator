// ============================================================================
// Variation Toolbox — fee editor (wp-admin)
//
// Types the fee table instead of Excel. Reads the same window.VCLCALC_DATA the
// calculator itself reads, renders one editable table per procedure role, and
// prices the live example through window.VCLCALC.computeFees — the real engine,
// not a second implementation of it. That is the whole point of the example:
// it can only ever show what the calculator would show.
//
// What is edited here are the AMOUNTS. The calculation rule of a row still
// lives in that row's formula in the fee table; the panel states it in plain
// language but does not offer to change it.
//
// Saving writes a sparse override map (only the cells actually changed) into
// the WordPress option vcl_fee_overrides, which the front end applies on top of
// the shipped data file. Nothing here rewrites vcl-calc-data.js.
// ============================================================================
(function () {
  'use strict';

  var CFG = window.VCLFE_CONFIG || {};
  var DATA = window.VCLCALC_DATA;
  var root = document.getElementById('vclfe-root');
  if (!root || !DATA || !DATA.FEE_ROWS) return;

  var FEE_ROWS = DATA.FEE_ROWS;
  var COUNTRY_NAMES = DATA.COUNTRY_NAMES || {};
  var CC_TO_CURRENCY = DATA.CC_TO_CURRENCY || {};
  var POINT_VALUES = DATA.POINT_VALUES || {};

  // The nine amount columns of the fee table, in the order they are shown.
  // F..K come from the workbook; T/U/V were lifted out of the formulas so the
  // caps and the fixed surcharge became plain numbers like the rest.
  var COLUMNS = [
    { key: 'F', label: 'Führende Variation', hint: 'Grundgebühr der teuersten Variation' },
    { key: 'H', label: 'Je weitere IA', hint: 'Satz für jede weitere Typ-IA-Variation' },
    { key: 'I', label: 'Je weitere IB', hint: 'Satz für jede weitere Typ-IB-Variation' },
    { key: 'J', label: 'Je weitere II', hint: 'Satz für jede weitere Typ-II-Variation' },
    { key: 'G', label: 'Je weitere Stärke', hint: 'Aufschlag je zusätzlicher Stärke' },
    { key: 'K', label: 'Gruppenpauschale', hint: 'Fester Betrag ab der zweiten Variation' },
    { key: 'T', label: 'Deckel', hint: 'Obergrenze auf die Summe' },
    { key: 'U', label: 'Deckel ab 2 Stärken', hint: 'Abweichende Obergrenze ab zwei Stärken' },
    { key: 'V', label: 'Zuschlag', hint: 'Fester Betrag obendrauf' }
  ];

  var ROLE_LABELS = {
    RMS: ['Als RMS', 'Referenzmitgliedstaat'],
    CMS: ['Als CMS', 'Betroffener Mitgliedstaat'],
    national: ['Rein national', 'Nationales Verfahren'],
    EMA: ['Zentral (EMA)', 'Zentralisiertes Verfahren']
  };
  var ROLE_ORDER = ['RMS', 'CMS', 'national', 'EMA'];
  var TYPE_LABELS = { IA: 'Typ IA', IB: 'Typ IB', II: 'Typ II' };

  // ---- edit state --------------------------------------------------------
  // edits[rowNumber][field] = number|null, plus points[cc] = number.
  // Sparse on purpose: an entry exists only where the value differs from the
  // shipped one, so an untouched country saves nothing at all.
  var saved = CFG.overrides || {};
  var edits = deepCopy(saved.rows || {});
  var pointEdits = deepCopy(saved.points || {});
  // Annual maintenance fees. Same sparse shape as `edits` above, one level
  // deeper: annualEdits[cc][tariffId] = { base, addStrength }. The structure --
  // which tariffs a country has, what they are called, in which currency -- stays
  // with vcl-annual-data.js; only the two amounts are editable here.
  var annualEdits = deepCopy(saved.annual || {});
  var savedAnnual = deepCopy(saved.annual || {});
  // Per-country provenance (checked date + source): keyed by country code,
  // independent of the amount edits above so a country switch shows the
  // right values without touching edits/pointEdits.
  // savedCountries is the pristine state as it came from the database: the
  // baseline "Verwerfen" restores, and the reference that decides whose "last
  // edited" date a save is allowed to move.
  var savedCountries = deepCopy(
    (window.VCLCALC_OVERRIDES && window.VCLCALC_OVERRIDES.countries) || saved.countries || {}
  );
  var countryOverrides = deepCopy(savedCountries);

  // Change-history entries already saved in the overlay. The bar below adds at
  // most one more per save; these ride along unchanged so a save never drops
  // what an earlier one wrote.
  var savedImprint = Array.isArray(saved.imprint) ? deepCopy(saved.imprint) : [];
  // What the user typed into the bar this session. `null` means "not touched
  // yet, keep following the suggestion"; a string -- including an empty one --
  // means the user has taken over, and an empty one means "no entry, thanks".
  var imprintText = null;
  var imprintDate = new Date().toISOString().slice(0, 10);
  var activeCc = null;
  var openRow = null;
  var example = { strengths: 1, IA: 0, IB: 0, II: 1 };

  function deepCopy(o) {
    var out = {};
    Object.keys(o || {}).forEach(function (k) {
      out[k] = (o[k] && typeof o[k] === 'object') ? deepCopy(o[k]) : o[k];
    });
    return out;
  }

  // ---- country model -----------------------------------------------------
  // Which amount a country is actually maintained in decides what the fields
  // mean. Non-euro countries keep the local amount as the authoritative one
  // (the euro columns are FX snapshots); point countries keep point counts.
  // Which unit a non-euro country is shown and edited in. Local currency leads --
  // it is what the authority publishes -- but both columns (F_lc and F) are
  // maintained data, so the switch moves the editing, not just the display.
  var curOverride = {};
  function modeFor(cc) {
    if (POINT_VALUES[cc] || pointEdits[cc]) return 'pt';
    if (CC_TO_CURRENCY[cc]) return curOverride[cc] === 'eur' ? 'eur' : 'lc';
    return 'eur';
  }
  // The same segmented pair as on the public fee-data page, on the heading of
  // the table it governs. Point-system countries have no second unit to offer.
  function currencyToggle(cc) {
    if (!CC_TO_CURRENCY[cc] || POINT_VALUES[cc] || pointEdits[cc]) return null;
    var eur = curOverride[cc] === 'eur';
    var wrap = document.createElement('div');
    wrap.className = 'vclfe-curtoggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Währung');
    [[CC_TO_CURRENCY[cc], 'lc', !eur], ['EUR', 'eur', eur]].forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'vclfe-curbtn' + (o[2] ? ' on' : '');
      b.textContent = o[0];
      b.addEventListener('click', function () {
        curOverride[cc] = o[1];
        renderCountry();
      });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function suffixFor(mode) { return mode === 'pt' ? '_pt' : (mode === 'lc' ? '_lc' : ''); }
  function unitFor(cc, mode) {
    if (mode === 'pt') return 'Punkte';
    if (mode === 'lc') return CC_TO_CURRENCY[cc];
    return 'EUR';
  }
  function shippedPointValue(cc) {
    var v = SHIPPED.points[cc];
    return (v === undefined) ? POINT_VALUES[cc] : v;
  }
  function pointValueFor(cc) {
    var v = pointEdits[cc];
    return (v === undefined || v === null) ? shippedPointValue(cc) : v;
  }

  function rowsFor(cc) { return FEE_ROWS.filter(function (r) { return r.cc === cc; }); }

  var COUNTRIES = Object.keys(COUNTRY_NAMES)
    .filter(function (cc) { return rowsFor(cc).length > 0; })
    .map(function (cc) { return { cc: cc, name: COUNTRY_NAMES[cc], n: rowsFor(cc).length }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });

  // ---- annual fees -------------------------------------------------------
  var ANNUAL = (window.VCL_ANNUAL_DATA && window.VCL_ANNUAL_DATA.COUNTRIES) || [];
  var ANNUAL_FX = (window.VCL_ANNUAL_DATA && window.VCL_ANNUAL_DATA.FALLBACK_FX) || {};

  // COUNTRIES (built from COUNTRY_NAMES, the calculator's data) spells Germany
  // "DE - BfArM"; vcl-annual-data.js, generated straight from the Excel sheet's
  // plain "DE", has never heard of that suffix. Normalize away everything from
  // " - " onward before comparing so the two country-code spaces line up.
  function normalizeCc(cc) {
    var i = (cc || '').indexOf(' - ');
    return i === -1 ? cc : cc.slice(0, i);
  }

  function annualFor(cc) {
    var code = normalizeCc(cc);
    return ANNUAL.filter(function (c) { return c.cc === code; })[0] || null;
  }

  /** The shipped amount of a tariff, i.e. what "unchanged" means here.
   *
   *  Every function below normalises the country code the same way annualFor()
   *  does. The picker hands out the calculator's own codes, one of which carries
   *  an authority suffix ("DE - BfArM"), while the annual dataset, the stored
   *  overlay and the front end all key on the bare code. Normalising only where
   *  the data is looked up would store edits under a code PHP then rejects as
   *  unknown, and the front end would never find them. */
  function shippedAnnual(cc, tariffId) {
    var all = (window.VCL_ANNUAL_OVERRIDES && window.VCL_ANNUAL_OVERRIDES.shipped()) || {};
    var code = normalizeCc(cc);
    return (all[code] && all[code][tariffId]) || {};
  }

  function annualValue(cc, tariffId, key) {
    var code = normalizeCc(cc);
    var edit = annualEdits[code] && annualEdits[code][tariffId];
    if (edit && typeof edit[key] === 'number') return edit[key];
    var was = shippedAnnual(code, tariffId);
    return was[key] === undefined ? null : was[key];
  }

  function annualEdited(cc, tariffId, key) {
    var code = normalizeCc(cc);
    var edit = annualEdits[code] && annualEdits[code][tariffId];
    return !!(edit && typeof edit[key] === 'number');
  }

  function setAnnualEdit(rawCc, tariffId, key, value) {
    var cc = normalizeCc(rawCc);
    var was = shippedAnnual(cc, tariffId);
    if (value === null || nearlyEqual(value, was[key] === undefined ? null : was[key])) {
      if (annualEdits[cc] && annualEdits[cc][tariffId]) {
        delete annualEdits[cc][tariffId][key];
        if (!Object.keys(annualEdits[cc][tariffId]).length) delete annualEdits[cc][tariffId];
        if (!Object.keys(annualEdits[cc]).length) delete annualEdits[cc];
      }
    } else {
      if (!annualEdits[cc]) annualEdits[cc] = {};
      if (!annualEdits[cc][tariffId]) annualEdits[cc][tariffId] = {};
      annualEdits[cc][tariffId][key] = value;
    }
    applyToEngine();
  }

  function annualEditCount(cc) {
    var n = 0;
    var want = cc ? normalizeCc(cc) : null;
    Object.keys(annualEdits).forEach(function (code) {
      if (want && code !== want) return;
      Object.keys(annualEdits[code]).forEach(function (tid) {
        n += Object.keys(annualEdits[code][tid]).length;
      });
    });
    return n;
  }

  /** Rough euro equivalent for a non-euro annual amount, using the fallback rates
   *  the converter lifted out of the workbook's 'Exchange rates' sheet. Shown as an
   *  orientation next to the field, never as the maintained value. */
  function annualEuroHint(amount, ccy) {
    if (!ccy || ccy === 'EUR' || amount === null || amount === undefined) return null;
    var rate = ANNUAL_FX[ccy];
    if (!rate) return null;
    return 'ca. ' + euro.format(amount / rate);
  }

  // ---- values ------------------------------------------------------------
  // Caps and the fixed surcharge (T/U/V) were lifted out of formulas that work
  // on the euro columns, so they exist only there -- there is no T_lc. A country
  // billing in its own currency therefore keeps those three in euro while the
  // rest of its row is in local currency, which is why the unit is a property of
  // the column and not of the country.
  var EURO_ONLY_IN_LOCAL = { T: true, U: true, V: true };

  function fieldName(col, mode) {
    if (mode === 'lc' && EURO_ONLY_IN_LOCAL[col]) return col;
    return col + suffixFor(mode);
  }
  function unitForColumn(cc, mode, col) {
    if (mode === 'lc' && EURO_ONLY_IN_LOCAL[col]) return 'EUR';
    return unitFor(cc, mode);
  }

  // The value this plugin build ships, NOT what sits on the row object right
  // now -- applyOverrides() has already rewritten the latter, so reading it back
  // would make every saved edit look like an untouched value.
  var SHIPPED = (window.VCLCALC && typeof window.VCLCALC.shippedFees === 'function')
    ? window.VCLCALC.shippedFees()
    : { rows: {}, points: {} };

  // ---- captions ----------------------------------------------------------
  // Fee code and variant label are text, not amounts, and they live in the same
  // per-row edit map as everything else -- so they are counted, exported,
  // imported and cleared without a second mechanism. What they are NOT is the
  // row's key: `special` stays untouched, so renaming a variant here cannot
  // reprice a budget plan that was saved with the old name.
  var TEXT_FIELDS = ['fee_code', 'label'];
  var SHIPPED_TEXT = (window.VCLCALC && typeof window.VCLCALC.shippedText === 'function')
    ? window.VCLCALC.shippedText()
    : {};

  function baseText(row, field) {
    var snap = SHIPPED_TEXT[row.row];
    var v = snap ? snap[field] : row[field];
    // fee_code is a number in the data file for codes like 3102.
    return (v === null || v === undefined) ? '' : String(v);
  }
  // What the field shows: the typed caption where one exists, otherwise what the
  // plugin ships. For the label that fallback is the row's own key -- which is
  // exactly what the badge showed before this was editable.
  function textValue(row, field) {
    var e = edits[row.row];
    if (e && Object.prototype.hasOwnProperty.call(e, field)) return e[field];
    if (field === 'label') return baseText(row, 'label') || String(row.special || '');
    return baseText(row, field);
  }
  function textEdited(row, field) {
    var e = edits[row.row];
    return !!(e && Object.prototype.hasOwnProperty.call(e, field));
  }
  function setText(row, field, raw) {
    var value = String(raw === null || raw === undefined ? '' : raw).trim();
    var shipped = (field === 'label')
      ? (baseText(row, 'label') || String(row.special || ''))
      : baseText(row, field);
    if (!edits[row.row]) edits[row.row] = {};
    // Empty, or typed back to what is shipped, is not an override -- same rule
    // the amount cells follow, so "n geändert" never counts a non-change.
    if (value === '' || value === shipped) {
      delete edits[row.row][field];
      if (!Object.keys(edits[row.row]).length) delete edits[row.row];
    } else {
      edits[row.row][field] = value;
    }
    // Same tail as setEdit(): pushes the edit into the engine, so the counter,
    // the unsaved-changes state and the live example all move with it.
    applyToEngine();
  }

  function baseValue(row, col, mode) {
    var snap = SHIPPED.rows[row.row];
    var f = fieldName(col, mode);
    var v = snap ? snap[f] : row[f];
    return (v === undefined) ? null : v;
  }
  // ---- couplings ---------------------------------------------------------
  // Half the fee table repeats itself: "each additional variation costs the same
  // as the first", "half of it", "three quarters". The workbook says so with a
  // formula rather than a second typed number, and those formulas are shipped
  // with the data (see tools/fee-migration/extract_links.py). A coupled cell
  // therefore shows a derived amount and is not asked for again.
  //
  // Typing into a coupled cell breaks its coupling -- and only that cell's.
  // Emptying it restores the coupling. There is no separate "still linked" flag
  // to drift out of step: an override on the cell IS the broken coupling.
  function linkFor(row, col) {
    return (row.links && row.links[col]) || null;
  }

  function derivedValue(row, col, mode) {
    var link = linkFor(row, col);
    if (!link) return null;
    var source = link.r ? (ROW_BY_NUMBER[link.r] || row) : row;
    var base = currentValue(source, link.c, mode);
    if (base === null || base === undefined) return null;
    return base * (link.f === undefined ? 1 : link.f)
                + (link.o === undefined ? 0 : link.o);
  }

  function linkExplanation(row, col, mode) {
    var link = linkFor(row, col);
    if (!link) return '';
    var label = (COLUMNS.filter(function (c) { return c.key === link.c; })[0] || {}).label || link.c;
    var where = link.r ? ' der Zeile „' + rowShortName(link.r) + '"' : '';
    var how = '';
    if (link.f !== undefined && link.o !== undefined) {
      how = ' × ' + fmt(link.f) + ' + ' + fmt(link.o);
    } else if (link.f !== undefined) {
      how = ' × ' + fmt(link.f);
    } else if (link.o !== undefined) {
      how = ' + ' + fmt(link.o);
    }
    return 'Folgt „' + label + '"' + where + how
      + '. Zum Entkoppeln einfach einen eigenen Betrag eintippen; '
      + 'Feld leeren stellt die Kopplung wieder her.';
  }

  function currentValue(row, col, mode) {
    var f = fieldName(col, mode);
    var e = edits[row.row];
    if (e && Object.prototype.hasOwnProperty.call(e, f)) return e[f];
    // A coupled cell reads its amount off the row, which the engine has already
    // resolved -- the shipped value would be stale the moment its source moves.
    if (linkFor(row, col)) {
      var v = row[f];
      return (v === undefined) ? null : v;
    }
    return baseValue(row, col, mode);
  }
  function isEdited(row, col, mode) {
    var e = edits[row.row];
    return !!(e && Object.prototype.hasOwnProperty.call(e, fieldName(col, mode)));
  }
  function countryEdited(cc) {
    if (pointEdits[cc] !== undefined) return true;
    if (annualEditCount(cc) > 0) return true;
    return rowsFor(cc).some(function (r) { return edits[r.row] && Object.keys(edits[r.row]).length; });
  }
  function editCount() {
    var n = Object.keys(pointEdits).length;
    Object.keys(edits).forEach(function (k) { n += Object.keys(edits[k]).length; });
    return n + annualEditCount(null);
  }

  /** Maintained provenance fields, counted the same way vcl_count_fee_overrides()
   *  counts them in PHP: the typed checked date and source, never the stamped
   *  'updated'. */
  function provCount() {
    var n = 0;
    Object.keys(countryOverrides).forEach(function (cc) {
      var e = countryOverrides[cc] || {};
      if (e.checked) { n++; }
      if (e.source) { n++; }
    });
    return n;
  }

  /** Everything this page maintains. An installation on which only dates and
   *  sources were entered is not "unchanged". */
  function overrideCount() { return editCount() + provCount(); }

  // ---- change history ----------------------------------------------------
  // overrideCount() answers "does an overlay exist at all", which is true from
  // the moment anything was ever saved. The history bar needs a different
  // question -- "what did THIS session change" -- so it diffs against the state
  // the page was loaded with.
  function changedSinceLoad() {
    var amounts = {};   // country code -> true, for a changed fee or point value
    var prov = {};      // country code -> true, for a changed checked date or source

    var was = saved.rows || {};
    Object.keys(edits).concat(Object.keys(was)).forEach(function (row) {
      if (JSON.stringify(edits[row] || {}) === JSON.stringify(was[row] || {})) { return; }
      var r = FEE_ROWS.filter(function (x) { return String(x.row) === String(row); })[0];
      if (r) { amounts[r.cc] = true; }
    });

    var wasPoints = saved.points || {};
    Object.keys(pointEdits).concat(Object.keys(wasPoints)).forEach(function (cc) {
      if (String(pointEdits[cc]) !== String(wasPoints[cc])) { amounts[cc] = true; }
    });

    Object.keys(annualEdits).concat(Object.keys(savedAnnual)).forEach(function (cc) {
      if (JSON.stringify(annualEdits[cc] || {}) === JSON.stringify(savedAnnual[cc] || {})) { return; }
      amounts[cc] = true;
    });

    Object.keys(countryOverrides).concat(Object.keys(savedCountries)).forEach(function (cc) {
      var now = countryOverrides[cc] || {};
      var old = savedCountries[cc] || {};
      if ((now.checked || '') !== (old.checked || '') || (now.source || '') !== (old.source || '')) {
        prov[cc] = true;
      }
    });

    return { amounts: Object.keys(amounts).sort(), prov: Object.keys(prov).sort() };
  }

  /** The house style of the 75 lines the workbook ships: one country spelled out,
   *  two joined with "&", three or more separated by commas. Both forms occur
   *  there ("to update DK & NO fees", "to update HR, HU fees"). */
  function imprintSuggestion() {
    var ch = changedSinceLoad();
    if (ch.amounts.length) {
      var list = ch.amounts.length === 2 ? ch.amounts.join(' & ') : ch.amounts.join(', ');
      return 'to update ' + list + ' fees';
    }
    if (ch.prov.length) { return 'to check fees on HA websites'; }
    return '';
  }

  function imprintValue() {
    return imprintText === null ? imprintSuggestion() : imprintText;
  }

  function renderSaveBar() {
    var host = document.getElementById('vclfe-savebar');
    if (!host) { return; }
    var ch = changedSinceLoad();
    var active = ch.amounts.length > 0 || ch.prov.length > 0;
    // Nothing changed in this session: no bar, and nothing carried into the
    // payload beyond the entries that were already saved.
    if (!active) { host.textContent = ''; return; }

    // Rebuilding the bar under the cursor would eat every second keystroke, so
    // it is built once and only its value follows the suggestion afterwards.
    var input = document.getElementById('vclfe-imprint');
    if (input) {
      if (imprintText === null) { input.value = imprintSuggestion(); }
      var why = document.getElementById('vclfe-imprint-why');
      if (why) { why.textContent = suggestionReason(ch); }
      return;
    }

    host.textContent = '';
    var bar = document.createElement('div');
    bar.className = 'vclfe-savebar';

    var lab = document.createElement('label');
    lab.className = 'vclfe-f vclfe-f--grow';
    var lspan = document.createElement('span');
    lspan.textContent = 'Eintrag für die Änderungshistorie';
    var text = document.createElement('input');
    text.type = 'text';
    text.id = 'vclfe-imprint';
    text.className = 'vclfe-imprint';
    text.value = imprintSuggestion();
    text.addEventListener('input', function () { imprintText = text.value; });
    lab.appendChild(lspan);
    lab.appendChild(text);
    bar.appendChild(lab);

    var dlab = document.createElement('label');
    dlab.className = 'vclfe-f';
    var dspan = document.createElement('span');
    dspan.textContent = 'Datum';
    var date = document.createElement('input');
    date.type = 'date';
    date.value = imprintDate;
    date.addEventListener('input', function () { imprintDate = date.value; });
    dlab.appendChild(dspan);
    dlab.appendChild(date);
    bar.appendChild(dlab);

    var why = document.createElement('p');
    why.className = 'vclfe-savebar__why';
    var tag = document.createElement('b');
    tag.textContent = 'Vorschlag';
    var whyText = document.createElement('span');
    whyText.id = 'vclfe-imprint-why';
    whyText.textContent = suggestionReason(ch);
    why.appendChild(tag);
    why.appendChild(whyText);
    bar.appendChild(why);

    host.appendChild(bar);
  }

  function suggestionReason(ch) {
    var names = (ch.amounts.length ? ch.amounts : ch.prov)
      .map(function (cc) { return COUNTRY_NAMES[cc] || cc; });
    var listed = names.length > 2
      ? names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1]
      : names.join(' und ');
    var what = ch.amounts.length ? 'geänderten Beträgen' : 'geänderten Angaben zur Quelle';
    return ' aus den ' + what + ' in ' + listed
      + '. Überschreib ihn mit allem, was besser passt. Leer lassen heißt: kein Eintrag.';
  }

  function setEdit(row, col, mode, value) {
    var f = fieldName(col, mode);
    // What "unchanged" means differs: a free cell is unchanged when it matches
    // the shipped amount, a coupled one when it matches what its coupling gives.
    var base = linkFor(row, col) ? derivedValue(row, col, mode)
                                 : baseValue(row, col, mode);
    if (value === null || nearlyEqual(value, base)) {
      if (edits[row.row]) {
        delete edits[row.row][f];
        if (!Object.keys(edits[row.row]).length) delete edits[row.row];
      }
    } else {
      if (!edits[row.row]) edits[row.row] = {};
      edits[row.row][f] = value;
    }
    applyToEngine();
  }

  function nearlyEqual(a, b) {
    if (a === null || b === null) return a === b;
    return Math.abs(a - b) < 1e-9;
  }

  // ---- number formatting -------------------------------------------------
  var nf = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  var euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

  function fmt(v) { return (v === null || v === undefined) ? '' : nf.format(v); }

  // Accepts both German ("1.234,56") and plain ("1234.56") notation, because
  // amounts get pasted out of authority PDFs in either shape.
  function parseAmount(text) {
    var s = String(text).trim();
    if (s === '') return null;
    if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(/\s/g, '');
    if (!/^-?\d*\.?\d*$/.test(s)) return undefined;   // undefined = not a number
    var v = parseFloat(s);
    return isFinite(v) ? v : undefined;
  }

  // ---- push edits into the live engine ----------------------------------
  // The example is priced by the real calculator, so the edits have to reach
  // the row objects it reads. Same shape the front end receives from PHP.
  function applyToEngine() {
    window.VCLCALC_OVERRIDES = {
      rows: edits, points: pointEdits, countries: countryOverrides, annual: annualEdits
    };
    if (window.VCL_ANNUAL_OVERRIDES) window.VCL_ANNUAL_OVERRIDES.apply();
    if (window.VCLCALC && typeof window.VCLCALC.applyOverrides === 'function') {
      window.VCLCALC.applyOverrides();
    }
    root.classList.toggle('is-dirty', overrideCount() > 0);
    var badge = document.getElementById('vclfe-editcount');
    if (badge) badge.textContent = overrideCount() ? overrideCount() + ' geändert' : '';
    renderSaveBar();
  }

  // ========================================================================
  // Rendering
  // ========================================================================
  function render() {
    renderPicker();
    renderCountry();
  }

  // ---- country picker ----------------------------------------------------
  // Sits above the tables rather than beside them: a country with caps and a
  // surcharge runs to ten columns, and a side rail took exactly the width those
  // columns need -- which is what put a scrollbar under every table.
  //
  // A search box and one named chip per country: the names are what the fee
  // schedules are discussed in, and typing two letters is faster than finding a
  // country in a list of thirty-three.

  function selectCountry(cc) {
    if (cc === activeCc) return;
    activeCc = cc;
    openRow = null;
    render();
  }

  function renderPicker() {
    var host = document.getElementById('vclfe-picker');
    if (!host) return;
    host.textContent = '';
    host.className = 'vclfe-picker';
    pickerPills(host);
    renderProvenance(host);
  }

  // Provenance for the active country: the date the user checked the amounts
  // against the authority's schedule, and the reference they checked against.
  // Both feed the public fee page's header.
  function renderProvenance(host) {
    var meta = document.createElement('div');
    meta.className = 'vclfe-prov';

    var saved = (countryOverrides[activeCc] || {});

    function field(key, label, type, placeholder) {
      var wrap = document.createElement('label');
      wrap.className = 'vclfe-prov__f';
      var span = document.createElement('span');
      span.textContent = label;
      var input = document.createElement('input');
      input.type = type;
      input.value = saved[key] || '';
      if (placeholder) { input.placeholder = placeholder; }
      input.addEventListener('input', function () {
        if (!countryOverrides[activeCc]) { countryOverrides[activeCc] = {}; }
        if (input.value) { countryOverrides[activeCc][key] = input.value; }
        else { delete countryOverrides[activeCc][key]; }
        applyToEngine();
      });
      wrap.appendChild(span);
      wrap.appendChild(input);
      meta.appendChild(wrap);
    }

    field('checked', 'Zuletzt gegen die Gebührenordnung geprüft', 'date', '');
    field('source', 'Quelle (Fundstelle der Gebührenordnung)', 'text',
          'z. B. Elenco Tariffe aggiornato ad Luglio 2025');

    var note = document.createElement('p');
    note.className = 'vclfe-prov__note';
    note.textContent = 'Das Änderungsdatum wird beim Speichern automatisch gesetzt. '
      + 'Behördenlink und Zahlungsweise stammen aus der Excel und sind hier nicht änderbar.';
    meta.appendChild(note);

    host.appendChild(meta);
  }

  var pillFilter = '';

  function pickerPills(host) {
    var bar = document.createElement('div');
    bar.className = 'vclfe-pillbar';

    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'vclfe-search';
    search.placeholder = 'Land suchen';
    search.value = pillFilter;
    search.setAttribute('aria-label', 'Land suchen');
    search.addEventListener('input', function () {
      pillFilter = search.value;
      renderPicker();
      var again = host.querySelector('.vclfe-search');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
    bar.appendChild(search);

    var q = pillFilter.trim().toLowerCase();
    var shown = COUNTRIES.filter(function (c) {
      return !q || c.name.toLowerCase().indexOf(q) > -1 || c.cc.toLowerCase().indexOf(q) > -1;
    });

    var count = document.createElement('span');
    count.className = 'vclfe-pillcount';
    count.textContent = q ? shown.length + ' von ' + COUNTRIES.length : COUNTRIES.length + ' Laender';
    bar.appendChild(count);
    host.appendChild(bar);

    var wrap = document.createElement('div');
    wrap.className = 'vclfe-pills';
    shown.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'vclfe-pill'
        + (c.cc === activeCc ? ' is-active' : '')
        + (countryEdited(c.cc) ? ' is-edited' : '');
      b.appendChild(document.createTextNode(c.name));
      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = c.n;
      b.appendChild(n);
      b.addEventListener('click', function () { selectCountry(c.cc); });
      wrap.appendChild(b);
    });
    if (!shown.length) {
      var none = document.createElement('p');
      none.className = 'vclfe-pillnone';
      none.textContent = 'Kein Land mit diesem Namen.';
      wrap.appendChild(none);
    }
    host.appendChild(wrap);
  }


  function renderCountry() {
    var main = document.getElementById('vclfe-main');
    main.textContent = '';
    if (!activeCc) return;

    var mode = modeFor(activeCc);
    var unit = unitFor(activeCc, mode);
    var rows = rowsFor(activeCc);

    document.getElementById('vclfe-title').textContent = COUNTRY_NAMES[activeCc];
    var meta = document.getElementById('vclfe-meta');
    meta.textContent = '';
    metaBit(meta, activeCc, 'code');
    metaBit(meta, mode === 'pt'
      ? 'Punktesystem · ' + fmt(pointValueFor(activeCc)) + ' EUR je Punkt'
      : 'Beträge in ' + unit);
    metaBit(meta, rows.length + ' Gebührenzeilen');
    if (countryEdited(activeCc)) metaBit(meta, 'ungespeicherte Änderungen');

    if (mode === 'pt') main.appendChild(pointPanel(activeCc));

    ROLE_ORDER.forEach(function (role) {
      var roleRows = rows.filter(function (r) { return r.role === role; });
      if (!roleRows.length) return;
      main.appendChild(roleSection(role, roleRows, mode, unit));
    });

    main.appendChild(annualSection(activeCc));
    main.appendChild(rulesSection(rows));
  }

  // ---- annual fees -------------------------------------------------------
  // Sits below the per-role tables of the one-off variation fees and above the
  // rules box. Same country, same page: the recurring fee of a registration is
  // maintained where its variation fees are, not on a screen of its own.
  //
  // Rendered even where there is nothing to type. A country without an annual fee
  // and a country whose annual fee nobody entered look identical if the block is
  // simply left out -- and that ambiguity is what let these fees be forgotten in
  // the first place.
  function annualSection(cc) {
    var entry = annualFor(cc);
    var sec = document.createElement('section');
    sec.className = 'vclfe-group vclfe-annual';

    var head = document.createElement('div');
    head.className = 'vclfe-group__head';
    var h = document.createElement('h3');
    h.textContent = 'Jahresgebühr';
    head.appendChild(h);
    var p = document.createElement('p');
    p.textContent = 'Wiederkehrende Gebühr je Zulassung — nicht die einmalige Variation-Gebühr oben.';
    head.appendChild(p);
    sec.appendChild(head);

    if (!entry) {
      sec.appendChild(annualNote('Für dieses Land liegen keine Jahresgebühr-Daten vor.'));
      return sec;
    }
    if (!entry.hasAnnual) {
      sec.appendChild(annualNote('Keine Jahresgebühr.'));
      return sec;
    }
    if (!entry.tariffs || !entry.tariffs.length) {
      sec.appendChild(annualNote(
        (entry.note ? entry.note + '. ' : '')
        + 'Umsatz- bzw. mengenabhängig — lässt sich nicht als fester Betrag pflegen.'));
      return sec;
    }

    var card = document.createElement('div');
    card.className = 'vclfe-card';
    var scroll = document.createElement('div');
    scroll.className = 'vclfe-scroll';
    var table = document.createElement('table');

    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    htr.appendChild(th('Tarif'));
    [['Grundbetrag', 'base'], ['Je weitere Stärke', 'addStrength']].forEach(function (pair) {
      var cell = th('', 'num');
      var name = document.createElement('span');
      name.className = 'vclfe-th__label';
      name.textContent = pair[0];
      var unitEl = document.createElement('span');
      unitEl.className = 'vclfe-th__unit';
      unitEl.textContent = entry.tariffs[0].ccy || 'EUR';
      cell.appendChild(name);
      cell.appendChild(unitEl);
      htr.appendChild(cell);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    entry.tariffs.forEach(function (t) {
      tbody.appendChild(annualRow(cc, t));
    });
    table.appendChild(tbody);

    scroll.appendChild(table);
    card.appendChild(scroll);
    sec.appendChild(card);

    if (entry.note) {
      var note = document.createElement('p');
      note.className = 'vclfe-legend';
      note.textContent = entry.note;
      sec.appendChild(note);
    }
    return sec;
  }

  function annualNote(text) {
    var box = document.createElement('div');
    box.className = 'vclfe-card vclfe-annual__note';
    box.textContent = text;
    return box;
  }

  function annualRow(cc, tariff) {
    var tr = document.createElement('tr');

    var tdLabel = document.createElement('td');
    tdLabel.className = 'vclfe-type';
    tdLabel.textContent = tariff.label;
    tr.appendChild(tdLabel);

    tr.appendChild(annualCell(cc, tariff, 'base'));
    tr.appendChild(annualCell(cc, tariff, 'addStrength'));
    return tr;
  }

  function annualCell(cc, tariff, key) {
    var td = document.createElement('td');
    td.className = 'num';

    // A tariff whose shipped addStrength is null does not scale with the number
    // of strengths. Offering an input there would invite a number that changes the
    // structure rather than an amount -- so the cell stays closed.
    if (key === 'addStrength' && shippedAnnual(cc, tariff.id).addStrength === null) {
      var dash = document.createElement('span');
      dash.className = 'vclfe-empty';
      dash.textContent = '—';
      dash.title = 'Skaliert nicht mit der Zahl der Stärken.';
      td.appendChild(dash);
      return td;
    }

    var value = annualValue(cc, tariff.id, key);
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'vclfe-amount'
      + (value === 0 ? ' is-zero' : '')
      + (annualEdited(cc, tariff.id, key) ? ' is-edited' : '');
    inp.value = fmt(value);
    inp.setAttribute('aria-label', tariff.label + ' — Jahresgebühr, '
      + (key === 'base' ? 'Grundbetrag' : 'je weitere Stärke'));
    inp.addEventListener('change', function () {
      var v = parseAmount(String(inp.value).trim());
      if (v === undefined || v === null || v < 0) {
        inp.classList.add('is-bad');
        return;
      }
      inp.classList.remove('is-bad');
      setAnnualEdit(cc, tariff.id, key, v);
      renderCountry();
      renderPicker();
    });
    td.appendChild(inp);

    var hint = annualEuroHint(value, tariff.ccy);
    if (hint) {
      var eurEl = document.createElement('span');
      eurEl.className = 'vclfe-annual__eur';
      eurEl.textContent = hint;
      td.appendChild(eurEl);
    }
    return td;
  }

  function metaBit(parent, text, cls) {
    if (parent.childNodes.length) {
      var d = document.createElement('span');
      d.className = 'vclfe-dot';
      d.textContent = '·';
      parent.appendChild(d);
    }
    var s = document.createElement('span');
    if (cls === 'code') s.className = 'vclfe-code';
    s.textContent = text;
    parent.appendChild(s);
  }

  function pointPanel(cc) {
    var box = document.createElement('div');
    box.className = 'vclfe-points';

    var lab = document.createElement('label');
    lab.setAttribute('for', 'vclfe-pointvalue');
    lab.textContent = 'Punktwert (EUR je Punkt)';
    box.appendChild(lab);

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.id = 'vclfe-pointvalue';
    inp.value = fmt(pointValueFor(cc));
    inp.addEventListener('change', function () {
      var v = parseAmount(inp.value);
      if (v === undefined || v === null || v <= 0) { inp.value = fmt(pointValueFor(cc)); return; }
      if (nearlyEqual(v, shippedPointValue(cc))) delete pointEdits[cc];
      else pointEdits[cc] = v;
      applyToEngine();
      inp.value = fmt(pointValueFor(cc));
      render();
    });
    box.appendChild(inp);

    var p = document.createElement('p');
    p.textContent = 'Die Gebühren dieses Landes werden in Punkten geführt. Alle Beträge in den '
      + 'Tabellen unten sind Punkte; der Euro-Betrag ist Punkte × Punktwert. Ändert die Behörde '
      + 'den Punktwert, genügt dieses eine Feld.';
    box.appendChild(p);
    return box;
  }

  function activeColumns(rows, mode) {
    return COLUMNS.filter(function (col) {
      return rows.some(function (r) {
        var v = currentValue(r, col.key, mode);
        return v !== null && v !== undefined;
      });
    });
  }

  function roleSection(role, rows, mode, unit) {
    var labels = ROLE_LABELS[role] || [role, ''];
    var sec = document.createElement('section');
    sec.className = 'vclfe-group';

    var head = document.createElement('div');
    head.className = 'vclfe-group__head';
    var h = document.createElement('h3');
    h.textContent = labels[0];
    head.appendChild(h);
    var p = document.createElement('p');
    p.textContent = labels[1];
    head.appendChild(p);
    var cur = currencyToggle(activeCc);
    if (cur) head.appendChild(cur);
    sec.appendChild(head);

    var cols = activeColumns(rows, mode);

    var card = document.createElement('div');
    card.className = 'vclfe-card';
    var scroll = document.createElement('div');
    scroll.className = 'vclfe-scroll';
    var table = document.createElement('table');

    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    htr.appendChild(th('Verfahrensart'));
    htr.appendChild(th('Fee code'));
    cols.forEach(function (c) {
      // Label and unit stack instead of sitting on one nowrap line: the long
      // ones ("Fuehrende Variation (EUR)") set the column width, and with eight
      // to ten columns that alone pushed the table past the page.
      var cell = th('', 'num');
      cell.title = c.hint;
      var name = document.createElement('span');
      name.className = 'vclfe-th__label';
      name.textContent = c.label;
      var unitEl = document.createElement('span');
      unitEl.className = 'vclfe-th__unit';
      unitEl.textContent = unitForColumn(activeCc, mode, c.key);
      cell.appendChild(name);
      cell.appendChild(unitEl);
      htr.appendChild(cell);
    });
    htr.appendChild(th(''));
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var opened = null;
    rows.forEach(function (r) {
      tbody.appendChild(feeRow(r, cols, mode, unit));
      if (openRow === r.row) opened = r;
    });
    table.appendChild(tbody);

    scroll.appendChild(table);
    card.appendChild(scroll);
    sec.appendChild(card);

    // Captions first: the two dashed fields are the only ones on this screen that
    // are not amounts, so the sentence that says so belongs directly under them.
    var capLegend = document.createElement('p');
    capLegend.className = 'vclfe-legend';
    var capSwatch = document.createElement('span');
    capSwatch.className = 'vclfe-legend__swatch vclfe-legend__swatch--text';
    capLegend.appendChild(capSwatch);
    capLegend.appendChild(document.createTextNode(
      'Gestrichelt umrandet sind Beschriftungen, keine Beträge: der Fee code und '
      + 'die Bezeichnung der Verfahrensart. Beide ändern nur, was angezeigt wird — '
      + 'gerechnet wird unverändert weiter, und bereits gespeicherte Budgetpläne '
      + 'behalten ihre Auswahl. Feld leeren stellt wieder her, was das Plugin '
      + 'ausliefert. Der Typ (IA / IB / II) links davon steht fest: er entscheidet, '
      + 'welche Formel rechnet.'));
    sec.appendChild(capLegend);

    if (rows.some(function (r) { return r.links; })) {
      var legend = document.createElement('p');
      legend.className = 'vclfe-legend';
      var swatch = document.createElement('span');
      swatch.className = 'vclfe-legend__swatch';
      legend.appendChild(swatch);
      legend.appendChild(document.createTextNode(
        'So gekennzeichnete Beträge folgen einem anderen Feld — meist der '
        + 'Grundgebühr derselben Zeile — genau wie die Formeln in der '
        + 'Arbeitsmappe. Sie ziehen automatisch nach. Tippst Du einen eigenen '
        + 'Betrag ein, gilt der; leerst Du das Feld, folgt es wieder.'));
      sec.appendChild(legend);
    }
    // The panel sits BELOW the card, not inside the table: a country with caps
    // and a surcharge runs to ten columns, and a panel inside that table would
    // scroll sideways out of view together with it.
    if (opened) sec.appendChild(panelBlock(opened, mode, unit));
    return sec;
  }

  // ========================================================================
  // Rechenwege — what the amounts above are put together with
  //
  // The rules are not stored anywhere separately: each row carries its own
  // Excel formulas (Mf/Nf/Of/Pf/Qf/Rf/Sf) exactly as they stand in the
  // workbook, and vcl-calc-app.js evaluates them. This section reads them back
  // out and shows them, grouped by the rows that share a formula.
  //
  // Deliberately a TRANSLITERATION, not an interpretation: cell references are
  // swapped for the column's plain name and the Excel keywords for German ones,
  // and nothing else is touched. An earlier attempt to derive named rules
  // ("Staffelung", "Pauschale ab der zweiten") from these formulas reproduced
  // only about 70 % of the amounts, so a summary in that style would look
  // authoritative while being wrong for one row in three. What is stated in
  // plain words below is limited to what can be read off the formula text with
  // certainty -- that it references the cap column, the surcharge column, and
  // so on.
  // ========================================================================

  var CELL_LABELS = {
    F: 'Führende Variation', G: 'Je weitere Stärke',
    H: 'Je weitere IA', I: 'Je weitere IB', J: 'Je weitere II',
    K: 'Gruppenpauschale', T: 'Deckel', U: 'Deckel ab 2 Stärken', V: 'Zuschlag',
    L: 'Stärken',
    M: 'wirksame Anzahl IA', N: 'wirksame Anzahl IB', O: 'wirksame Anzahl II',
    P: 'Summe IA', Q: 'Summe IB', R: 'Summe II', S: 'Gesamt'
  };
  // Row 2 is the input header of the sheet: the counts the user typed in.
  var INPUT_LABELS = { M: 'Anzahl IA', N: 'Anzahl IB', O: 'Anzahl II' };

  var FORMULA_FIELDS = [
    ['Sf', 'Gesamt'], ['Pf', 'Summe IA'], ['Qf', 'Summe IB'], ['Rf', 'Summe II'],
    ['Mf', 'wirksame Anzahl IA'], ['Nf', 'wirksame Anzahl IB'], ['Of', 'wirksame Anzahl II']
  ];

  var ROW_BY_NUMBER = {};
  FEE_ROWS.forEach(function (r) { ROW_BY_NUMBER[r.row] = r; });

  function rowShortName(row) {
    var r = ROW_BY_NUMBER[row];
    if (!r) return 'Zeile ' + row;
    return (TYPE_LABELS[r.type] || r.type) + (r.special ? ' ' + textValue(r, 'label') : '') + ' · ' + r.role;
  }

  // A row's formulas with every row number stripped, so two rows doing the same
  // thing land in the same group.
  function formulaSignature(row) {
    return FORMULA_FIELDS.map(function (f) {
      var v = row[f[0]];
      return v ? v.replace(/([A-Z]{1,2})\d+/g, '$1') : '';
    }).join('||');
  }

  function humanFormula(text, ownRow) {
    var out = text.replace(/^=/, '');
    out = out.replace(/ISBLANK\(L\d+\)/g, 'Zeile nicht ausgewählt');
    out = out.replace(/\b([A-Z])(\d+)\b/g, function (m, col, row) {
      var n = parseInt(row, 10);
      if (n === 2) return INPUT_LABELS[col] || (CELL_LABELS[col] || col);
      var label = CELL_LABELS[col] || col;
      return (n === ownRow) ? label : label + ' [' + rowShortName(n) + ']';
    });
    out = out.replace(/\bIF\(/g, 'WENN(')
             .replace(/\bAND\(/g, 'UND(')
             .replace(/\bOR\(/g, 'ODER(');
    out = out.replace(/""/g, '\u2014');
    out = out.replace(/<>/g, '\u2260').replace(/<=/g, '\u2264').replace(/>=/g, '\u2265');
    out = out.replace(/,/g, '; ');
    return out;
  }

  // Statements that can be read straight off the formula text. Each is a
  // reference to a specific column, never a guess about the shape of the rule.
  function formulaFacts(row) {
    var text = FORMULA_FIELDS.map(function (f) { return row[f[0]] || ''; }).join(' ');
    var bare = text.replace(/ISBLANK\([^)]*\)/g, '');
    var facts = [];
    function uses(col) { return new RegExp('\\b' + col + '\\d+\\b').test(bare); }
    if (uses('G')) facts.push('Jede zusätzliche Stärke erhöht die Sätze');
    if (uses('K')) {
      facts.push(/>\s*1/.test(bare)
        ? 'Ab der zweiten Variation gilt die Gruppenpauschale'
        : 'Rechnet mit der Gruppenpauschale');
    }
    if (uses('T')) facts.push('Die Summe ist gedeckelt');
    if (uses('U')) facts.push('Ab zwei Stärken gilt ein anderer Deckel');
    if (uses('V')) facts.push('Auf die Summe kommt ein fester Zuschlag');
    return facts;
  }

  // ========================================================================
  // In einfachen Worten
  //
  // The transliteration above is exact but still shaped like a formula. This
  // turns the same formula into sentences, by parsing it and walking the tree --
  // not by recognising which "kind of rule" a row is. That distinction matters:
  // deriving named rules from these formulas was tried in the migration study
  // and reproduced only about 70 % of the amounts. Every sentence below is a
  // restatement of a branch that is actually in the formula.
  //
  // Where a piece cannot be phrased with confidence, it falls back to the
  // transliterated text rather than inventing a description, so the worst case
  // is prose that reads a bit technical -- never prose that is wrong.
  // ========================================================================

  function tokenize(text) {
    var tokens = [], i = 0;
    while (i < text.length) {
      var ch = text[i];
      if (ch === ' ') { i++; continue; }
      if (text.substr(i, 2) === '<>' || text.substr(i, 2) === '>=' || text.substr(i, 2) === '<=') {
        tokens.push({ t: 'op', v: text.substr(i, 2) }); i += 2; continue;
      }
      if ('+-*/(),=<>'.indexOf(ch) > -1) { tokens.push({ t: 'op', v: ch }); i++; continue; }
      if (ch === '"') {
        var j = i + 1;
        while (j < text.length && text[j] !== '"') j++;
        tokens.push({ t: 'str', v: text.slice(i + 1, j) }); i = j + 1; continue;
      }
      var m = /^[0-9]+(\.[0-9]+)?/.exec(text.slice(i));
      if (m) { tokens.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(text.slice(i));
      if (m) {
        var word = m[0]; i += word.length;
        var cell = /^([A-Z]{1,2})([0-9]+)$/.exec(word);
        if (cell) tokens.push({ t: 'cell', col: cell[1], row: parseInt(cell[2], 10) });
        else tokens.push({ t: 'name', v: word });
        continue;
      }
      return null;   // something unexpected -- give up on this formula
    }
    return tokens;
  }

  function parseFormula(text) {
    var tokens = tokenize(text.replace(/^=/, ''));
    if (!tokens) return null;
    var pos = 0;

    function peek() { return tokens[pos]; }
    function eat(v) {
      var tk = tokens[pos];
      if (!tk || tk.t !== 'op' || tk.v !== v) throw new Error('erwartet ' + v);
      pos++;
      return tk;
    }
    function expr() { return comparison(); }
    function comparison() {
      var left = sum();
      var tk = peek();
      if (tk && tk.t === 'op' && ['=', '<>', '>', '<', '>=', '<='].indexOf(tk.v) > -1) {
        pos++;
        return { t: 'cmp', op: tk.v, l: left, r: sum() };
      }
      return left;
    }
    function sum() {
      var node = product();
      for (;;) {
        var tk = peek();
        if (tk && tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
          pos++;
          node = { t: 'arith', op: tk.v, l: node, r: product() };
        } else return node;
      }
    }
    function product() {
      var node = unary();
      for (;;) {
        var tk = peek();
        if (tk && tk.t === 'op' && (tk.v === '*' || tk.v === '/')) {
          pos++;
          node = { t: 'arith', op: tk.v, l: node, r: unary() };
        } else return node;
      }
    }
    function unary() {
      var tk = peek();
      if (tk && tk.t === 'op' && tk.v === '-') { pos++; return { t: 'neg', v: unary() }; }
      return primary();
    }
    function primary() {
      var tk = peek();
      if (!tk) throw new Error('unerwartetes Ende');
      if (tk.t === 'num') { pos++; return { t: 'num', v: tk.v }; }
      if (tk.t === 'str') { pos++; return { t: 'str', v: tk.v }; }
      if (tk.t === 'cell') { pos++; return { t: 'cell', col: tk.col, row: tk.row }; }
      if (tk.t === 'name') {
        pos++;
        eat('(');
        var args = [];
        if (!(peek() && peek().t === 'op' && peek().v === ')')) {
          args.push(expr());
          while (peek() && peek().t === 'op' && peek().v === ',') { pos++; args.push(expr()); }
        }
        eat(')');
        return { t: 'call', name: tk.v.toUpperCase(), args: args };
      }
      if (tk.t === 'op' && tk.v === '(') { pos++; var e = expr(); eat(')'); return e; }
      throw new Error('unerwartetes Zeichen');
    }

    try {
      var tree = expr();
      return pos === tokens.length ? tree : null;
    } catch (e) {
      return null;
    }
  }

  // ---- phrases -----------------------------------------------------------
  var COUNT_NOUN = { M: 'Typ-IA-Variation', N: 'Typ-IB-Variation', O: 'Typ-II-Variation' };
  // Both cases, because these appear as the subject of a condition ("wenn der
  // Deckel ...") and as the object of a result ("kostet es den Deckel").
  var SUM_NOUN = {
    P: ['die Typ-IA-Gebühren', 'die Typ-IA-Gebühren'],
    Q: ['die Typ-IB-Gebühren', 'die Typ-IB-Gebühren'],
    R: ['die Typ-II-Gebühren', 'die Typ-II-Gebühren']
  };
  var RATE_NOUN = {
    F: ['die Grundgebühr', 'die Grundgebühr'],
    G: ['der Aufschlag je Stärke', 'den Aufschlag je Stärke'],
    H: ['der Satz für jede weitere Typ IA', 'den Satz für jede weitere Typ IA'],
    I: ['der Satz für jede weitere Typ IB', 'den Satz für jede weitere Typ IB'],
    J: ['der Satz für jede weitere Typ II', 'den Satz für jede weitere Typ II'],
    K: ['die Gruppenpauschale', 'die Gruppenpauschale'],
    T: ['der Deckel', 'den Deckel'],
    U: ['der Deckel ab zwei Stärken', 'den Deckel ab zwei Stärken'],
    V: ['der Zuschlag', 'den Zuschlag']
  };

  function isCell(node, cols) {
    return node && node.t === 'cell' && cols.indexOf(node.col) > -1;
  }
  function isNum(node, v) {
    return node && node.t === 'num' && node.v === v;
  }

  function money(v) { return fmt(v); }

  // A value, as a noun phrase. `k` picks nominative (0) or accusative (1).
  // Returns null when it cannot be phrased -- the caller then drops the whole
  // explanation rather than shipping half a sentence.
  function sayValue(node, row, k) {
    if (!node) return null;
    k = k || 0;
    if (node.t === 'str' && node.v === '') return 'nichts';
    if (node.t === 'num') return node.v === 0 ? 'nichts' : money(node.v);
    if (node.t === 'cell') {
      if (SUM_NOUN[node.col]) return SUM_NOUN[node.col][k];
      if (node.col === 'S') return k ? 'die Gesamtgebühr' : 'die Gesamtgebühr';
      if (RATE_NOUN[node.col]) {
        return RATE_NOUN[node.col][k] + (node.row === row ? '' : ' aus „' + rowShortName(node.row) + '"');
      }
      if (COUNT_NOUN[node.col]) return 'die Zahl der ' + COUNT_NOUN[node.col] + 'en';
      if (node.col === 'L') return 'die Zahl der Stärken';
      return null;
    }
    if (node.t === 'arith' && node.op === '+') {
      // P+Q+R and friends: a list of sub-totals
      var parts = [];
      (function collect(n) {
        if (n.t === 'arith' && n.op === '+') { collect(n.l); collect(n.r); return; }
        parts.push(n);
      })(node);
      var said = parts.map(function (p) { return sayValue(p, row, k); });
      if (said.every(function (x) { return x; })) {
        if (said.length === 2) return said[0] + ' und ' + said[1];
        return said.slice(0, -1).join(', ') + ' und ' + said[said.length - 1];
      }
    }
    return null;
  }

  // A condition, phrased as the subordinate clause after "Wenn".
  function sayCondition(node, negated, row) {
    if (!node) return null;

    if (node.t === 'call' && node.name === 'ISBLANK') return null;   // plumbing

    if (node.t === 'cmp') {
      var l = node.l, r = node.r, op = node.op;

      // count = 0  /  count > 1  /  count = 1. Tagged with the count they talk
      // about and how tight they are, so "at least one" can be dropped next to
      // "more than one" instead of being spelled out beside it.
      if (isCell(l, ['M', 'N', 'O']) && r.t === 'num') {
        var noun = COUNT_NOUN[l.col];
        var key = 'count:' + l.col;
        if (op === '=' && r.v === 0) {
          return negated ? { t: 'mindestens eine ' + noun + ' dabei ist', key: key, rank: 1 }
                         : { t: 'keine ' + noun + ' dabei ist', key: key, rank: 3 };
        }
        if (op === '>' && r.v === 1) {
          return negated ? { t: 'höchstens eine ' + noun + ' dabei ist', key: key, rank: 2 }
                         : { t: 'mehr als eine ' + noun + ' dabei ist', key: key, rank: 3 };
        }
        if (op === '=' && r.v === 1) {
          return negated ? { t: 'nicht genau eine ' + noun + ' dabei ist', key: key, rank: 2 }
                         : { t: 'genau eine ' + noun + ' dabei ist', key: key, rank: 3 };
        }
      }
      // strengths = 1
      if (isCell(l, ['L']) && isNum(r, 1) && op === '=') {
        return negated ? { t: 'es mehr als eine Stärke gibt', key: 'strengths', rank: 3 }
                       : { t: 'es nur eine Stärke gibt', key: 'strengths', rank: 3 };
      }
      // a sum against a cap
      if (isCell(r, ['T', 'U']) && op === '>') {
        var what = sayValue(l, row, 0);
        var cap = r.col === 'T' ? 'den Deckel' : 'den Deckel ab zwei Stärken';
        if (what) {
          return negated ? what + ' ' + cap + ' nicht überschreiten'
                         : what + ' über ' + cap + ' hinausgehen';
        }
      }
      // (N+O)>0 style: are other types present
      if (op === '>' && isNum(r, 0)) {
        var cols = [];
        (function collect(n) {
          if (n.t === 'arith' && n.op === '+') { collect(n.l); collect(n.r); return; }
          if (n.t === 'cell' && COUNT_NOUN[n.col]) cols.push(COUNT_NOUN[n.col]);
        })(l);
        if (cols.length) {
          var list = cols.length === 1 ? cols[0]
                   : cols.slice(0, -1).join(', ') + ' oder ' + cols[cols.length - 1];
          return negated ? 'keine ' + list + ' dabei ist' : 'auch ' + list + 'en dabei sind';
        }
      }
    }
    return null;
  }

  // Walk the IF-tree into a list of cases, each with its conditions and result.
  function decisionTable(node, row) {
    var cases = [];
    (function walk(n, conds) {
      if (n && n.t === 'call' && n.name === 'IF' && n.args.length === 3) {
        walk(n.args[1], conds.concat([{ node: n.args[0], neg: false }]));
        walk(n.args[2], conds.concat([{ node: n.args[0], neg: true }]));
        return;
      }
      cases.push({ conds: conds, value: n });
    })(node, []);
    return cases;
  }

  function eli5(row, field) {
    var text = row[field];
    if (!text) return null;
    var tree = parseFormula(text);
    if (!tree) return null;

    // Every branch of the formula, phrased. One unphrasable piece and the whole
    // explanation is dropped -- half an explanation of a fee is worse than none.
    var cases = [];
    var raw = decisionTable(tree, row.row);
    for (var i = 0; i < raw.length; i++) {
      var value = sayValue(raw[i].value, row.row, 1);
      if (value === null) return null;
      var clauses = [];
      for (var j = 0; j < raw[i].conds.length; j++) {
        var cond = raw[i].conds[j];
        // The "this row is not part of the submission" guard is plumbing, not a
        // fee rule, and is dropped. Anything else unphrasable aborts.
        if (cond.node && cond.node.t === 'call' && cond.node.name === 'ISBLANK') continue;
        var said = sayCondition(cond.node, cond.neg, row.row);
        if (said === null) return null;
        clauses.push(typeof said === 'string' ? { t: said, key: said, rank: 3 } : said);
      }
      // Two clauses about the same thing where one implies the other: keep the
      // tighter. "At least one Type IA" next to "more than one Type IA" is not
      // wrong, just noise.
      var byKey = {};
      clauses.forEach(function (c) {
        if (!byKey[c.key] || c.rank > byKey[c.key].rank) byKey[c.key] = c;
      });
      var tightened = clauses.filter(function (c) { return byKey[c.key] === c; });
      // "at least one" plus "at most one" is exactly one, and reads better so.
      var pairs = {};
      clauses.forEach(function (c) { (pairs[c.key] = pairs[c.key] || []).push(c); });
      tightened = tightened.map(function (c) {
        var group = pairs[c.key] || [];
        if (group.length === 2 && group[0].rank === 1 && group[1].rank === 2) {
          var noun = group[0].t.replace('mindestens eine ', '').replace(' dabei ist', '');
          return { t: 'genau eine ' + noun + ' dabei ist', key: c.key, rank: 3 };
        }
        return c;
      });
      cases.push({ clauses: tightened.map(function (c) { return c.t; }), value: value });
    }

    // A branch with no conditions left and no fee is the unselected row again.
    cases = cases.filter(function (c) { return c.clauses.length || c.value !== 'nichts'; });
    if (!cases.length) return null;

    // "Costs nothing" branches are the entry conditions; they read best up front.
    var nothing = cases.filter(function (c) { return c.value === 'nichts'; });
    var rest = cases.filter(function (c) { return c.value !== 'nichts'; });

    // Some rows carry a fee of zero throughout -- a UK Type IA as a CMS, for
    // one. Walking the reader through two branches that both end at nothing
    // hides that behind procedure.
    if (!rest.length) return ['Für diese Zeile fällt keine Gebühr an.'];

    // A condition every remaining branch shares says nothing about the choice
    // between them, so it is stated once instead of in each line. A pure
    // factorisation -- the branches keep meaning exactly what they meant.
    var shared = [];
    if (rest.length > 1) {
      shared = rest[0].clauses.filter(function (clause) {
        return rest.every(function (c) { return c.clauses.indexOf(clause) > -1; });
      });
      rest.forEach(function (c) {
        c.clauses = c.clauses.filter(function (x) { return shared.indexOf(x) < 0; });
      });
    }

    var lines = [];
    nothing.forEach(function (c) {
      lines.push(c.clauses.length
        ? 'Wenn ' + c.clauses.join(' und ') + ', kostet es nichts.'
        : 'Es kostet nichts.');
    });
    if (shared.length) {
      lines.push('Sonst, wenn ' + shared.join(' und ') + ':');
    }
    rest.forEach(function (c, i) {
      var last = i === rest.length - 1;
      if (c.clauses.length) {
        lines.push('Wenn ' + c.clauses.join(' und ') + ', kostet es ' + c.value + '.');
      } else if (last && (shared.length || nothing.length)) {
        lines.push('Sonst kostet es ' + c.value + '.');
      } else {
        lines.push('Es kostet ' + c.value + '.');
      }
    });
    return lines.length ? lines : null;
  }

  function rulesSection(rows) {
    var sec = document.createElement('section');
    sec.className = 'vclfe-group vclfe-rules';

    var head = document.createElement('div');
    head.className = 'vclfe-group__head';
    var h = document.createElement('h3');
    h.textContent = 'Rechenwege';
    head.appendChild(h);
    var p = document.createElement('p');
    p.appendChild(document.createTextNode('wie aus den Beträgen oben eine Gebühr wird'));
    head.appendChild(p);
    sec.appendChild(head);

    var intro = document.createElement('p');
    intro.className = 'vclfe-rules__intro';
    intro.textContent = 'Jede Gebührenzeile trägt ihre eigene Formel — dieselbe, die in der '
      + 'Excel-Arbeitsmappe steht. Hier stehen sie im Klartext, gruppiert nach Zeilen, die '
      + 'dieselbe Formel benutzen. Zellbezüge sind durch die Spaltennamen ersetzt, sonst ist '
      + 'nichts verändert. Geändert werden die Rechenwege hier nicht — nur die Beträge oben.';
    sec.appendChild(intro);

    // group the country's rows by formula signature, in the order they appear
    var groups = [];
    var bySig = {};
    rows.forEach(function (r) {
      var sig = formulaSignature(r);
      if (!bySig[sig]) {
        bySig[sig] = { rows: [], first: r };
        groups.push(bySig[sig]);
      }
      bySig[sig].rows.push(r);
    });

    groups.forEach(function (g, i) { sec.appendChild(ruleCard(g, i + 1, groups.length)); });
    return sec;
  }

  function ruleCard(group, index, total) {
    var card = document.createElement('div');
    card.className = 'vclfe-rule';

    var head = document.createElement('div');
    head.className = 'vclfe-rule__head';
    var n = document.createElement('span');
    n.className = 'vclfe-rule__n';
    n.textContent = index + ' / ' + total;
    head.appendChild(n);

    var who = document.createElement('div');
    who.className = 'vclfe-rule__rows';
    group.rows.forEach(function (r) {
      var chip = document.createElement('span');
      chip.className = 'vclfe-rule__row';
      chip.textContent = rowShortName(r.row);
      who.appendChild(chip);
    });
    head.appendChild(who);
    card.appendChild(head);

    var facts = formulaFacts(group.first);
    if (facts.length) {
      var ul = document.createElement('ul');
      ul.className = 'vclfe-rule__facts';
      facts.forEach(function (f) {
        var li = document.createElement('li');
        li.textContent = f;
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }

    var plain = eli5(group.first, 'Sf');
    if (plain) {
      var box = document.createElement('div');
      box.className = 'vclfe-rule__plain';
      var h = document.createElement('h5');
      h.textContent = 'In einfachen Worten';
      box.appendChild(h);
      var ul = document.createElement('ul');
      plain.forEach(function (line) {
        var li = document.createElement('li');
        li.textContent = line;
        ul.appendChild(li);
      });
      box.appendChild(ul);
      card.appendChild(box);
    }

    var list = document.createElement('dl');
    list.className = 'vclfe-rule__formulas';
    FORMULA_FIELDS.forEach(function (f) {
      var text = group.first[f[0]];
      if (!text) return;
      var dt = document.createElement('dt');
      dt.textContent = f[1];
      var dd = document.createElement('dd');
      dd.textContent = humanFormula(text, group.first.row);
      list.appendChild(dt);
      list.appendChild(dd);
    });
    card.appendChild(list);
    return card;
  }

  function th(text, cls) {
    var e = document.createElement('th');
    if (cls) e.className = cls;
    e.textContent = text;
    return e;
  }

  function feeRow(row, cols, mode, unit) {
    var tr = document.createElement('tr');
    if (openRow === row.row) tr.className = 'is-open';

    var tdType = document.createElement('td');
    var typeWrap = document.createElement('div');
    typeWrap.className = 'vclfe-typecell';
    var typeName = document.createElement('span');
    typeName.className = 'vclfe-type';
    typeName.textContent = TYPE_LABELS[row.type] || row.type;
    typeWrap.appendChild(typeName);
    // The type itself (IA / IB / II) is not editable: it decides which formula
    // prices the row. Only the variant beside it is a caption.
    if (row.special) {
      typeWrap.appendChild(textInput(row, 'label', 'vclfe-label',
        'Bezeichnung der Verfahrensart, Zeile ' + row.row));
    }
    tdType.appendChild(typeWrap);
    tr.appendChild(tdType);

    var tdCode = document.createElement('td');
    tdCode.appendChild(textInput(row, 'fee_code', 'vclfe-codeinput',
      'Fee code, Zeile ' + row.row));
    tr.appendChild(tdCode);

    cols.forEach(function (col) {
      tr.appendChild(amountCell(row, col, mode));
    });

    var tdBtn = document.createElement('td');
    tdBtn.className = 'num';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vclfe-toggle';
    var chev = document.createElement('span');
    chev.className = 'vclfe-chev';
    chev.textContent = '›';
    btn.appendChild(chev);
    btn.appendChild(document.createTextNode(' Beispiel'));
    btn.addEventListener('click', function () {
      openRow = (openRow === row.row) ? null : row.row;
      renderCountry();
    });
    tdBtn.appendChild(btn);
    tr.appendChild(tdBtn);

    return tr;
  }

  // One caption field. Unlike an amount there is nothing to validate: any short
  // text is a legitimate fee code or variant name, and emptying it is the
  // documented way back to what the plugin ships.
  function textInput(row, field, cls, ariaLabel) {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = cls + (textEdited(row, field) ? ' is-edited' : '');
    inp.value = textValue(row, field);
    inp.setAttribute('aria-label', ariaLabel);
    inp.title = 'Nur die Beschriftung. Feld leeren stellt wieder her, was das Plugin ausliefert.';
    inp.addEventListener('change', function () {
      setText(row, field, inp.value);
      renderCountry();
      renderPicker();
    });
    return inp;
  }

  function amountCell(row, col, mode) {
    var td = document.createElement('td');
    td.className = 'num';
    var value = currentValue(row, col.key, mode);

    // A cell the row's formula never reads stays empty rather than becoming an
    // editable zero -- typing a number there would look like it did something.
    if (value === null || value === undefined) {
      var dash = document.createElement('span');
      dash.className = 'vclfe-empty';
      dash.textContent = '—';
      td.appendChild(dash);
      return td;
    }

    var edited = isEdited(row, col.key, mode);
    var coupled = !!linkFor(row, col.key) && !edited;

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'vclfe-amount'
      + (value === 0 ? ' is-zero' : '')
      + (edited ? ' is-edited' : '')
      + (coupled ? ' is-coupled' : '');
    inp.value = fmt(value);
    var label = (TYPE_LABELS[row.type] || row.type) + ' — ' + col.label;
    if (coupled) {
      var why = linkExplanation(row, col.key, mode);
      inp.title = why;
      label += ' (gekoppelt)';
    } else if (linkFor(row, col.key)) {
      inp.title = 'Eigener Betrag, Kopplung gelöst. Feld leeren stellt sie wieder her.';
      label += ' (entkoppelt)';
    }
    inp.setAttribute('aria-label', label);
    inp.addEventListener('change', function () {
      var raw = String(inp.value).trim();
      // Emptying a coupled cell is how the coupling is restored; emptying a free
      // cell would just delete a fee, so that is refused.
      if (raw === '' && linkFor(row, col.key)) {
        setEdit(row, col.key, mode, null);
        renderCountry();
        renderPicker();
        return;
      }
      var v = parseAmount(raw);
      if (v === undefined || v === null || v < 0) {
        inp.classList.add('is-bad');
        return;
      }
      inp.classList.remove('is-bad');
      setEdit(row, col.key, mode, v);
      renderCountry();
      renderPicker();
    });
    td.appendChild(inp);
    return td;
  }

  // ---- row panel: plain-language sentence + live example -----------------
  function panelBlock(row, mode, unit) {
    var panel = document.createElement('div');
    panel.className = 'vclfe-panel';

    var left = document.createElement('div');
    var h = document.createElement('h4');
    h.textContent = 'Was diese Zeile berechnet';
    left.appendChild(h);
    left.appendChild(sentenceFor(row, mode, unit));
    var f = document.createElement('p');
    f.className = 'vclfe-formula';
    f.textContent = 'Rechenweg (aus der Gebührentabelle, hier nicht änderbar): ' + (row.Sf || '—');
    left.appendChild(f);
    panel.appendChild(left);

    panel.appendChild(examplePanel(row));
    return panel;
  }

  function sentenceFor(row, mode, unit) {
    var p = document.createElement('p');
    p.className = 'vclfe-sentence';
    var parts = [];
    function push(text, col) {
      var value = currentValue(row, col, mode);
      if (value === null || value === undefined) return;
      parts.push([text, fmt(value) + ' ' + unitForColumn(row.cc, mode, col)]);
    }
    push('Grundgebühr ', 'F');
    push('je weitere Typ IA ', 'H');
    push('je weitere Typ IB ', 'I');
    push('je weitere Typ II ', 'J');
    push('je zusätzliche Stärke ', 'G');
    push('Gruppenpauschale ab der zweiten ', 'K');
    push('Deckel ', 'T');
    push('Deckel ab zwei Stärken ', 'U');
    push('Zuschlag ', 'V');

    parts.forEach(function (part, i) {
      if (i) p.appendChild(document.createTextNode(', '));
      p.appendChild(document.createTextNode(part[0]));
      var b = document.createElement('b');
      b.textContent = part[1];
      p.appendChild(b);
    });
    p.appendChild(document.createTextNode('. Wie diese Sätze zusammengerechnet werden, '
      + 'steht in der Formel dieser Zeile — die Beispielrechnung rechts rechnet sie mit dem '
      + 'echten Rechner durch.'));
    return p;
  }

  function examplePanel(row) {
    var aside = document.createElement('aside');
    aside.className = 'vclfe-example';

    var h = document.createElement('h4');
    h.textContent = 'Beispielrechnung';
    aside.appendChild(h);

    var ctx = document.createElement('p');
    ctx.className = 'vclfe-ex__ctx';
    ctx.textContent = (TYPE_LABELS[row.type] || row.type)
      + (row.special ? ' ' + textValue(row, 'label') : '')
      + ' · ' + (row.role === 'national' ? 'rein national' : 'als ' + row.role);
    aside.appendChild(ctx);

    var grid = document.createElement('div');
    grid.className = 'vclfe-ex__grid';
    [['strengths', 'Stärken'], ['IA', 'Variationen Typ IA'],
     ['IB', 'Variationen Typ IB'], ['II', 'Variationen Typ II']].forEach(function (f) {
      var lab = document.createElement('label');
      lab.setAttribute('for', 'vclfe-ex-' + f[0]);
      lab.textContent = f[1];
      grid.appendChild(lab);
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'vclfe-ex-' + f[0];
      inp.value = example[f[0]];
      inp.addEventListener('input', function () {
        var v = parseInt(String(inp.value).replace(/\D/g, ''), 10);
        example[f[0]] = isNaN(v) ? 0 : v;
        renderExample(row, out, total, hint);
      });
      grid.appendChild(inp);
    });
    aside.appendChild(grid);

    var out = document.createElement('div');
    out.className = 'vclfe-ex__out';
    aside.appendChild(out);

    var totalBox = document.createElement('div');
    totalBox.className = 'vclfe-ex__total';
    var lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = 'Gesamtgebühr';
    totalBox.appendChild(lbl);
    var total = document.createElement('span');
    total.className = 'val';
    total.textContent = '—';
    totalBox.appendChild(total);
    aside.appendChild(totalBox);

    var hint = document.createElement('p');
    hint.className = 'vclfe-ex__hint';
    aside.appendChild(hint);

    renderExample(row, out, total, hint);
    return aside;
  }

  function renderExample(row, out, totalEl, hintEl) {
    out.textContent = '';
    hintEl.textContent = '';

    if (!window.VCLCALC || typeof window.VCLCALC.computeFees !== 'function') {
      totalEl.textContent = '—';
      hintEl.textContent = 'Der Rechner ist auf dieser Seite nicht geladen.';
      return;
    }

    // The row's own special variant is requested for its type, so the engine
    // resolves exactly this row and not the country's default one.
    var special = { IA: null, IB: null, II: null };
    special[row.type] = row.special || null;

    var res;
    try {
      res = window.VCLCALC.computeFees({
        countries: [{ cc: row.cc, role: row.role, strengths: Math.max(1, example.strengths), special: special }],
        counts: { IA: example.IA, IB: example.IB, II: example.II }
      });
    } catch (e) {
      totalEl.textContent = '—';
      hintEl.textContent = 'Berechnung fehlgeschlagen: ' + e.message;
      return;
    }

    var cr = res && res.countries && res.countries[0];
    if (!cr || !cr.items || !cr.items.length) {
      totalEl.textContent = '—';
      hintEl.textContent = 'Keine Variation ausgewählt.';
      return;
    }

    cr.items.forEach(function (it) {
      var d = document.createElement('div');
      d.className = 'vclfe-ex__line';
      var a = document.createElement('span');
      var n = { IA: example.IA, IB: example.IB, II: example.II }[it.row.type];
      a.textContent = n + '× ' + (TYPE_LABELS[it.row.type] || it.row.type)
        + (it.subsumed ? ' (mitgerechnet)' : '');
      var b = document.createElement('span');
      b.textContent = (typeof it.total === 'number') ? euro.format(it.total)
                    : (it.subsumed ? 'in der Summe' : '—');
      d.appendChild(a);
      d.appendChild(b);
      out.appendChild(d);
    });

    totalEl.textContent = euro.format(cr.total || 0);

    if (cr.currency && cr.fxRate) {
      hintEl.textContent = 'Landeswährung: '
        + new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(cr.totalLocal)
        + ' ' + cr.currency + ' (Kurs ' + nf.format(cr.fxRate) + ').';
    } else {
      hintEl.textContent = 'Gerechnet mit dem Rechner der Toolbox — inklusive Grouping, Deckel und Zuschlag.';
    }
  }

  // ========================================================================
  // Save / reset
  // ========================================================================
  document.getElementById('vclfe-payload').form.addEventListener('submit', function () {
    document.getElementById('vclfe-payload').value =
      JSON.stringify({
        rows: edits,
        points: pointEdits,
        annual: annualEdits,
        // One new line at most, in front of what was saved before. An empty box
        // is a decision, not an omission: this save then adds nothing.
        imprint: (function () {
          var topic = (imprintValue() || '').trim();
          if (!topic || !imprintDate) { return savedImprint; }
          return [{ date: imprintDate, topic: topic }].concat(savedImprint);
        }()),
        countries: (function () {
          var out = {};
          var today = new Date().toISOString().slice(0, 10);
          Object.keys(countryOverrides).forEach(function (cc) {
            var e = countryOverrides[cc];
            if (!e || (!e.checked && !e.source)) { return; }
            // Only a country actually touched in this session gets a new "last
            // edited" date. The others were merely loaded from the saved overlay
            // and keep the date they were saved with -- otherwise maintaining
            // Denmark in November would date every other country to November.
            var was = savedCountries[cc] || {};
            var touched = (e.checked || '') !== (was.checked || '')
                       || (e.source || '') !== (was.source || '');
            out[cc] = {
              checked: e.checked || '',
              source: e.source || '',
              updated: touched ? today : (was.updated || today)
            };
          });
          return out;
        }())
      });
  });

  document.getElementById('vclfe-reset').addEventListener('click', function () {
    if (!overrideCount()) return;
    if (!window.confirm('Alle ungespeicherten Änderungen verwerfen?')) return;
    edits = deepCopy(saved.rows || {});
    pointEdits = deepCopy(saved.points || {});
    annualEdits = deepCopy(savedAnnual);
    // Provenance is part of what this page maintains, so it is part of what
    // "Verwerfen" throws away -- otherwise the next save would write the very
    // dates and sources the user just discarded.
    countryOverrides = deepCopy(savedCountries);
    imprintText = null;
    applyToEngine();
    render();
  });

  // ---- go --------------------------------------------------------------
  activeCc = (CFG.startCountry && COUNTRY_NAMES[CFG.startCountry]) ? CFG.startCountry
           : (COUNTRIES.length ? COUNTRIES[0].cc : null);
  applyToEngine();
  render();

  // Minimal handle for the harness and the design preview: change
  // VCLFE_CONFIG.picker, then re-render.
  window.VCLFE = { render: render };
})();
