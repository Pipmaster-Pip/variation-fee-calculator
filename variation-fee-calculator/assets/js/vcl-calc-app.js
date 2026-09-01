// ============================================================================
// Variation Fee Calculator — WordPress plugin build.
// Wrapped in an IIFE and reading data from window.VCLCALC_DATA so nothing here
// (FEE_ROWS, appState, STEPS, ...) leaks into the shared global script scope
// of the WordPress page — avoids collisions with other plugins/the theme.
// All DOM ids are prefixed with "vclcalc-" for the same reason.
// Formula interpreter — evaluates the original Excel cell formulas exactly,
// resolving cross-row references (e.g. a IB-row referencing the "G" of the
// preceding IA-row), so behaviour matches the source workbook 1:1.
// ============================================================================
(function(){

const { FEE_ROWS, COUNTRY_NAMES, IMPRINT, HA_WEBSITES, CC_TO_CURRENCY, STATIC_FX_RATES, POINT_VALUES } = window.VCLCALC_DATA;

const ROWS_BY_ROW = {};
FEE_ROWS.forEach(r => { ROWS_BY_ROW[r.row] = r; });

// ============================================================================
// Live exchange-rate support
// Currencies available from Frankfurter (ECB data): CZK, DKK, HUF, ISK,
// NOK, PLN, SEK, GBP, CHF.
// RSD (Serbia) is NOT published by ECB — static fallback from Excel is used.
// Rates are fetched once per calendar day and cached in localStorage.
// ============================================================================

// Current live rates (1 EUR = X local units). Populated asynchronously.
// Falls back to STATIC_FX_RATES from data.js while loading or on error.
let LIVE_FX = null;          // null = not yet loaded
let fxStatusEl = null;       // DOM element for status display, set later

const FX_CACHE_KEY = 'vclcalc_fx_rates';
const FX_FRANKFURTER_CURRENCIES = ['CZK','DKK','HUF','ISK','NOK','PLN','SEK','GBP','CHF'];

function todayISO() {
  return new Date().toISOString().slice(0,10);
}

function getEffectiveRate(cc) {
  // Returns the rate to use (1 EUR = X local units) for a given country code.
  const currency = (typeof CC_TO_CURRENCY !== 'undefined') ? CC_TO_CURRENCY[cc] : null;
  if (!currency) return null;
  // Try live rate first, then static fallback
  const liveRates = LIVE_FX || {};
  if (liveRates[currency]) return liveRates[currency];
  if (typeof STATIC_FX_RATES !== 'undefined' && STATIC_FX_RATES[cc]) return STATIC_FX_RATES[cc];
  return null;
}

async function loadLiveRates() {
  // 1. Check localStorage cache
  try {
    const cached = localStorage.getItem(FX_CACHE_KEY);
    if (cached) {
      const { date, rates } = JSON.parse(cached);
      if (date === todayISO()) {
        LIVE_FX = rates;
        updateFxStatus('live', date);
        applyLiveRatesToRows();
        return;
      }
    }
  } catch(e) { /* ignore parse errors */ }

  // 2. Fetch from Frankfurter (ECB data, CORS-enabled, no key needed)
  try {
    const symbols = FX_FRANKFURTER_CURRENCIES.join(',');
    const resp = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${symbols}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    // data.rates = { CZK: 24.3, DKK: 7.46, ... }
    LIVE_FX = data.rates;
    try {
      localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ date: todayISO(), rates: LIVE_FX }));
    } catch(e) { /* storage full or unavailable */ }
    updateFxStatus('live', data.date || todayISO());
  } catch(e) {
    // API unavailable — silently use static rates, note in UI
    LIVE_FX = {};
    updateFxStatus('static', null);
  }
  applyLiveRatesToRows();
}

function applyLiveRatesToRows() {
  // Rewrite F/G/H/I/J/K on every non-EUR row using the live rate.
  FEE_ROWS.forEach(r => {
    if (!r.currency) return;  // EUR country, nothing to do
    const rate = getEffectiveRate(r.cc);
    if (!rate) return;
    // Convert local amounts back to EUR using the live rate
    if (r.F_lc !== undefined && r.F_lc !== null) r.F = r.F_lc / rate;
    if (r.G_lc !== undefined && r.G_lc !== null) r.G = r.G_lc / rate;
    if (r.H_lc !== undefined && r.H_lc !== null) r.H = r.H_lc / rate;
    if (r.I_lc !== undefined && r.I_lc !== null) r.I = r.I_lc / rate;
    if (r.J_lc !== undefined && r.J_lc !== null) r.J = r.J_lc / rate;
    if (r.K_lc !== undefined && r.K_lc !== null) r.K = r.K_lc / rate;
  });
}

function updateFxStatus(source, date) {
  if (!fxStatusEl) return;
  if (source === 'live') {
    fxStatusEl.textContent = `Exchange rates: live (ECB, ${date})`;
    fxStatusEl.style.color = 'var(--accent)';
  } else {
    fxStatusEl.textContent = 'Exchange rates: from fee table (live rates unavailable)';
    fxStatusEl.style.color = 'var(--amber)';
  }
}

// ============================================================================
// Editable fee data
// Two layers sit between the shipped fee table and the numbers the engine
// reads, both applied once here -- before anything resolves a cell.
//
//  1. Admin overrides. Whatever was typed into the fee editor (wp-admin ->
//     Variation Toolbox -> Gebühren) arrives as window.VCLCALC_OVERRIDES and
//     wins over the value in this plugin's data file. Sparse: only edited
//     cells appear, so an untouched install behaves exactly as before.
//  2. Point-based schedules. Some authorities publish their fees as a point
//     count times a point value that is revised on its own schedule (Slovenia,
//     Article 18). Those rows carry F_pt..V_pt; the euro amounts are derived
//     from them, so points and point value are the only things to maintain.
//
// Countries billing in their own currency keep F_lc..V_lc as the authoritative
// amount -- the euro columns are FX snapshots. Editing a local amount therefore
// has to re-run the conversion, which is why applyLiveRatesToRows() is called
// again below whenever an override actually landed.
// ============================================================================
const AMOUNT_COLUMNS = ['F','G','H','I','J','K','T','U','V'];
const OVERRIDABLE = new Set(
  AMOUNT_COLUMNS.flatMap(c => [c, c + '_lc', c + '_pt'])
);

// The shipped values, kept aside before anything is overridden. Without them
// applyOverrides() could only ever add edits, never take one back -- which the
// fee editor needs, since it re-applies the whole (shrinking or growing) edit
// set on every keystroke to keep its live example honest.
const SHIPPED_AMOUNTS = FEE_ROWS.map(r => {
  const snap = {};
  OVERRIDABLE.forEach(f => { if (f in r) snap[f] = r[f]; });
  return snap;
});
const SHIPPED_POINT_VALUES = Object.assign({}, POINT_VALUES);

function applyOverrides() {
  const ov = window.VCLCALC_OVERRIDES;
  let touched = false;

  // Start from the shipped state every time, so this is idempotent.
  FEE_ROWS.forEach((r, i) => {
    const snap = SHIPPED_AMOUNTS[i];
    Object.keys(snap).forEach(f => { r[f] = snap[f]; });
  });
  if (POINT_VALUES) {
    Object.keys(POINT_VALUES).forEach(cc => { delete POINT_VALUES[cc]; });
    Object.assign(POINT_VALUES, SHIPPED_POINT_VALUES);
  }

  if (ov && typeof ov === 'object') {
    if (ov.points && POINT_VALUES) {
      Object.keys(ov.points).forEach(cc => {
        const v = Number(ov.points[cc]);
        if (Number.isFinite(v) && v > 0) { POINT_VALUES[cc] = v; touched = true; }
      });
    }
    if (ov.rows) {
      Object.keys(ov.rows).forEach(key => {
        const r = ROWS_BY_ROW[key];
        if (!r) return;
        const fields = ov.rows[key];
        if (!fields || typeof fields !== 'object') return;
        Object.keys(fields).forEach(f => {
          if (!OVERRIDABLE.has(f)) return;
          const raw = fields[f];
          if (raw === null || raw === '') { r[f] = null; touched = true; return; }
          const v = Number(raw);
          if (Number.isFinite(v)) { r[f] = v; touched = true; }
        });
      });
    }
  }

  applyPointValues();
  // Re-derive the euro columns from the local ones, but only when something was
  // actually overridden: doing it on an untouched install would replace the
  // workbook's own snapshots with values recomputed from the static rates --
  // the same numbers, but needless float drift.
  if (touched) applyLiveRatesToRows();
  return touched;
}

function applyPointValues() {
  if (!POINT_VALUES) return;
  FEE_ROWS.forEach(r => {
    const pv = POINT_VALUES[r.cc];
    if (!pv) return;
    AMOUNT_COLUMNS.forEach(c => {
      const pts = r[c + '_pt'];
      if (pts === undefined || pts === null) return;
      r[c] = Math.round(pts * pv * 100) / 100;
    });
  });
}

applyOverrides();

function cellRef(letter, row, state) {
  if (row === 2) return state.global[letter];
  const r = ROWS_BY_ROW[row];
  if (!r) return 0;
  if (['F','G','H','I','J','K','T','U','V'].includes(letter)) {
    const v = r[letter];
    return (v === null || v === undefined) ? 0 : v;
  }
  if (letter === 'L') {
    const v = state.L[row];
    return (v === undefined) ? null : v;
  }
  if (['M','N','O','P','Q','R'].includes(letter)) {
    const c = state.computed[row];
    return c && c[letter] !== undefined ? c[letter] : 0;
  }
  return 0;
}

// Translate one Excel formula string into a JS expression, then eval it
// in a tiny sandboxed function scope (IF/AND/OR helpers only).
function excelToJs(formula, state) {
  let f = formula.slice(1); // strip leading '='

  // ISBLANK(Lxx) -> boolean
  f = f.replace(/ISBLANK\(([A-Z]{1,2})(\d+)\)/g, (m, col, row) => {
    const v = cellRef(col, parseInt(row,10), state);
    return (v === null || v === undefined) ? 'true' : 'false';
  });

  // Plain cell refs like F4, G407, K396 etc.
  f = f.replace(/\b([A-Z]{1,2})(\d+)\b/g, (m, col, row) => {
    const v = cellRef(col, parseInt(row,10), state);
    return '(' + (v === null || v === undefined ? 0 : v) + ')';
  });

  // Excel "" -> JS ''
  f = f.replace(/""/g, "''");

  // IF( -> IF(   (kept, function call)
  // Excel "=" comparison -> JS "=="; protect existing <=,>=,<>
  f = f.replace(/<>/g, '!=');
  f = f.replace(/([^<>=!])=([^=])/g, '$1==$2');

  // AND(...) / OR(...) already valid as function calls if we provide helpers
  return f;
}

function IFx(cond, a, b) { return cond ? a : b; }
function ANDx(...args) { return args.every(Boolean); }
function ORx(...args) { return args.some(Boolean); }

