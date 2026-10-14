import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSafety, computeBmi, filterCatalog, filterCatalogForGoal, isWeightGoal, MIN_AGE } from './safety.js';

const CATALOG = [
  { id: 'sema', category: 'weight', tags: ['glpClass'], verified: true, inStock: true },
  { id: 'reta', category: 'weight', tags: ['glpClass'], verified: true, inStock: true },
  { id: 'bpc', category: 'healing', tags: ['growthPromoting'], verified: true, inStock: true },
  { id: 'dsip', category: 'sleep', tags: [], verified: true, inStock: true },
  { id: 'unverified', category: 'sleep', tags: [], verified: false, inStock: true },
  { id: 'oos', category: 'sleep', tags: [], verified: true, inStock: false },
];
const allow = (profile, goals = [], cfg) => {
  const s = evaluateSafety(profile, goals, cfg);
  return filterCatalogForGoal(CATALOG, s, 'g1').map((p) => p.id);
};

// ---------- BMI ----------

test('computeBmi handles both unit systems', () => {
  assert.equal(computeBmi({ weightValue: 80, weightUnit: 'kg', heightValue: 180, heightUnit: 'cm' }), 24.7);
  assert.equal(computeBmi({ weightValue: 220, weightUnit: 'lb', heightFeet: 5, heightInches: 9, heightUnit: 'ft' }), 32.5);
  assert.equal(computeBmi({ weightValue: 80 }), null);
  assert.equal(computeBmi({}), null);
});

// ---------- Hard blocks (spec §15.1 case 8) ----------

test('under 18 is blocked before anything else', () => {
  const r = evaluateSafety({ age: 17 });
  assert.equal(r.blocked.reason, 'age');
  assert.match(r.blocked.message, new RegExp(`${MIN_AGE} and over`));
});

test('pregnancy is blocked', () => {
  const r = evaluateSafety({ age: 30, health: { pregnantOrBreastfeeding: true } });
  assert.equal(r.blocked.reason, 'pregnancy');
});

test('a blocked profile excludes nothing, because nothing is shown at all', () => {
  const r = evaluateSafety({ age: 15, health: { cancerHistory: true } });
  assert.ok(r.blocked);
  assert.deepEqual(r.excludedTags, []);
});

// ---------- Class exclusions ----------

test('BMI 22 with a weight goal removes every glpClass product (§15.1 case 7)', () => {
  const profile = { age: 30, weightValue: 60, weightUnit: 'kg', heightValue: 165, heightUnit: 'cm' };
  assert.deepEqual(allow(profile, ['I want to lose weight']), ['bpc', 'dsip']);
});

test('BMI 32 keeps them', () => {
  const profile = { age: 30, weightValue: 95, weightUnit: 'kg', heightValue: 172, heightUnit: 'cm' };
  assert.ok(allow(profile, ['lose weight']).includes('sema'));
});

test('BMI between 27 and 30 is allowed but flagged', () => {
  const profile = { age: 30, weightValue: 80, weightUnit: 'kg', heightValue: 172, heightUnit: 'cm' };
  const r = evaluateSafety(profile, ['lose weight']);
  assert.equal(r.bmi, 27);
  assert.deepEqual(r.excludedTags, []);
  const caution = r.flags.find((f) => f.severity === 'caution');
  assert.equal(caution.goalId, 'g1');
});

test('unknown BMI allows the class by default — no BMI check happens at all', () => {
  assert.ok(allow({ age: 30 }, ['lose weight']).includes('sema'));
});

test('unknown BMI can be configured to exclude instead', () => {
  const ids = allow({ age: 30 }, ['lose weight'], { onUnknownBmi: 'exclude' });
  assert.ok(!ids.includes('sema'));
});

test('cancer history removes growth-promoting products from every goal (§15.1 case 9)', () => {
  const profile = { age: 50, health: { cancerHistory: true } };
  const s = evaluateSafety(profile, ['heal my tendon', 'sleep better']);
  assert.ok(s.excludedTags.includes('growthPromoting'));
  for (const id of ['g1', 'g2']) assert.ok(!filterCatalogForGoal(CATALOG, s, id).map((p) => p.id).includes('bpc'));
});

