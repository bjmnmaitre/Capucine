/**
 * Capucine — Purchase Readiness Assessment
 *
 * Determines whether an offer has sufficient information to proceed
 * with purchase consideration (not the same as purchase worthiness).
 */

import { Offer, DataStatus } from '../domain/types';
import { UserInfo } from '../domain/types';

/**
 * Input parameters for purchase readiness assessment.
 */
export interface ReadinessInput {
  /** User's desired delivery country for availability checks */
  destinationCountry?: string;
  /** Minimum confidence level for price to be considered reliable */
  minimumPriceConfidence?: 'low' | 'medium' | 'high';
}

/**
 * Represents the readiness of an offer for purchase consideration.
 */
export interface OfferReadiness {
  /** Whether the offer is ready for purchase consideration */
  ready: boolean;
  /** Information that is pending/missing */
  pending: string[];
  /** Information that blocks purchase consideration */
  blocked: string[];
  /** Confidence in the readiness assessment (0-1) */
  confidence: number;
}

/**
 * Assess whether an offer has sufficient information for purchase consideration.
 * This is about data completeness, not purchase worthiness.
 */
export function assessPurchaseReadiness(
  offer: Offer,
  input: ReadinessInput = {}
): OfferReadiness {
  const { destinationCountry, minimumPriceConfidence = 'medium' } = input;

  const pending: string[] = [];
  const blocked: string[] = [];

  // 1. Check price information
  if (offer.price.status === 'unknown') {
    blocked.push('Prix inconnu');
  } else if (offer.price.status === 'contradictory') {
    blocked.push('Prix contradictoire entre sources');
  } else if (offer.price.status === 'unverifiable') {
    pending.push('Prix non vérifiable');
  }

  // Check if price meets minimum confidence threshold
  const priceConfidenceLevel = getConfidenceLevel(offer.price.status);
  const minConfidenceLevel = getConfidenceLevel(minimumPriceConfidence);
  if (priceConfidenceLevel < minConfidenceLevel) {
    pending.push(`Confiance prix insuffisante (${priceConfidenceLevel}/${minConfidenceLevel})`);
  }

  // 2. Check execution URL (needed to actually purchase)
  if (!offer.executionUrl) {
    blocked.push('aucun lien d\'achat connu');
  }

  // 3. Check availability if destination country specified
  if (destinationCountry) {
    // In a real implementation, we'd check shipping restrictions
    // For now, we'll just note if availability data is missing
    const availabilityChars = ['availability', 'stock', 'in_stock', 'delivery'];
    let hasAvailabilityInfo = false;
    for (const char of availabilityChars) {
      if (offer.characteristics[char] && offer.characteristics[char].status !== 'unknown') {
        hasAvailabilityInfo = true;
        break;
      }
    }
    if (!hasAvailabilityInfo) {
      pending.push('information de disponibilité manquante');
    }
  }

  // 4. Check for essential product characteristics
  const essentialChars = ['brand', 'model', 'category'];
  for (const char of essentialChars) {
    if (!offer.characteristics[char] || offer.characteristics[char].status === 'unknown') {
      pending.push(`caractéristique essentielle manquante: ${char}`);
    }
  }

  // Determine readiness
  const ready = blocked.length === 0;

  // Calculate confidence
  let confidence = 1.0;
  if (blocked.length > 0) {
    confidence = 0.0; // Blocked means not ready
  } else if (pending.length > 0) {
    confidence = Math.max(0.3, 1.0 - (pending.length * 0.15)); // Reduce confidence for pending items
  } else {
    confidence = 0.95; // All good
  }

  return {
    ready,
    pending,
    blocked,
    confidence: Math.max(0, Math.min(1, confidence))
  };
}

/**
 * Convert confidence status to numeric level for comparison.
 */
function getConfidenceLevel(status: DataStatus | 'low' | 'medium' | 'high'): number {
  if (typeof status === 'string' && (status === 'low' || status === 'medium' || status === 'high')) {
    return status === 'low' ? 1 : status === 'medium' ? 2 : 3;
  }

  switch (status) {
    case 'verified': return 3;
    case 'known': return 2;
    case 'unknown': return 0;
    case 'contradictory': return 0; // Treat contradictory as low confidence for readiness
    case 'unverifiable': return 1;
    default: return 0;
  }
}