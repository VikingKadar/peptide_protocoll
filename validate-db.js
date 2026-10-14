/**
 * Checks data/peptides.json and data/compatibility.json before anything can be recommended.
 * A product is "ready" only when every clinical field is filled and internally consistent.
 * Anything else stays info-only, per brief §6.1: the model never invents a dose.
 *
 * Run: npm run validate
 * Exits 1 on errors (use in CI), 0 when only warnings remain.
 */
import fs from 'fs';
import { FREQUENCY_CODES, buildSchedule, planVials, chooseBacWater, doseToUnits } from './calc.js';

const peptides = JSON.parse(fs.readFileSync('data/peptides.json', 'utf-8'));
const compat = JSON.parse(fs.readFileSync('data/compatibility.json', 'utf-8'));
const supplies = JSON.parse(fs.readFileSync('data/supplies.json', 'utf-8'));

const errors = [];
const warnings = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);
const warn = (id, msg) => warnings.push(`${id}: ${msg}`);

const VALID_CATEGORIES = ['healing', 'weight', 'sleep', 'skin', 'cognition', 'performance', 'other'];
const VALID_TAGS = ['glpClass', 'growthPromoting', 'melanocortin', 'hormonal'];
const VALID_GRADES = ['A', 'B', 'C', 'D'];
const VALID_TIERS = ['starter', 'standard', 'advanced'];
const VALID_STATUSES = ['synergy', 'ok', 'caution', 'avoid'];

const ids = new Set();
const ready = [];

for (const p of peptides) {
  const id = p.id;
  if (!id) { err('(no id)', 'missing id'); continue; }
  if (ids.has(id)) err(id, 'duplicate id');
  ids.add(id);

  // Structural checks apply to every product, finished or not
  if (!VALID_CATEGORIES.includes(p.category)) err(id, `invalid category "${p.category}"`);
  for (const t of p.tags || []) if (!VALID_TAGS.includes(t)) err(id, `unknown tag "${t}"`);
  if (!(p.vialMg > 0)) err(id, 'vialMg must be > 0');
  if (!(p.vialCapacityMl > 0)) err(id, 'vialCapacityMl must be > 0');
  if (/\+/.test(p.legacyNameSv || p.name) && !p.components?.length) {
    warn(id, 'looks like a blend but has no components — dose split cannot be shown');
  }
  if (p.components?.length) {
    const sum = p.components.reduce((n, c) => n + c.mg, 0);
    if (Math.abs(sum - p.vialMg) > 0.01) err(id, `components sum to ${sum} mg but vialMg is ${p.vialMg}`);
  }

  const sourceIds = new Set((p.sources || []).map((s) => s.id));
  for (const o of p.reportedOutcomes || []) {
    if (!o.sourceId) err(id, `reportedOutcome "${o.text?.slice(0, 30)}…" has no sourceId`);
    else if (!sourceIds.has(o.sourceId)) err(id, `reportedOutcome cites unknown sourceId "${o.sourceId}"`);
  }
  for (const s of p.sources || []) {
    if (!s.url) warn(id, `source "${s.id}" has no url`);
  }

  // Protocols: every dose must be measurable and fit the vial
  for (const proto of p.protocols || []) {
    const where = `${id}/${proto.id}`;
    if (!VALID_TIERS.includes(proto.tier)) err(where, `invalid tier "${proto.tier}"`);
    if (!proto.phases?.length) { err(where, 'no phases'); continue; }

    for (const ph of proto.phases) {
      if (!FREQUENCY_CODES.includes(ph.frequency)) err(where, `unknown frequency "${ph.frequency}"`);
      if (!(ph.weeks > 0)) err(where, `phase "${ph.name}" has weeks ${ph.weeks}`);
      if (!(ph.doseMcg > 0)) err(where, `phase "${ph.name}" has doseMcg ${ph.doseMcg}`);
      if (ph.doseMcg > p.vialMg * 1000) err(where, `phase "${ph.name}" dose exceeds a full vial`);
    }

    if (errors.some((e) => e.startsWith(where))) continue;

    const doses = [...new Set(proto.phases.map((ph) => ph.doseMcg))];
    const bacMl = chooseBacWater(p.vialMg, doses, p.vialCapacityMl);
    if (bacMl == null) {
      warn(where, 'no BAC volume gives measurable units for every dose — users get the manual calculator');
    } else {
      const units = doses.map((d) => doseToUnits(d, p.vialMg, bacMl).units);
      if (units.some((u) => u < 4)) warn(where, `smallest dose is ${Math.min(...units)} units — hard to measure`);
    }

    const events = buildSchedule(proto.phases);
    const { vials } = planVials(events, p.vialMg, p.reconstitutedStableDays);
    if (p.reconstitutedStableDays == null) warn(where, 'reconstitutedStableDays unknown — vial count may be optimistic');
    if (vials > 12) warn(where, `needs ${vials} vials — check the dose`);
  }

  // Clinical completeness: what it takes to be recommended at all
  const missing = [];
  if (!p.protocols?.length) missing.push('protocols');
  if (!(p.priceUsd > 0)) missing.push('priceUsd');
  if (!p.contraindications?.length) missing.push('contraindications');
  if (!p.sideEffects?.common?.length) missing.push('sideEffects.common');
  if (!p.sideEffects?.stopAndSeekCare?.length) missing.push('sideEffects.stopAndSeekCare');
  if (!p.reportedOutcomes?.length) missing.push('reportedOutcomes');
  if (!VALID_GRADES.includes(p.evidenceGrade)) missing.push('evidenceGrade');
  if (!p.sources?.length) missing.push('sources');
  if (!p.storage?.afterMixing) missing.push('storage.afterMixing');
  if (!p.tagsVerified) missing.push('tagsVerified (safety gates depend on tags)');

  if (p.verified && missing.length) err(id, `marked verified but missing: ${missing.join(', ')}`);
  if (!p.verified) warn(id, `info-only — missing: ${missing.join(', ')}`);
  else ready.push(p);
}

