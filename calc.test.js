import test from 'node:test';
import assert from 'node:assert/strict';
import { doseToUnits, chooseBacWater, buildSchedule, planVials, syringeSize, splitBlendDose, planCost, concentration } from './calc.js';
import { pairStatus, compatibilityMatrix, arrangePlan, mergeSchedules, arrangeSequential } from './combine.js';

// ---------- calc.js: spec §15.2 ----------

test('doseToUnits', () => {
  assert.deepEqual(doseToUnits(500, 20, 2), { ml: 0.05, units: 5 });
  assert.deepEqual(doseToUnits(2000, 10, 1), { ml: 0.2, units: 20 });
});

test('chooseBacWater picks whole units near 20', () => {
  assert.equal(chooseBacWater(20, [500]), 2);
  assert.equal(chooseBacWater(10, [2000]), 1);
});

test('chooseBacWater returns null when no volume is measurable', () => {
  // 1 mg vial at 10 mcg: every candidate lands under 4 units
  assert.equal(chooseBacWater(1, [10]), null);
});

test('chooseBacWater respects vial capacity', () => {
  assert.ok(chooseBacWater(20, [500], 1) <= 1 || chooseBacWater(20, [500], 1) === null);
});

test('buildSchedule event counts', () => {
  assert.equal(buildSchedule([{ weeks: 6, frequency: 'daily', doseMcg: 500 }]).length, 42);
  assert.equal(buildSchedule([{ weeks: 12, frequency: 'weekly', doseMcg: 2000 }]).length, 12);
  assert.equal(buildSchedule([{ weeks: 8, frequency: '2x_week', doseMcg: 500 }]).length, 16);
  assert.equal(buildSchedule([{ weeks: 4, frequency: '5on2off', doseMcg: 500 }]).length, 20);
  assert.equal(buildSchedule([{ weeks: 2, frequency: 'eod', doseMcg: 500 }]).length, 7);
});

test('buildSchedule runs phases back to back and keeps per-phase doses', () => {
  const events = buildSchedule([
    { name: 'Titration', weeks: 4, frequency: 'weekly', doseMcg: 2500 },
    { name: 'Maintenance', weeks: 8, frequency: 'weekly', doseMcg: 5000 },
  ]);
  assert.equal(events.length, 12);
  assert.equal(events[0].doseMcg, 2500);
  assert.equal(events[4].doseMcg, 5000); // phase 2 starts at day 28
  assert.equal(events[4].dayOffset, 28);
  // Problem 3: phase labels must not share a dose when the DB says they differ
  assert.notEqual(events[0].doseMcg, events[4].doseMcg);
});

test('buildSchedule rejects an unknown frequency', () => {
  assert.throws(() => buildSchedule([{ weeks: 1, frequency: 'twice_daily', doseMcg: 100 }]), /Unknown frequency/);
});

test('planVials', () => {
  const daily = buildSchedule([{ weeks: 6, frequency: 'daily', doseMcg: 500 }]);
  assert.deepEqual(planVials(daily, 20), { vials: 2, leftoverMcg: 19000, reconstitute: [
    { dayOffset: 0, vialNumber: 1 }, { dayOffset: 40, vialNumber: 2 },
  ] });

  const weekly = buildSchedule([{ weeks: 12, frequency: 'weekly', doseMcg: 2000 }]);
  const r = planVials(weekly, 10);
  assert.equal(r.vials, 3);
  assert.equal(r.leftoverMcg, 6000);
});

test('planVials opens a new vial when the old one passes its stable window', () => {
  const events = buildSchedule([{ weeks: 6, frequency: 'daily', doseMcg: 100 }]);
  assert.equal(planVials(events, 20).vials, 1); // plenty of peptide left
  assert.equal(planVials(events, 20, 28).vials, 2); // but it expires after 28 days
});

test('planVials rejects a dose larger than the vial', () => {
  assert.throws(() => planVials([{ dayOffset: 0, doseMcg: 30000 }], 20), /exceeds a full/);
});

test('syringeSize', () => {
  assert.equal(syringeSize(5), '0.3 ml (30 units)');
  assert.equal(syringeSize(40), '0.5 ml (50 units)');
  assert.equal(syringeSize(75), '1 ml (100 units)');
});

test('splitBlendDose', () => {
  assert.deepEqual(splitBlendDose(500, [{ name: 'BPC-157', mg: 10 }, { name: 'TB-500', mg: 10 }]), [
    { name: 'BPC-157', doseMcg: 250 }, { name: 'TB-500', doseMcg: 250 },
  ]);
});