function evalFormula(formula, state) {
  if (!formula) return null;
  const js = excelToJs(formula, state)
    .replace(/\bIF\(/g, 'IFx(')
    .replace(/\bAND\(/g, 'ANDx(')
    .replace(/\bOR\(/g, 'ORx(');
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('IFx','ANDx','ORx', `return (${js});`);
    const v = fn(IFx, ANDx, ORx);
    return v === '' ? '' : v;
  } catch (e) {
    console.error('Formula eval error:', formula, '->', js, e);
    return null;
  }
}

// Evaluate one fee-table row (M,N,O,P,Q,R,S) given current global inputs (M2/N2/O2)
// and the row's "No. of strengths" (L). Returns {M,N,O,P,Q,R,S}.
function evalRow(row, state) {
  const r = ROWS_BY_ROW[row];
  const computed = {};
  state.computed[row] = computed;
  [['M','Mf'],['N','Nf'],['O','Of'],['P','Pf'],['Q','Qf'],['R','Rf']].forEach(([col,key]) => {
    if (r[key]) {
      let v = evalFormula(r[key], state);
      if (v === '' || v === null) v = 0;
      computed[col] = v;
    }
  });
  let s = r.Sf ? evalFormula(r.Sf, state) : null;
  if (s === '') s = null;
  computed.S = s;
  return computed;
}

// Build a fresh state for a calculation run.
// globalCounts: {M, N, O} = total no. of IA / IB / II variations (mirrors M2/N2/O2)
// strengthsByRow: { rowId: numberOfStrengths }
function buildState(globalCounts, strengthsByRow) {
  return {
    global: globalCounts,
    L: strengthsByRow,
    computed: {}
  };
}

// ============================================================================
// Domain helpers
// ============================================================================

function rowsForCountry(cc) {
  return FEE_ROWS.filter(r => r.cc === cc);
}

function roleLabel(role) {
  // Bare abbreviations for RMS/CMS (user decision 2026-07-23) -- used in the
  // country-details role dropdown and the result cards alike.
  return { RMS: 'RMS', CMS: 'CMS', national: 'National procedure', EMA: 'Centralised procedure (EMA)' }[role] || role;
}

function typeLabel(t) {
  return { IA: 'Type IA', IB: 'Type IB', II: 'Type II' }[t] || t;
}

// The coloured IA/IB/II pill used all over the Toolbox (.badge.type-ia etc. in
// vcl-style.css) -- own classes here so the calculator also renders it standalone.
function typePillHTML(t) {
  const cls = { IA: 'type-pill--ia', IB: 'type-pill--ib', II: 'type-pill--ii' }[t];
  return cls ? `<span class="type-pill ${cls}">${t}</span>` : '';
}

// Used to pick which type's grouping-fee rate to display when more than
// one item has one (should be rare in practice, since a lower type is
// normally already subsumed by a higher one — this is a safety-net tiebreak).
const TYPE_PRIORITY = { II: 3, IB: 2, IA: 1 };

// Short role labels for the Excel export (the full "RMS (Reference Member
// State)" style labels used in the on-screen breakdown are too long for a
// spreadsheet column).
const EXCEL_ROLE_LABELS = { RMS: 'RMS', CMS: 'CMS', national: 'National procedure', EMA: 'Centralised procedure' };

// Excel number formats, always comma thousands separator + exactly two
// decimal places, matching the online calculator's own number formatting.
// EUR/GBP get a symbol prefix; the rest get a currency-code suffix (avoids
// relying on less common currency symbols rendering correctly everywhere).
const EXCEL_CURRENCY_FORMATS = {
  EUR: '"€"#,##0.00',
  GBP: '"£"#,##0.00',
  CZK: '#,##0.00" CZK"',
  DKK: '#,##0.00" DKK"',
  HUF: '#,##0.00" HUF"',
  ISK: '#,##0.00" ISK"',
  NOK: '#,##0.00" NOK"',
  PLN: '#,##0.00" PLN"',
  SEK: '#,##0.00" SEK"',
  RSD: '#,##0.00" RSD"',
  CHF: '#,##0.00" CHF"',
};

function fmtEUR(v) {
  if (v === null || v === undefined || v === '') return '–';
  return new Intl.NumberFormat('en-IE', { style:'currency', currency:'EUR', minimumFractionDigits:2, maximumFractionDigits:2 }).format(v);
}

// Decimal places per currency (0 for HUF and ISK, 2 for all others)
const CURRENCY_DECIMALS = { HUF: 0, ISK: 0 };

function fmtLocalCurrency(amount, currencyCode) {
  if (amount === null || amount === undefined) return '–';
  const dec = CURRENCY_DECIMALS[currencyCode] !== undefined ? CURRENCY_DECIMALS[currencyCode] : 2;
  return new Intl.NumberFormat('en-IE', {
    style: 'currency', currency: currencyCode,
    minimumFractionDigits: dec, maximumFractionDigits: dec
  }).format(amount);
}

function fmtRate(rate, currencyCode) {
  // Display: "1 EUR = X.XX CZK"
  const dec = CURRENCY_DECIMALS[currencyCode] !== undefined ? 0 : 4;
  return '1 EUR = ' + new Intl.NumberFormat('en-IE', {
    minimumFractionDigits: dec, maximumFractionDigits: dec
  }).format(rate) + ' ' + currencyCode;
}

// Returns the available roles for a country, in a fixed display order.
function rolesForCountry(cc) {
  const rows = rowsForCountry(cc);
  const order = ['RMS','CMS','national','EMA'];
  const present = new Set(rows.map(r => r.role));
  return order.filter(r => present.has(r));
}

// Returns the rows for a country+role+type, so we can see what special-case
// variants exist for that combination (used to offer a per-country special
// picker only where it's actually meaningful).
function rowsFor(cc, role, type) {
  return FEE_ROWS.filter(r => r.cc === cc && r.role === role && r.type === type);
}

// Picks the best-matching row for a country+role+type given a preferred
// special-case label (which the user chose globally). Falls back to the
// plain/standard row (no special) if the preferred label doesn't exist for
// this country, and finally to the first available row of that type if
// there isn't an unambiguous "standard" row either (e.g. Denmark, where
// every row has some special label).
function resolveRow(cc, role, type, preferredSpecial) {
  const candidates = rowsFor(cc, role, type);
  if (candidates.length === 0) return null;
  if (preferredSpecial) {
    const match = candidates.find(r => r.special === preferredSpecial);
    if (match) return match;
  }
  const standard = candidates.find(r => !r.special);
  if (standard) return standard;
  return candidates[0];
}

// ============================================================================
// Application state & wizard
// ============================================================================

const STEPS = ['Countries', 'Country details', 'Variations', 'Result'];

const appState = {
  step: 0,
  selectedCountries: [],     // array of country codes, in selection order
  countrySearch: '',
  // per-country config: { [cc]: { role: 'RMS', strengths: 1, specialByType: { IA: null, IB: null, II: 'complex' } } }
  countryConfig: {},
  // global variations: how many of each type are being filed, applied to
  // every selected country (mirrors M2/N2/O2 in the original sheet)
  globalCounts: { IA: 0, IB: 0, II: 0 },
  // Set when the Guide's Summary hands counts over, and shown on the Countries step -- without
  // it the hand-off is invisible until the user has walked two steps to the Variations counters,
  // which is indistinguishable from the button not having worked.
  prefillNote: null,
  // Which classification-exception hint lists are expanded in the special-cases panel
  // (keyed "cc|type|label") -- survives the panel's re-renders.
  specialHintOpen: {},
  // Which result-card status chips (cap / grouping / local currency) are expanded
  // (keyed "cc|kind") -- survives re-renders of the result step.
  resultChipOpen: {},
  // Result step: 'eur' or 'local' -- the EUR/local-currency toggle above the list.
  resultCurrencyMode: 'eur',
  // Which per-type result rows are expanded to their individual variations (keyed "cc|type").
  resultExpanded: {},
  // Result overview table sort: empty key keeps the natural order (RMS first, then alphabetical).
  resultOverviewSort: { key: '', dir: 1 },
  // Country details step: one "number of authorised strengths" that every country follows, so a
  // 20-country procedure does not have to be clicked through country by country. The value is
  // written straight into countryConfig[cc].strengths -- the single source the fee calculation
  // reads; strengthsManual only remembers WHICH countries the user gave their own number, so
  // those are the ones a later change of the default leaves alone. Keyed by country code.
  strengthsDefault: 1,
  strengthsManual: {},
  results: null
};

// ---- Classification-exception hints ----
// Which classification codes qualify for a country's special-case fee, keyed
// "cc|type|special label". Shown as an expandable list under that country's card in the
// special-cases panel -- purely informational; the fee itself stays whatever special
// the user picks in the dropdown above. Codes use the CURRENT classification and are
// resolved to their descriptions at runtime against the Toolbox's own classification
// data (window.VCL_DATA), sub-variants included. An optional buttonLabel overrides the
// special label in the toggle button text; several keys may share ONE hint object
// (e.g. DK complex applies to IB and II alike) -- the panel renders shared objects once.
// FR list transcribed from the official Décret no 2025-1445 du 31/12/2025 (JO of
// 1 Jan 2026, texte 41; applies to applications filed from 15 Jan 2026; replaces
// Décret 2019-388): Type IA variations are free of the ANSM registration fee EXCEPT
// these -- which therefore carry the "Type IA exemptions" fee row (EUR 2,500).
// DK list transcribed from the Danish Medicines Agency's fee guidance ("complex
// variations" examples; DK's own "B.I.z"-style shorthand mapped to the current
// classification -- the guidance's Q.I.z has no counterpart and is left out, user
// decision 2026-07-23). Same fee row for IB and II, hence one shared object.
// TODO: move to the Excel -> convert.py path once a normalised "Classification
// exceptions" sheet exists -- then LT etc. join without touching this file.
const DK_COMPLEX_HINT = {
  buttonLabel: 'Complex variations',
  codes: [
    'Q.I.a.1.f', 'Q.I.a.1.b', 'Q.I.a.1.d', 'Q.I.a.2.b', 'Q.I.a.3.c', 'Q.I.a.5',
    'Q.II.a.3.b.2', 'Q.II.a.3.b.3', 'Q.II.a.z', 'Q.II.d.3',
    'Q.I.e.1.a', 'Q.II.g.1.a', 'Q.I.e.2', 'Q.II.g.2',
    'Q.II.b.1.c', 'Q.II.b.3.b', 'Q.II.b.4.c', 'C.4',
  ],
  source: {
    text: 'Danish Medicines Agency — Guidance for companies (fees)',
    url: 'https://laegemiddelstyrelsen.dk/en/licensing/fees/guidance-for-companies-/',
  },
};
// IE list transcribed from the HPRA "Guide to Fees for Human Products"
// (FIN-G0002-37), Appendix "List of Complex Variations" -- already in the current
// Q-classification. Applies to Type II ("complex" and "complex - reduced" share
// this one object -> one button). A code entry may be {code, extra} where extra
// is an HPRA precision appended after the classification description (C.4's
// SmPC sections); the optional note renders as an italic line above the source.
const IE_COMPLEX_HINT = {
  buttonLabel: 'Complex variations',
  codes: [
    'Q.I.a.1.b', 'Q.I.a.1.d', 'Q.I.a.1.f', 'Q.I.a.2.b',
    'Q.I.e.1.a', 'Q.I.e.2', 'Q.I.e.6',
    'Q.II.a.3.b.2', 'Q.II.a.3.b.3', 'Q.II.a.5', 'Q.II.b.3.b', 'Q.II.c.3.c',
    'Q.II.d.3', 'Q.II.e.1.b.2', 'Q.II.g.1.a', 'Q.II.g.2', 'Q.II.g.6',
    { code: 'C.4', extra: 'SmPC sections 4.2, 4.3 or 5.1' },
    'C.6.a',
  ],
  note: 'Note (HPRA): the complex fee is not charged for a modification of an approved indication (C.6.a); other categories of variations with substantial changes may be considered complex case-by-case.',
  source: {
    text: 'HPRA — Guide to Fees for Human Products (FIN-G0002-37), Appendix: List of Complex Variations',
    url: 'https://assets.hpra.ie/data/docs/default-source/external-guidance-document/fin-g0002-guide-to-fees-for-human-products-v37.pdf?sfvrsn=dd51febb_51',
  },
};
const SPECIAL_CODE_HINTS = {
  'FR|IA|Type IA exemptions': {
    codes: [
      'C.3.a', 'Q.I.a.3.a', 'Q.I.b.1.c', 'Q.I.b.2.h', 'Q.I.d.1.a.5', 'Q.I.d.1.b.1',
      'Q.I.d.1.c', 'Q.I.e.5.b', 'Q.II.b.1.b', 'Q.II.c.1.b', 'Q.II.d.1.c',
      'Q.II.f.1.a.1', 'Q.II.f.1.b.1', 'Q.II.g.5.b', 'Q.III.1.a.1', 'Q.III.1.a.2', 'Q.IV.1.a',
    ],
    source: {
      text: 'Décret n° 2025-1445 du 31/12/2025 (JO 01/01/2026), applicable to applications filed from 15/01/2026',
      url: 'https://www.legifrance.gouv.fr/download/pdf?id=rTBlMhYaksAKNHFY-s19Qb3QdemZfdsvuyg_hvSsm3I=',
    },
  },
  'DK|IB|quality, complex (Q)': DK_COMPLEX_HINT,
  'DK|II|quality, complex (Q)': DK_COMPLEX_HINT,
  'IE|II|complex': IE_COMPLEX_HINT,
  'IE|II|complex - reduced': IE_COMPLEX_HINT,
};

// Resolve a classification code to its description via the Toolbox's classification
// data: exact entry code first, otherwise entry + variant id (the variant tail loses
// its dots: "Q.I.d.1.b.1" -> entry "Q.I.d.1", variant "b1"). Returns null when the
// code is not in the current classification -- callers show it flagged, not hidden.
function classificationTitleFor(code) {
  const entries = (window.VCL_DATA && window.VCL_DATA.ENTRIES) || [];
  let e = entries.find(x => x.code === code);
  if (e) return { title: e.title, variant: null };
  const parts = code.split('.');
  for (let cut = parts.length - 1; cut >= 2; cut--) {
    const base = parts.slice(0, cut).join('.');
    e = entries.find(x => x.code === base);
    if (e) {
      const vid = parts.slice(cut).join('.').replace(/\./g, '');
      const v = (e.variants || []).find(x => String(x.id) === vid);
      return v ? { title: e.title, variant: v.label || vid } : null;
    }
  }
  return null;
}

// Optional pre-fill from a companion tool (e.g. the Variation Toolbox's
// "Export to Fee Calculator" button) via URL query params ?ia=&ib=&ii= -- only seeds the
// Variations step's counters; the user still walks through Countries and Country details
// themselves before reaching them.
(function prefillFromQueryParams() {
  const params = new URLSearchParams(window.location.search);
  ['IA', 'IB', 'II'].forEach((type) => {
    const raw = params.get(type.toLowerCase());
    const val = raw === null ? NaN : parseInt(raw, 10);
    if (Number.isInteger(val) && val >= 0) appState.globalCounts[type] = val;
  });
})();

// Same hand-off, in memory, for the Guide that this calculator is embedded in: its Summary's
// "Export to Variation Fee Calculator" button calls this before switching to the calculator
// view. Deliberately does NOT jump to the Variations step -- the counts apply to every selected
// country, so Countries and Country details still have to be answered first; the user walks the
// same path and simply finds step 3 already filled in.
window.VCLCALC = {
  // Country universe + the fee roles each country supports, for tools that need to build a
  // procedure at country level (e.g. the Guided Workflow). Derived from the same fee data the
  // calculator itself uses, so it stays in sync. Shape: [{ cc, name, roles:['RMS','CMS',...] }].
  countries() {
    return Object.keys(COUNTRY_NAMES)
      .map((cc) => ({ cc, name: COUNTRY_NAMES[cc], roles: rolesForCountry(cc) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  },
  // Pure fee computation for an explicit set of countries + type counts, without touching the
  // wizard's own state. Used by the Guided Workflow to price one procedure at country level.
  // input: { countries: [{ cc, role, strengths?, special? }], counts: {IA,IB,II} }.
  // Returns { countries: [countryResult...], grandTotal } in EUR (each countryResult also
  // carries currency/fxRate/totalLocal). Goes through computeCountryResult -- the same code the
  // calculator uses -- so results match the standalone tool exactly.
  // Re-applies window.VCLCALC_OVERRIDES on top of the shipped fee table. The fee
  // editor calls this after every change so its live example is priced by the
  // same engine the site uses, with the amounts currently in the form.
  applyOverrides() { return applyOverrides(); },
  // The fee table as this plugin build ships it, before any override. The editor
  // needs it to tell an edit from an untouched value -- it cannot read that off
  // the rows themselves, since applyOverrides() has already rewritten those.
  // Shape: { rows: { '<rowNo>': { F: 1234, F_lc: null, ... } }, points: { cc: v } }.
  shippedFees() {
    const rows = {};
    FEE_ROWS.forEach((r, i) => { rows[r.row] = Object.assign({}, SHIPPED_AMOUNTS[i]); });
    return { rows, points: Object.assign({}, SHIPPED_POINT_VALUES) };
  },
  computeFees(input) {
    const counts = { IA: 0, IB: 0, II: 0 };
    if (input && input.counts) ['IA', 'IB', 'II'].forEach((t) => { counts[t] = Math.max(0, parseInt(input.counts[t], 10) || 0); });
    const list = (input && input.countries) || [];
    const results = list.map((c) => computeCountryResult(
      c.cc,
      { role: c.role, strengths: Math.max(1, parseInt(c.strengths, 10) || 1), specialByType: c.special || { IA: null, IB: null, II: null } },
      counts
    ));
    const grandTotal = results.reduce((acc, cr) => acc + (cr.total || 0), 0);
    return { countries: results, grandTotal };
  },
  setGlobalCounts(counts) {
    const parts = [];
    ['IA', 'IB', 'II'].forEach((type) => {
      const n = Math.max(0, parseInt(counts && counts[type], 10) || 0);
      appState.globalCounts[type] = n;
      if (n > 0) parts.push(`${n} × Type ${type}`);
    });
    appState.prefillNote = parts.length ? parts.join(' · ') : null;
    appState.step = 0;
    appState.results = null;
    render();
  }
};

function ensureCountryConfig(cc) {
  if (!appState.countryConfig[cc]) {
    const roles = rolesForCountry(cc);
    // Default to CMS if available (most common use case), otherwise first available role
    const defaultRole = roles.includes('CMS') ? 'CMS' : (roles[0] || 'RMS');
    appState.countryConfig[cc] = {
      role: defaultRole,
      strengths: 1,
      specialByType: { IA: null, IB: null, II: null }
    };
  }
  return appState.countryConfig[cc];
}

const railEl = document.getElementById('vclcalc-rail');
const contentEl = document.getElementById('vclcalc-stepContent');
fxStatusEl = document.getElementById('vclcalc-fxStatus'); // set the module-level variable

// Kick off the rate fetch now that fxStatusEl is bound (non-blocking). Doing
// this any earlier means a same-day cache hit — which updates the status
// text synchronously, with no intervening await — would silently run before
// fxStatusEl exists, leaving the status line blank until the next full page
// load happens to be a cache miss.
loadLiveRates();

// Populate the "last updated" date from the Imprint sheet. When embedded in the
// Variation Toolbox the calculator's own header is dropped, so also expose the date
// on window.VCLCALC_META for the guide-rendered view heading to use as a fallback.
(function() {
  if (typeof IMPRINT !== 'undefined' && IMPRINT.length > 0) {
    const dateStr = formatImprintDate(IMPRINT[0].date);
    window.VCLCALC_META = { lastUpdated: dateStr };
    const tagEl = document.getElementById('vclcalc-headerTag');
    if (tagEl) tagEl.textContent = `last updated: ${dateStr}`;
  }
})();

function setStep(n) {
  appState.step = n;
  render();
  // Jump the toolbox heading of the new step back into view. Prefer the host's shared scroll
  // (lands the masthead just under the site's fixed nav, same as the top nav / Classification);
  // fall back to the calculator container when the calculator runs standalone (dev harness).
  if (window.VCL_APP && window.VCL_APP.scrollToTop) {
    window.VCL_APP.scrollToTop();
  } else {
    const appEl = document.getElementById('vclcalc-app');
    if (appEl) {
      const top = appEl.getBoundingClientRect().top + window.pageYOffset - 20;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }
}

function renderRail() {
  railEl.innerHTML = STEPS.map((label, i) => {
    let cls = 'rail-step';
    const isDone = i < appState.step;
    const isActive = i === appState.step;
    if (isActive) cls += ' active';
    else if (isDone) cls += ' done clickable';
    const inner = `<span class="n">${isDone ? '✓' : i+1}</span><span class="label">${label}</span>`;
    // Wrap done steps in a button so they are keyboard-accessible and clearly interactive
    return isDone
      ? `<button class="${cls}" data-goto="${i}" title="Back to: ${label}">${inner}</button>`
      : `<div class="${cls}">${inner}</div>`;
  }).join('');

  railEl.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => setStep(parseInt(btn.dataset.goto, 10)));
  });
}

// Country tile display name: composite codes ("DE - BfArM") already carry the authority in
// the code line, so the name drops its "(BfArM)"-style suffix to keep the tile compact.
function tileName(cc) {
  const n = COUNTRY_NAMES[cc] || cc;
  return /^[A-Za-z]{2}\s*[-–]/.test(cc) ? n.replace(/\s*\([^)]*\)\s*$/, '') : n;
}

// Change history + HA-websites info panels. Shown at the bottom of every calculator step (not just
// the result), so the fee-data provenance and the HA links are reachable from anywhere in the flow.
// Only one step renders at a time (contentEl.innerHTML is replaced), so the fixed IDs stay unique.
function calcInfoPanelsHtml() {
  return `
    ${(typeof IMPRINT !== 'undefined' && IMPRINT.length > 0) ? `
    <div class="panel" style="margin-bottom:18px;">
      <button class="btn ghost" id="vclcalc-toggleChangelog" style="padding-left:0;">📋 View change history (${IMPRINT.length} entries)</button>
      <div id="vclcalc-changelogPanel" style="display:none; margin-top:14px;"></div>
    </div>
    ` : ''}
    ${(typeof HA_WEBSITES !== 'undefined' && HA_WEBSITES.length > 0) ? `
    <div class="panel" style="margin-bottom:18px;">
      <button class="btn ghost" id="vclcalc-toggleHaWebsites" style="padding-left:0;">🔗 Update status and link to HA websites (${HA_WEBSITES.length} entries)</button>
      <div id="vclcalc-haWebsitesPanel" style="display:none; margin-top:14px;"></div>
    </div>
    ` : ''}
  `;
}

// Wires the toggles produced by calcInfoPanelsHtml(). Call after each step sets contentEl.innerHTML.
function wireCalcInfoPanels() {
  const changelogBtn = document.getElementById('vclcalc-toggleChangelog');
  if (changelogBtn) {
    changelogBtn.addEventListener('click', () => {
      const panel = document.getElementById('vclcalc-changelogPanel');
      const isOpen = panel.style.display !== 'none';
      if (isOpen) {
        panel.style.display = 'none';
        changelogBtn.textContent = `📋 View change history (${IMPRINT.length} entries)`;
      } else {
        panel.innerHTML = renderChangelogList();
        panel.style.display = '';
        changelogBtn.textContent = `📋 Hide change history`;
      }
    });
  }
  const haWebsitesBtn = document.getElementById('vclcalc-toggleHaWebsites');
  if (haWebsitesBtn) {
    haWebsitesBtn.addEventListener('click', () => {
      const panel = document.getElementById('vclcalc-haWebsitesPanel');
      const isOpen = panel.style.display !== 'none';
      if (isOpen) {
        panel.style.display = 'none';
        haWebsitesBtn.textContent = `🔗 Update status and link to HA websites (${HA_WEBSITES.length} entries)`;
      } else {
        panel.innerHTML = renderHaWebsitesList();
        panel.style.display = '';
        haWebsitesBtn.textContent = `🔗 Hide update status and link to HA websites`;
      }
    });
  }
}

// ---- Step 0: select one or more countries ----
function renderStepCountries() {
  const codes = Object.keys(COUNTRY_NAMES).sort((a,b) => COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b],'en'));
  const q = appState.countrySearch.trim().toLowerCase();
  const filtered = codes.filter(c => !q || COUNTRY_NAMES[c].toLowerCase().includes(q) || c.toLowerCase().includes(q));
  const n = appState.selectedCountries.length;

  contentEl.innerHTML = `
    <div class="panel">
      <h2>Which countries is the variation being submitted in?</h2>
      <p class="hint">Select one or more markets. You'll set the procedure role and number of strengths for each country next, then choose the variations once — they'll apply to every selected country.</p>
      ${appState.prefillNote ? `<div class="prefill-note"><strong>Taken over from your summary:</strong> ${appState.prefillNote}. You can still adjust the numbers at the Variations step.</div>` : ''}
      <div style="display:flex; gap:8px; margin-bottom:10px; align-items:center; flex-wrap:wrap;">
        <input type="text" class="country-search" id="vclcalc-countrySearch" placeholder="Search for a country…" value="${appState.countrySearch}" style="flex:1; min-width:180px; margin-bottom:0;">
        <button class="btn ghost" id="vclcalc-selectAll" style="white-space:nowrap;">Select all</button>
        <button class="btn ghost" id="vclcalc-resetSelection" ${n===0?'disabled':''} style="white-space:nowrap;">Reset</button>
      </div>
      <div class="country-grid" id="vclcalc-countryGrid">
        ${filtered.map(c => `
          <button class="country-tile ${appState.selectedCountries.includes(c)?'selected':''}" data-cc="${c}">
            <span class="cc">${c}</span>
            <span class="cn">${tileName(c)}</span>
          </button>
        `).join('')}
      </div>
    </div>
    ${calcInfoPanelsHtml()}
    <div class="nav-row">
      <span class="hint" style="margin:0;">${n} countr${n===1?'y':'ies'} selected</span>
      <button class="btn primary" id="vclcalc-toStep2" ${n===0?'disabled':''}>Continue</button>
    </div>
  `;

  document.getElementById('vclcalc-countrySearch').addEventListener('input', (e) => {
    appState.countrySearch = e.target.value;
    renderStepCountries();
  });

  document.getElementById('vclcalc-selectAll').addEventListener('click', () => {
    codes.forEach(c => {
      if (!appState.selectedCountries.includes(c)) {
        appState.selectedCountries.push(c);
        ensureCountryConfig(c);
      }
    });
    renderStepCountries();
  });

  document.getElementById('vclcalc-resetSelection').addEventListener('click', () => {
    appState.selectedCountries = [];
    appState.countryConfig = {};
    // The per-country strengths are gone with countryConfig, so the record of which of them
    // were hand-set has to go too -- otherwise a re-picked country would still count as manual.
    appState.strengthsManual = {};
    renderStepCountries();
  });

  contentEl.querySelectorAll('.country-tile').forEach(btn => {
    btn.addEventListener('click', () => {
      const cc = btn.dataset.cc;
      const idx = appState.selectedCountries.indexOf(cc);
      if (idx === -1) {
        appState.selectedCountries.push(cc);
        ensureCountryConfig(cc);
      } else {
        appState.selectedCountries.splice(idx, 1);
        delete appState.countryConfig[cc];
      }
      renderStepCountries();
    });
  });
  document.getElementById('vclcalc-toStep2').addEventListener('click', () => setStep(1));
  wireCalcInfoPanels();
}