// Compatibility table
const seen = new Set();
for (const c of compat) {
  const where = `compat ${c.a}×${c.b}`;
  if (!ids.has(c.a)) err(where, `unknown product "${c.a}"`);
  if (!ids.has(c.b)) err(where, `unknown product "${c.b}"`);
  if (c.a === c.b) err(where, 'pair with itself');
  if (!VALID_STATUSES.includes(c.status)) err(where, `invalid status "${c.status}"`);
  if (!c.note) warn(where, 'no note — the UI shows this text to users');
  const key = [c.a, c.b].sort().join('|');
  if (seen.has(key)) err(where, 'duplicate pair');
  seen.add(key);
}

// Coverage: pairs among ready products that nobody has reviewed yet
const readyIds = ready.map((p) => p.id);
let uncovered = 0;
for (let i = 0; i < readyIds.length; i++) {
  for (let j = i + 1; j < readyIds.length; j++) {
    if (!seen.has([readyIds[i], readyIds[j]].sort().join('|'))) uncovered++;
  }
}

for (const [key, s] of Object.entries(supplies)) {
  if (!(s.priceUsd > 0)) warn(`supplies.${key}`, 'priceUsd missing — cost totals will be wrong');
}

// Report
const show = (list, label) => {
  if (!list.length) return;
  console.log(`\n${label} (${list.length}):`);
  for (const line of list.slice(0, 40)) console.log('  ' + line);
  if (list.length > 40) console.log(`  …and ${list.length - 40} more`);
};

show(errors, '❌ ERRORS');
show(warnings, '⚠️  WARNINGS');

console.log(`\n${ready.length} of ${peptides.length} products ready to recommend.`);
console.log(`Compatibility: ${compat.length} pairs reviewed, ${uncovered} pairs between ready products still unreviewed.`);
if (!ready.length) console.log('No product can be recommended yet — fill in data/peptides.json.');

process.exit(errors.length ? 1 : 0);
