/**
 * CAPUCINE — cycle de vie des sessions de checkout
 *
 * Les sessions étaient le dernier angle mort avant le premier appel Web réel.
 * Ce fichier éprouve leur cycle complet ET répond, par la mesure, à la
 * question de leur persistance : faut-il qu'elles survivent à un redémarrage ?
 *
 * Aucun état de session ne doit mentir : une donnée jamais capturée ne doit
 * pas être présentée comme capturée, et un résultat non déterminé ne doit pas
 * devenir un succès.
 */
import { CheckoutSessionService } from '../../src/application/checkout-session-service';
import type {
  CartSnapshot, OfferSnapshot, MerchantSnapshot, ExecutionState, CheckoutSession,
} from '../../src/domain/types';

jest.setTimeout(30000);

const cart: CartSnapshot = {
  items: [{ offerId: 'offer-1', quantity: 1 }], quantities: { 'offer-1': 1 },
  selectedVariants: {}, destinationCountry: 'FR', capturedAt: new Date(),
} as CartSnapshot;

const offer: OfferSnapshot = {
  offerId: 'offer-1', productId: 'prod-1', merchantId: 'fnac', title: 'Fnac',
  brand: 'Sony', model: 'WH-1000XM5', condition: 'new', seller: 'Fnac',
  availability: 'in_stock', price: 329, currency: 'EUR',
  productUrl: 'https://fnac.com/p', executionUrl: 'https://fnac.com/p',
  capturedAt: new Date(),
};

const merchant: MerchantSnapshot = {
  merchantId: 'fnac', name: 'Fnac', country: 'FR',
  executionCapabilities: ['web_redirect'], capturedAt: new Date(),
};

const create = (svc: CheckoutSessionService, key?: string) =>
  svc.createCheckoutSession(cart, offer, merchant, 'web_redirect', key);

const lastAudit = (s: CheckoutSession) => s.auditTrail[s.auditTrail.length - 1];

describe('Cycle de vie — création, identité, idempotence', () => {
  it('1. création : la session existe et porte ses snapshots', async () => {
    const s = await create(new CheckoutSessionService());
    expect(s.id).toBeTruthy();
    expect(s.status).toBe('verification_required');
    expect(s.offerSnapshot.offerId).toBe('offer-1');
    expect(s.merchantSnapshot.merchantId).toBe('fnac');
    expect(s.cartSnapshot.items.length).toBe(1);
  });

  it('2. récupération par identifiant', async () => {
    const svc = new CheckoutSessionService();
    const s = await create(svc);
    expect(svc.getSession(s.id)?.id).toBe(s.id);
  });

  it('3. session inconnue : undefined, jamais une session fabriquée', async () => {
    expect(new CheckoutSessionService().getSession('jamais-vue')).toBeUndefined();
  });

  it('4. idempotence : la même clé renvoie la MÊME session, pas un doublon', async () => {
    const svc = new CheckoutSessionService();
    const first = await create(svc, 'cle-idem');
    const second = await create(svc, 'cle-idem');
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(first.version);
  });

  it('5. clés différentes : deux sessions distinctes', async () => {
    const svc = new CheckoutSessionService();
    const a = await create(svc, 'cle-a');
    const b = await create(svc, 'cle-b');
    expect(b.id).not.toBe(a.id);
  });

  it('6. corrélation : chaque session porte un correlationId exploitable', async () => {
    const s = await create(new CheckoutSessionService());
    expect(typeof s.correlationId).toBe('string');
    expect(s.correlationId.length).toBeGreaterThan(0);
  });

  it('7. expiration : date fixée, et la session fraîche n’est pas expirée', async () => {
    const svc = new CheckoutSessionService();
    const s = await create(svc);
    expect(s.expiresAt.getTime()).toBeGreaterThan(s.createdAt.getTime());
    // Interrogé sur la MÊME instance : une session inconnue d'une autre
    // instance serait signalée expirée, ce qui est un test différent (voir la
    // section MESURE plus bas).
    expect(svc.isExpired(s.id)).toBe(false);
  });
});

