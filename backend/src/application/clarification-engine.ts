/**
 * Capucine — ClarificationEngine
 *
 * DETERMINISTIC: Identifies when user input is ambiguous and generates
 * structured clarification questions.
 *
 * Rules:
 * - Never asks a clarification that silently modifies the user's request.
 * - Never invents missing information — always surfaces uncertainty explicitly.
 * - Each clarification has a trigger condition and a suggested question.
 * - The engine does NOT call AI. AI may format questions, but logic is here.
 *
 * Invariant 5: "Capucine ne modifie jamais silencieusement la volonté de
 * l'utilisateur pour obtenir davantage de résultats."
 */

import { PreferenceCriterion, PreferenceLevel } from '../domain/types';
import { hasStatedUsage } from './request-interpreter';

// ============================================================================
// TYPES
// ============================================================================

export type ClarificationTrigger =
  | 'ambiguous_budget'          // "pas trop cher" without amount
  | 'ambiguous_size'            // "grand écran" without measurement
  | 'conflicting_criteria'      // user wants X but also Y which conflicts with X
  | 'underspecified_category'   // could be multiple product types
  | 'missing_required_value'    // criterion has required level but no target value
  | 'incompatible_constraints'  // two constraints that cannot simultaneously be satisfied
  | 'ambiguous_location'        // "local" without specifying where
  | 'dual_interpretation'       // phrase could mean two different things
  | 'unknown_threshold'         // comparative without reference (faster, cheaper)
  | 'unspecified_usage';        // product category where the intended usage changes what to look for

export type ClarificationUrgency = 'blocking' | 'important' | 'optional';

/**
 * A single clarification opportunity.
 */
export interface ClarificationItem {
  id: string;
  trigger: ClarificationTrigger;
  urgency: ClarificationUrgency;

  /** Human-readable description of the ambiguity */
  ambiguityDescription: string;

  /** Suggested question to ask the user */
  suggestedQuestion: string;

  /** The criterion(s) involved */
  involvedCriteria: string[];

  /** Possible interpretations if the question is not answered */
  possibleInterpretations: Array<{
    interpretation: string;
    assumedValue: unknown;
    impact: string;
  }>;

  /** If false, the search can proceed with a safe default */
  blocksSearch: boolean;

  /** Safe default to use if user skips this clarification */
  safeDefault?: {
    value: unknown;
    description: string;
  };
}

export interface ClarificationAnalysis {
  requestId: string;
  opportunities: ClarificationItem[];
  blockingCount: number;
  importantCount: number;
  optionalCount: number;
  canProceedWithoutClarification: boolean;
  recommendedQuestions: ClarificationItem[];
}

// ============================================================================
// AMBIGUITY DETECTORS
// ============================================================================

interface AmbiguityRule {
  id: string;
  trigger: ClarificationTrigger;
  urgency: ClarificationUrgency;
  detect(criteria: PreferenceCriterion[], queryText?: string): DetectionResult | null;
}

interface DetectionResult {
  ambiguityDescription: string;
  suggestedQuestion: string;
  involvedCriteria: string[];
  possibleInterpretations: ClarificationItem['possibleInterpretations'];
  blocksSearch: boolean;
  safeDefault?: ClarificationItem['safeDefault'];
}

/**
 * Categories where the intended usage genuinely changes WHICH product is
 * right — the only ones the 'usage-unspecified' rule below will ask about.
 * A commuting headset, a studio headset and a gaming headset are different
 * products; a book is a book whatever you plan to do with it.
 */
const USAGE_SENSITIVE_CATEGORIES: ReadonlySet<string> = new Set([
  'casque',
  'ordinateur_portable',
  'clavier',
]);

