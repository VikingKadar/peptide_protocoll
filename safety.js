// safety.js — safety gates. Pure functions, no I/O. Brief §6.5.
//
// These run BEFORE the model is called, on every request, and the exclusions they
// return apply to every goal and to the combined plan. The model never sees an
// excluded product, so it cannot recommend one even if it ignores its instructions.
//
// Exclusions here are person-level, not goal-level: if a condition rules a class out,
// it is ruled out everywhere. Goal text is only used to pick the right wording.

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

/** Default when weight or height is missing. 'exclude' is the safe side. */
export const DEFAULT_CONFIG = { region: 'US', onUnknownBmi: 'exclude' };

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

/** Only used to choose wording, never to decide an exclusion. */
export function mentionsWeight(goals = []) {
  return goals.some((g) => WEIGHT_WORDS.test(typeof g === 'string' ? g : g?.text ?? ''));
}

const block = (reason, message, links = []) => ({ reason, message, links });

/**
 * Evaluate a profile against the gates.
 *
 * @returns {{
 *   blocked: {reason,message,links}|null,
 *   flags: Array<{severity:'stop'|'caution'|'info', goalId:null, message:string}>,
 *   excludedTags: string[],
 *   excludedCategories: string[],
 *   bmi: number|null
 * }}
 */
export function evaluateSafety(profile = {}, goals = [], config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const health = profile.health ?? {};
  const flags = [];
  const excludedTags = new Set();
  const excludedCategories = new Set();
  const bmi = computeBmi(profile);

  // --- Hard blocks: no model call at all ---

  if (profile.age != null && profile.age < MIN_AGE) {
    return {
      blocked: block('age', `Amida is for adults ${MIN_AGE} and over.`),
      flags, excludedTags: [], excludedCategories: [], bmi,
    };
  }

  if (health.pregnantOrBreastfeeding) {
    return {
      blocked: block(
        'pregnancy',
        "There's not enough safety data for use during pregnancy or breastfeeding, so we don't build protocols for it."
      ),
      flags, excludedTags: [], excludedCategories: [], bmi,
    };
  }

  // --- Class exclusions ---

  if (health.eatingDisorderHistory) {
    excludedCategories.add('weight');
    excludedTags.add('glpClass');
    const helpline = HELPLINES[cfg.region] ?? HELPLINES.US;
    flags.push({
      severity: 'stop',
      goalId: null,
      message: mentionsWeight(goals)
        ? "We don't build weight-loss protocols for people with a history of an eating disorder. Support is available if you want it."
        : "We've left out weight-loss compounds, based on your health answers.",
      links: [{ label: helpline.name, url: helpline.url, phone: helpline.phone }],
    });
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
    if (bmi == null) {
      if (cfg.onUnknownBmi === 'exclude') {
        excludedTags.add('glpClass');
        flags.push({
          severity: 'info',
          goalId: null,
          message: 'Add your height and weight to see whether GLP-1 class compounds are a fit for you.',
        });
      }
    } else if (bmi < BMI_MIN_FOR_GLP) {
      excludedTags.add('glpClass');
      flags.push({
        severity: 'info',
        goalId: null,
        message: `Weight-loss compounds in this class are studied in people with a BMI of ${BMI_MIN_FOR_GLP} or above. Yours is ${bmi}.`,
      });
    } else if (bmi < BMI_CAUTION_MAX) {
      flags.push({
        severity: 'caution',
        goalId: null,
        message: `Your BMI is ${bmi}. This class is studied from BMI ${BMI_MIN_FOR_GLP} upwards when there's a weight-related condition, and from ${BMI_CAUTION_MAX} otherwise.`,
      });
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
    bmi,
  };
}

/**
 * The catalog the model is allowed to choose from.
 * Unverified products are dropped here too: no verified protocol, no recommendation.
 */
export function filterCatalog(products, { excludedTags = [], excludedCategories = [] } = {}) {
  return products.filter(
    (p) =>
      p.verified &&
      p.inStock &&
      !excludedCategories.includes(p.category) &&
      !(p.tags ?? []).some((t) => excludedTags.includes(t))
  );
}
