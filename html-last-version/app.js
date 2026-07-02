// ============================================================================
// Formula interpreter — evaluates the original Excel cell formulas exactly,
// resolving cross-row references (e.g. a IB-row referencing the "G" of the
// preceding IA-row), so behaviour matches the source workbook 1:1.
// ============================================================================

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

const FX_CACHE_KEY = 'vfc_fx_rates';
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

function cellRef(letter, row, state) {
  if (row === 2) return state.global[letter];
  const r = ROWS_BY_ROW[row];
  if (!r) return 0;
  if (['F','G','H','I','J','K'].includes(letter)) {
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
  return { RMS: 'RMS (Reference Member State)', CMS: 'CMS (Concerned Member State)', national: 'National procedure', EMA: 'Centralised procedure (EMA)' }[role] || role;
}

function typeLabel(t) {
  return { IA: 'Type IA', IB: 'Type IB', II: 'Type II' }[t] || t;
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
  return '1 EUR\u00a0=\u00a0' + new Intl.NumberFormat('en-IE', {
    minimumFractionDigits: dec, maximumFractionDigits: dec
  }).format(rate) + '\u00a0' + currencyCode;
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
  results: null
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

const railEl = document.getElementById('rail');
const contentEl = document.getElementById('stepContent');
fxStatusEl = document.getElementById('fxStatus'); // set the module-level variable

// Kick off the rate fetch now that fxStatusEl is bound (non-blocking). Doing
// this any earlier means a same-day cache hit — which updates the status
// text synchronously, with no intervening await — would silently run before
// fxStatusEl exists, leaving the status line blank until the next full page
// load happens to be a cache miss.
loadLiveRates();

// Populate the "last updated" date in the header tag from the Imprint sheet
(function() {
  const tagEl = document.getElementById('headerTag');
  if (tagEl && typeof IMPRINT !== 'undefined' && IMPRINT.length > 0) {
    const dateStr = formatImprintDate(IMPRINT[0].date);
    tagEl.textContent = `last updated: ${dateStr}`;
  }
})();

function setStep(n) {
  appState.step = n;
  render();
  // Scroll to the calculator container (works both standalone and inside WordPress)
  const appEl = document.getElementById('vfc-app') || document.getElementById('app');
  if (appEl) {
    const top = appEl.getBoundingClientRect().top + window.pageYOffset - 20;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
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
      <div style="display:flex; gap:8px; margin-bottom:10px; align-items:center; flex-wrap:wrap;">
        <input type="text" class="country-search" id="countrySearch" placeholder="Search for a country…" value="${appState.countrySearch}" style="flex:1; min-width:180px; margin-bottom:0;">
        <button class="btn ghost" id="selectAll" style="white-space:nowrap;">Select all</button>
        <button class="btn ghost" id="resetSelection" ${n===0?'disabled':''} style="white-space:nowrap;">Reset</button>
      </div>
      <div class="country-grid" id="countryGrid">
        ${filtered.map(c => `
          <button class="country-tile ${appState.selectedCountries.includes(c)?'selected':''}" data-cc="${c}">
            <span class="cc">${c}</span>
            <span class="cn">${COUNTRY_NAMES[c]}</span>
          </button>
        `).join('')}
      </div>
    </div>
    <div class="nav-row">
      <span class="hint" style="margin:0;">${n} countr${n===1?'y':'ies'} selected</span>
      <button class="btn primary" id="toStep2" ${n===0?'disabled':''}>Continue</button>
    </div>
  `;

  document.getElementById('countrySearch').addEventListener('input', (e) => {
    appState.countrySearch = e.target.value;
    renderStepCountries();
  });

  document.getElementById('selectAll').addEventListener('click', () => {
    codes.forEach(c => {
      if (!appState.selectedCountries.includes(c)) {
        appState.selectedCountries.push(c);
        ensureCountryConfig(c);
      }
    });
    renderStepCountries();
  });

  document.getElementById('resetSelection').addEventListener('click', () => {
    appState.selectedCountries = [];
    appState.countryConfig = {};
    renderStepCountries();
  });

  document.querySelectorAll('.country-tile').forEach(btn => {
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
  document.getElementById('toStep2').addEventListener('click', () => setStep(1));
}

// ---- Step 1: per-country role + strengths ----
function renderStepCountryDetails() {
  contentEl.innerHTML = `
    <div class="panel">
      <h2>Procedure role &amp; strengths per country</h2>
      <p class="hint">Choose the applicable procedure role and the number of authorised strengths for each country — these can differ from country to country (e.g. one country may have 2 authorised strengths where another only has 1).</p>
      <div id="countryDetailList"></div>
    </div>
    <div class="nav-row">
      <button class="btn ghost" id="back1">← Back</button>
      <button class="btn primary" id="toStep3">Continue</button>
    </div>
  `;

  const list = document.getElementById('countryDetailList');
  const sortedCCs = [...appState.selectedCountries]
    .sort((a, b) => COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b], 'en'));
  list.innerHTML = sortedCCs.map(cc => {
    const cfg = ensureCountryConfig(cc);
    const roles = rolesForCountry(cc);
    return `
      <div class="row-card active" data-cc="${cc}" style="margin-bottom:10px;">
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
            <span class="field-label" style="margin-bottom:6px;">Number of authorised strengths</span>
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
  });

  document.getElementById('back1').addEventListener('click', () => setStep(0));
  document.getElementById('toStep3').addEventListener('click', () => setStep(2));
}

// ---- Step 2: global variations (type + count), with optional per-country special override ----
function renderStepVariations() {
  contentEl.innerHTML = `
    <div class="panel">
      <h2>Which variations are being filed?</h2>
      <p class="hint">Set how many variations of each type are part of this submission. This applies the same way to every selected country.</p>
      <div id="typeCounters"></div>
    </div>
    <div class="panel" id="specialPanel" style="display:none;">
      <h2 style="margin-bottom:4px;">Special cases</h2>
      <p class="hint">Some countries distinguish between several variants of the same type (e.g. "simple" vs "complex"). Where that applies, pick the variant per country below — countries without that distinction automatically use their standard fee.</p>
      <div id="specialBlocks"></div>
    </div>
    <div class="nav-row">
      <button class="btn ghost" id="back2">← Back</button>
      <button class="btn primary" id="toResult" ${totalVariationCount()===0?'disabled':''}>Calculate fees</button>
    </div>
  `;

  const counters = document.getElementById('typeCounters');
  counters.innerHTML = ['IA','IB','II'].map(type => `
    <div class="field-group">
      <div class="num-row">
        <div style="width:110px;font-size:13px;font-weight:600;color:var(--ink);">${typeLabel(type)}</div>
        ${stepperHTML('global_'+type, appState.globalCounts[type], 0, 99)}
      </div>
    </div>
  `).join('');
  bindRowSteppers(counters, (field, value) => {
    const type = field.split('_')[1];
    appState.globalCounts[type] = value;
    updateResultButtonState();
    renderSpecialPanel();
  });

  renderSpecialPanel();
  document.getElementById('back2').addEventListener('click', () => setStep(1));
  document.getElementById('toResult').addEventListener('click', () => {
    computeResult();
    setStep(3);
  });
}

function totalVariationCount() {
  return appState.globalCounts.IA + appState.globalCounts.IB + appState.globalCounts.II;
}

function updateResultButtonState() {
  const btn = document.getElementById('toResult');
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
    const labels = candidates.map(r => r.special).filter(Boolean);
    if (labels.length === 0) return; // only one unlabelled row, nothing to choose
    result.push({ cc, role: cfg.role, options: labels, hasStandard: candidates.some(r => !r.special) });
  });
  return result;
}