test('MTC/MEN2 and pancreatitis each remove the GLP-1 class', () => {
  const bmi = { age: 40, weightValue: 100, weightUnit: 'kg', heightValue: 170, heightUnit: 'cm' };
  assert.ok(!allow({ ...bmi, health: { medullaryThyroidCancerOrMEN2: true } }).includes('sema'));
  assert.ok(!allow({ ...bmi, health: { pancreatitisHistory: true } }).includes('reta'));
});

test('eating-disorder history removes weight products from a weight goal', () => {
  const profile = { age: 25, weightValue: 100, weightUnit: 'kg', heightValue: 170, heightUnit: 'cm', health: { eatingDisorderHistory: true } };
  const r = evaluateSafety(profile, ['I want to lose 10 kg']);
  assert.equal(r.blocked, null);
  assert.deepEqual(allow(profile, ['I want to lose 10 kg']), ['bpc', 'dsip']);
  const stop = r.flags.find((f) => f.severity === 'stop');
  assert.equal(stop.goalId, 'g1');
  assert.ok(stop.links[0].url);
});

test('the support wording follows the region', () => {
  const profile = { age: 25, health: { eatingDisorderHistory: true } };
  const us = evaluateSafety(profile, ['lose weight'], { region: 'US' });
  const se = evaluateSafety(profile, ['gå ner i vikt'], { region: 'SE' });
  assert.match(us.flags[0].links[0].label, /National Alliance/);
  assert.match(se.flags[0].links[0].label, /Frisk & Fri/);
});

test('weight gates are scoped to the goal, so other goals keep the full catalog', () => {
  const profile = { age: 25, health: { eatingDisorderHistory: true } };
  const s = evaluateSafety(profile, ['sleep better', 'lose 10 kg']);
  assert.deepEqual(filterCatalogForGoal(CATALOG, s, 'g1').map((p) => p.id), ['sema', 'reta', 'bpc', 'dsip']);
  assert.deepEqual(filterCatalogForGoal(CATALOG, s, 'g2').map((p) => p.id), ['bpc', 'dsip']);
});

test('a weight goal the keyword match misses keeps weight products available', () => {
  // The known cost of goal-level scoping
  const profile = { age: 25, weightValue: 60, weightUnit: 'kg', heightValue: 175, heightUnit: 'cm' };
  assert.ok(allow(profile, ['I want to look leaner for summer']).includes('sema'));
});

// ---------- Cautions ----------

test('insulin or a sulfonylurea is a caution, not an exclusion', () => {
  const profile = { age: 55, weightValue: 110, weightUnit: 'kg', heightValue: 175, heightUnit: 'cm', health: { insulinOrSulfonylurea: true } };
  const r = evaluateSafety(profile, ['lose weight']);
  assert.deepEqual(r.excludedTags, []);
  assert.ok(r.flags.some((f) => f.severity === 'caution' && /low blood sugar/.test(f.message)));
});

test('a skipped profile excludes nothing — no age, BMI or health answers to gate on', () => {
  const r = evaluateSafety({}, ['heal my tendon']);
  assert.equal(r.blocked, null);
  assert.deepEqual(r.excludedTags, []);
  assert.deepEqual(allow({}, ['heal my tendon']), ['sema', 'reta', 'bpc', 'dsip']);
});

// ---------- Catalog filter ----------

test('filterCatalog drops unverified and out-of-stock products', () => {
  const ids = filterCatalog(CATALOG, {}).map((p) => p.id);
  assert.ok(!ids.includes('unverified'));
  assert.ok(!ids.includes('oos'));
});

test('isWeightGoal decides whether the weight gates apply', () => {
  assert.equal(isWeightGoal('I want to lose weight'), true);
  assert.equal(isWeightGoal('my knee hurts'), false);
});