// ---- Step 1: per-country role + strengths ----
function renderStepCountryDetails() {
  contentEl.innerHTML = `
    <div class="panel">
      <h2>Procedure role &amp; strengths per country</h2>
      <p class="hint">Choose the applicable procedure role and the number of authorised strengths for each country — these can differ from country to country (e.g. one country may have 2 authorised strengths where another only has 1).</p>
      <div class="strength-default">
        <div class="strength-default__head">Strengths for all countries</div>
        <p class="strength-default__sub">Applies to every country below. Give a single country its own number afterwards and it keeps that number, even if you change this default again.</p>
        <div class="strength-default__row">
          <div>
            <span class="field-label" style="margin-bottom:6px;">Number of authorised strengths</span>
            ${stepperHTML('strengthsDefault', appState.strengthsDefault, 1, 99)}
          </div>
          <button type="button" class="strength-default__reset" id="vclcalc-strengthsReset">&#8634; Reset all to default</button>
        </div>
        <p class="strength-default__note" id="vclcalc-strengthsNote"></p>
      </div>
      <div id="vclcalc-countryDetailList"></div>
    </div>
    ${calcInfoPanelsHtml()}
    <div class="nav-row">
      <button class="btn primary" id="vclcalc-back1">← Back</button>
      <button class="btn primary" id="vclcalc-toStep3">Continue</button>
    </div>
  `;

  const list = document.getElementById('vclcalc-countryDetailList');
  // Two columns of country cards: 33 countries used to be 33 full-width rows of scrolling.
  list.className = 'vc-ccgrid';
  const noteEl = document.getElementById('vclcalc-strengthsNote');
  const resetBtn = document.getElementById('vclcalc-strengthsReset');
  const sortedCCs = [...appState.selectedCountries]
    .sort((a, b) => COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b], 'en'));

  // A country follows the default until the user gives it a number of its own; from then on it
  // is listed in strengthsManual and the default leaves it alone. Writing straight into
  // countryConfig keeps the fee calculation reading the one field it always read.
  function applyDefaultToFollowers() {
    sortedCCs.forEach(cc => {
      if (appState.strengthsManual[cc]) return;
      ensureCountryConfig(cc).strengths = appState.strengthsDefault;
      const input = list.querySelector(`[data-field-input="strengths_${cc}"]`);
      if (input) input.value = appState.strengthsDefault;
      const card = list.querySelector(`.row-card[data-cc="${cc}"]`);
      if (card) card.classList.remove('has-own-strengths');
    });
  }

  function refreshStrengthMeta() {
    const n = sortedCCs.filter(cc => appState.strengthsManual[cc]).length;
    resetBtn.disabled = n === 0;
    noteEl.textContent = n === 0
      ? `All ${sortedCCs.length} countries follow the default of ${appState.strengthsDefault} ` +
        (appState.strengthsDefault === 1 ? 'strength.' : 'strengths.')
      : `${n} of ${sortedCCs.length} countries ${n === 1 ? 'has' : 'have'} its own number ` +
        'and keeps it when you change the default.';
  }

  list.innerHTML = sortedCCs.map(cc => {
    const cfg = ensureCountryConfig(cc);
    const roles = rolesForCountry(cc);
    const own = appState.strengthsManual[cc] ? ' has-own-strengths' : '';
    return `
      <div class="row-card active${own}" data-cc="${cc}">
        <div class="row-card-top">
          <div class="row-card-title" style="flex:1;">
            <span class="t1">${COUNTRY_NAMES[cc]} <span class="badge">${cc}</span></span>
          </div>
        </div>
        <div class="row-card-body">
          <div>
            <span class="field-label" style="margin-bottom:6px;">Procedure role</span>
            <select class="field-select" data-role-select="${cc}">
              ${roles.map(r => `<option value="${r}" ${cfg.role===r?'selected':''}>${roleLabel(r)}</option>`).join('')}
            </select>
          </div>
          <div>
            <span class="field-label" style="margin-bottom:6px;">Strengths</span>
            ${stepperHTML('strengths_'+cc, cfg.strengths, 1, 99)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-role-select]').forEach(sel => {
    sel.addEventListener('change', () => {
      const cc = sel.dataset.roleSelect;
      ensureCountryConfig(cc).role = sel.value;
    });
  });
  bindRowSteppers(list, (field, value) => {
    const cc = field.split('_').slice(1).join('_');
    ensureCountryConfig(cc).strengths = value;
    // Landing back on the default is not a deviation -- the country rejoins the group and will
    // follow the default again, which is what makes the reset button reach a genuinely clean state.
    if (value === appState.strengthsDefault) delete appState.strengthsManual[cc];
    else appState.strengthsManual[cc] = true;
    const card = list.querySelector(`.row-card[data-cc="${cc}"]`);
    if (card) card.classList.toggle('has-own-strengths', !!appState.strengthsManual[cc]);
    refreshStrengthMeta();
  });

  bindRowSteppers(document.querySelector('.strength-default'), (field, value) => {
    if (field !== 'strengthsDefault') return;
    appState.strengthsDefault = value;
    applyDefaultToFollowers();
    refreshStrengthMeta();
  });

  resetBtn.addEventListener('click', () => {
    appState.strengthsManual = {};
    applyDefaultToFollowers();
    refreshStrengthMeta();
  });

  applyDefaultToFollowers();
  refreshStrengthMeta();

  document.getElementById('vclcalc-back1').addEventListener('click', () => setStep(0));
  document.getElementById('vclcalc-toStep3').addEventListener('click', () => setStep(2));
  wireCalcInfoPanels();
}

// ---- Step 2: global variations (type + count), with optional per-country special override ----
function renderStepVariations() {
  contentEl.innerHTML = `
    <div class="panel">
      <h2>Which variations are being filed?</h2>
      <p class="hint">Set how many variations of each type are part of this submission. This applies the same way to every selected country.</p>
      <div id="vclcalc-typeCounters"></div>
    </div>
    <div class="panel special-panel" id="vclcalc-specialPanel" style="display:none;">
      <h2 style="margin-bottom:4px;">Special cases</h2>
      <p class="hint">Some countries distinguish between several variants of the same type (e.g. "simple" vs "complex"). Where that applies, pick the variant per type below — countries without that distinction automatically use their standard fee.</p>
      <div id="vclcalc-specialBlocks"></div>
    </div>
    ${calcInfoPanelsHtml()}
    <div class="nav-row">
      <button class="btn primary" id="vclcalc-back2">← Back</button>
      <button class="btn primary" id="vclcalc-toResult" ${totalVariationCount()===0?'disabled':''}>Calculate fees</button>
    </div>
  `;

  const counters = document.getElementById('vclcalc-typeCounters');
  counters.className = 'vc-typegrid';
  counters.innerHTML = ['IA','IB','II'].map(type => `
    <div class="vc-typecard${appState.globalCounts[type] === 0 ? ' vc-typecard--zero' : ''}" data-typecard="${type}">
      <div class="vc-typecard__t">${typeLabel(type)} ${typePillHTML(type)}</div>
      ${stepperHTML('global_'+type, appState.globalCounts[type], 0, 99)}
    </div>
  `).join('');
  bindRowSteppers(counters, (field, value) => {
    const type = field.split('_')[1];
    appState.globalCounts[type] = value;
    const card = counters.querySelector(`[data-typecard="${type}"]`);
    if (card) card.classList.toggle('vc-typecard--zero', value === 0);
    updateResultButtonState();
    renderSpecialPanel();
  });

  renderSpecialPanel();
  document.getElementById('vclcalc-back2').addEventListener('click', () => setStep(1));
  document.getElementById('vclcalc-toResult').addEventListener('click', () => {
    computeResult();
    setStep(3);
  });
  wireCalcInfoPanels();
}

function totalVariationCount() {
  return appState.globalCounts.IA + appState.globalCounts.IB + appState.globalCounts.II;
}

function updateResultButtonState() {
  const btn = document.getElementById('vclcalc-toResult');
  if (btn) btn.disabled = totalVariationCount() === 0;
}

// For a given type, find which selected countries have more than one
// variant (i.e. a real choice to make), and what those variants are.
function specialChoicesForType(type) {
  const result = []; // { cc, role, options: [specialLabel,...] }
  appState.selectedCountries.forEach(cc => {
    const cfg = ensureCountryConfig(cc);
    const candidates = rowsFor(cc, cfg.role, type);
    if (candidates.length <= 1) return;
    // Worksharing variants stay out of the classic calculator's special-case picker --
    // they belong to the Guided Workflow's worksharing path (user decision 2026-07-22).
    const labels = candidates.map(r => r.special).filter(Boolean).filter(l => !/worksharing/i.test(l));
    if (labels.length === 0) return; // only one unlabelled row, nothing to choose
    result.push({ cc, role: cfg.role, options: labels, hasStandard: candidates.some(r => !r.special) });
  });
  return result;
}

function renderSpecialPanel() {
  const panel = document.getElementById('vclcalc-specialPanel');
  const blocks = document.getElementById('vclcalc-specialBlocks');
  if (!panel || !blocks) return;

  const activeTypes = ['IA','IB','II'].filter(t => appState.globalCounts[t] > 0);
  const sections = [];

  activeTypes.forEach(type => {
    const choices = specialChoicesForType(type);
    if (choices.length === 0) return;
    sections.push({ type, choices });
  });

  if (sections.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';

  // Regroup type-first into country-first: one card per country, one row per type with a
  // real choice (user decision 2026-07-23, mockup "B"). Each country appears exactly once,
  // and a hint list shared between types (DK complex: IB + II) renders one single button.
  const choicesByType = {};
  sections.forEach(({type, choices}) => { choicesByType[type] = choices; });
  const cards = [];
  appState.selectedCountries.forEach(cc => {
    const rows = [];
    sections.forEach(({type}) => {
      const hit = choicesByType[type].find(c => c.cc === cc);
      if (hit) rows.push({ type, options: hit.options, hasStandard: hit.hasStandard });
    });
    if (rows.length) cards.push({ cc, rows });
  });

  blocks.innerHTML = cards.map(({cc, rows}) => {
    const cfg = ensureCountryConfig(cc);
    // One hint button per distinct hint object -- keys sharing an object collapse to one.
    const seenHints = [];
    const hintRefs = [];
    rows.forEach(({type, options}) => {
      options.forEach(label => {
        const hint = SPECIAL_CODE_HINTS[cc + '|' + type + '|' + label];
        if (hint && seenHints.indexOf(hint) === -1) { seenHints.push(hint); hintRefs.push({ type, label }); }
      });
    });
    // One table per country: type, how many variations it covers, and the variant --
    // three columns the eye can follow, instead of a pill and a select at opposite edges.
    return `
      <div class="sp-card">
        <div class="sp-card__head">${COUNTRY_NAMES[cc]} <span class="badge">${cc}</span></div>
        <table class="sp-tbl">
          <thead><tr><th style="width:90px;">Type</th><th>Applies to</th><th>Variant</th></tr></thead>
          <tbody>
            ${rows.map(({type, options, hasStandard}) => {
              const current = cfg.specialByType[type] || '';
              const n = appState.globalCounts[type] || 0;
              return `
                <tr>
                  <td>${typePillHTML(type)}</td>
                  <td class="sp-scope">${n} variation${n === 1 ? '' : 's'}</td>
                  <td>
                    <select class="field-select" data-special-select="${cc}|${type}">
                      ${hasStandard ? `<option value="" ${current===''?'selected':''}>Standard</option>` : ''}
                      ${options.map(o => `<option value="${o}" ${current===o?'selected':''}>${o}</option>`).join('')}
                    </select>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
        ${hintRefs.map(h => `<div class="sp-hint">${specialHintHTML(cc, h.type, h.label)}</div>`).join('')}
      </div>`;
  }).join('');

  blocks.querySelectorAll('[data-special-select]').forEach(sel => {
    sel.addEventListener('change', () => {
      const [cc, type] = sel.dataset.specialSelect.split('|');
      ensureCountryConfig(cc).specialByType[type] = sel.value || null;
    });
  });

  blocks.querySelectorAll('[data-exm-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.exmToggle;
      appState.specialHintOpen[k] = !appState.specialHintOpen[k];
      renderSpecialPanel();
    });
  });

  equalizeSelectWidths(blocks.querySelectorAll('select.field-select'));
}