const AMBIGUITY_RULES: AmbiguityRule[] = [
  // ── Unspecified usage ─────────────────────────────────────────────────────
  //
  // Asks ONE question — "for what usage?" — and only where the answer really
  // changes the search. Spec §14 is explicit about the trap to avoid: knowing
  // the user commutes must let Capucine work out that weight matters, NOT
  // force the user to specify every attribute. So this rule never asks "quel
  // poids maximum ?", "quelle autonomie ?", or anything derivable from the
  // usage — those are what the contextual mapping is for.
  //
  // Three gates keep it quiet:
  //   1. the category must be one where usage genuinely changes the answer
  //      (a commuting headset and a studio headset are different products;
  //      a book is a book);
  //   2. the user must not have stated a usage already (hasStatedUsage);
  //   3. it never blocks the search — Capucine searches now and refines if
  //      the user answers.
  {
    id: 'usage-unspecified',
    trigger: 'unspecified_usage',
    urgency: 'important',
    detect(criteria, queryText) {
      if (!queryText) return null;
      if (hasStatedUsage(queryText)) return null;

      const categoryCriterion = criteria.find(c => c.id === 'category');
      const values = (categoryCriterion?.parameters?.preferredValues as string[] | undefined) ?? [];
      const category = values.find(v => USAGE_SENSITIVE_CATEGORIES.has(v));
      if (!category) return null;

      return {
        ambiguityDescription:
          "L'usage prévu n'est pas précisé, alors qu'il change les dimensions pertinentes pour ce type de produit.",
        suggestedQuestion: 'Pour quel usage principal ? (musique, transports, sport, bureau, gaming…)',
        involvedCriteria: [categoryCriterion!.id],
        possibleInterpretations: [
          { interpretation: 'Transports / déplacements', assumedValue: 'transport', impact: 'Valorise autonomie, poids, réduction de bruit' },
          { interpretation: 'Bureau / télétravail', assumedValue: 'office', impact: 'Valorise micro, confort, réduction de bruit' },
          { interpretation: 'Sport', assumedValue: 'sport', impact: 'Valorise maintien, résistance, légèreté' },
          { interpretation: 'Gaming', assumedValue: 'gaming', impact: 'Valorise latence, micro, compatibilité' },
        ],
        blocksSearch: false,
        safeDefault: {
          value: undefined,
          description: "Rechercher sans signal d'usage — aucune dimension contextuelle n'est valorisée, aucune n'est pénalisée",
        },
      };
    },
  },

  // ── Budget ambiguity ──────────────────────────────────────────────────────
  {
    id: 'budget-no-amount',
    trigger: 'ambiguous_budget',
    urgency: 'important',
    detect(criteria, queryText) {
      const budgetCriterion = criteria.find(c =>
        c.id.includes('budget') || c.id.includes('price') || c.name.toLowerCase().includes('budget')
      );

      if (!budgetCriterion) return null;

      // Check if no concrete value
      const hasAmount = budgetCriterion.parameters?.maxBudget !== undefined ||
                        budgetCriterion.parameters?.targetValue !== undefined;
      if (hasAmount) return null;

      // Check if queryText has vague budget language
      const vagueBudget = queryText && /pas trop cher|raisonnable|abordable|économique|budget serré|pas cher/i.test(queryText);
      if (!vagueBudget && !budgetCriterion) return null;

      return {
        ambiguityDescription: 'Le budget mentionné est vague (pas de montant précis).',
        suggestedQuestion: 'Quel est votre budget maximum pour cet achat ?',
        involvedCriteria: [budgetCriterion?.id || 'budget'],
        possibleInterpretations: [
          { interpretation: 'Budget modeste', assumedValue: 300, impact: 'Filtre les offres > 300€' },
          { interpretation: 'Budget moyen', assumedValue: 600, impact: 'Filtre les offres > 600€' },
          { interpretation: 'Budget confortable', assumedValue: 1000, impact: 'Filtre les offres > 1000€' },
        ],
        blocksSearch: false,
        safeDefault: { value: undefined, description: 'Afficher toutes les offres sans filtre de prix' },
      };
    },
  },

  // ── Missing required value ────────────────────────────────────────────────
  {
    id: 'required-no-value',
    trigger: 'missing_required_value',
    urgency: 'blocking',
    detect(criteria) {
      const problematic = criteria.filter(c =>
        c.level === 'required' &&
        !c.parameters?.targetValue &&
        !c.parameters?.acceptedValues &&
        !c.parameters?.boolean &&
        !c.parameters?.maxBudget &&
        !c.parameters?.minBudget &&
        !c.parameters?.operator  // GenericCriterion-style: has operator = has a value spec
      );

      if (problematic.length === 0) return null;

      const names = problematic.map(c => c.name).join(', ');
      return {
        ambiguityDescription: `Critère(s) requis sans valeur cible : ${names}`,
        suggestedQuestion: `Quelle valeur souhaitez-vous pour : ${names} ?`,
        involvedCriteria: problematic.map(c => c.id),
        possibleInterpretations: [
          {
            interpretation: 'Critère présent mais valeur indifférente',
            assumedValue: 'any',
            impact: 'Le critère est évalué comme "doit exister"',
          },
        ],
        blocksSearch: true,
      };
    },
  },

  // ── Conflicting criteria ──────────────────────────────────────────────────
  {
    id: 'conflicting-budget-quality',
    trigger: 'conflicting_criteria',
    urgency: 'important',
    detect(criteria) {
      const hasLowBudget = criteria.some(c =>
        (c.id.includes('budget') || c.id.includes('price')) &&
        (c.parameters?.maxBudget as number) < 200
      );
      const hasHighQuality = criteria.some(c =>
        c.name.toLowerCase().includes('qualité') &&
        (c.level === 'required' || c.level === 'very_important')
      );

      if (!hasLowBudget || !hasHighQuality) return null;

      return {
        ambiguityDescription: 'Budget très serré (<200€) et exigence de haute qualité — potentiellement incompatibles.',
        suggestedQuestion: 'En cas de compromis nécessaire, préférez-vous rester dans votre budget ou accepter un prix légèrement supérieur pour la qualité ?',
        involvedCriteria: ['budget', 'quality'],
        possibleInterpretations: [
          {
            interpretation: 'Priorité au budget',
            assumedValue: 'budget_strict',
            impact: 'Les produits hors budget sont exclus même si de haute qualité',
          },
          {
            interpretation: 'Priorité à la qualité',
            assumedValue: 'quality_priority',
            impact: 'Le budget est traité comme une préférence, pas une contrainte dure',
          },
        ],
        blocksSearch: false,
        safeDefault: {
          value: 'budget_strict',
          description: 'Respect strict du budget (invariant : la volonté utilisateur n\'est pas modifiée)',
        },
      };
    },
  },

  // ── Underspecified category ───────────────────────────────────────────────
  {
    id: 'ambiguous-category',
    trigger: 'underspecified_category',
    urgency: 'blocking',
    detect(criteria, queryText) {
      if (!queryText) return null;

      const q = queryText.toLowerCase();

      // ── Context disambiguators: if ANY of these are present, the query
      //    already carries enough information to infer the category.
      //    A specific model reference (alphanumeric pattern like "wh-1000xm5",
      //    "iphone 15", "rtx 4090") essentially always uniquely identifies a category.
      const DISAMBIGUATORS: Record<string, RegExp[]> = {
        'casque': [
          // Audio context
          /\b(bluetooth|audio|anc|noise.cancel|hi.fi|hifi|headphone|earphone|écouteur|oreillette|sennheiser|bose|sony|audio.technica|beyerdynamic|jabra|jbl|bang|olufsen|airpod|galaxy.bud|wh-|wf-|qc\d|momentum|stax|focal|denon|shure|akg|marshall)\b/i,
          // Specific gaming context
          /\b(gaming|gamer|jeu|xbox|playstation|ps[45]|pc gaming|g.pro|hyperx|razer|steelseries|corsair|arctis)\b/i,
          // Specific moto context
          /\b(moto|scooter|intégral|jet|modulable|moto.cross|enduro|ece)\b/i,
          // Specific vélo context
          /\b(vélo|vtt|bike|cyclisme|aero|route|gravel)\b/i,
          // Product model pattern: ≥2 letters then digits (e.g. WH-1000XM5, XM5, M50x).
          // Requires letter prefix to avoid matching bare prices like "200€".
          /\b[a-z]{2,6}[-\s]?\d{2,6}[a-z0-9]*/i,
        ],
        'tablette': [
          // Tactile / tech context
          /\b(tactile|ipad|samsung|android|windows|surface|lenovo|huawei|xiaomi|fire|kindle|galaxy.tab|mediapad|draw|dessin|wacom)\b/i,
          // Medical tablet context
          /\b(médicament|comprimé|gélule|pharmacie|mg|dosage|posologie)\b/i,
          // Product model: ≥2 letters then digits (e.g. P125, K3). Requires \b to
          // avoid matching trailing letters of preceding words (e.g. "tablette 200").
          /\b[a-z]{2,6}[-\s]?\d{2,6}[a-z0-9]*/i,
        ],
        'clavier': [
          // Computer keyboard context
          /\b(mécanique|membrane|sans.fil|usb|azerty|qwerty|backlit|rgb|keychron|logitech|corsair|razer|ducky|anne.pro|switches|cherry|gateron|kailh|pc|ordinateur|mac|clavier.gamer)\b/i,
          // Musical keyboard context
          /\b(piano|midi|musique|octave|touche.lestée|yamaha|roland|casio|korg|synthé|numérique)\b/i,
          // Product model
          /[a-z]{1,4}[-\s]?\d{2,6}[a-z0-9]*/i,
        ],
        'écran': [
          // Monitor context
          /\b(moniteur|pc|144hz|4k|ultra.wide|ips|va|oled|amoled|hz|ms|pouce|inch|dell|lg|asus|aoc|benq|viewsonic|samsung)\b/i,
          // TV context
          /\b(tv|télé|téléviseur|smart.tv|netflix|hdmi|qled|neo|oled)\b/i,
          // Product model
          /[a-z]{1,4}[-\s]?\d{2,6}[a-z0-9]*/i,
        ],
        'montre': [
          // Smartwatch context
          /\b(connectée|smartwatch|apple.watch|galaxy.watch|fitbit|garmin|suunto|gps|santé|cardiaque|sport)\b/i,
          // Classical watch context
          /\b(automatique|mécanique|quartz|saphir|or|acier|rolex|omega|seiko|tissot|hamilton|breitling|tag.heuer|luminox)\b/i,
          // Product model
          /[a-z]{1,4}[-\s]?\d{2,6}[a-z0-9]*/i,
        ],
      };

      // Detect keywords that could mean multiple product types
      const ambiguousPhrases: Record<string, string[]> = {
        'casque': ['casque audio', 'casque moto', 'casque vélo'],
        'tablette': ['tablette tactile', 'tablette graphique', 'médicament en tablette'],
        'clavier': ['clavier d\'ordinateur', 'clavier musical / piano'],
        'écran': ['moniteur PC', 'TV', 'smartphone'],
        'montre': ['montre connectée', 'montre classique'],
      };

      for (const [term, interpretations] of Object.entries(ambiguousPhrases)) {
        if (!q.includes(term)) continue;

        // Check if there are no disambiguating category criteria already
        const hasCategoryCriterion = criteria.some(c =>
          c.id === 'category' ||
          c.parameters?.category !== undefined
        );
        if (hasCategoryCriterion) continue;

        // Check if the query already contains disambiguating context.
        // If ANY disambiguator pattern matches, the category is sufficiently clear
        // and we must NOT ask for clarification (INVARIANT 5: no silent modification).
        const disambiguators = DISAMBIGUATORS[term] ?? [];
        const alreadyDisambiguated = disambiguators.some(pattern => pattern.test(q));
        if (alreadyDisambiguated) continue;

        return {
          ambiguityDescription: `"${term}" peut désigner plusieurs types de produits.`,
          suggestedQuestion: `Quand vous dites "${term}", vous cherchez : ${interpretations.join(', ou ')} ?`,
          involvedCriteria: ['category'],
          possibleInterpretations: interpretations.map(i => ({
            interpretation: i,
            assumedValue: i,
            impact: `La recherche est limitée à la catégorie "${i}"`,
          })),
          blocksSearch: true,
        };
      }

      return null;
    },
  },

  // ── Comparative without reference ─────────────────────────────────────────
  {
    id: 'comparative-no-reference',
    trigger: 'unknown_threshold',
    urgency: 'optional',
    detect(criteria, queryText) {
      if (!queryText) return null;

      const comparatives = [
        { pattern: /\bplus (léger|petit|rapide|puissant|autonome)\b/i, dim: 'physical', label: 'comparatif relatif' },
        { pattern: /\bmoins (cher|lourd|encombrant)\b/i, dim: 'price', label: 'comparatif de prix' },
      ];

      for (const { pattern, label } of comparatives) {
        if (pattern.test(queryText)) {
          return {
            ambiguityDescription: `Expression comparative "${label}" sans référence absolue.`,
            suggestedQuestion: 'Pouvez-vous préciser par rapport à quoi ou donner une valeur cible ?',
            involvedCriteria: [],
            possibleInterpretations: [
              {
                interpretation: 'Préférence relative (par rapport au marché)',
                assumedValue: 'market_relative',
                impact: 'Pondération dans le classement, pas de filtre dur',
              },
            ],
            blocksSearch: false,
            safeDefault: {
              value: 'market_relative',
              description: 'Traité comme une préférence dans le classement',
            },
          };
        }
      }

      return null;
    },
  },
];

