import { agentResultLine, temporaryExceptionLines, SEARCH_STEPS } from './agent';

describe('agentResultLine — la voix de Capucine n’invente aucun chiffre', () => {
  it('résumé complet', () => {
    expect(agentResultLine({ totalFound: 4, totalRejected: 3 }, 4))
      .toBe('J’ai retenu 4 offres sur 7 examinées ; 3 écartées car elles ne respectaient pas un critère obligatoire.');
  });
  it('rien d’écarté, singulier', () => {
    expect(agentResultLine({ totalFound: 1, totalRejected: 0 }, 1)).toBe('J’ai retenu 1 offre sur 1 examinée.');
  });
  it('données absentes ou nulles → rien (pas de phrase fabriquée)', () => {
    expect(agentResultLine(undefined, 3)).toBeNull();
    expect(agentResultLine({ totalFound: 0, totalRejected: 0 }, 0)).toBeNull();
    expect(agentResultLine({ totalFound: NaN, totalRejected: 1 } as never, 0)).toBeNull();
  });
});

describe('temporaryExceptionLines — exceptions du MEGAPROMPT #6', () => {
  it('marchand réautorisé, nommé', () => {
    expect(temporaryExceptionLines([
      { criterionId: 'merchant-exclude-amazon', temporaryLevel: 'disabled', originalLevel: 'forbidden', reason: 'x' },
    ])).toEqual(['Amazon est réautorisé pour cette recherche uniquement.']);
  });
  it('autre préférence : phrase générique honnête ; aucune exception → liste vide', () => {
    expect(temporaryExceptionLines([
      { criterionId: 'free-shipping', temporaryLevel: 'disabled', originalLevel: 'very_important', reason: 'x' },
    ])).toHaveLength(1);
    expect(temporaryExceptionLines(undefined)).toEqual([]);
  });
});

it('les étapes affichées sont les 4 étapes réelles du pipeline', () => {
  expect(SEARCH_STEPS).toHaveLength(4);
});