// The expandable "which codes qualify?" hint under a special-case row (see
// SPECIAL_CODE_HINTS). Returns '' where no hint list is registered for this
// country/type/label, so it costs nothing anywhere else.
function specialHintHTML(cc, type, label) {
  const hint = SPECIAL_CODE_HINTS[cc + '|' + type + '|' + label];
  if (!hint) return '';
  const codes = hint.codes;
  const key = cc + '|' + type + '|' + label;
  const open = !!appState.specialHintOpen[key];
  const toggle = `
    <button type="button" class="exm-toggle" data-exm-toggle="${escapeHtml(key)}">
      <span class="exm-toggle__car">${open ? '&#9660;' : '&#9654;'}</span> ${escapeHtml(hint.buttonLabel || label)} &mdash; which codes qualify?
    </button>`;
  if (!open) return toggle;

  // Fee amount straight from the special row itself, so the head stays true to the data.
  const cfg = ensureCountryConfig(cc);
  const row = rowsFor(cc, cfg.role, type).find(r => r.special === label);
  const feeBit = row && row.F ? ` (${fmtEUR(row.F)})` : '';
  const items = codes.map(entry => {
    // An entry is either the code string or {code, extra} -- extra being the
    // authority's own precision, appended in the same grey as a variant label.
    const code = typeof entry === 'string' ? entry : entry.code;
    const extra = typeof entry === 'string' ? null : entry.extra;
    const res = classificationTitleFor(code);
    let desc = res
      ? escapeHtml(res.title) + (res.variant ? ` <span class="exm-var">&mdash; ${escapeHtml(res.variant)}</span>` : '')
      : '<span class="exm-miss">not in the current classification</span>';
    if (res && extra) desc += ` <span class="exm-var">&mdash; ${escapeHtml(extra)}</span>`;
    return `<div class="exm-row"><span class="exm-code">${escapeHtml(code)}</span><span class="exm-desc">${desc}</span></div>`;
  }).join('');
  // Source line: the hint list's own legal source (decree etc.), plus where the
  // descriptions come from.
  const src = hint.source;
  const source = src
    ? `Source: ${src.url ? `<a href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${escapeHtml(src.text)}</a>` : escapeHtml(src.text)} &middot; descriptions from the Classification of Variations (this Toolbox).`
    : 'Descriptions from the Classification of Variations (this Toolbox).';
  return `${toggle}
    <div class="exm-list">
      <div class="exm-list__head">These classification codes qualify for the ${escapeHtml(COUNTRY_NAMES[cc] || cc)} &quot;${escapeHtml(label)}&quot; fee${feeBit}:</div>
      ${items}
      ${hint.note ? `<div class="exm-note">${escapeHtml(hint.note)}</div>` : ''}
      <div class="exm-foot">${source}</div>
    </div>`;
}

