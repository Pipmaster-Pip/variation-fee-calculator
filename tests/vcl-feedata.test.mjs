import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const F = require("../variation-fee-calculator/assets/js/vcl-feedata.js");

const HA = [
  { cc: "IT", link_text: "AIFA", link_url: "https://www.aifa.gov.it/tariffe",
    comments: "Elenco Tariffe aggiornato ad Luglio 2025",
    updated_calc: "2026-05-11", checked_ha: "2026-05-11", payment: "proof of payment" },
  { cc: "DK", link_text: "DKMA", link_url: "https://x/dk", comments: "Takstbekendtgorelse 2026",
    updated_calc: "2026-01-09", checked_ha: "2026-05-11", payment: "invoice" },
  { cc: "DE", link_text: "BfArM", link_url: "https://www.bfarm.de/kosten",
    comments: "AMG-Kostenverordnung", updated_calc: "2026-03-02", checked_ha: "2026-05-11",
    payment: "invoice" }
];
const CUR = { DK: "DKK", NO: "NOK" };

test("countryMeta: euro country has no currency", () => {
  const m = F.countryMeta("IT", HA, CUR, null);
  assert.equal(m.currency, null);
  assert.equal(m.checked, "2026-05-11");
  assert.equal(m.source, "Elenco Tariffe aggiornato ad Luglio 2025");
  assert.equal(m.linkText, "AIFA");
  assert.equal(m.payment, "proof of payment");
});

test("countryMeta: non-euro country reports its currency", () => {
  assert.equal(F.countryMeta("DK", HA, CUR, null).currency, "DKK");
});

test("countryMeta: an override wins over the shipped value", () => {
  const ov = { countries: { IT: { checked: "2026-08-30", source: "Nuovo decreto" } } };
  const m = F.countryMeta("IT", HA, CUR, ov);
  assert.equal(m.checked, "2026-08-30");
  assert.equal(m.source, "Nuovo decreto");
  assert.equal(m.linkText, "AIFA", "an override must not disturb the shipped link");
});

test("countryMeta: an unknown country yields empty fields, never a throw", () => {
  const m = F.countryMeta("ZZ", HA, CUR, null);
  assert.equal(m.checked, "");
  assert.equal(m.source, "");
  assert.equal(m.linkUrl, "");
});

test("deriveRate: reads the rate off a local-currency row", () => {
  const rows = [{ F: 1054.1116911542383, F_lc: 7879 }];
  assert.equal(F.deriveRate(rows), 7.47454);
});

test("deriveRate: falls back to the grouping column when F is empty", () => {
  const rows = [{ F: null, F_lc: null, K: 1342.1561728213376, K_lc: 10032 }];
  assert.equal(F.deriveRate(rows), 7.47454);
});

test("deriveRate: a euro-only country has no rate", () => {
  assert.equal(F.deriveRate([{ F: 1055, F_lc: null }]), null);
});

test("groupByRole: RMS, CMS, national — in that order", () => {
  const rows = [
    { role: "national", type: "IA" }, { role: "CMS", type: "IA" }, { role: "RMS", type: "IA" }
  ];
  assert.deepEqual(F.groupByRole(rows).map(g => g.role), ["RMS", "CMS", "national"]);
});

test("groupByRole: an unexpected role is kept, sorted after the three known ones", () => {
  const rows = [{ role: "worksharing" }, { role: "RMS" }];
  assert.deepEqual(F.groupByRole(rows).map(g => g.role), ["RMS", "worksharing"]);
});

test("chipList: alphabetical, counts rows, skips countries without rows", () => {
  const names = { IT: "Italy", AT: "Austria", ZZ: "Nowhere" };
  const rows = [{ cc: "IT" }, { cc: "IT" }, { cc: "AT" }];
  assert.deepEqual(F.chipList(names, rows), [
    { cc: "AT", name: "Austria", n: 1 },
    { cc: "IT", name: "Italy", n: 2 }
  ]);
});

// The fee table calls Germany "DE - BfArM" (its only composite code) while the
// HA sheet calls it "DE" -- without the fallback the whole metadata strip stays
// empty for the one country whose HA entry is fully filled in.
test("countryMeta: the composite German code finds the plain \"DE\" HA entry", () => {
  const m = F.countryMeta("DE - BfArM", HA, CUR, null);
  assert.equal(m.cc, "DE - BfArM", "the reported code stays the one that was asked for");
  assert.equal(m.checked, "2026-05-11");
  assert.equal(m.edited, "2026-03-02");
  assert.equal(m.source, "AMG-Kostenverordnung");
  assert.equal(m.linkText, "BfArM");
  assert.equal(m.linkUrl, "https://www.bfarm.de/kosten");
  assert.equal(m.payment, "invoice");
  assert.equal(m.currency, null, "Germany is a euro country");
});

test("countryMeta: overrides for the composite code still win", () => {
  const ov = { countries: { "DE - BfArM": { checked: "2026-09-01", source: "Neue KostV" } } };
  const m = F.countryMeta("DE - BfArM", HA, CUR, ov);
  assert.equal(m.checked, "2026-09-01");
  assert.equal(m.source, "Neue KostV");
  assert.equal(m.linkText, "BfArM", "an override must not disturb the shipped link");
});

test("countryMeta: the exact match wins over the base-code fallback", () => {
  const ha = [
    { cc: "DE - BfArM", link_text: "composite", comments: "composite entry" },
    { cc: "DE", link_text: "plain", comments: "plain entry" }
  ];
  assert.equal(F.countryMeta("DE - BfArM", ha, CUR, null).linkText, "composite");
});

test("countryMeta: a plain code never falls back to another country", () => {
  const m = F.countryMeta("DK", HA, CUR, null);
  assert.equal(m.linkText, "DKMA");
  assert.equal(F.countryMeta("D", HA, CUR, null).linkText, "", "no prefix matching");
});