function renderSpecialPanel() {
  const panel = document.getElementById('specialPanel');
  const blocks = document.getElementById('specialBlocks');
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

  blocks.innerHTML = sections.map(({type, choices}) => `
    <div class="field-group">
      <span class="field-label">${typeLabel(type)}</span>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${choices.map(({cc, options, hasStandard}) => {
          const cfg = ensureCountryConfig(cc);
          const current = cfg.specialByType[type] || '';
          return `
            <div class="num-row" style="justify-content:space-between;">
              <div style="font-size:13px; color:var(--ink-soft);">${COUNTRY_NAMES[cc]} <span class="badge">${cc}</span></div>
              <select class="field-select" style="width:auto; min-width:220px;" data-special-select="${cc}|${type}">
                ${hasStandard ? `<option value="" ${current===''?'selected':''}>Standard</option>` : ''}
                ${options.map(o => `<option value="${o}" ${current===o?'selected':''}>${o}</option>`).join('')}
              </select>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');

  blocks.querySelectorAll('[data-special-select]').forEach(sel => {
    sel.addEventListener('change', () => {
      const [cc, type] = sel.dataset.specialSelect.split('|');
      ensureCountryConfig(cc).specialByType[type] = sel.value || null;
    });
  });
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
function computeResult() {
  const countryResults = appState.selectedCountries.map(cc => {
    const cfg = ensureCountryConfig(cc);
    const rows = rowsForCountry(cc);

    const selectedRows = [];
    ['IA','IB','II'].forEach(type => {
      if (appState.globalCounts[type] <= 0) return;
      const row = resolveRow(cc, cfg.role, type, cfg.specialByType[type]);
      if (row) selectedRows.push(row);
    });

    if (selectedRows.length === 0) {
      return { cc, role: cfg.role, strengths: cfg.strengths, items: [], total: 0, hasData: false };
    }

    // ── Combined run (actual total, respects grouping/subsumption rules) ──
    const globalCounts = { M: appState.globalCounts.IA, N: appState.globalCounts.IB, O: appState.globalCounts.II };
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
      const singleCounts = { M: r.type==='IA' ? appState.globalCounts.IA : 0,
                             N: r.type==='IB' ? appState.globalCounts.IB : 0,
                             O: r.type==='II' ? appState.globalCounts.II : 0 };
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
      const count = appState.globalCounts[r.type];
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
  });

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

// ---- Step 3: result ----
function renderStepResult() {
  const res = appState.results;

  const countryRows = res.countries.map((cr) => {

    const itemLines = cr.items.map(it => {
      const r = it.row;
      const label = r.special ? `${typeLabel(r.type)} – ${r.special}` : typeLabel(r.type);
      const countLabel = `${it.count}×`;
      const displayAmtValue = (it.capValue !== null && it.rawSumSingle > it.singleTotal + 0.01)
        ? it.rawSumSingle   // show the uncapped raw amount when per-type cap fired
        : (it.singleTotal !== null ? it.singleTotal : it.total);
      const displayAmt = fmtEUR(displayAmtValue);

      // No extra "(before cap:)" hint needed — the raw amount IS the line display
      const uncappedHint = '';
      return { html: `<span class="bd-meta" style="display:block;">${countLabel} ${label} – ${displayAmt}${uncappedHint}</span>`, label, countLabel, eurValue: displayAmtValue };
    });
    const itemLinesHtml = itemLines.map(l => l.html).join('');

    // ── Cap annotation: one per country ──
    // Priority: group cap (sum of all types exceeds country ceiling) takes
    // precedence and replaces per-type caps, since it is the binding rule.
    const firedCaps = cr.items.filter(it => it.capValue !== null).map(it => it.capValue);
    let capNote = '';
    if (cr.groupCapValue !== null) {
      // Group cap: show the cap value and the uncapped sum so the user sees the difference
      capNote = `<div class="fee-note fee-note--cap"><span class="fn-label">Cap fee applied (total before cap: ${fmtEUR(cr.sumOfSingles)}):</span><span class="fn-amount">${fmtEUR(cr.groupCapValue)}</span></div>`;
    } else if (firedCaps.length > 0) {
      capNote = `<div class="fee-note fee-note--cap"><span class="fn-label">Cap fee applied:</span><span class="fn-amount">${fmtEUR(Math.max(...firedCaps))}</span></div>`;
    }

    // ── Grouping annotation: one per country ──
    // If grouping fired for more than one item, show the highest type's
    // rate (Type II > Type IB > Type IA), matching how the fee itself is
    // determined by the highest type present.
    const firedGrouping = cr.items.filter(it => it.groupingFee !== null);
    const topGrouping = firedGrouping.reduce((best, it) =>
      (!best || TYPE_PRIORITY[it.row.type] > TYPE_PRIORITY[best.row.type]) ? it : best, null);
    // The amount shown is the row's real total (already correctly includes
    // any per-additional-strength surcharge) — not the raw K rate, which
    // only covers the 1st strength. When there's more than one strength,
    // the label spells out the breakdown instead of just naming the rate.
    let groupNote = '';
    if (topGrouping) {
      const hasBreakdown = cr.strengths > 1 && topGrouping.groupingBase !== null && topGrouping.groupingPerAdditional !== null && Math.abs(topGrouping.groupingPerAdditional) > 0.01;
      const label = hasBreakdown
        ? `Grouping fee applied (${fmtEUR(topGrouping.groupingBase)} for the 1st strength + ${fmtEUR(topGrouping.groupingPerAdditional)} for each additional strength):`
        : 'Grouping fee applied:';
      groupNote = `<div class="fee-note fee-note--group"><span class="fn-label">${label}</span><span class="fn-amount">${fmtEUR(topGrouping.total)}</span></div>`;
    }

    const annotations = capNote + groupNote;

    // Local currency block: heading, FX rate, each variation line converted to
    // local currency (mirrors the EUR lines above 1:1), then the total — right-aligned.
    const hasLocal = cr.hasData && cr.currency && cr.fxRate != null && cr.totalLocal != null;
    const localItemLines = hasLocal ? itemLines.map(l => {
      const localValue = (l.eurValue !== null && l.eurValue !== undefined) ? l.eurValue * cr.fxRate : null;
      const localAmt = localValue !== null ? fmtLocalCurrency(localValue, cr.currency) : '–';
      return `<span class="bd-meta" style="display:block;">${l.countLabel} ${l.label} – ${localAmt}</span>`;
    }).join('') : '';
    const localBlock = hasLocal ? `
      <div class="local-currency-row">
        <div class="lc-header">
          <span class="lc-title">Fees in local currency</span>
          <span class="lc-rate">${fmtRate(cr.fxRate, cr.currency)}</span>
        </div>
        <div class="lc-items">${localItemLines}</div>
        <div class="lc-total">
          <span class="lc-total-label">Total</span>
          <span class="lc-amount">${fmtLocalCurrency(cr.totalLocal, cr.currency)}</span>
        </div>
      </div>` : '';

    // EUR total column
    const eurLabel = (cr.currency && cr.fxRate) ? 'EUR equivalent' : '';
    const amountBlock = cr.hasData
      ? `<div class="bd-amount-col">
           ${eurLabel ? `<span class="bd-meta" style="text-align:right;display:block;margin-bottom:2px;">${eurLabel}</span>` : ''}
           <span class="bd-amount">${fmtEUR(cr.total)}</span>
         </div>`
      : `<span class="bd-amount">–</span>`;

    return `
      <div class="breakdown-row">
        <div class="bd-top">
          <div class="bd-left">
            <span class="bd-name">${COUNTRY_NAMES[cr.cc]} <span class="badge">${cr.cc}</span></span>
            <span class="bd-meta"><b>${roleLabel(cr.role)}</b> · <b>${cr.strengths} strength${cr.strengths===1?'':'s'}</b></span>
            ${itemLinesHtml}
          </div>
          ${amountBlock}
        </div>
        ${annotations}
        ${localBlock}
      </div>
    `;
  // Insert a divider element between rows (not after the last one)
  }).join('<div class="breakdown-divider"></div>');

  const anySubsumed = res.countries.some(cr => cr.items.some(it => it.subsumed));
  const anyNoData = res.countries.some(cr => !cr.hasData);

  const lastUpdated = (typeof IMPRINT !== 'undefined' && IMPRINT.length > 0) ? formatImprintDate(IMPRINT[0].date) : null;

  contentEl.innerHTML = `
    <div class="result-panel">
      <div class="rp-top-row">
        <div class="rp-label">Total fee — ${res.countries.length} ${res.countries.length===1?'country':'countries'}</div>
        ${lastUpdated ? `<div class="rp-updated">Last updated: ${lastUpdated}</div>` : ''}
      </div>
      <div class="rp-total"><span class="cur">EUR</span>${new Intl.NumberFormat('en-IE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(res.grandTotal)}</div>
      <div class="rp-sub">${res.countries.map(cr=>cr.cc).join(' · ')}</div>
    </div>

    <div class="panel" style="margin-bottom:18px;">
      <h2 style="margin-bottom:14px;">Fees by country</h2>
      <div class="breakdown">${countryRows}
        <div class="breakdown-row total-row">
          <div class="bd-top">
            <div class="bd-left">
              <span class="bd-name">Total</span>
            </div>
            <div class="bd-amount-col">
              <span class="bd-amount">${fmtEUR(res.grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="export-buttons">
      <button class="btn-export" id="btnPrint">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Print
      </button>
      <button class="btn-export" id="btnExcel">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        Export Excel
      </button>
    </div>

    ${(typeof IMPRINT !== 'undefined' && IMPRINT.length > 0) ? `
    <div class="panel" style="margin-bottom:18px;">
      <button class="btn ghost" id="toggleChangelog" style="padding-left:0;">📋 View change history (${IMPRINT.length} entries)</button>
      <div id="changelogPanel" style="display:none; margin-top:14px;"></div>
    </div>
    ` : ''}

    ${(typeof HA_WEBSITES !== 'undefined' && HA_WEBSITES.length > 0) ? `
    <div class="panel" style="margin-bottom:18px;">
      <button class="btn ghost" id="toggleHaWebsites" style="padding-left:0;">🔗 Update status and link to HA websites (${HA_WEBSITES.length} entries)</button>
      <div id="haWebsitesPanel" style="display:none; margin-top:14px;"></div>
    </div>
    ` : ''}

    ${anyNoData ? `<div class="note-box">One or more countries did not return a fee for the selected combination. Please double-check the role/variation selection for the affected country.</div>` : ''}

    <div class="nav-row">
      <button class="btn ghost" id="back3">← Edit selection</button>
      <button class="btn" id="restart">New calculation</button>
    </div>
  `;

  document.getElementById('back3').addEventListener('click', () => setStep(2));

  // ── Print ──
  document.getElementById('btnPrint').addEventListener('click', () => window.print());

  // ── Export Excel ──
  document.getElementById('btnExcel').addEventListener('click', () => exportExcel(res));

  const changelogBtn = document.getElementById('toggleChangelog');
  if (changelogBtn) {
    changelogBtn.addEventListener('click', () => {
      const panel = document.getElementById('changelogPanel');
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

  const haWebsitesBtn = document.getElementById('toggleHaWebsites');
  if (haWebsitesBtn) {
    haWebsitesBtn.addEventListener('click', () => {
      const panel = document.getElementById('haWebsitesPanel');
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

  document.getElementById('restart').addEventListener('click', () => {
    appState.selectedCountries = [];
    appState.countryConfig = {};
    appState.globalCounts = { IA: 0, IB: 0, II: 0 };
    appState.results = null;
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

function exportExcel(res) {
  if (typeof XLSX === 'undefined') {
    alert('Excel export library not loaded. Please check your internet connection and try again.');
    return;
  }

  const ws_data = [];
  const numberCells = []; // { r, c, format } — 0-indexed, applied after the sheet is built
  const dateCells = [];   // { r, c, format }
  const boldRows = [];    // 0-indexed row numbers to bold (best-effort; harmless if unsupported)

  function pushRow(row) {
    ws_data.push(row);
    return ws_data.length - 1; // 0-indexed row just added
  }

  const lastUpdatedDate = (typeof IMPRINT !== 'undefined' && IMPRINT.length > 0 && IMPRINT[0].date)
    ? new Date(IMPRINT[0].date + 'T00:00:00') : null;

  // ── Metadata block ──
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

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(ws_data);

  // ── Column widths (fixed 10-column layout, both tables share it) ──
  ws['!cols'] = [
    { wch: 22 }, // Country
    { wch: 6  }, // Code
    { wch: 20 }, // Role
    { wch: 10 }, // Strengths
    { wch: 16 }, // Type IA
    { wch: 16 }, // Type IB
    { wch: 16 }, // Type II
    { wch: 16 }, // Total / Total (local)
    { wch: 14 }, // n.a. / Exchange rate
    { wch: 44 }, // Notes
  ];

  // ── Apply number/date formats and (best-effort) bold ──
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

  XLSX.utils.book_append_sheet(wb, ws, 'Variation Fees');

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