// Gives every <select> in the list the same width, wide enough to fit the
// longest option label across all of them (measured via canvas text
// metrics, since a <select>'s natural width isn't otherwise queryable
// cross-browser without rendering every option).
function equalizeSelectWidths(selects) {
  if (!selects.length) return;
  const canvas = equalizeSelectWidths._canvas || (equalizeSelectWidths._canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  const cs = getComputedStyle(selects[0]);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  let maxTextWidth = 0;
  selects.forEach(sel => {
    Array.from(sel.options).forEach(opt => {
      const w = ctx.measureText(opt.textContent).width;
      if (w > maxTextWidth) maxTextWidth = w;
    });
  });
  const width = Math.ceil(maxTextWidth) + 48; // padding + dropdown arrow room
  selects.forEach(sel => { sel.style.width = width + 'px'; });
}

// ---- Shared stepper widget ----
function stepperHTML(id, value, min=0, max=999) {
  return `
    <div class="num-stepper" data-field="${id}">
      <button type="button" data-act="dec">−</button>
      <input type="text" inputmode="numeric" value="${value}" data-field-input="${id}">
      <button type="button" data-act="inc">+</button>
    </div>
  `;
}

function bindRowSteppers(scope, onChange) {
  scope.querySelectorAll('.num-stepper').forEach(wrap => {
    const field = wrap.dataset.field;
    const input = wrap.querySelector('input');
    const dec = wrap.querySelector('[data-act=dec]');
    const inc = wrap.querySelector('[data-act=inc]');
    const minVal = field.startsWith('strengths') ? 1 : 0;

    function setVal(v) {
      v = Math.max(minVal, Math.min(99, v|0));
      input.value = v;
      onChange(field, v);
    }
    dec.addEventListener('click', () => setVal((parseInt(input.value,10)||minVal)-1));
    inc.addEventListener('click', () => setVal((parseInt(input.value,10)||minVal)+1));
    input.addEventListener('change', () => setVal(parseInt(input.value,10) || minVal));
  });
}

// ---- Imprint / changelog helpers ----
function formatImprintDate(isoDate) {
  if (!isoDate) return isoDate;
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderChangelogList() {
  const rows = IMPRINT.map(entry => `
    <div class="breakdown-row">
      <div class="bd-left">
        <span class="bd-meta" style="font-family:var(--mono); color:var(--ink-soft);">${formatImprintDate(entry.date)}</span>
        <span class="bd-name" style="font-weight:400; font-size:13px;">${escapeHtml(entry.topic)}</span>
      </div>
    </div>
  `).join('');
  return `<div class="breakdown" style="max-height:420px; overflow-y:auto;">${rows}</div>`;
}

function renderHaWebsitesList() {
  if (typeof HA_WEBSITES === 'undefined' || HA_WEBSITES.length === 0) return '<div class="breakdown"></div>';
  const sorted = [...HA_WEBSITES].sort((a, b) => {
    const nameA = COUNTRY_NAMES[a.cc] || a.cc;
    const nameB = COUNTRY_NAMES[b.cc] || b.cc;
    return nameA.localeCompare(nameB, 'en');
  });
  const rows = sorted.map(entry => {
    const countryName = COUNTRY_NAMES[entry.cc] || entry.cc;
    const linkHtml = entry.link_url
      ? `<a href="${escapeHtml(entry.link_url)}" target="_blank" rel="noopener">${escapeHtml(entry.link_text || entry.link_url)}</a>`
      : escapeHtml(entry.link_text || '–');
    const updatedCalc = formatImprintDate(entry.updated_calc) || '–';
    const checkedHa = formatImprintDate(entry.checked_ha) || '–';
    const payment = entry.payment ? escapeHtml(entry.payment) : '–';
    const annual = entry.annual ? escapeHtml(entry.annual) : '–';
    return `
    <div class="breakdown-row">
      <div class="bd-left">
        <span class="bd-name" style="font-weight:600; font-size:13px;">${escapeHtml(countryName)} <span class="badge">${escapeHtml(entry.cc)}</span></span>
        <span class="bd-meta" style="display:block;">Authority: ${linkHtml}</span>
        <span class="bd-meta" style="display:block;">Fees last updated in calculator: <span style="font-family:var(--mono); color:var(--ink-soft);">${updatedCalc}</span></span>
        <span class="bd-meta" style="display:block;">Fees last checked on HA website: <span style="font-family:var(--mono); color:var(--ink-soft);">${checkedHa}</span></span>
        <span class="bd-meta" style="display:block;">Payment method: ${payment} · Annual fee: ${annual}</span>
      </div>
    </div>
  `;
  }).join('');
  return `<div class="breakdown" style="max-height:420px; overflow-y:auto;">${rows}</div>`;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ---- Compute results across all selected countries ----
// Each country is evaluated independently (its own role, strengths, and
// special-case choices), since fee tables and grouping rules in the source
// data are scoped to a single country + procedure role.
// Per-country fee computation, factored out so it can be driven either by the wizard's own
// appState (computeResult below) or by an explicit input (window.VCLCALC.computeFees, used by
// the Guided Workflow to price each procedure at country level). `counts` is {IA,IB,II};
// `cfg` is {role, strengths, specialByType}. This is the single source of truth for a country's
// fee -- both callers go through it, so there is no second copy of the grouping/cap/FX logic.
function computeCountryResult(cc, cfg, counts) {
    const rows = rowsForCountry(cc);

    const selectedRows = [];
    ['IA','IB','II'].forEach(type => {
      if (counts[type] <= 0) return;
      const row = resolveRow(cc, cfg.role, type, cfg.specialByType[type]);
      if (row) selectedRows.push(row);
    });

    if (selectedRows.length === 0) {
      return { cc, role: cfg.role, strengths: cfg.strengths, items: [], total: 0, hasData: false };
    }

    // ── Combined run (actual total, respects grouping/subsumption rules) ──
    const globalCounts = { M: counts.IA, N: counts.IB, O: counts.II };
    const strengthsByRow = {};
    selectedRows.forEach(r => { strengthsByRow[r.row] = cfg.strengths; });
    const stateCombined = buildState(globalCounts, strengthsByRow);
    rows.forEach(r => evalRow(r.row, stateCombined));

    // ── Per-type individual runs (each type evaluated alone, no grouping) ──
    // This gives the standalone fee for each type independently of what else
    // is being filed — used for the per-line display in the result list.
    // We also store the raw P+Q+R sum from the single run for cap detection.
    const singleFeeByRow = {};
    const rawSumByRow = {};
    selectedRows.forEach(r => {
      const singleCounts = { M: r.type==='IA' ? counts.IA : 0,
                             N: r.type==='IB' ? counts.IB : 0,
                             O: r.type==='II' ? counts.II : 0 };
      const stateSingle = buildState(singleCounts, { [r.row]: cfg.strengths });
      rows.forEach(row => evalRow(row.row, stateSingle));
      const s = stateSingle.computed[r.row];
      singleFeeByRow[r.row] = (s && typeof s.S === 'number') ? s.S : null;
      // Raw sum = P+Q+R before any cap truncation, from the single run
      rawSumByRow[r.row] = (s ? (s.P||0) + (s.Q||0) + (s.R||0) : 0);
    });

    // ── "1st strength" baseline (strengths forced to 1) ──
    // Used only to break the grouping-fee note into "1st strength" + "each
    // additional strength" (UK-style: K+(L-1)*(K/2) for standard rows, but
    // K_complex+(L-1)*K_standard for the "complex" special-case rows — the
    // per-additional-strength amount differs between them). Rather than
    // hardcoding either shape, we derive it from the formula itself: the
    // difference between the real (multi-strength) total and this baseline,
    // divided by the extra strengths, is whatever that row's formula says it
    // is — correct for both variants without special-casing them.
    //
    // Crucially, this must reuse the COMBINED run's global counts (not an
    // isolated single-type run): some countries' grouping condition sums
    // counts across ALL selected types (e.g. UK/BE), so a row can only be
    // >1 once combined with other types even though its own type count is
    // just 1 — using an isolated single-type run here would wrongly compute
    // a non-grouped baseline for exactly that case. Only this row's own
    // strength is forced to 1; every other row's strength (and every type's
    // real count) stays as in the actual combined run.
    const baseStrengthFeeByRow = {};
    if (cfg.strengths > 1) {
      selectedRows.forEach(r => {
        const strengthsBase = Object.assign({}, strengthsByRow, { [r.row]: 1 });
        const stateBase = buildState(globalCounts, strengthsBase);
        rows.forEach(row => evalRow(row.row, stateBase));
        const s = stateBase.computed[r.row];
        baseStrengthFeeByRow[r.row] = (s && typeof s.S === 'number') ? s.S : null;
      });
    }

    const currency = (typeof CC_TO_CURRENCY !== 'undefined') ? CC_TO_CURRENCY[cc] : null;
    const fxRate = currency ? getEffectiveRate(cc) : null;

    const items = selectedRows.map(r => {
      const cCombined = stateCombined.computed[r.row];
      const typeCounterKey = { IA: 'M', IB: 'N', II: 'O' }[r.type];
      const subsumed = typeCounterKey && cCombined[typeCounterKey] === 0 && (cCombined.S === null || cCombined.S === 0);
      const singleTotal = singleFeeByRow[r.row];
      const combinedTotal = (typeof cCombined.S === 'number') ? cCombined.S : null;

      // ── Cap detection ──
      // Two scenarios where a cap fires:
      // 1. Single-run cap: raw P+Q+R > S in the standalone run (ES, IE style)
      // 2. Combined-run cap: the combined S is lower than the standalone S,
      //    meaning adding other types pushed the sum over a ceiling (DE style)
      // In both cases the combined S is the actual capped amount to show.
      const rawSumSingle = rawSumByRow[r.row];
      const singleRunCap = singleTotal !== null
        && rawSumSingle > 0
        && rawSumSingle > singleTotal + 0.01;
      const combinedRunCap = combinedTotal !== null
        && singleTotal !== null
        && singleTotal > 0
        && combinedTotal < singleTotal - 0.01;
      const capFired = singleRunCap || combinedRunCap;
      const capValue = capFired ? combinedTotal : null;
      // For display: the "before cap" amount is the single-run total (what it
      // would cost without other types pushing it over the ceiling)
      const beforeCapAmount = singleRunCap ? rawSumSingle : (combinedRunCap ? singleTotal : null);

      // ── Grouping fee detection ──
      // The grouping fee lives in column K. Rather than reverse-guessing
      // "did grouping fire" from comparing final numbers (which breaks as
      // soon as a row does extra arithmetic on top of K, e.g. UK/DK's
      // per-additional-strength surcharge: K+(L-1)*(K/2)), we check whether
      // this row's own formula actually HAS a count-gated K-branch, and — if
      // so — read the count that gates it straight from this row's own
      // already-computed combined M/N/O. Subsumption (a lower type folded
      // into a higher one) already zeroes out a row's M/N/O in the formulas
      // themselves, and the active/highest row absorbs the lower types'
      // counts into its own M/N/O — so summing this row's own M+N+O gives
      // exactly the count the Excel formula itself tests, for both the
      // "K != F, per-type count" style (UK/DK) and the "K == F, total across
      // all grouped types" style (BE), without needing to special-case them.
      const count = counts[r.type];
      const kVal = (r.K !== null && r.K !== undefined) ? r.K : null;
      const formulaText = [r.Pf, r.Qf, r.Rf, r.Sf].filter(Boolean).join(' ');
      const hasGroupingBranch = kVal !== null && /[MNO]\d+/.test(formulaText) && />1/.test(formulaText) && /\bK\d+\b/.test(formulaText);
      const rowCount = (cCombined.M || 0) + (cCombined.N || 0) + (cCombined.O || 0);
      const groupingFired = hasGroupingBranch && !subsumed && rowCount > 1;
      const groupingFee = groupingFired ? kVal : null;
      // Only meaningful (and only computed above) when cfg.strengths > 1.
      // Uses combinedTotal (the row's real, combined-run total — the same
      // number the country's grand total is built from), not singleTotal
      // (which is deliberately the "this type on its own" figure used for
      // the per-line breakdown, and can differ once grouping only fires in
      // combination with other selected types).
      const groupingBase = (groupingFired && cfg.strengths > 1) ? baseStrengthFeeByRow[r.row] : null;
      const groupingPerAdditional = (groupingBase !== null && groupingBase !== undefined && combinedTotal !== null)
        ? (combinedTotal - groupingBase) / (cfg.strengths - 1)
        : null;

      return {
        row: r,
        total:       combinedTotal,
        singleTotal,
        rawSumSingle,   // raw amount before cap (same as singleTotal when no cap)
        subsumed,
        count,
        capValue,          // null unless cap was applied
        groupingFee,       // null unless grouping rate was used
        groupingBase,      // "1st strength" amount, null unless strengths>1
        groupingPerAdditional, // amount added per additional strength, null unless strengths>1
      };
    });

    // Grand total uses the combined run (correct grouping behaviour)
    const total = items.reduce((acc, it) => acc + (it.total || 0), 0);

    // ── Group cap detection ──
    // DE (and similar) caps the combined P+Q+R of the highest-type row against
    // a ceiling. We detect this by checking each non-subsumed item in the combined
    // run: if its raw P+Q+R (which includes all types' contributions) exceeds its
    // combined S, a group cap has fired. The "before cap" amount is that raw sum.
    let groupCapValue = null;
    let sumOfSingles = 0;  // the raw before-cap sum (P+Q+R from combined run)
    for (const it of items) {
      if (it.subsumed) continue;
      const cRow = stateCombined.computed[it.row.row];
      if (!cRow) continue;
      const rawCombined = (cRow.P||0) + (cRow.Q||0) + (cRow.R||0);
      if (rawCombined > (it.total||0) + 1.0) {
        // This row's combined raw exceeds its combined S — group cap fired
        groupCapValue = it.total;
        sumOfSingles = rawCombined;
        break;
      }
    }
    const groupCapFired = groupCapValue !== null;

    const totalLocal = (fxRate !== null && total !== null) ? total * fxRate : null;

    return { cc, role: cfg.role, strengths: cfg.strengths, items, total, hasData: true, currency, fxRate, totalLocal, groupCapValue, sumOfSingles };
}

// ---- Compute results across all selected countries (wizard) ----
function computeResult() {
  const countryResults = appState.selectedCountries.map(cc => computeCountryResult(cc, ensureCountryConfig(cc), appState.globalCounts));

  // Sort: RMS entries first, then all others alphabetically by country name
  countryResults.sort((a, b) => {
    const aIsRMS = a.role === 'RMS' ? 0 : 1;
    const bIsRMS = b.role === 'RMS' ? 0 : 1;
    if (aIsRMS !== bIsRMS) return aIsRMS - bIsRMS;
    return COUNTRY_NAMES[a.cc].localeCompare(COUNTRY_NAMES[b.cc], 'en');
  });

  const grandTotal = countryResults.reduce((acc, cr) => acc + cr.total, 0);

  appState.results = { countries: countryResults, grandTotal };
}

// Per-country breakdown for the result table. Produces one entry per variation TYPE
// (ordered II > IB > IA), each carrying its individual variations (for the expandable
// detail rows), with a per-strength split (Base fee + per-additional-strength). Every
// amount comes from sub-runs of computeCountryResult, so the lines always reconcile with
// the country total and are never negative:
//   - grouping / no special mechanic: each type is its MARGINAL contribution added on top
//     of the higher types (II first). Where a lower type is fully subsumed it comes out at
//     0 ("included in grouped fee"); where it genuinely costs extra (e.g. FR IB) it shows
//     that cost. Per variation is the same, one variation at a time.
//   - cap: each type is priced on its own (uncapped); rawEur is their sum, which the footer
//     then caps down to the real (capped) total.
function computeCountryBreakdown(cc, full) {
  const cfg = ensureCountryConfig(cc);
  const counts = appState.globalCounts;
  const s = cfg.strengths;
  const cr = full || computeCountryResult(cc, cfg, counts);

  const order = ['II', 'IB', 'IA'].filter(t => (counts[t] || 0) > 0);
  const totalFor = (cnts, str) => (computeCountryResult(cc, Object.assign({}, cfg, { strengths: str }), cnts).total || 0);
  const labelFor = t => { const r = resolveRow(cc, cfg.role, t, cfg.specialByType[t]); return (r && r.special) ? r.special : ''; };
  // Whether this country/type offers a variant choice at all -- decides between "standard"
  // and a plain dash in the result's Special case column.
  const hasVariants = t => {
    const candidates = rowsFor(cc, cfg.role, t);
    return candidates.length > 1 && candidates.some(r => r.special && !/worksharing/i.test(r.special));
  };
  const clamp0 = x => (x < 0 ? 0 : x);
  const mkVar = (base, line) => ({ base, perAdd: (s > 1 && line > 0.005) ? clamp0((line - base) / (s - 1)) : null, line });

  const capFired = cr.groupCapValue !== null || cr.items.some(it => it.capValue !== null);
  // "grouping" is a genuine grouping FEE only when the country's Excel formula actually has
  // a count-gated column-K branch (it.groupingFee, set in computeCountryResult) -- i.e. BE/DK/UK.
  // It is NOT enough that combining happens to be cheaper: subsumption/discount effects (DE, CZ,
  // IS, LT, RO ...) also make the combined total drop, but those are not grouping fees and must
  // not be labelled as such.
  const realGrouping = cr.items.some(it => it.groupingFee !== null);
  const mechanic = capFired ? 'cap' : (realGrouping ? 'grouping' : 'none');

  const types = [];
  if (mechanic === 'cap') {
    // Each type shows its FULL (uncapped) fee for its variation count -- what those variations
    // would cost on their own -- so the reader sees the real per-type amounts. The footer then
    // caps their sum down to the country's actual (capped) total, which covers all variations.
    // Uses each single-type run's pre-cap P+Q+R (rawSumSingle) instead of the capped S.
    const rawFor = (cnts, str) => { const it = computeCountryResult(cc, Object.assign({}, cfg, { strengths: str }), cnts).items[0]; return it ? (it.rawSumSingle || 0) : 0; };
    order.forEach(t => {
      const cnt = counts[t] || 0;
      const vars = []; let pvS = 0, pv1 = 0;
      for (let k = 1; k <= cnt; k++) {
        const only = { IA: 0, IB: 0, II: 0 }; only[t] = k;
        const tS = rawFor(only, s), t1 = s > 1 ? rawFor(only, 1) : tS;
        const line = clamp0(tS - pvS);
        vars.push(mkVar(s > 1 ? clamp0(t1 - pv1) : line, line));
        pvS = tS; pv1 = t1;
      }
      const line = vars.reduce((a, v) => a + v.line, 0), base = vars.reduce((a, v) => a + v.base, 0);
      types.push({ type: t, special: labelFor(t), variants: hasVariants(t), count: cnt, base, perAdd: (s > 1 && Math.abs(line - base) > 0.005) ? (line - base) / (s - 1) : null, line, incl: false, vars });
    });
  } else if (mechanic === 'grouping') {
    // Genuine grouping fee (BE/DK/UK): a single flat fee for the whole group that is not
    // attributable to any one type. Every type line shows "included in grouped fee" (0);
    // the country subtotal (cr.total) is the one place that carries the actual fee -- so
    // it never clings to Type II, and DK/UK's per-strength breakdown stays in the export note.
    order.forEach(t => {
      const cnt = counts[t] || 0;
      const vars = [];
      for (let k = 1; k <= cnt; k++) vars.push(mkVar(0, 0));
      types.push({ type: t, special: labelFor(t), variants: hasVariants(t), count: cnt, base: 0, perAdd: null, line: 0, incl: true, vars });
    });
  } else {
    // Marginal contribution of each type in turn (II -> +IB -> +IA), split by variation.
    const prefix = { IA: 0, IB: 0, II: 0 };
    let baseS = 0, base1 = 0;
    order.forEach(t => {
      const cnt = counts[t] || 0;
      const vars = []; let pvS = baseS, pv1 = base1;
      for (let k = 1; k <= cnt; k++) {
        const cnts = Object.assign({}, prefix, { [t]: k });
        const tS = totalFor(cnts, s), t1 = s > 1 ? totalFor(cnts, 1) : tS;
        const line = clamp0(tS - pvS);
        vars.push(mkVar(s > 1 ? clamp0(t1 - pv1) : line, line));
        pvS = tS; pv1 = t1;
      }
      const line = vars.reduce((a, v) => a + v.line, 0), base = vars.reduce((a, v) => a + v.base, 0);
      types.push({ type: t, special: labelFor(t), variants: hasVariants(t), count: cnt, base, perAdd: (s > 1 && Math.abs(line - base) > 0.005) ? (line - base) / (s - 1) : null, line, incl: (line < 0.005), vars });
      prefix[t] = cnt; baseS = pvS; base1 = pv1;
    });
  }
  const rawEur = types.reduce((a, ty) => a + ty.line, 0);
  return { mechanic, types, rawEur };
}

// ---- Step 3: result ----
function renderStepResult() {
  const res = appState.results;
  if (appState.results && window.VCL_USAGE) window.VCL_USAGE.track("calculator", "finish");

  const mode = appState.resultCurrencyMode || 'eur';
  const counts = appState.globalCounts;
  const varTotal = ['IA','IB','II'].reduce((a,t) => a + (counts[t] || 0), 0);
  const varBreakdown = ['IA','IB','II'].filter(t => counts[t] > 0).map(t => `${counts[t]} &times; ${t}`).join(', ');

  // One entry per country carrying its own breakdown, so the overview table above and the
  // detail card below are built from exactly the same numbers (and it is computed once).
  const entries = res.countries.map(cr => ({ cr, bd: cr.hasData ? computeCountryBreakdown(cr.cc, cr) : null }));

  const mechChipHTML = (bd) => {
    if (!bd || bd.mechanic === 'none') return '<span class="vres-chip vres-chip--none">&ndash;</span>';
    return bd.mechanic === 'cap'
      ? '<span class="vres-chip vres-chip--cap">Cap</span>'
      : '<span class="vres-chip">Grouping</span>';
  };
  // The overview's code column is a fixed 30px so the names line up; "DE - BfArM" would blow
  // that apart. Only the ISO part goes in the pill -- the authority stays in the name beside it
  // ("Germany (BfArM)"), so nothing is lost.
  const ccShort = (cc) => String(cc).split(/[^A-Za-z]/)[0].toUpperCase();

  // Amount in the country's own view (local currency when toggled), as used everywhere below.
  const money = (cr) => (v) => (mode === 'local' && cr.currency && cr.fxRate != null)
    ? fmtLocalCurrency(v * cr.fxRate, cr.currency)
    : fmtEUR(v);

  const countryCards = entries.map(({ cr, bd }) => {
    if (!cr.hasData) {
      return `
      <div class="vres-cty" data-ctycard="${cr.cc}">
        <div class="vres-top">
          <div>
            <div class="vres-name">${COUNTRY_NAMES[cr.cc]} <span class="badge">${cr.cc}</span></div>
            <div class="vres-meta"><b>${roleLabel(cr.role)}</b></div>
          </div>
          <div class="vres-total"><span class="vres-amt">&ndash;</span></div>
        </div>
      </div>`;
    }

    const useLocal = mode === 'local' && cr.currency && cr.fxRate != null;
    const m = money(cr);

    // Header caption: exchange rate (local view) or "EUR equivalent" (foreign country shown in EUR).
    let caption = '';
    if (useLocal) caption = `<span class="vres-eq">${fmtRate(cr.fxRate, cr.currency)}</span>`;
    else if (cr.currency) caption = `<span class="vres-eq">EUR equivalent</span>`;

    // One row per variation type; rows with more than one variation expand to the individual ones.
    const rowsHtml = bd.types.map((ty) => {
      const key = cr.cc + '|' + ty.type;
      const expandable = ty.count > 1;
      const open = !!appState.resultExpanded[key];
      const caret = expandable
        ? `<span class="vres-caret">${open ? '&#9662;' : '&#9656;'}</span>`
        : `<span class="vres-caret vres-caret--none"></span>`;
      // A grouping fee makes every single line "included" -- saying so once in the footer beats
      // repeating it on every row. Elsewhere a zero line is genuine news and stays annotated.
      const inclNote = (ty.incl && bd.mechanic !== 'grouping')
        ? ` <span class="vres-subnote">&middot; no extra fee</span>` : '';
      const scText = ty.special ? escapeHtml(ty.special) : (ty.variants ? 'standard' : '&ndash;');
      const scClass = ty.special ? 'vres-sc' : 'vres-sc vres-sc--std';
      const main = `<tr class="vres-trow${expandable ? ' vres-exp' : ''}"${expandable ? ` data-exp="${escapeHtml(key)}"` : ''}>
          <td><span class="vres-var">${caret}${typePillHTML(ty.type)}<span class="vres-cnt">${ty.count}&times;</span> Type ${ty.type}${inclNote}</span></td>
          <td class="${scClass}">${scText}</td>
          <td class="vres-num">${m(ty.base)}</td>
          <td class="vres-num">${ty.perAdd != null ? m(ty.perAdd) : '&ndash;'}</td>
          <td class="vres-num">${m(ty.line)}</td>
        </tr>`;
      const subs = expandable ? ty.vars.map((v, vi) => `
        <tr class="vres-subrow${open ? '' : ' vres-hidden'}" data-sub="${escapeHtml(key)}">
          <td><span class="vres-var"><span class="vres-caret vres-caret--none"></span><span class="vres-vno">Var ${vi + 1}</span></span></td>
          <td class="vres-sc vres-sc--std"></td>
          <td class="vres-num">${m(v.base)}</td>
          <td class="vres-num">${v.perAdd != null ? m(v.perAdd) : '&ndash;'}</td>
          <td class="vres-num">${m(v.line)}</td>
        </tr>`).join('') : '';
      return main + subs;
    }).join('');

    // Footer: always "Country subtotal"; a subtle mechanic note beside it, and for a
    // cap the raw (uncapped) sum struck through before the capped subtotal.
    let note = '';
    if (bd.mechanic === 'grouping') note = ` <span class="vres-fnote vres-fnote--grp">&middot; all variations covered by one grouping fee</span>`;
    else if (bd.mechanic === 'cap') note = ` <span class="vres-fnote vres-fnote--cap">&middot; Cap fee applies</span>`;
    const amtCell = bd.mechanic === 'cap'
      ? `<span class="vres-capraw">${m(bd.rawEur)}</span><span class="vres-num">${m(cr.total)}</span>`
      : `<span class="vres-num">${m(cr.total)}</span>`;

    return `
      <div class="vres-cty" data-ctycard="${cr.cc}">
        <div class="vres-top">
          <div>
            <div class="vres-name">${COUNTRY_NAMES[cr.cc]} <span class="badge">${cr.cc}</span></div>
            <div class="vres-meta"><b>${roleLabel(cr.role)}</b> &middot; <b>${cr.strengths} strength${cr.strengths===1?'':'s'}</b> &middot; <b>${varTotal} variation${varTotal===1?'':'s'}</b></div>
          </div>
          <div class="vres-total">${caption}${bd.mechanic !== 'none' ? mechChipHTML(bd) : ''}<span class="vres-amt">${m(cr.total)}</span></div>
        </div>
        <table class="vres-tbl${bd.mechanic !== 'none' ? ' vres-tbl--indicative' : ''}">
          <thead><tr><th>Variation</th><th>Special case</th><th>Base fee</th><th>Per add. strength</th><th>Line total</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot><tr><td colspan="4">Country subtotal${note}</td><td>${amtCell}</td></tr></tfoot>
        </table>
      </div>`;
  }).join('');

  // ---- Overview table: every country with its final sum, before any detail ----
  const sort = appState.resultOverviewSort || { key: '', dir: 1 };
  const ordered = entries.slice();
  if (sort.key) {
    ordered.sort((a, b) => {
      let r;
      if (sort.key === 'name') r = COUNTRY_NAMES[a.cr.cc].localeCompare(COUNTRY_NAMES[b.cr.cc], 'en');
      else if (sort.key === 'strengths') r = (a.cr.strengths || 0) - (b.cr.strengths || 0);
      else r = (a.cr.total || 0) - (b.cr.total || 0);
      return r * sort.dir;
    });
  }
  const sortTh = (key, label) => {
    const on = sort.key === key;
    const car = on ? (sort.dir === 1 ? '&#9650;' : '&#9660;') : '&#9650;';
    return `<button type="button" data-ovsort="${key}">${label} <span class="vres-sortcar${on ? ' on' : ''}">${car}</span></button>`;
  };
  const overviewHTML = `
    <div class="vres-ovwrap">
      <table class="vres-ov">
        <thead><tr>
          <th>${sortTh('name','Country')}</th>
          <th>Role</th>
          <th>${sortTh('strengths','Strengths')}</th>
          <th>Variations</th>
          <th>Mechanic</th>
          <th>${sortTh('total','Total')}</th>
        </tr></thead>
        <tbody>
          ${ordered.map(({ cr, bd }) => {
            const m = money(cr);
            const amount = cr.hasData ? m(cr.total) : '&ndash;';
            const zero = cr.hasData && cr.total < 0.005;
            return `
            <tr data-ovrow="${cr.cc}" tabindex="0">
              <td><span class="vres-ovname"><span class="badge vres-ovcode">${ccShort(cr.cc)}</span>${COUNTRY_NAMES[cr.cc]}</span></td>
              <td>${roleLabel(cr.role)}</td>
              <td>${cr.hasData ? cr.strengths : '&ndash;'}</td>
              <td>${varTotal}</td>
              <td>${mechChipHTML(bd)}</td>
              <td class="vres-ovmoney${zero ? ' vres-ovmoney--zero' : ''}">${amount}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="5">Total &mdash; ${res.countries.length} ${res.countries.length===1?'country':'countries'} &middot; ${varTotal} variation${varTotal===1?'':'s'}${varBreakdown ? ` <span class="vres-varbd">(${varBreakdown})</span>` : ''}</td>
          <td>${fmtEUR(res.grandTotal)}</td>
        </tr></tfoot>
      </table>
    </div>`;

  const anyForeign = res.countries.some(cr => cr.hasData && cr.currency);

  const anySubsumed = res.countries.some(cr => cr.items.some(it => it.subsumed));
  const anyNoData = res.countries.some(cr => !cr.hasData);

  contentEl.innerHTML = `
    <div class="panel" style="margin-bottom:14px;">
      <div class="vres-panelhead">
        <h2 class="bd-heading" style="margin:0;">Overview - fees by country</h2>
        <div class="vres-headtools">
          <button class="btn-export" data-calc-print>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print
          </button>
          <button class="btn-export" data-calc-excel>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            Export Excel
          </button>
          ${anyForeign ? `
          <div class="vres-curtoggle" role="group" aria-label="Currency">
            <button type="button" class="vres-ct${mode==='eur'?' on':''}" data-cmode="eur">EUR</button>
            <button type="button" class="vres-ct${mode==='local'?' on':''}" data-cmode="local">Local currency</button>
          </div>` : ''}
        </div>
      </div>
      ${overviewHTML}
    </div>

    <div class="panel" style="margin-bottom:18px;">
      <div class="vres-panelhead">
        <h2 class="bd-heading" style="margin:0;">Details - fees by country</h2>
      </div>
      ${countryCards}
      <div class="vres-grand">
        <span class="vres-grand-l">Total${anyForeign ? ' (EUR)' : ''}</span>
        <span class="vres-grand-r">${fmtEUR(res.grandTotal)}</span>
      </div>
    </div>

    <div class="export-buttons">
      <button class="btn-export" data-calc-print>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Print
      </button>
      <button class="btn-export" data-calc-excel>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        Export Excel
      </button>
    </div>

    ${calcInfoPanelsHtml()}

    ${anyNoData ? `<div class="note-box">One or more countries did not return a fee for the selected combination. Please double-check the role/variation selection for the affected country.</div>` : ''}

    <div class="nav-row">
      <button class="btn primary" id="vclcalc-back3">← Edit selection</button>
      <button class="btn primary" id="vclcalc-restart">New calculation</button>
    </div>
  `;

  document.getElementById('vclcalc-back3').addEventListener('click', () => setStep(2));

  // Currency toggle (EUR / local currency): re-render the result step in the chosen mode.
  contentEl.querySelectorAll('[data-cmode]').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.resultCurrencyMode = btn.dataset.cmode;
      renderStepResult();
    });
  });

  // Overview table: sort by country, strengths or total. Same column twice flips direction.
  contentEl.querySelectorAll('[data-ovsort]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.ovsort;
      const cur = appState.resultOverviewSort || { key: '', dir: 1 };
      appState.resultOverviewSort = (cur.key === key)
        ? { key, dir: -cur.dir }
        : { key, dir: key === 'name' ? 1 : -1 };
      renderStepResult();
    });
  });

  // A row in the overview leads to that country's detail card -- scrolled into view and
  // briefly outlined, so a 33-country result never turns into a hunt.
  contentEl.querySelectorAll('[data-ovrow]').forEach(row => {
    const jump = () => {
      const card = contentEl.querySelector(`[data-ctycard="${row.dataset.ovrow}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('vres-flash');
      setTimeout(() => card.classList.remove('vres-flash'), 1400);
    };
    row.addEventListener('click', jump);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
    });
  });

  // Expand/collapse a type row to its individual variations (DOM + stored state, no re-render
  // -- so the open state survives a later currency-toggle re-render).
  contentEl.querySelectorAll('[data-exp]').forEach(row => {
    row.addEventListener('click', () => {
      const key = row.dataset.exp;
      const open = (appState.resultExpanded[key] = !appState.resultExpanded[key]);
      contentEl.querySelectorAll(`[data-sub="${key.replace(/"/g, '\\"')}"]`).forEach(r => r.classList.toggle('vres-hidden', !open));
      const car = row.querySelector('.vres-caret');
      if (car) car.innerHTML = open ? '&#9662;' : '&#9656;';
    });
  });

  // ── Print / Export Excel ──
  // The pair exists twice (above the overview and below the cards), so a long result never
  // makes the reader scroll back for them; both copies share one handler.
  contentEl.querySelectorAll('[data-calc-print]').forEach(b => b.addEventListener('click', () => window.print()));
  contentEl.querySelectorAll('[data-calc-excel]').forEach(b => b.addEventListener('click', () => exportExcel(res)));

  wireCalcInfoPanels();

  document.getElementById('vclcalc-restart').addEventListener('click', () => {
    appState.selectedCountries = [];
    appState.countryConfig = {};
    appState.globalCounts = { IA: 0, IB: 0, II: 0 };
    appState.prefillNote = null; // the counts it described are gone -- it would now be a lie
    appState.results = null;
    appState.resultCurrencyMode = 'eur';
    appState.resultExpanded = {};
    appState.resultOverviewSort = { key: '', dir: 1 };
    appState.strengthsDefault = 1;
    appState.strengthsManual = {};
    setStep(0);
  });
}

