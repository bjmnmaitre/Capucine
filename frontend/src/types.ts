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

export interface SearchResponse {
  requestId: string;
  language?: string;
  session?: { sessionId: string } | null;
  results: RankedOffer[];
  summary?: SearchSummary;
  interpretation?: { productTerms?: string[]; [k: string]: unknown } | null;
  effectiveCriteria?: unknown;
  noResultsDiagnosis?: { reason?: string; suggestion?: string } | null;
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
