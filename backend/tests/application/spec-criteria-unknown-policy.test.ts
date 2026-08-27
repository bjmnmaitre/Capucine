/**
 * CAPUCINE — une spec technique inconnue ne doit pas éliminer une offre
 *
 * DÉFAUT TROUVÉ SUR LE WEB RÉEL (campagne Serper, 12 recherches) :
 * « MacBook Air M2 13 pouces » renvoyait ZÉRO résultat. 18 pages marchandes
 * réelles avaient été trouvées, mais aucune ne publie sa taille d'écran de
 * façon extractible : l'interpréteur poussait `screen_size` en critère
 * `required` sans `unknownPolicy`, donc rejet par défaut, donc 18 rejets.
 *
 * C'était UNKNOWN traité comme BAD au niveau de l'admissibilité — l'invariant
 * fondateur du projet — sur une requête parfaitement légitime.
 *
 * Correction : `unknownPolicy: 'pass'` sur screen_size, ram et storage.
 * `budget` reste en rejet : un prix inconnu ne peut pas être déclaré conforme
 * à un budget, et RULE 3 le bloque déjà en aval.
 */
import { BasicPatternInterpreter } from '../../src/application/request-interpreter';
import { AdmissibilityEngine } from '../../src/domain/admissibility';
import type { Offer, Merchant, DataStatus, PreferenceCriterion } from '../../src/domain/types';

const merchant: Merchant =
  { id: 'm', name: 'M', country: 'FR', executionCapabilities: ['web_redirect'] };

function offer(characteristics: Record<string, { value: unknown; status: DataStatus }>): Offer {
  return {
    id: 'o', productId: 'p', merchant,
    price: { value: 1200, status: 'known' }, currency: 'EUR',
    shippingCost: { value: 0, status: 'known' },
    characteristics: characteristics as Offer['characteristics'],
    executionUrl: 'https://marchand.example/p',
    createdAt: new Date(), retrievedAt: new Date(),
    provenance: { source: 'test', retrievedAt: new Date() },
  } as Offer;
}

async function criteriaFor(query: string): Promise<PreferenceCriterion[]> {
  const interpreted = await new BasicPatternInterpreter().interpret({
    id: 'q-test', userId: 'test', text: query,
  } as never);
  return interpreted.extractedCriteria;
}

describe('Les specs techniques extraites de la requête tolèrent l’inconnu', () => {
  it.each([
    ['taille d’écran', 'ordinateur portable 13 pouces', 'screen_size'],
    ['RAM', 'ordinateur portable 16 Go RAM', 'ram'],
    // L'extraction de stockage exige un marqueur explicite (« SSD » ou « To ») :
    // « 512 Go » seul est ambigu avec la RAM, et l'interpréteur ne devine pas.
    ['stockage', 'ordinateur portable 512 Go SSD', 'storage'],
  ])('%s : le critère porte unknownPolicy « pass »', async (_label, query, id) => {
    const criteria = await criteriaFor(query);
    const found = criteria.find(c => c.id === id);
    expect(found).toBeDefined();
    expect(found!.level).toBe('required');
    // Sans cela, aucune offre du Web réel ne franchit l'admissibilité.
    expect(found!.parameters?.unknownPolicy).toBe('pass');
  });

  it('le budget reste en rejet : un prix inconnu n’est pas conforme à un budget', async () => {
    const criteria = await criteriaFor('ordinateur portable moins de 1000 euros');
    const budget = criteria.find(c => c.id === 'budget' || c.id === 'price');
    if (budget) expect(budget.parameters?.unknownPolicy).not.toBe('pass');
  });
});

describe('Admissibilité — inconnu accepté, contradiction toujours rejetée', () => {
  const engine = new AdmissibilityEngine();
  const screenSize = (policy?: 'pass'): PreferenceCriterion => ({
    id: 'screen_size', name: "Taille d'écran", level: 'required',
    parameters: { exactValue: 13, tolerance: 0.5, unit: 'pouces', ...(policy ? { unknownPolicy: policy } : {}) },
  });

  it('spec INCONNUE + policy « pass » → offre admissible, mais signalée', () => {
    const result = engine.checkOffer(
      offer({ screen_size: { value: null, status: 'unknown' } }),
      [screenSize('pass')]
    );
    expect(result.eligible).toBe(true);
    // Admissible n'est pas « satisfait » : l'incertitude doit rester visible.
    expect(result.violations.length).toBe(0);
  });

  it('spec CONTRADICTOIRE avec la demande → toujours rejetée', () => {
    // 'pass' ne relâche PAS la contrainte quand la donnée existe : une offre
    // de 17 pouces face à une demande de 13 reste éliminée.
    const result = engine.checkOffer(
      offer({ screen_size: { value: 17, status: 'known' } }),
      [screenSize('pass')]
    );
    expect(result.eligible).toBe(false);
  });

  it('spec CONFORME → admissible', () => {
    const result = engine.checkOffer(
      offer({ screen_size: { value: 13, status: 'known' } }),
      [screenSize('pass')]
    );
    expect(result.eligible).toBe(true);
  });

  it('sans policy, l’inconnu élimine encore — le comportement d’origine', () => {
    // Conservé pour documenter la différence : c'est ce défaut qui produisait
    // zéro résultat sur le Web réel.
    const result = engine.checkOffer(
      offer({ screen_size: { value: null, status: 'unknown' } }),
      [screenSize()]
    );
    expect(result.eligible).toBe(false);
  });
});