// ── Excel export ──────────────────────────────────────────────────────────────
// Builds the "Notes" column text (cap/grouping annotations) for one
// country's export row — shared between the EUR and local-currency tables.
function exportNotesFor(cr) {
  const notes = [];
  const firedCaps = cr.items.filter(it => it.capValue !== null);
  if (firedCaps.length > 0) notes.push(`Cap fee applied: ${fmtEUR(Math.max(...firedCaps.map(it=>it.capValue)))}`);
  const firedGrouping = cr.items.filter(it => it.groupingFee !== null);
  const topGrouping = firedGrouping.reduce((best, it) =>
    (!best || TYPE_PRIORITY[it.row.type] > TYPE_PRIORITY[best.row.type]) ? it : best, null);
  if (topGrouping) {
    const hasBreakdown = cr.strengths > 1 && topGrouping.groupingBase !== null && topGrouping.groupingPerAdditional !== null && Math.abs(topGrouping.groupingPerAdditional) > 0.01;
    const suffix = hasBreakdown
      ? ` (${fmtEUR(topGrouping.groupingBase)} for the 1st strength + ${fmtEUR(topGrouping.groupingPerAdditional)} for each additional strength)`
      : '';
    notes.push(`Grouping fee applied${suffix}: ${fmtEUR(topGrouping.total)}`);
  }
  return notes.join(' | ');
}

