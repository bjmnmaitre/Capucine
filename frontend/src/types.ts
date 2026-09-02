/**
 * Types mirroring the Capucine backend contract (backend/src/api/server.ts).
 *
 * DISCIPLINE: every field that the backend can legitimately not know is typed
 * as nullable here. The UI must render "inconnu" for those — never a fallback
 * number, never an em-dash standing in for a real value. UNKNOWN != BAD, and
 * UNKNOWN is never silently turned into a figure the user could act on.
 */

export type CostCertainty = 'known' | 'partially_known' | 'unknown';

export interface Merchant {
  id: string;
  name: string;
}

export interface OfferPrice {
  amount: number | null;
  currency: string;
  status: string;
  verifiedAt?: string | null;
  source?: string | null;
}

export interface OfferCost {
  /** Sum of the components that ARE known. NOT the final price unless
   *  certainty === 'known' — see the backend's CostEngine. */
  totalKnown: number | null;
  currency: string;
  certainty: CostCertainty;
  unknownComponents: string[];
  componentStates?: Record<string, string>;
  containsEstimate?: boolean;
  /** Human-readable statement produced by the backend. Preferred over any
   *  sentence we could compose here: it already says what is and is not known. */
  statement?: string | null;
  budgetWarning?: string | null;
}

/**
 * Delivery cost as reported by the backend. `amount: null` with
 * `status: 'unknown'` means "we do not know", which is NOT "free". The UI must
 * keep those two apart.
 */
export interface OfferShipping {
  amount: number | null;
  currency: string;
  status: string;
  source?: string | null;
}

/** One dimension of purchase readiness (purchasable / inStock / deliverable…),
 *  each carrying the reason the backend gives for its state. */
export interface ReadinessDetail {
  dimension: string;
  state: string;
  reason: string;
}

export interface OfferProvenance {
  source: string;
  reliability?: number | null;
}

export interface OfferDataQuality {
  overall?: string;
  priceConfidence?: string;
  statement?: string | null;
}

export interface OfferReadiness {
  ready: boolean;
  pending?: string[];
  blocked?: string[];
  details?: ReadinessDetail[];
  statement?: string | null;
}

export interface RankedOffer {
  rank: number;
  offerId: string;
  productId: string;
  merchant: Merchant;
  /**
   * NULL when the price is unknown. The backend serializes `price: null`
   * rather than an object with `amount: null`, so this whole field — not just
   * `amount` — must be treated as optional. Reading `offer.price.amount`
   * unguarded crashes the screen on any offer whose price was not extracted.
   */
  price: OfferPrice | null;
  cost: OfferCost;
  score: number;
  rankingReasonCode?: string;
  satisfiesAllConstraints?: boolean;
  explanation?: string | null;
  matchQuality?: string | null;
  /** Real, verified offer URL — or null. NEVER synthesized on the client. */
  offerUrl?: string | null;
  shipping?: OfferShipping;
  readiness?: OfferReadiness;
  dataQuality?: OfferDataQuality;
  provenance?: OfferProvenance;
  /** NOTE: a criterion carries a STATUS, not a score. The per-criterion score
   *  is not part of this payload — rendering `${c.score} pts` would print
   *  "undefined pts". */
  criteria?: {
    id: string;
    name: string;
    level?: string;
    status: string;
    requiredOrForbidden?: boolean;
    reasoning?: string;
  }[];
}

export interface SearchSummary {
  totalFound: number;
  totalRejected: number;
  resultSummary?: string;
}

/**
 * How the shown list is ordered. `applied: false` means the preference was
 * understood and accepted but does not reorder anything yet (BEST_VALUE /
 * FASTEST_DELIVERY / BEST_RATED — see backend ranking-preference.ts): the UI
 * must then NOT claim the list is sorted that way.
 */
export type RankingPreferenceCode =
  | 'BEST_MATCH' | 'PRICE_LOWEST' | 'BEST_VALUE' | 'FASTEST_DELIVERY' | 'BEST_RATED' | string;

export interface RankingPreferenceState {
  preference: RankingPreferenceCode;
  applied: boolean;
}

/** One refinement the user has spoken in this conversation, as the backend
 *  recorded it (POST /clarify → session.answeredQuestions). */
export interface AnsweredQuestion {
  questionId: string;
  question: string;
  answer: string;
}

