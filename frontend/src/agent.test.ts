import { agentResultLine, temporaryExceptionLines, SEARCH_STEPS } from './agent';

describe('agentResultLine — la voix de Capucine n’affirme que ce que le backend garantit', () => {
  it('offres écartées : pluriel / singulier', () => {
    expect(agentResultLine({ totalFound: 4, totalRejected: 3 }, 4))
      .toBe('J’ai écarté 3 offres qui ne respectaient pas un de vos critères obligatoires.');
    expect(agentResultLine({ totalFound: 4, totalRejected: 1 }, 4))
      .toBe('J’ai écarté 1 offre qui ne respectait pas un de vos critères obligatoires.');
  });
  it('rien d’écarté', () => {
    expect(agentResultLine({ totalFound: 3, totalRejected: 0 }, 3))
      .toBe('Toutes les offres trouvées respectent vos critères obligatoires.');
  });
  it('ne prétend jamais avoir « examiné » un nombre d’offres (des offres peuvent être masquées à l’affichage)', () => {
    expect(agentResultLine({ totalFound: 3, totalRejected: 0 }, 3)).not.toMatch(/examin/);
  });
  it('données absentes ou invalides → rien', () => {
    expect(agentResultLine(undefined, 3)).toBeNull();
    expect(agentResultLine({ totalFound: 1, totalRejected: NaN } as never, 0)).toBeNull();
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