// Starts a new "sheet build" — an object with a pushRow() helper and the
// tracking arrays exportSheetToWorkbook() later needs to apply number/date
// formats and (best-effort) bold, since aoa_to_sheet itself only takes plain
// values.
function newSheetBuilder() {
  const ws_data = [];
  const numberCells = []; // { r, c, format } — 0-indexed, applied after the sheet is built
  const dateCells = [];   // { r, c, format }
  const boldRows = [];    // 0-indexed row numbers to bold (best-effort; harmless if unsupported)
  function pushRow(row) {
    ws_data.push(row);
    return ws_data.length - 1; // 0-indexed row just added
  }
  return { ws_data, numberCells, dateCells, boldRows, pushRow };
}

// Shared metadata block (title/copyright/dates/counts/grand total) at the
// top of every export sheet.
function pushMetadataRows(sheet, res) {
  const { pushRow, boldRows, dateCells, numberCells } = sheet;
  const lastUpdatedDate = (typeof IMPRINT !== 'undefined' && IMPRINT.length > 0 && IMPRINT[0].date)
    ? new Date(IMPRINT[0].date + 'T00:00:00') : null;

  boldRows.push(pushRow(['Variation Fee Calculator']));
  pushRow(['© Dr. Tom Deutschle']);
  pushRow(['www.pharmazulassung.de']);
  pushRow([]);
  pushRow(['Your project/procedure:', '']);
  dateCells.push({ r: pushRow(['Calculation date:', new Date()]), c: 1, format: 'dd mmm yyyy' });
  if (lastUpdatedDate) {
    dateCells.push({ r: pushRow(['Fee table last updated:', lastUpdatedDate]), c: 1, format: 'dd mmm yyyy' });
  } else {
    pushRow(['Fee table last updated:', '–']);
  }
  pushRow(['Variations filed - Type IA:', appState.globalCounts.IA]);
  pushRow(['Variations filed - Type IB:', appState.globalCounts.IB]);
  pushRow(['Variations filed - Type II:', appState.globalCounts.II]);
  pushRow(['Countries:', res.countries.length]);
  {
    const r = pushRow(['Total:', res.grandTotal]);
    boldRows.push(r);
    numberCells.push({ r, c: 1, format: EXCEL_CURRENCY_FORMATS.EUR });
  }
  pushRow([]);
}

