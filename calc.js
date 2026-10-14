// calc.js — single-protocol math. Pure functions, no I/O.
// All doses in mcg. U-100 syringes: 100 units = 1 ml.
// Nothing here may be produced by the model: every number on the page comes from this file.

export const UNITS_PER_ML = 100;

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const isWhole = (n) => Math.abs(n - Math.round(n)) < 1e-6;

/** Concentration of a reconstituted vial, in mcg per ml. */
export function concentration(vialMg, bacMl) {
  if (!(vialMg > 0) || !(bacMl > 0)) throw new Error('concentration: vialMg and bacMl must be > 0');
  return (vialMg * 1000) / bacMl;
}

/** Volume and syringe units for one dose. */
export function doseToUnits(doseMcg, vialMg, bacMl) {
  const ml = doseMcg / concentration(vialMg, bacMl);
  return { ml: round(ml, 3), units: round(ml * UNITS_PER_ML, 1) };
}

/**
 * Pick the BAC-water volume that makes every dose in the protocol easy to draw.
 * Doses under 4 units are too small to measure accurately on a U-100 syringe, and
 * over 100 units does not fit, so those volumes are rejected outright. Among the
 * rest, whole-unit doses win, then the one landing nearest ~20 units.
 * Returns null when no volume works — the UI then shows the manual calculator.
 */
export function chooseBacWater(vialMg, doses, capacityMl = 3) {
  const candidates = [0.5, 1, 1.5, 2, 2.5, 3].filter((v) => v <= capacityMl);
  let best = null;
  for (const v of candidates) {
    const units = doses.map((d) => (d / concentration(vialMg, v)) * UNITS_PER_ML);
    if (units.some((u) => u < 4 || u > 100)) continue;
    const score = units.filter(isWhole).length * 100 - Math.abs(median(units) - 20);
    if (!best || score > best.score) best = { bacMl: v, score };
  }
  return best ? best.bacMl : null;
}

/** Smallest syringe that fits the largest dose in the protocol. */
export function syringeSize(maxUnits) {
  return maxUnits <= 30 ? '0.3 ml (30 units)' : maxUnits <= 50 ? '0.5 ml (50 units)' : '1 ml (100 units)';
}

// Frequency codes stored in the DB, evaluated against the day index within a phase.
const FREQ = {
  daily: () => true,
  eod: (d) => d % 2 === 0,
  weekly: (d) => d % 7 === 0,
  '2x_week': (d) => [0, 3].includes(d % 7),
  '3x_week': (d) => [0, 2, 4].includes(d % 7),
  '5on2off': (d) => d % 7 < 5,
};

export const FREQUENCY_CODES = Object.keys(FREQ);

export const FREQUENCY_LABELS = {
  daily: 'Every day',
  eod: 'Every other day',
  weekly: 'Once a week',
  '2x_week': 'Twice a week',
  '3x_week': 'Three times a week',
  '5on2off': '5 days on, 2 days off',
};

/**
 * Expand protocol phases into one event per injection.
 * The calendar is built from this list, so its length is the injection count —
 * the old bug was a calendar generated separately from the plan.
 */
export function buildSchedule(phases) {
  const events = [];
  let day = 0;
  for (const p of phases) {
    const test = FREQ[p.frequency];
    if (!test) throw new Error(`Unknown frequency: ${p.frequency}`);
    for (let d = 0; d < p.weeks * 7; d++, day++) {
      if (test(d)) events.push({ dayOffset: day, doseMcg: p.doseMcg, phase: p.name });
    }
  }
  return events;
}

/**
 * Simulate vial use: open a new vial when the current one cannot cover the next
 * dose, or when it has passed its stable window after reconstitution.
 */
export function planVials(events, vialMg, stableDays = null) {
  const vialMcg = vialMg * 1000;
  let vials = 0;
  let remaining = 0;
  let openedDay = -Infinity;
  const reconstitute = [];

  for (const e of events) {
    if (e.doseMcg > vialMcg) throw new Error(`Dose ${e.doseMcg} mcg exceeds a full ${vialMg} mg vial`);
    const expired = stableDays != null && e.dayOffset - openedDay >= stableDays;
    if (remaining < e.doseMcg || expired) {
      vials++;
      remaining = vialMcg;
      openedDay = e.dayOffset;
      reconstitute.push({ dayOffset: e.dayOffset, vialNumber: vials });
    }
    remaining -= e.doseMcg;
  }
  return { vials, leftoverMcg: remaining, reconstitute };
}

/** Split a blend dose across its components, e.g. 500 mcg = 250 + 250. */
export function splitBlendDose(doseMcg, components) {
  if (!components?.length) return [];
  const totalMg = components.reduce((n, c) => n + c.mg, 0);
  return components.map((c) => ({ name: c.name, doseMcg: round((doseMcg * c.mg) / totalMg, 1) }));
}

/**
 * Full cost of a protocol: vials plus the supplies the injections consume.
 * One syringe and two swabs per injection; BAC water by total volume used.
 */
export function planCost({ vials, injections, bacMl, product, supplies }) {
  const bacVials = Math.ceil((vials * bacMl) / supplies.bacWater.vialMl);
  const lines = [
    { item: `${product.name} — ${vials} vial${vials === 1 ? '' : 's'}`, qty: vials, unitUsd: product.priceUsd, totalUsd: round(vials * product.priceUsd) },
    { item: 'Bacteriostatic water', qty: bacVials, unitUsd: supplies.bacWater.priceUsd, totalUsd: round(bacVials * supplies.bacWater.priceUsd) },
    { item: 'Insulin syringes', qty: injections, unitUsd: supplies.syringe.priceUsd, totalUsd: round(injections * supplies.syringe.priceUsd) },
    { item: 'Alcohol swabs', qty: injections * 2, unitUsd: supplies.swab.priceUsd, totalUsd: round(injections * 2 * supplies.swab.priceUsd) },
  ];
  return { lines, totalUsd: round(lines.reduce((n, l) => n + l.totalUsd, 0)) };
}
