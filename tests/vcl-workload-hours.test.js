'use strict';
var assert = require('assert');
var H = require('../variation-fee-calculator/assets/js/vcl-workload-hours.js');

var total = 0, failed = 0;
function t(name, fn) {
  total++;
  try { fn(); console.log('ok   - ' + name); }
  catch (e) { failed++; console.error('FAIL - ' + name + ': ' + e.message); }
}

var SF = {
  worksharing:   { factor: 1.2, perNational: 1, perMrpdcp: 2 },
  grouping:      { factor: 1.2, perIA: 0.5, perIB: 1, perII: 2 },
  annualUpdate:  { factor: 1.2, perIA: 0.5 },
  superGrouping: { factor: 1.2, perNational: 1, perMrpdcp: 1, perCp: 1 }
};
function counts(over) {
  var base = {
    worksharingNational: 0, worksharingMrpdcp: 0,
    groupingIA: 0, groupingIB: 0, groupingII: 0,
    annualUpdateIaCount: 0,
    superGroupingNational: 0, superGroupingMrpdcp: 0, superGroupingCp: 0
  };
  for (var k in (over || {})) base[k] = over[k];
  return base;
}

t('addHours: nothing ticked -> 0', function () {
  assert.strictEqual(H.computeSubmissionAddHours({}, counts(), SF), 0);
});
t('addHours: SG CP-only, 2 CP procedures -> 2', function () {
  assert.strictEqual(
    H.computeSubmissionAddHours({ superGrouping: true }, counts({ superGroupingCp: 2 }), SF), 2);
});
t('addHours: SG national + MRP/DCP -> 2', function () {
  assert.strictEqual(
    H.computeSubmissionAddHours({ superGrouping: true }, counts({ superGroupingNational: 1, superGroupingMrpdcp: 1 }), SF), 2);
});
t('addHours: AU 4 x Type IA at 0.5 -> 2', function () {
  assert.strictEqual(
    H.computeSubmissionAddHours({ annualUpdate: true }, counts({ annualUpdateIaCount: 4 }), SF), 2);
});
t('addHours: Grouping 2 x IA (0.5) + 1 x II (2) -> 3', function () {
  assert.strictEqual(
    H.computeSubmissionAddHours({ grouping: true }, counts({ groupingIA: 2, groupingII: 1 }), SF), 3);
});
t('addHours: inactive option is ignored even if counts set', function () {
  assert.strictEqual(
    H.computeSubmissionAddHours({ superGrouping: false }, counts({ superGroupingCp: 5 }), SF), 0);
});
t('sgKinds: cp -> [cp]', function () {
  assert.deepStrictEqual(H.computeSgCounterKinds('cp'), ['cp']);
});
t('sgKinds: national -> [national, mrpdcp]', function () {
  assert.deepStrictEqual(H.computeSgCounterKinds('national'), ['national', 'mrpdcp']);
});
t('sgKinds: mrpdcp -> [national, mrpdcp]', function () {
  assert.deepStrictEqual(H.computeSgCounterKinds('mrpdcp'), ['national', 'mrpdcp']);
});

console.log('\n' + (total - failed) + '/' + total + ' passed');
process.exit(failed ? 1 : 0);