describe('Cycle de vie — états et audit honnête', () => {
  it('8. l’audit de création dit ce qui s’est réellement passé', async () => {
    const s = await create(new CheckoutSessionService());
    const entry = s.auditTrail[0];
    expect(entry.action).toBe('session_created');
    expect(entry.result).toBe('success'); // une création EST un fait observé
  });

  it('9. exécution en cours → audit « unknown », jamais « success »', async () => {
    const svc = new CheckoutSessionService();
    const s = await create(svc);
    const state: ExecutionState = {
      started: true, startedAt: new Date(), completedAt: null,
      result: null, error: undefined, merchantConfirmed: false, merchantConfirmedAt: null,
    };
    const updated = await svc.setExecutionState(s.id, state);
    expect(lastAudit(updated).result).toBe('unknown');
  });

  it('10. exécution échouée → « failure » explicite', async () => {
    const svc = new CheckoutSessionService();
    const s = await create(svc);
    const updated = await svc.setExecutionState(s.id, {
      started: true, startedAt: new Date(), completedAt: new Date(),
      result: 'failure', error: 'refus marchand', merchantConfirmed: false, merchantConfirmedAt: null,
    });
    expect(lastAudit(updated).result).toBe('failure');
  });

  it('11. exécution réussie → « success » seulement avec un résultat observé', async () => {
    const svc = new CheckoutSessionService();
    const s = await create(svc);
    const updated = await svc.setExecutionState(s.id, {
      started: true, startedAt: new Date(), completedAt: new Date(),
      result: 'success', error: undefined, merchantConfirmed: true, merchantConfirmedAt: new Date(),
    });
    expect(lastAudit(updated).result).toBe('success');
  });

  it('12. vérification impossible → « unknown », pas « failure »', async () => {
    const svc = new CheckoutSessionService();
    const s = await create(svc);
    // Aucune issue bloquante mais non vérifié : la comparaison n'a pas eu lieu.
    const updated = await svc.setVerificationState(s.id, {
      verified: false, verifiedAt: new Date(), discrepancies: [],
      blockingIssues: [], warnings: [], version: 1,
    });
    expect(lastAudit(updated).result).toBe('unknown');
  });

  it('13. vérification ayant trouvé un blocage → « failure »', async () => {
    const svc = new CheckoutSessionService();
    const s = await create(svc);
    const updated = await svc.setVerificationState(s.id, {
      verified: false, verifiedAt: new Date(), discrepancies: [],
      blockingIssues: [{ type: 'price_changed', description: 'prix modifié', detectedAt: new Date() }],
      warnings: [], version: 1,
    });
    expect(lastAudit(updated).result).toBe('failure');
  });

  it('14. une transition invalide est refusée, l’état ne se falsifie pas', async () => {
    const svc = new CheckoutSessionService();
    const s = await create(svc);
    // 'verification_required' ne mène pas directement à 'executed'.
    await expect(svc.transitionState(s.id, 'executed')).rejects.toThrow();
    expect(svc.getSession(s.id)!.status).toBe('verification_required');
  });

  it('15. la version augmente à chaque modification — traçabilité', async () => {
    const svc = new CheckoutSessionService();
    const s = await create(svc);
    const before = s.version;
    const after = await svc.transitionState(s.id, 'verified');
    expect(after.version).toBeGreaterThan(before);
  });
});

describe('MESURE — faut-il persister les sessions ?', () => {
  it('une session ne survit PAS à la reconstruction du service', async () => {
    const first = new CheckoutSessionService();
    const s = await create(first, 'cle-restart');
    expect(first.getSession(s.id)).toBeDefined();

    // Service neuf = redémarrage du backend.
    const second = new CheckoutSessionService();
    expect(second.getSession(s.id)).toBeUndefined();
  });

  it('DÉCISION MESURÉE : persister les sessions seules ne restaurerait pas un parcours cohérent', async () => {
    // Le raisonnement, appuyé sur le code :
    //
    // Une CheckoutSession référence une offre (offerSnapshot.offerId) issue
    // d'une session de RECHERCHE, elle-même détenue par ConversationManager —
    // une Map en mémoire, avec 30 min de TTL et un commentaire explicite
    // « no persistent storage needed ».
    //
    // Persister la seule CheckoutSession produirait donc une session valide
    // pointant vers une offre que Capucine ne sait plus produire : ni la
    // reclasser, ni la re-préparer, ni la vérifier contre un état courant.
    // L'utilisateur retrouverait une coquille — pire qu'un refus franc.
    //
    // Rendre le parcours réellement reprenable demanderait de persister aussi
    // la recherche et ses résultats classés. C'est un chantier de continuité
    // de session, pas une case à cocher, et il dépasse le MVP.
    //
    // CONCLUSION : ne PAS persister maintenant. Le comportement actuel est
    // honnête — une session absente répond « introuvable » et l'utilisateur
    // relance une recherche, ce qu'il devrait faire de toute façon puisque
    // les prix ont pu changer.
    const svc = new CheckoutSessionService();
    const s = await create(svc);

    // Ce qui compte pour le MVP : l'absence est dite, jamais masquée.
    expect(new CheckoutSessionService().getSession(s.id)).toBeUndefined();
    expect(new CheckoutSessionService().isExpired(s.id)).toBe(true);
  });

  it('les snapshots capturés ne prétendent jamais contenir ce qui n’a pas été capturé', async () => {
    const s = await create(new CheckoutSessionService());
    // Ce service ne reçoit aucune donnée de prix : son priceSnapshot est
    // explicitement inconnu plutôt que rempli de zéros.
    expect(s.priceSnapshot.productPrice).toBeNull();
    expect(s.priceSnapshot.totalCost).toBeNull();
    expect(s.priceSnapshot.source).toBe('not_captured');
    // Et aucune promotion n'est inventée.
    expect(s.promotionSnapshot).toEqual([]);
  });
});
