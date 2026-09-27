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

/** "J'ai retenu 4 offres sur 7 ; 3 écartées (critère obligatoire non respecté)." */
export function agentResultLine(
  summary: SearchResponse['summary'] | undefined,
  shownCount: number,
): string | null {
  if (!summary || !Number.isFinite(summary.totalFound) || !Number.isFinite(summary.totalRejected)) return null;
  const considered = summary.totalFound + summary.totalRejected;
  if (considered <= 0) return null;
  const s = (n: number) => (n > 1 ? 's' : '');
  const kept = `J’ai retenu ${shownCount} offre${s(shownCount)} sur ${considered} examinée${s(considered)}`;
  if (summary.totalRejected <= 0) return `${kept}.`;
  return `${kept} ; ${summary.totalRejected} écartée${s(summary.totalRejected)} car elle${s(summary.totalRejected)} ne respectai${summary.totalRejected > 1 ? 'ent' : 't'} pas un critère obligatoire.`;
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
