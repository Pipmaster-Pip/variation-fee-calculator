// Annual maintenance fee reference data. Source: the "Annual Fees" sheet of
// Variation-Fee-Calculator-EU.xlsx (never modified). One entry per country; `tariffs` holds one
// variant per row of the sheet. `role` is set only where the fee splits by RMS/CMS/national;
// `addStrength: null` means the fee does not scale with the number of strengths. Amounts are in
// `ccy` units (converted to EUR downstream via the shared FX rates). Dual-export like the other
// data modules.
(function (root) {
  "use strict";

  var COUNTRIES = [
    { cc: "AT", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "rms", label: "RMS", role: "RMS", base: 3965, addStrength: 3965, ccy: "EUR" },
      { id: "cms", label: "CMS", role: "CMS", base: 2052, addStrength: 2052, ccy: "EUR" },
      { id: "national", label: "national", role: "national", base: 1709, addStrength: 1709, ccy: "EUR" },
    ] },
    { cc: "BE", hasAnnual: true, turnoverBased: true, note: "Annual fee per packs sold", tariffs: [] },
    { cc: "BG", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 127.82, addStrength: null, ccy: "EUR" },
    ] },
    { cc: "CH", hasAnnual: true, turnoverBased: true, note: "Annual sales fee on medicines", tariffs: [] },
    { cc: "CY", hasAnnual: false, turnoverBased: false, note: "", tariffs: [] },
    { cc: "CZ", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "rms", label: "RMS", role: "RMS", base: 42795, addStrength: 42795, ccy: "CZK" },
      { id: "cmsnat", label: "CMS/national", role: "CMS", base: 21345, addStrength: 21345, ccy: "CZK" },
      { id: "cmsnat_nat", label: "CMS/national", role: "national", base: 21345, addStrength: 21345, ccy: "CZK" },
    ] },
    { cc: "DE", hasAnnual: false, turnoverBased: false, note: "", tariffs: [] },
    { cc: "DK", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 20116, addStrength: 20116, ccy: "DKK" },
    ] },
    { cc: "EE", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "rms", label: "RMS", role: "RMS", base: 600, addStrength: null, ccy: "EUR" },
      { id: "cms", label: "CMS", role: "CMS", base: 320, addStrength: null, ccy: "EUR" },
      { id: "national", label: "national", role: "national", base: 320, addStrength: null, ccy: "EUR" },
    ] },
    { cc: "EL", hasAnnual: true, turnoverBased: true, note: "depending on the national tariff system/turnover", tariffs: [] },
    { cc: "EU", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "reference", label: "Reference / innovative", role: null, base: 232400, addStrength: null, ccy: "EUR" },
      { id: "art10", label: "Art. 10(1)/(3) & 10c", role: null, base: 60300, addStrength: null, ccy: "EUR", isDefault: true },
      { id: "biosimilar", label: "Art. 10(4) Biosimilar", role: null, base: 118100, addStrength: null, ccy: "EUR" },
    ] },
    { cc: "ES", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "ref_le10", label: "Reference 8(3) ≤ 10 yrs", role: null, base: 1711.71, addStrength: 1711.71, ccy: "EUR" },
      { id: "generic_gt10", label: "Generic & 8(3) > 10 yrs", role: null, base: 855.85, addStrength: 855.85, ccy: "EUR", isDefault: true },
    ] },
    { cc: "FI", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 1550, addStrength: 1550, ccy: "EUR" },
    ] },
    { cc: "FR", hasAnnual: false, turnoverBased: false, note: "", tariffs: [] },
    { cc: "HR", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 318.54, addStrength: 318.54, ccy: "EUR" },
    ] },
    { cc: "HU", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 364500, addStrength: null, ccy: "HUF" },
    ] },
    { cc: "IE", hasAnnual: true, turnoverBased: false, note: "w/o Annual Enforcement Fee", tariffs: [
      { id: "le10", label: "Annual fee ≤ 10 MAs", role: null, base: 865, addStrength: 865, ccy: "EUR", isDefault: true },
      { id: "eachadd", label: "Annual fee each add. MA", role: null, base: 1080, addStrength: 1080, ccy: "EUR" },
      { id: "dormant", label: "Dormant MA", role: null, base: 463, addStrength: 463, ccy: "EUR" },
    ] },
    { cc: "IS", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 42600, addStrength: 42600, ccy: "ISK" },
    ] },
    { cc: "IT", hasAnnual: true, turnoverBased: false, note: "Annual fee per valid six-digit AIC", tariffs: [
      { id: "aic", label: "per AIC", role: null, base: 1879, addStrength: null, ccy: "EUR" },
    ] },
    { cc: "LT", hasAnnual: false, turnoverBased: false, note: "", tariffs: [] },
    { cc: "LU", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 100, addStrength: 100, ccy: "EUR" },
    ] },
    { cc: "LV", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 850, addStrength: 850, ccy: "EUR" },
    ] },
    { cc: "MT", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "rms", label: "RMS", role: "RMS", base: 900, addStrength: 900, ccy: "EUR" },
      { id: "cms", label: "CMS", role: "CMS", base: 275, addStrength: 275, ccy: "EUR" },
      { id: "national", label: "national", role: "national", base: 275, addStrength: 275, ccy: "EUR" },
    ] },
    { cc: "NL", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "rms", label: "RMS", role: "RMS", base: 2330, addStrength: 2330, ccy: "EUR" },
      { id: "cms", label: "CMS", role: "CMS", base: 1830, addStrength: 1830, ccy: "EUR" },
      { id: "national", label: "national", role: "national", base: 1830, addStrength: 1830, ccy: "EUR" },
    ] },
    { cc: "NO", hasAnnual: false, turnoverBased: false, note: "", tariffs: [] },
    { cc: "PL", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "rms", label: "RMS", role: "RMS", base: 2730, addStrength: 2730, ccy: "PLN" },
      { id: "cms", label: "CMS", role: "CMS", base: 2100, addStrength: 2100, ccy: "PLN" },
      { id: "national", label: "national", role: "national", base: 2100, addStrength: 2100, ccy: "PLN" },
    ] },
    { cc: "PT", hasAnnual: false, turnoverBased: false, note: "", tariffs: [] },
    { cc: "RO", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 230, addStrength: 230, ccy: "EUR" },
    ] },
    { cc: "RS", hasAnnual: false, turnoverBased: false, note: "", tariffs: [] },
    { cc: "SE", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 60000, addStrength: 30000, ccy: "SEK" },
    ] },
    { cc: "SI", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "all", label: "RMS/CMS/national", role: null, base: 348, addStrength: 348, ccy: "EUR" },
    ] },
    { cc: "SK", hasAnnual: false, turnoverBased: false, note: "", tariffs: [] },
    { cc: "UK", hasAnnual: true, turnoverBased: false, note: "", tariffs: [
      { id: "standard", label: "POM – standard", role: null, base: 2908, addStrength: 2908, ccy: "GBP", isDefault: true },
      { id: "reduced", label: "POM – reduced", role: null, base: 1450, addStrength: 1450, ccy: "GBP" },
      { id: "newapi", label: "New API", role: null, base: 11627, addStrength: 11627, ccy: "GBP" },
    ] },
  ];

  var api = { updated: "2026-08-13", COUNTRIES: COUNTRIES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VCL_ANNUAL_DATA = api;
})(typeof window !== "undefined" ? window : this);