// ============================================================================
// CLARIFICATION ENGINE
// ============================================================================

/**
 * Deterministic clarification engine.
 *
 * No AI calls. All logic is rule-based and fully testable.
 * AI may be used downstream to PHRASE questions more naturally,
 * but the DETECTION and DECISION logic is deterministic.
 */
export class ClarificationEngine {
  private rules: AmbiguityRule[];

  constructor(customRules?: AmbiguityRule[]) {
    this.rules = customRules ?? AMBIGUITY_RULES;
  }

  /**
   * Analyze criteria for ambiguities.
   *
   * @param criteria - The effective criteria to analyze
   * @param queryText - The original user query text (optional, enables more rules)
   * @param requestId - For tracing
   */
  analyze(
    criteria: PreferenceCriterion[],
    queryText?: string,
    requestId?: string
  ): ClarificationAnalysis {
    const opportunities: ClarificationItem[] = [];
    let idCounter = 0;

    for (const rule of this.rules) {
      try {
        const result = rule.detect(criteria, queryText);
        if (result) {
          opportunities.push({
            id: `clarif-${requestId ?? 'unknown'}-${++idCounter}`,
            trigger: rule.trigger,
            urgency: rule.urgency,
            ...result,
          });
        }
      } catch {
        // Rule detection must never crash the engine
      }
    }

    const blockingCount = opportunities.filter(o => o.urgency === 'blocking').length;
    const importantCount = opportunities.filter(o => o.urgency === 'important').length;
    const optionalCount = opportunities.filter(o => o.urgency === 'optional').length;

    // Can proceed only if no blocking issues (blocking = search cannot yield valid results)
    const canProceedWithoutClarification = blockingCount === 0;

    // Recommended: blocking first, then important, skip optional
    const recommendedQuestions = opportunities
      .filter(o => o.urgency !== 'optional')
      .sort((a, b) => {
        const priority = { blocking: 0, important: 1, optional: 2 };
        return priority[a.urgency] - priority[b.urgency];
      });

    return {
      requestId: requestId ?? 'unknown',
      opportunities,
      blockingCount,
      importantCount,
      optionalCount,
      canProceedWithoutClarification,
      recommendedQuestions,
    };
  }

  /**
   * Quick check: does this request need clarification before searching?
   */
  needsClarification(criteria: PreferenceCriterion[], queryText?: string): boolean {
    const analysis = this.analyze(criteria, queryText);
    return !analysis.canProceedWithoutClarification;
  }

  /**
   * Register a custom rule (for domain extensions).
   * Custom rules are checked AFTER built-in rules.
   */
  registerRule(rule: AmbiguityRule): void {
    this.rules.push(rule);
  }
}
