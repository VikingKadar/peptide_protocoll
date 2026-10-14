// safety.js — safety gates. Pure functions, no I/O. Brief §6.5.
//
// These run BEFORE the model is called, on every request. The model never sees an
// excluded product, so it cannot recommend one even if it ignores its instructions.
//
// Scope follows §6.5 literally:
//   - Person-level, applied to every goal: cancer history, MTC/MEN2, pancreatitis.
//   - Goal-level, applied only to goals about weight: BMI and eating-disorder history.
//
// Goal-level scoping depends on reading intent from free text (isWeightGoal), which
// is a keyword match and will sometimes miss. A goal it fails to recognise as a
// weight goal keeps the weight products available.

export const MIN_AGE = 18;

// BMI thresholds follow the approved labels for this drug class:
// BMI >= 30, or >= 27 with a weight-related condition.
export const BMI_MIN_FOR_GLP = 27;
export const BMI_CAUTION_MAX = 30;

export const HELPLINES = {
  US: {
    name: 'National Alliance for Eating Disorders',
    url: 'https://www.allianceforeatingdisorders.com/find-treatment/',
    phone: '1-866-662-1235',
  },
  SE: {
    name: 'Frisk & Fri — Riksföreningen mot ätstörningar',
    url: 'https://www.friskfri.se/',
    phone: '020-20 80 18',
  },
};

// onUnknownBmi: what to do when the profile was skipped. 'allow' lets the model
// recommend GLP-1 class products with no BMI check; 'exclude' holds them back.
export const DEFAULT_CONFIG = { region: 'US', onUnknownBmi: 'allow' };

/** BMI from the profile's own units. Returns null when either value is missing. */
export function computeBmi(profile) {
  const { weightValue, weightUnit = 'lb', heightValue, heightUnit = 'cm', heightFeet, heightInches } = profile ?? {};

  let kg = null;
  if (weightValue > 0) kg = weightUnit === 'kg' ? weightValue : weightValue * 0.45359237;

  let metres = null;
  if (heightUnit === 'ft' || heightFeet > 0) {
    const inches = (heightFeet || 0) * 12 + (heightInches || 0);
    if (inches > 0) metres = inches * 0.0254;
  } else if (heightValue > 0) {
    metres = heightUnit === 'cm' ? heightValue / 100 : heightValue;
  }

  if (!kg || !metres) return null;
  return Math.round((kg / metres ** 2) * 10) / 10;
}

const WEIGHT_WORDS = /\b(weight|lose|losing|slim|fat loss|appetite|obes|bmi|gå ner|vikt|banta)\b/i;

/** Decides whether the weight-related gates apply to this goal. */
export function isWeightGoal(goal) {
  return WEIGHT_WORDS.test(typeof goal === 'string' ? goal : goal?.text ?? '');
}

/** Accepts plain strings or { id, text }; ids default to g1, g2, … */
export function normalizeGoals(goals = []) {
  return goals.map((g, i) => (typeof g === 'string' ? { id: `g${i + 1}`, text: g } : { id: g.id ?? `g${i + 1}`, text: g.text ?? '' }));
}

const block = (reason, message, links = []) => ({ reason, message, links });

/**
 * Evaluate a profile against the gates.
 *
 * @returns {{
 *   blocked: {reason,message,links}|null,
 *   flags: Array<{severity:'stop'|'caution'|'info', goalId:null, message:string}>,
 *   excludedTags: string[],          // apply to every goal
 *   excludedCategories: string[],
 *   perGoal: Array<{goalId, excludedTags: string[], excludedCategories: string[]}>,
 *   bmi: number|null
 * }}
 */
