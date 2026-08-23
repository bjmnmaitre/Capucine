/**
 * Capucine — Usage Context Mapping
 *
 * Defines how usage contexts map to relevant product attributes (contextual signals).
 * These signals are used to influence ranking and search strategy but are NEVER
 * treated as hard constraints.
 *
 * The mapping is explicit, deterministic, and auditable.
 */

import { UsageContext, UsageType, ContextType } from './types';
import { ContextualSignals, RelevanceLevel } from './types';

/**
 * Map a usage context to contextual signals indicating which attributes are relevant.
 * Returns a ContextualSignals object with relevance levels for various attributes.
 *
 * @param context The usage context to map
 * @returns ContextualSignals with relevance levels (never undefined for relevant attributes)
 */
export function mapUsageContextToSignals(context: UsageContext): ContextualSignals {
  const signals: ContextualSignals = {};

  // Default: no attributes are relevant unless specified by mapping
  // We only set attributes to 'relevant' when the mapping says so.
  // All other attributes remain undefined (treated as neutral).

  switch (context.usage) {
    case 'transport':
      // For transport (commuting, travel by public transport, etc.)
      signals.portability = 'relevant';
      signals.weight = 'relevant';
      signals.batteryLife = 'relevant';
      signals.noiseCancellation = 'relevant';
      signals.comfort = 'relevant';
      break;

    case 'travel':
      // For travel (vacations, trips, etc.)
      signals.portability = 'relevant';
      signals.weight = 'relevant';
      signals.batteryLife = 'relevant';
      signals.noiseCancellation = 'relevant';
      signals.foldability = 'relevant';
      break;

    case 'sport':
      // For sports and fitness activities
      signals.weight = 'relevant';
      signals.stability = 'relevant';
      signals.sweatResistance = 'relevant';
      signals.batteryLife = 'relevant';
      break;

    case 'office':
      // For office/work usage
      signals.comfort = 'relevant';
      signals.microphone = 'relevant';
      signals.noiseCancellation = 'relevant';
      signals.batteryLife = 'relevant';
      break;

    case 'gaming':
      // For gaming (PC, console, etc.)
      signals.latency = 'relevant';
      signals.microphone = 'relevant';
      signals.compatibility = 'relevant';
      signals.spatialAudio = 'relevant';
      break;

    case 'music':
      // For music listening
      signals.audioQuality = 'relevant';
      signals.noiseCancellation = 'relevant';
      signals.batteryLife = 'relevant';
      signals.comfort = 'relevant';
      break;

    case 'home':
      // For home usage
      signals.comfort = 'relevant';
      signals.batteryLife = 'relevant';
      break;

    case 'outdoor':
      // For outdoor usage
      signals.portability = 'relevant';
      signals.weight = 'relevant';
      signals.batteryLife = 'relevant';
      signals.stability = 'relevant';
      break;

    case 'other':
    default:
      // No specific signals
      break;
  }

  // Context can refine or override the usage-based signals
  if (context.context) {
    switch (context.context) {
      case 'transport':
        // Already covered by usage 'transport', but could be emphasized
        signals.portability = 'relevant';
        signals.weight = 'relevant';
        signals.batteryLife = 'relevant';
        signals.noiseCancellation = 'relevant';
        signals.comfort = 'relevant';
        break;
      case 'office':
        signals.comfort = 'relevant';
        signals.microphone = 'relevant';
        signals.noiseCancellation = 'relevant';
        signals.batteryLife = 'relevant';
        break;
      case 'home':
        signals.comfort = 'relevant';
        signals.batteryLife = 'relevant';
        break;
      case 'outdoor':
        signals.portability = 'relevant';
        signals.weight = 'relevant';
        signals.batteryLife = 'relevant';
        signals.stability = 'relevant';
        break;
      case 'gym':
        signals.weight = 'relevant';
        signals.stability = 'relevant';
        signals.sweatResistance = 'relevant';
        signals.batteryLife = 'relevant';
        break;
      case 'gaming':
        signals.latency = 'relevant';
        signals.microphone = 'relevant';
        signals.compatibility = 'relevant';
        signals.spatialAudio = 'relevant';
        break;
      case 'studio':
        signals.audioQuality = 'relevant';
        signals.microphone = 'relevant';
        signals.latency = 'relevant';
        break;
      case 'classroom':
        signals.comfort = 'relevant';
        signals.microphone = 'relevant';
        signals.batteryLife = 'relevant';
        break;
      case 'travel':
        // Already covered by usage 'travel'
        signals.portability = 'relevant';
        signals.weight = 'relevant';
        signals.batteryLife = 'relevant';
        signals.noiseCancellation = 'relevant';
        signals.foldability = 'relevant';
        break;
      default:
        break;
    }
  }

  return signals;
}

/**
 * Get a human-readable description of why a signal is relevant for a usage context.
 * Used for explanations.
 */
export function explainSignalRelevance(usage: UsageType, context: ContextType | undefined, signalKey: keyof ContextualSignals): string {
  const usageDescriptions: Record<UsageType, string> = {
    transport: 'utilisation dans les transports',
    travel: 'utilisation en voyage',
    sport: 'utilisation pour le sport',
    office: 'utilisation au bureau',
    gaming: 'utilisation pour le gaming',
    music: 'utilisation pour écouter de la musique',
    home: 'utilisation à la maison',
    outdoor: 'utilisation en extérieur',
    other: 'autre utilisation'
  };

  const contextDescriptions: Record<ContextType, string> = {
    transport: 'dans les transports',
    office: 'au bureau',
    home: 'à la maison',
    outdoor: 'en extérieur',
    gaming: 'pour le gaming',
    studio: 'en studio',
    classroom: 'en salle de classe',
    travel: 'en voyage',
    gym: 'en salle de sport',
    other: 'autre contexte'
  };

  const signalDescriptions: Record<keyof ContextualSignals, string> = {
    portability: 'la portabilité est importante (facile à transporter)',
    weight: 'le poids est important (léger préférable)',
    batteryLife: 'l\'autonomie de la batterie est importante',
    noiseCancellation: 'la réduction de bruit est importante',
    comfort: 'le confort est important',
    audioQuality: 'la qualité audio est importante',
    microphone: 'la qualité du microphone est importante',
    latency: 'la faible latence est importante',
    stability: 'la stabilité est importante',
    sweatResistance: 'la résistance à la transpiration est importante',
    spatialAudio: 'l\'audio spatial est important',
    foldability: 'la pliabilité est importante',
    compatibility: 'la compatibilité est importante'
  };

  let description = '';
  if (usageDescriptions[usage]) {
    description += usageDescriptions[usage];
  }
  if (context && contextDescriptions[context]) {
    description += (description ? ' ' : '') + contextDescriptions[context];
  }
  description += ` — ${signalDescriptions[signalKey]}`;

  return description;
}