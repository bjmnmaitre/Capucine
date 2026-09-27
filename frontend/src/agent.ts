/**
 * Capucine's voice — pure text helpers for the agent-style UI.
 * Never invents a figure: every sentence is built from response fields, and
 * returns null when the data to say it is missing.
 */
import type { SearchResponse } from './types';

/** The real pipeline steps (CapucineEngine), in order. Shown while a search
 *  runs; the API reports no intermediate progress, so none is claimed. */
export const SEARCH_STEPS: readonly string[] = [
  'Je comprends votre demande',
  'J’interroge les marchands',
  'Je calcule le coût réel',
  'Je classe les offres',
];

/**
 * Capucine's one-line account of what she discarded. Built ONLY from
 * summary.totalRejected: "found/shown" counts are not used because offers can
 * also be hidden at presentation time (merchant exclusions, result limit), so
 * "N sur M examinées" would misstate what was examined.
 */
export function agentResultLine(
  summary: SearchResponse['summary'] | undefined,
  _shownCount: number,
): string | null {
  const rejected = summary?.totalRejected;
  if (typeof rejected !== 'number' || !Number.isFinite(rejected) || rejected < 0) return null;
  if (rejected === 0) return 'Toutes les offres trouvées respectent vos critères obligatoires.';
  return rejected === 1
    ? 'J’ai écarté 1 offre qui ne respectait pas un de vos critères obligatoires.'
    : `J’ai écarté ${rejected} offres qui ne respectaient pas un de vos critères obligatoires.`;
}

/** One line per permanent preference suspended for this conversation only. */
export function temporaryExceptionLines(overrides: SearchResponse['temporaryOverrides']): string[] {
  return (overrides ?? [])
    .filter((o) => o.temporaryLevel === 'disabled')
    .map((o) => {
      const merchant = /^merchant-exclude-(.+)$/.exec(o.criterionId)?.[1]?.replace(/-+/g, ' ');
      return merchant
        ? `${merchant.charAt(0).toUpperCase()}${merchant.slice(1)} est réautorisé pour cette recherche uniquement.`
        : 'Une de vos préférences permanentes est suspendue pour cette recherche uniquement.';
    });
}