// Turns a sheet builder's tracked rows/formats into an actual worksheet and
// appends it to the workbook. cellDates:true is essential here — without it,
// aoa_to_sheet silently converts JS Date values to raw Excel serial numbers
// typed as plain numbers, and the later "ws[addr].t = 'd'" pass then
// re-interprets that already-converted serial as if it were a JS Date's
// millisecond timestamp, corrupting the date (this was the "Calculation
// date shows 1970" bug).
function appendSheet(wb, sheet, sheetName, colWidths) {
  const { ws_data, numberCells, dateCells, boldRows } = sheet;
  const ws = XLSX.utils.aoa_to_sheet(ws_data, { cellDates: true });
  if (colWidths) ws['!cols'] = colWidths.map(wch => ({ wch }));

  numberCells.forEach(({ r, c, format }) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (ws[addr] && typeof ws[addr].v === 'number') {
      ws[addr].z = format;
      ws[addr].t = 'n';
    }
  });
  dateCells.forEach(({ r, c, format }) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (ws[addr]) {
      ws[addr].t = 'd';
      ws[addr].z = format;
    }
  });
  boldRows.forEach(r => {
    const row = ws_data[r];
    if (!row) return;
    row.forEach((_, c) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr]) ws[addr].s = Object.assign({}, ws[addr].s, { font: Object.assign({}, ws[addr].s && ws[addr].s.font, { bold: true }) });
    });
  });

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

function exportExcel(res) {
  if (typeof XLSX === 'undefined') {
    alert('Excel export library not loaded. Please check your internet connection and try again.');
    return;
  }

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: "Variation Fees" ──
  const sheet1 = newSheetBuilder();
  const { ws_data, pushRow, numberCells, boldRows } = sheet1;
  pushMetadataRows(sheet1, res);

  // ── Table 1: Euro (all countries) ──
  boldRows.push(pushRow(['Euro (all countries):']));
  pushRow([]);
  boldRows.push(pushRow(['Country', 'Code', 'Role', 'Strengths', 'Type IA', 'Type IB', 'Type II', 'Total', 'n.a.', 'Notes']));

  res.countries.forEach(cr => {
    const typeAmounts = ['IA', 'IB', 'II'].map(t => {
      if (appState.globalCounts[t] <= 0) return '';
      const item = cr.items.find(it => it.row.type === t);
      return item && item.singleTotal !== null ? item.singleTotal : 0;
    });
    const r = pushRow([
      COUNTRY_NAMES[cr.cc], cr.cc, EXCEL_ROLE_LABELS[cr.role] || cr.role, cr.strengths,
      ...typeAmounts,
      cr.hasData ? cr.total : '',
      '',
      exportNotesFor(cr)
    ]);
    [4, 5, 6, 7].forEach(c => {
      if (typeof ws_data[r][c] === 'number') numberCells.push({ r, c, format: EXCEL_CURRENCY_FORMATS.EUR });
    });
  });

  {
    const totalTypeAmounts = ['IA', 'IB', 'II'].map(t => {
      if (appState.globalCounts[t] <= 0) return '';
      return res.countries.reduce((sum, cr) => {
        const item = cr.items.find(it => it.row.type === t);
        return sum + (item && item.singleTotal ? item.singleTotal : 0);
      }, 0);
    });
    const r = pushRow(['TOTAL', '', '', '', ...totalTypeAmounts, res.grandTotal, '', '']);
    boldRows.push(r);
    [4, 5, 6, 7].forEach(c => {
      if (typeof ws_data[r][c] === 'number') numberCells.push({ r, c, format: EXCEL_CURRENCY_FORMATS.EUR });
    });
  }

  // ── Table 2: local currencies, only for countries that have one ──
  const localCountries = res.countries.filter(cr => cr.hasData && cr.currency && cr.fxRate != null);
  if (localCountries.length > 0) {
    pushRow([]);
    boldRows.push(pushRow(['Local currencies (if any) for information:']));
    pushRow([]);
    boldRows.push(pushRow(['Country', 'Code', 'Role', 'Strengths', 'Type IA', 'Type IB', 'Type II', 'Total (local)', 'Exchange rate', 'Notes']));

    localCountries.forEach(cr => {
      const typeAmountsLocal = ['IA', 'IB', 'II'].map(t => {
        if (appState.globalCounts[t] <= 0) return '';
        const item = cr.items.find(it => it.row.type === t);
        return item && item.singleTotal !== null ? item.singleTotal * cr.fxRate : 0;
      });
      const r = pushRow([
        COUNTRY_NAMES[cr.cc], cr.cc, EXCEL_ROLE_LABELS[cr.role] || cr.role, cr.strengths,
        ...typeAmountsLocal,
        cr.totalLocal,
        cr.fxRate,
        exportNotesFor(cr)
      ]);
      const fmt = EXCEL_CURRENCY_FORMATS[cr.currency] || '#,##0.00';
      [4, 5, 6, 7].forEach(c => {
        if (typeof ws_data[r][c] === 'number') numberCells.push({ r, c, format: fmt });
      });
      // Exchange rate gets more precision than money amounts — 2 decimals
      // would round e.g. SEK's ~11.0955 down to useless precision.
      numberCells.push({ r, c: 8, format: '#,##0.0000' });
    });
  }

  appendSheet(wb, sheet1, 'Variation Fees', [22, 6, 20, 10, 16, 16, 16, 16, 14, 44]);

  // ── Sheet 2: "Variation cases" ──
  // For each filed type, lists every selected country's resolved special
  // case (e.g. "complex", "full & abbreviated application") — or "standard"
  // where the source fee table has no distinct variant for that country/
  // type. This documents *which* row of the fee table each country's figure
  // in Sheet 1 actually came from.
  const sheet2 = newSheetBuilder();
  pushMetadataRows(sheet2, res);
  ['IA', 'IB', 'II'].forEach(type => {
    if (appState.globalCounts[type] <= 0) return;
    sheet2.boldRows.push(sheet2.pushRow([typeLabel(type)]));
    sheet2.boldRows.push(sheet2.pushRow(['Country', 'Code', 'Special case']));
    res.countries.forEach(cr => {
      const item = cr.items.find(it => it.row.type === type);
      if (!item) return;
      sheet2.pushRow([COUNTRY_NAMES[cr.cc], cr.cc, item.row.special || 'standard']);
    });
    sheet2.pushRow([]);
  });
  appendSheet(wb, sheet2, 'Variation cases', [22, 6, 40]);

  // Generate filename with date
  const dateStr = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `variation-fees-${dateStr}.xlsx`);
}

function render() {
  renderRail();
  if (appState.step === 0) renderStepCountries();
  else if (appState.step === 1) renderStepCountryDetails();
  else if (appState.step === 2) renderStepVariations();
  else if (appState.step === 3) renderStepResult();
}

render();

})();
