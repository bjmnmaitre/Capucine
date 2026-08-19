import { classifyMatchQuality } from '../../src/application/match-quality';

describe('classifyMatchQuality', () => {
  it('exact_match uniquement quand une référence exacte est trouvée verbatim (modulo espaces/tirets)', () => {
    const result = classifyMatchQuality({
      text: 'sony wh-1000xm6 casque sans fil noir',
      exactRefs: ['wh-1000xm6'],
      keywordsMatched: 3,
      keywordsTotal: 4,
    });
    expect(result).toBe('exact_match');
  });

  it('reconnaît une référence exacte même avec une variation de tirets/espaces', () => {
    const result = classifyMatchQuality({
      text: 'casque sony wh 1000 xm6 disponible',
      exactRefs: ['wh-1000xm6'],
      keywordsMatched: 2,
      keywordsTotal: 4,
    });
    expect(result).toBe('exact_match');
  });

  it("une référence exacte cherchée mais absente du texte ne produit JAMAIS exact_match, même avec un fort recouvrement de mots-clés", () => {
    const result = classifyMatchQuality({
      text: 'casque sony sans fil réduction de bruit',
      exactRefs: ['wh-1000xm6'],
      keywordsMatched: 4,
      keywordsTotal: 4, // recouvrement parfait des mots-clés génériques
    });
    expect(result).not.toBe('exact_match');
    expect(result).toBe('close_match'); // retombe sur le classement par ratio
  });

  it('close_match pour un ratio de mots-clés élevé (>= 0.75) sans référence exacte', () => {
    const result = classifyMatchQuality({
      text: 'casque bluetooth réduction de bruit noir',
      exactRefs: [],
      keywordsMatched: 3,
      keywordsTotal: 4,
    });
    expect(result).toBe('close_match');
  });

  it('partial_match pour un ratio moyen (0.4 à 0.75)', () => {
    const result = classifyMatchQuality({
      text: 'casque quelconque',
      exactRefs: [],
      keywordsMatched: 2,
      keywordsTotal: 4,
    });
    expect(result).toBe('partial_match');
  });

  it('alternative pour un ratio faible mais non nul', () => {
    const result = classifyMatchQuality({
      text: 'produit vaguement lié',
      exactRefs: [],
      keywordsMatched: 1,
      keywordsTotal: 5,
    });
    expect(result).toBe('alternative');
  });

  it('unknown quand aucun mot-clé ne correspond', () => {
    const result = classifyMatchQuality({
      text: 'produit totalement différent',
      exactRefs: [],
      keywordsMatched: 0,
      keywordsTotal: 4,
    });
    expect(result).toBe('unknown');
  });

  it("unknown quand il n'y a aucun mot-clé à comparer (recherche non structurée)", () => {
    const result = classifyMatchQuality({
      text: 'peu importe le texte',
      exactRefs: [],
      keywordsMatched: 0,
      keywordsTotal: 0,
    });
    expect(result).toBe('unknown');
  });
});
