import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSafety, computeBmi, filterCatalog, mentionsWeight, MIN_AGE } from './safety.js';

const CATALOG = [
  { id: 'sema', category: 'weight', tags: ['glpClass'], verified: true, inStock: true },
  { id: 'reta', category: 'weight', tags: ['glpClass'], verified: true, inStock: true },
  { id: 'bpc', category: 'healing', tags: ['growthPromoting'], verified: true, inStock: true },
  { id: 'dsip', category: 'sleep', tags: [], verified: true, inStock: true },
  { id: 'unverified', category: 'sleep', tags: [], verified: false, inStock: true },
  { id: 'oos', category: 'sleep', tags: [], verified: true, inStock: false },
];
const allow = (profile, goals = [], cfg) => filterCatalog(CATALOG, evaluateSafety(profile, goals, cfg)).map((p) => p.id);

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
  assert.equal(r.flags.filter((f) => f.severity === 'caution').length, 1);
});

test('unknown BMI excludes the class by default, and says how to fix it', () => {
  const r = evaluateSafety({ age: 30 }, ['lose weight']);
  assert.ok(r.excludedTags.includes('glpClass'));
  assert.match(r.flags[0].message, /height and weight/);
  assert.ok(!allow({ age: 30 }, ['lose weight']).includes('sema'));
});

test('unknown BMI can be configured to allow instead', () => {
  const r = evaluateSafety({ age: 30 }, [], { onUnknownBmi: 'allow' });
  assert.deepEqual(r.excludedTags, []);
});

test('cancer history removes growth-promoting products (§15.1 case 9)', () => {
  const profile = { age: 50, health: { cancerHistory: true } };
  assert.ok(!allow(profile, ['heal my tendon']).includes('bpc'));
});

test('MTC/MEN2 and pancreatitis each remove the GLP-1 class', () => {
  const bmi = { age: 40, weightValue: 100, weightUnit: 'kg', heightValue: 170, heightUnit: 'cm' };
  assert.ok(!allow({ ...bmi, health: { medullaryThyroidCancerOrMEN2: true } }).includes('sema'));
  assert.ok(!allow({ ...bmi, health: { pancreatitisHistory: true } }).includes('reta'));
});

test('eating-disorder history removes all weight products and offers support', () => {
  const profile = { age: 25, weightValue: 100, weightUnit: 'kg', heightValue: 170, heightUnit: 'cm', health: { eatingDisorderHistory: true } };
  const r = evaluateSafety(profile, ['I want to lose 10 kg']);
  assert.equal(r.blocked, null); // other goals still work
  assert.deepEqual(allow(profile, ['I want to lose 10 kg']), ['bpc', 'dsip']);
  const stop = r.flags.find((f) => f.severity === 'stop');
  assert.match(stop.message, /eating disorder/);
  assert.ok(stop.links[0].url);
});

test('the support wording follows the region', () => {
  const profile = { age: 25, health: { eatingDisorderHistory: true } };
  const us = evaluateSafety(profile, ['lose weight'], { region: 'US' });
  const se = evaluateSafety(profile, ['gå ner i vikt'], { region: 'SE' });
  assert.match(us.flags[0].links[0].label, /National Alliance/);
  assert.match(se.flags[0].links[0].label, /Frisk & Fri/);
});

test('exclusions apply even when no goal mentions weight', () => {
  // The gate is person-level: a weight product must not slip in via a combined plan
  const profile = { age: 25, health: { eatingDisorderHistory: true } };
  assert.deepEqual(allow(profile, ['sleep better']), ['bpc', 'dsip']);
});

// ---------- Cautions ----------

test('insulin or a sulfonylurea is a caution, not an exclusion', () => {
  const profile = { age: 55, weightValue: 110, weightUnit: 'kg', heightValue: 175, heightUnit: 'cm', health: { insulinOrSulfonylurea: true } };
  const r = evaluateSafety(profile, ['lose weight']);
  assert.deepEqual(r.excludedTags, []);
  assert.ok(r.flags.some((f) => f.severity === 'caution' && /low blood sugar/.test(f.message)));
});

test('a skipped profile still works, just more restricted', () => {
  const r = evaluateSafety({}, ['heal my tendon']);
  assert.equal(r.blocked, null);
  assert.deepEqual(allow({}, ['heal my tendon']), ['bpc', 'dsip']);
});

// ---------- Catalog filter ----------

test('filterCatalog drops unverified and out-of-stock products', () => {
  const ids = filterCatalog(CATALOG, {}).map((p) => p.id);
  assert.ok(!ids.includes('unverified'));
  assert.ok(!ids.includes('oos'));
});

test('mentionsWeight only affects wording', () => {
  assert.equal(mentionsWeight(['I want to lose weight']), true);
  assert.equal(mentionsWeight(['my knee hurts']), false);
});
