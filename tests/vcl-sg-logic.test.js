'use strict';
var assert = require('assert');
var L = require('../variation-fee-calculator/assets/js/vcl-sg-logic.js');

var total = 0, failed = 0;
function t(name, fn) {
  total++;
  try { fn(); console.log('ok   - ' + name); }
  catch (e) { failed++; console.error('FAIL - ' + name + ': ' + e.message); }
}

t('allVariationsAreIA: base IA + grouping all IA -> true', function () {
  assert.strictEqual(L.computeAllVariationsAreIA('IA', ['IA', 'IA']), true);
});
t('allVariationsAreIA: any non-IA -> false', function () {
  assert.strictEqual(L.computeAllVariationsAreIA('IA', ['IB']), false);
});
t('allVariationsAreIA: no variations -> false', function () {
  assert.strictEqual(L.computeAllVariationsAreIA(null, []), false);
});

t('deadline: 2026-03-15 -> 2027-03-15', function () {
  var d = L.computeAnnualUpdateDeadline('2026-03-15');
  assert.strictEqual(d.getFullYear(), 2027);
  assert.strictEqual(d.getMonth(), 2); // March = 2
  assert.strictEqual(d.getDate(), 15);
});
t('deadline: leap-day 2028-02-29 -> 2029-02-28 (clamped)', function () {
  var d = L.computeAnnualUpdateDeadline('2028-02-29');
  assert.strictEqual(d.getFullYear(), 2029);
  assert.strictEqual(d.getMonth(), 1); // Feb = 1
  assert.strictEqual(d.getDate(), 28);
});
t('deadline: empty -> null', function () {
  assert.strictEqual(L.computeAnnualUpdateDeadline(''), null);
});
t('deadline: 9 months, 2026-03-15 -> 2026-12-15 (Annual Update earliest bound)', function () {
  var d = L.computeAnnualUpdateDeadline('2026-03-15', 9);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 11); // December = 11
  assert.strictEqual(d.getDate(), 15);
});
t('deadline: 9 months, month-end clamp, 2026-05-31 -> 2027-02-28', function () {
  var d = L.computeAnnualUpdateDeadline('2026-05-31', 9);
  assert.strictEqual(d.getFullYear(), 2027);
  assert.strictEqual(d.getMonth(), 1); // February = 1
  assert.strictEqual(d.getDate(), 28);
});

t('distinctRms: only mrpdcp rms, unique + sorted', function () {
  assert.deepStrictEqual(
    L.computeDistinctRms([{ kind: 'mrpdcp', rms: 'PL' }, { kind: 'mrpdcp', rms: 'FR' }, { kind: 'national' }, { kind: 'mrpdcp', rms: 'FR' }]),
    ['FR', 'PL']
  );
});

t('conflicts: 2 RMS + a chapter-C variation -> reported', function () {
  var c = L.computeSuperGroupingConflicts(
    [{ code: 'C.I.z', title: 'Safety change', chapter: 'C' }, { code: 'E.1.a', title: 'Admin', chapter: 'E' }],
    [{ kind: 'mrpdcp', rms: 'FR' }, { kind: 'mrpdcp', rms: 'PL' }]
  );
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].code, 'C.I.z');
  assert.deepStrictEqual(c[0].rmsList, ['FR', 'PL']);
});
t('conflicts: single RMS -> none', function () {
  assert.strictEqual(L.computeSuperGroupingConflicts([{ code: 'C.1', chapter: 'C' }], [{ kind: 'mrpdcp', rms: 'FR' }]).length, 0);
});
t('conflicts: only E/Q -> none', function () {
  assert.strictEqual(L.computeSuperGroupingConflicts([{ code: 'E.1', chapter: 'E' }, { code: 'Q.1', chapter: 'Q' }], [{ kind: 'mrpdcp', rms: 'FR' }, { kind: 'mrpdcp', rms: 'PL' }]).length, 0);
});

t('allowedKinds: no other procedures -> all three kinds', function () {
  var p1 = { kind: 'national' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([p1], p1), ['national', 'mrpdcp', 'cp']);
});
t('allowedKinds: other procedure is cp -> only cp allowed', function () {
  var p1 = { kind: 'cp' }, p2 = { kind: 'national' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([p1, p2], p2), ['cp']);
});
t('allowedKinds: other procedure is national -> national+mrpdcp allowed, cp excluded', function () {
  var p1 = { kind: 'national' }, p2 = { kind: 'cp' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([p1, p2], p2), ['national', 'mrpdcp']);
});
t('allowedKinds: other procedure is mrpdcp -> national+mrpdcp allowed, cp excluded', function () {
  var p1 = { kind: 'mrpdcp', rms: 'FR' }, p2 = { kind: 'cp' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([p1, p2], p2), ['national', 'mrpdcp']);
});
t('allowedKinds: multiple cp procedures group together fine', function () {
  var p1 = { kind: 'cp' }, p2 = { kind: 'cp' }, p3 = { kind: 'cp' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([p1, p2, p3], p3), ['cp']);
});
t('allowedKinds: cp takes precedence over national/mrpdcp deterministically', function () {
  var pCp = { kind: 'cp' }, pNat = { kind: 'national' }, pSelf = { kind: 'mrpdcp', rms: 'FR' };
  assert.deepStrictEqual(L.computeAllowedProcedureKinds([pCp, pNat, pSelf], pSelf), ['cp']);
});

console.log('\n' + (total - failed) + '/' + total + ' passed');
process.exit(failed ? 1 : 0);