test('concentration rejects nonsense input', () => {
  assert.throws(() => concentration(20, 0), /must be > 0/);
});

test('planCost counts supplies per injection', () => {
  const supplies = { bacWater: { vialMl: 30, priceUsd: 6 }, syringe: { priceUsd: 0.25 }, swab: { priceUsd: 0.03 } };
  const cost = planCost({ vials: 2, injections: 42, bacMl: 2, product: { name: 'BPC-157', priceUsd: 60 }, supplies });
  assert.equal(cost.lines[0].totalUsd, 120);
  assert.equal(cost.lines[2].qty, 42);
  assert.equal(cost.lines[3].qty, 84);
  assert.equal(cost.totalUsd, 120 + 6 + 10.5 + 2.52);
});

// ---------- combine.js: spec §15.2 ----------

const COMPAT = [
  { a: 'A', b: 'B', status: 'synergy', note: 'Complementary mechanisms.' },
  { a: 'A', b: 'C', status: 'avoid', note: 'Not together.' },
];

const products = () => [
  { id: 'A', totalDays: 42, events: buildSchedule([{ weeks: 6, frequency: 'daily', doseMcg: 500 }]) },
  { id: 'B', totalDays: 84, events: buildSchedule([{ weeks: 12, frequency: 'weekly', doseMcg: 2000 }]) },
  { id: 'C', totalDays: 28, events: buildSchedule([{ weeks: 4, frequency: 'daily', doseMcg: 500 }]) },
  { id: 'D', totalDays: 28, events: buildSchedule([{ weeks: 4, frequency: '5on2off', doseMcg: 500 }]) },
];

test('pairStatus treats an unlisted pair as no data', () => {
  assert.equal(pairStatus(COMPAT, 'A', 'D').status, 'none');
  assert.equal(pairStatus(COMPAT, 'B', 'A').status, 'synergy'); // symmetric
  assert.equal(pairStatus(COMPAT, 'A', 'A').status, 'same');
});

test('compatibilityMatrix covers every pair once', () => {
  const m = compatibilityMatrix(['A', 'B', 'C', 'A'], COMPAT);
  assert.equal(m.ids.length, 3);
  assert.equal(m.cells.length, 3);
});

test('arrangePlan places, sequences and drops', () => {
  const { placed, dropped } = arrangePlan(products(), COMPAT, { maxProducts: 4, maxInjectionsPerDay: 3, sequenceGapDays: 7 });
  assert.deepEqual(placed.map((p) => [p.id, p.startDay]), [['A', 0], ['B', 0], ['D', 91]]);
  assert.deepEqual(dropped, [{ id: 'C', reason: 'avoid', with: ['A'] }]);
});

test('arrangePlan drops anything past maxProducts', () => {
  const { dropped } = arrangePlan(products(), [], CONFIG_DEFAULT());
  assert.deepEqual(dropped, [{ id: 'D', reason: 'maxProducts' }]);
});
function CONFIG_DEFAULT() { return { maxProducts: 3, maxInjectionsPerDay: 3, sequenceGapDays: 7 }; }

test('mergeSchedules totals', () => {
  const { placed } = arrangePlan(products(), COMPAT, { maxProducts: 4, maxInjectionsPerDay: 3, sequenceGapDays: 7 });
  const merged = mergeSchedules(placed);
  assert.equal(merged.totalInjections, 74);
  assert.equal(merged.maxPerDay, 2);
  assert.equal(merged.totalDays, 119);
  // The calendar is built from these days, so the counts must agree
  assert.equal(merged.days.reduce((n, d) => n + d.doses.length, 0), merged.totalInjections);
});

test('arrangeSequential removes all overlap', () => {
  const { placed } = arrangeSequential(products().slice(0, 2), COMPAT, CONFIG_DEFAULT());
  assert.deepEqual(placed.map((p) => [p.id, p.startDay]), [['A', 0], ['B', 49]]);
  assert.equal(mergeSchedules(placed).maxPerDay, 1);
});

test('arrangeSequential still refuses an avoid pair', () => {
  const { dropped } = arrangeSequential([products()[0], products()[2]], COMPAT, CONFIG_DEFAULT());
  assert.deepEqual(dropped, [{ id: 'C', reason: 'avoid', with: ['A'] }]);
});