export interface SearchResponse {
  requestId: string;
  language?: string;
  /**
   * Continuable session. Present on EVERY completed search now: `sessionId`
   * is what POST /prepare-cart and POST /clarify both need. `turn` and
   * `answeredQuestions` grow as the user refines the search conversationally.
   */
  session?: {
    sessionId: string;
    turn?: number;
    originalQuery?: string;
    answeredQuestions?: AnsweredQuestion[];
    remainingQuestions?: number;
  } | null;
  rankingPreference?: RankingPreferenceState;
  /**
   * Exclusions de marchand réellement appliquées à cette liste — soit un
   * affinage de session (« sans Amazon »), soit une préférence permanente du
   * profil. `null` quand rien n'a été exclu. Sert à dire honnêtement
   * « 2 offres de Amazon masquées » plutôt que d'avoir une liste
   * silencieusement plus courte.
   */
  merchantExclusions?: {
    requested: string[];
    hiddenOfferCount: number;
    hiddenMerchants: string[];
  } | null;
  /**
   * La préférence permanente « privilégier la disponibilité immédiate » était
   * active pour cette recherche : elle a relevé le bonus de classement des
   * offres dont le stock/la livraison sont CONFIRMÉS (jamais de malus pour une
   * disponibilité inconnue). Informe l'UI, qui peut alors expliquer pourquoi
   * une offre en stock passe devant une correspondance légèrement meilleure.
   */
  availabilityEmphasis?: boolean;
  results: RankedOffer[];
  summary?: SearchSummary;
  /**
   * Ce que Capucine a compris de l'USAGE prévu du produit. `source: 'user'`
   * = l'utilisateur l'a dit explicitement (« pour le train ») ; `'inferred'`
   * = déduit ; `'profile'` = vient d'une préférence permanente. `summary` est
   * une phrase déjà rédigée et traduite par le backend — affichée telle
   * quelle, jamais recomposée à partir des codes.
   */
  usageContext?: {
    usage: string;
    context?: string | null;
    source: 'user' | 'inferred' | 'profile' | string;
    confidence: number;
    matchedText?: string | null;
    summary?: string | null;
  } | null;
  interpretation?: { productTerms?: string[]; [k: string]: unknown } | null;
  effectiveCriteria?: unknown;
  /**
   * Pourquoi aucune offre n'est retenue.
   *
   * Le contrat déclaré ici ne correspondait PAS à celui du backend
   * (`{ reason, suggestion }` contre `{ primaryCause, message, recoveryOptions }`).
   * Conséquence mesurée : le diagnostic existait, était traduit, et n'était
   * jamais affiché — l'utilisateur voyait « aucune offre » sans jamais savoir
   * que c'était SON critère qui les avait toutes écartées.
   */
  noResultsDiagnosis?: {
    primaryCause?: string;
    /** Phrase déjà traduite par le backend. */
    message?: string;
    recoveryOptions?: Array<{
      id: string;
      type: string;
      description: string;
      impact: string;
      requiresConfirmation: boolean;
    }>;
  } | null;
  provenanceSummary?: unknown;
}

/** Response of POST /prepare-cart. `status: 'unavailable'` is a legitimate,
 *  honest outcome (RULE 1/2/3), not an error to hide. */
export interface PrepareCartResponse {
  sessionId: string;
  offerId: string;
  quantity: number;
  status: 'partial' | 'success' | 'unavailable' | 'failed' | string;
  checkoutUrl: string | null;
  nextAction: string | null;
  error: string | null;
  merchant?: Merchant | null;
  purchaseCompleted?: boolean;
}

/**
 * A PERMANENT user preference, stored server-side via /profile.
 *
 * Deliberately distinct from the current search: a criterion here outlives the
 * request, whereas what the user types in the search box describes only this
 * search and may contradict — and override — a stored preference. The two are
 * never merged client-side; the backend owns that arbitration.
 */
export interface ProfileCriterion {
  id: string;
  name: string;
  level: PreferenceLevel;
  parameters?: Record<string, unknown> | null;
}

export type PreferenceLevel =
  | 'forbidden' | 'required' | 'very_important'
  | 'important' | 'preference' | 'low' | 'none';

export const PREFERENCE_LEVELS: PreferenceLevel[] = [
  'required', 'very_important', 'important', 'preference', 'low',
];

export interface ProfileResponse {
  userId: string;
  criteria: ProfileCriterion[];
  updatedAt: string;
}

/** Anything that went wrong between the tap and a parsed response. */
export class ApiError extends Error {
  readonly kind: 'network' | 'server' | 'bad_request';
  readonly detail?: string;
  constructor(kind: ApiError['kind'], message: string, detail?: string) {
    super(message);
    this.kind = kind;
    this.detail = detail;
  }
}
