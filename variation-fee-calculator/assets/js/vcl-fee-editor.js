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
  function modeFor(cc) {
    if (POINT_VALUES[cc] || pointEdits[cc]) return 'pt';
    if (CC_TO_CURRENCY[cc]) return 'lc';
    return 'eur';
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

  function baseValue(row, col, mode) {
    var snap = SHIPPED.rows[row.row];
    var f = fieldName(col, mode);
    var v = snap ? snap[f] : row[f];
    return (v === undefined) ? null : v;
  }
  function currentValue(row, col, mode) {
    var f = fieldName(col, mode);
    var e = edits[row.row];
    if (e && Object.prototype.hasOwnProperty.call(e, f)) return e[f];
    return baseValue(row, col, mode);
  }
  function isEdited(row, col, mode) {
    var e = edits[row.row];
    return !!(e && Object.prototype.hasOwnProperty.call(e, fieldName(col, mode)));
  }
  function countryEdited(cc) {
    if (pointEdits[cc] !== undefined) return true;
    return rowsFor(cc).some(function (r) { return edits[r.row] && Object.keys(edits[r.row]).length; });
  }
  function editCount() {
    var n = Object.keys(pointEdits).length;
    Object.keys(edits).forEach(function (k) { n += Object.keys(edits[k]).length; });
    return n;
  }

  function setEdit(row, col, mode, value) {
    var f = fieldName(col, mode);
    var base = baseValue(row, col, mode);
    if (nearlyEqual(value, base)) {
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
    window.VCLCALC_OVERRIDES = { rows: edits, points: pointEdits };
    if (window.VCLCALC && typeof window.VCLCALC.applyOverrides === 'function') {
      window.VCLCALC.applyOverrides();
    }
    root.classList.toggle('is-dirty', editCount() > 0);
    var badge = document.getElementById('vclfe-editcount');
    if (badge) badge.textContent = editCount() ? editCount() + ' geändert' : '';
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
  // Three shapes, chosen with VCLFE_CONFIG.picker:
  //   tabs   -- every country code in one register row, nothing hidden
  //   pills  -- a search box and one chip per country, wrapping
  //   select -- a dropdown between two step arrows, the most compact
  // Read on every render rather than captured once, so the shape can be swapped
  // at runtime -- which is how the harness and the design preview compare them.
  function currentPicker() {
    return ({ pills: 1, select: 1, tabs: 1 })[CFG.picker] ? CFG.picker : 'tabs';
  }

  function selectCountry(cc) {
    if (cc === activeCc) return;
    activeCc = cc;
    openRow = null;
    render();
  }

  function renderPicker() {
    var host = document.getElementById('vclfe-picker');
    if (!host) return;
    var shape = currentPicker();
    host.textContent = '';
    host.className = 'vclfe-picker vclfe-picker--' + shape;
    if (shape === 'pills') pickerPills(host);
    else if (shape === 'select') pickerSelect(host);
    else pickerTabs(host);
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

  function pickerSelect(host) {
    var i = -1;
    COUNTRIES.forEach(function (c, n) { if (c.cc === activeCc) i = n; });

    function step(delta) {
      var next = COUNTRIES[i + delta];
      if (next) selectCountry(next.cc);
    }

    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'vclfe-step';
    prev.textContent = '‹';
    prev.title = 'Vorheriges Land';
    prev.setAttribute('aria-label', 'Vorheriges Land');
    prev.disabled = i <= 0;
    prev.addEventListener('click', function () { step(-1); });
    host.appendChild(prev);

    var sel = document.createElement('select');
    sel.className = 'vclfe-select';
    sel.setAttribute('aria-label', 'Land wählen');
    COUNTRIES.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.cc;
      o.textContent = c.name + '  ·  ' + c.n + ' Zeilen' + (countryEdited(c.cc) ? '  ●' : '');
      if (c.cc === activeCc) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { selectCountry(sel.value); });
    host.appendChild(sel);

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'vclfe-step';
    next.textContent = '›';
    next.title = 'Nächstes Land';
    next.setAttribute('aria-label', 'Nächstes Land');
    next.disabled = i < 0 || i >= COUNTRIES.length - 1;
    next.addEventListener('click', function () { step(1); });
    host.appendChild(next);

    var pos = document.createElement('span');
    pos.className = 'vclfe-pos';
    pos.textContent = (i + 1) + ' / ' + COUNTRIES.length;
    host.appendChild(pos);

    var edited = COUNTRIES.filter(function (c) { return countryEdited(c.cc); });
    if (edited.length) {
      var badge = document.createElement('span');
      badge.className = 'vclfe-editedlist';
      badge.textContent = 'geändert: ' + edited.map(function (c) { return c.cc; }).join(', ');
      host.appendChild(badge);
    }
  }

  function pickerTabs(host) {
    // Sorted by code, not by name: a register of codes is scanned as codes, and
    // "AT BE BG CH ..." reads as ordered where the by-name order does not.
    // "DE - BfArM" is the one code carrying an authority suffix -- shown short so
    // it does not break the rhythm of the row; the full name is in the tooltip
    // and in the heading below.
    COUNTRIES.slice()
      .sort(function (a, b) { return tabLabel(a.cc) < tabLabel(b.cc) ? -1 : 1; })
      .forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'vclfe-tab'
          + (c.cc === activeCc ? ' is-active' : '')
          + (countryEdited(c.cc) ? ' is-edited' : '');
        b.textContent = tabLabel(c.cc);
        b.title = c.name + ' — ' + c.n + ' Gebührenzeilen';
        b.addEventListener('click', function () { selectCountry(c.cc); });
        host.appendChild(b);
      });
  }

  function tabLabel(cc) { return cc.split(' ')[0]; }

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
    // The panel sits BELOW the card, not inside the table: a country with caps
    // and a surcharge runs to ten columns, and a panel inside that table would
    // scroll sideways out of view together with it.
    if (opened) sec.appendChild(panelBlock(opened, mode, unit));
    return sec;
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
    tdType.className = 'vclfe-type';
    tdType.appendChild(document.createTextNode(TYPE_LABELS[row.type] || row.type));
    if (row.special) {
      var sp = document.createElement('span');
      sp.className = 'vclfe-special';
      sp.textContent = row.special;
      tdType.appendChild(sp);
    }
    tr.appendChild(tdType);

    var tdCode = document.createElement('td');
    tdCode.className = 'vclfe-code';
    tdCode.textContent = row.fee_code || '—';
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

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'vclfe-amount'
      + (value === 0 ? ' is-zero' : '')
      + (isEdited(row, col.key, mode) ? ' is-edited' : '');
    inp.value = fmt(value);
    inp.setAttribute('aria-label', (TYPE_LABELS[row.type] || row.type) + ' — ' + col.label);
    inp.addEventListener('change', function () {
      var v = parseAmount(inp.value);
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
      + (row.special ? ' ' + row.special : '')
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
      JSON.stringify({ rows: edits, points: pointEdits });
  });

  document.getElementById('vclfe-reset').addEventListener('click', function () {
    if (!editCount()) return;
    if (!window.confirm('Alle ungespeicherten Änderungen verwerfen?')) return;
    edits = deepCopy(saved.rows || {});
    pointEdits = deepCopy(saved.points || {});
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
