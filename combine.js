// combine.js — multi-goal math. Pure functions, no I/O.
// Pair statuses come ONLY from the DB compatibility table. A missing pair is "none",
// which is treated as "no data" — never as safe to run at the same time.

export const CONCURRENT_OK = new Set(['synergy', 'ok', 'caution']);

export const CONFIG = { maxProducts: 3, maxInjectionsPerDay: 3, sequenceGapDays: 7 };

export const STATUS_LABELS = {
  synergy: 'Work well together',
  ok: 'OK together',
  caution: 'Caution',
  avoid: "Don't combine",
  none: 'No data — we run them one after another',
};

/** Look up one pair. Order does not matter; the table is symmetric. */
export function pairStatus(compat, a, b) {
  if (a === b) return { status: 'same' };
  const hit = compat.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  return hit
    ? { status: hit.status, note: hit.note, sourceId: hit.sourceId }
    : { status: 'none', note: 'No data on combining these.' };
}

/** Every pair among the products shown on the page, for the UI matrix. */
export function compatibilityMatrix(productIds, compat) {
  const ids = [...new Set(productIds)];
  const cells = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      cells.push({ a: ids[i], b: ids[j], ...pairStatus(compat, ids[i], ids[j]) });
    }
  }
  return { ids, cells };
}

/**
 * Place products on a timeline in priority order.
 * - "avoid": the lower-priority product is dropped entirely.
 * - "none" (no data): run it after the other one finishes, plus a gap.
 * - synergy / ok / caution: may overlap.
 *
 * @param products priority-ordered, each with { id, totalDays, events }
 */
export function arrangePlan(products, compat, cfg = CONFIG) {
  const placed = [];
  const dropped = [];

  for (const p of products.slice(0, cfg.maxProducts)) {
    const conflicts = placed.filter((q) => pairStatus(compat, p.id, q.id).status === 'avoid');
    if (conflicts.length) {
      dropped.push({ id: p.id, reason: 'avoid', with: conflicts.map((q) => q.id) });
      continue;
    }
    let start = 0;
    for (const q of placed) {
      if (!CONCURRENT_OK.has(pairStatus(compat, p.id, q.id).status)) {
        start = Math.max(start, q.startDay + q.totalDays + cfg.sequenceGapDays);
      }
    }
    placed.push({ ...p, startDay: start });
  }

  for (const p of products.slice(cfg.maxProducts)) dropped.push({ id: p.id, reason: 'maxProducts' });
  return { placed, dropped };
}

/** Merge the placed products' schedules into one day-by-day plan. */
export function mergeSchedules(placed) {
  const byDay = new Map();
  for (const p of placed) {
    for (const e of p.events) {
      const day = p.startDay + e.dayOffset;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push({ productId: p.id, doseMcg: e.doseMcg, phase: e.phase });
    }
  }
  const days = [...byDay.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([dayOffset, doses]) => ({ dayOffset, doses }));

  return {
    days,
    maxPerDay: Math.max(0, ...days.map((d) => d.doses.length)),
    totalInjections: days.reduce((n, d) => n + d.doses.length, 0),
    totalDays: Math.max(0, ...placed.map((p) => p.startDay + p.totalDays)),
  };
}

/**
 * Re-arrange so nothing overlaps, for "Run them one after another" when the
 * merged plan exceeds the user's injections-per-day limit.
 */
export function arrangeSequential(products, compat, cfg = CONFIG) {
  const noOverlap = products.flatMap((p, i) =>
    products.slice(i + 1).map((q) => ({ a: p.id, b: q.id, status: 'none', note: 'Scheduled one after another.' }))
  );
  const avoid = compat.filter((c) => c.status === 'avoid');
  return arrangePlan(products, [...avoid, ...noOverlap], cfg);
}