export function evaluateSafety(profile = {}, goals = [], config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const health = profile.health ?? {};
  const flags = [];
  const excludedTags = new Set();
  const excludedCategories = new Set();
  const scoped = new Map(); // goalId -> { tags:Set, categories:Set }
  const bmi = computeBmi(profile);
  const named = normalizeGoals(goals);
  const weightGoals = named.filter(isWeightGoal);
  const scopeTo = (goalId, { tag, category }) => {
    if (!scoped.has(goalId)) scoped.set(goalId, { tags: new Set(), categories: new Set() });
    if (tag) scoped.get(goalId).tags.add(tag);
    if (category) scoped.get(goalId).categories.add(category);
  };

  // --- Hard blocks: no model call at all ---

  if (profile.age != null && profile.age < MIN_AGE) {
    return {
      blocked: block('age', `Amida is for adults ${MIN_AGE} and over.`),
      flags, excludedTags: [], excludedCategories: [], perGoal: [], bmi,
    };
  }

  if (health.pregnantOrBreastfeeding) {
    return {
      blocked: block(
        'pregnancy',
        "There's not enough safety data for use during pregnancy or breastfeeding, so we don't build protocols for it."
      ),
      flags, excludedTags: [], excludedCategories: [], perGoal: [], bmi,
    };
  }

  // --- Class exclusions ---

  if (health.eatingDisorderHistory) {
    const helpline = HELPLINES[cfg.region] ?? HELPLINES.US;
    for (const goal of weightGoals) {
      scopeTo(goal.id, { category: 'weight' });
      scopeTo(goal.id, { tag: 'glpClass' });
      flags.push({
        severity: 'stop',
        goalId: goal.id,
        message:
          "We don't build weight-loss protocols for people with a history of an eating disorder. Support is available if you want it.",
        links: [{ label: helpline.name, url: helpline.url, phone: helpline.phone }],
      });
    }
  }

  if (health.cancerHistory) {
    excludedTags.add('growthPromoting');
    flags.push({
      severity: 'info',
      goalId: null,
      message: "We've left out compounds that promote tissue growth, because of your cancer history.",
    });
  }

  if (health.medullaryThyroidCancerOrMEN2) {
    excludedTags.add('glpClass');
    flags.push({
      severity: 'info',
      goalId: null,
      message: "We've left out GLP-1 class compounds, because of medullary thyroid cancer or MEN2 in your history.",
    });
  }

  if (health.pancreatitisHistory) {
    excludedTags.add('glpClass');
    flags.push({
      severity: 'info',
      goalId: null,
      message: "We've left out GLP-1 class compounds, because of your history of pancreatitis.",
    });
  }

  // --- BMI ---

  if (!excludedTags.has('glpClass')) {
    for (const goal of weightGoals) {
      if (bmi == null) {
        if (cfg.onUnknownBmi === 'exclude') {
          scopeTo(goal.id, { tag: 'glpClass' });
          flags.push({
            severity: 'info',
            goalId: goal.id,
            message: 'Add your height and weight to see whether GLP-1 class compounds are a fit for you.',
          });
        }
      } else if (bmi < BMI_MIN_FOR_GLP) {
        scopeTo(goal.id, { tag: 'glpClass' });
        flags.push({
          severity: 'info',
          goalId: goal.id,
          message: `Weight-loss compounds in this class are studied in people with a BMI of ${BMI_MIN_FOR_GLP} or above. Yours is ${bmi}.`,
        });
      } else if (bmi < BMI_CAUTION_MAX) {
        flags.push({
          severity: 'caution',
          goalId: goal.id,
          message: `Your BMI is ${bmi}. This class is studied from BMI ${BMI_MIN_FOR_GLP} upwards when there's a weight-related condition, and from ${BMI_CAUTION_MAX} otherwise.`,
        });
      }
    }
  }

  // --- Cautions that do not exclude anything ---

  if (health.insulinOrSulfonylurea) {
    flags.push({
      severity: 'caution',
      goalId: null,
      message: 'Insulin and sulfonylureas can cause low blood sugar alongside GLP-1 class compounds. Talk to your prescriber first.',
    });
  }

  if (health.otherMedications) {
    flags.push({
      severity: 'caution',
      goalId: null,
      message: 'Check your protocol against your current medications with a clinician.',
    });
  }

  if (profile.selfInjection === 'never') {
    flags.push({ severity: 'info', goalId: null, message: 'First time injecting — the technique steps are opened for you.' });
  }

  return {
    blocked: null,
    flags,
    excludedTags: [...excludedTags],
    excludedCategories: [...excludedCategories],
    perGoal: named.map((g) => ({
      goalId: g.id,
      excludedTags: [...(scoped.get(g.id)?.tags ?? [])],
      excludedCategories: [...(scoped.get(g.id)?.categories ?? [])],
    })),
    bmi,
  };
}

/**
 * The catalog the model is allowed to choose from.
 * Unverified products are dropped here too: no verified protocol, no recommendation.
 */
/** The catalog for one goal: everything excluded for the person, plus this goal's own. */
export function filterCatalogForGoal(products, safety, goalId) {
  const g = safety.perGoal?.find((x) => x.goalId === goalId);
  return filterCatalog(products, {
    excludedTags: [...safety.excludedTags, ...(g?.excludedTags ?? [])],
    excludedCategories: [...safety.excludedCategories, ...(g?.excludedCategories ?? [])],
  });
}

export function filterCatalog(products, { excludedTags = [], excludedCategories = [] } = {}) {
  return products.filter(
    (p) =>
      p.verified &&
      p.inStock &&
      !excludedCategories.includes(p.category) &&
      !(p.tags ?? []).some((t) => excludedTags.includes(t))
  );
}
