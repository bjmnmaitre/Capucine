/**
 * CAPUCINE — helpers purs du wizard de création de profil.
 *
 * Ce que ces tests protègent : le corps envoyé à POST /profile/:userId/onboarding
 * est CORRECT et HONNÊTE. Un budget mal saisi ne devient jamais 0; un profil
 * « tout décliné » reste valide; un compte marchand partagé n'est envoyé que
 * lorsque l'utilisateur l'a explicitement coché (la présence DANS la liste est
 * le consentement).
 */
import {
  buildOnboardingAnswers, KNOWN_MERCHANT_NAMES, parseAmount,
} from './onboarding';

describe('parseAmount', () => {
  it('accepte un entier et un décimal (virgule ou point)', () => {
    expect(parseAmount('300')).toBe(300);
    expect(parseAmount('299,90')).toBe(299.9);
    expect(parseAmount('299.90')).toBe(299.9);
  });

  it('une entrée vide ou illisible est « non renseigné » — JAMAIS 0', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('0')).toBeNull();      // zéro n'est pas un budget
    expect(parseAmount('-5')).toBeNull();
  });
});

describe('buildOnboardingAnswers', () => {
  it("« tout décliné » produit un profil valide, sans rien d'inventé", () => {
    const ans = buildOnboardingAnswers({
      budgetRaw: '', condition: null, freeShipping: 'off', origin: null,
      shipping: {}, sharedAccounts: [], sharedExtra: '', excluded: [],
    });
    expect(ans).toEqual({
      preferredLanguage: 'fr',
      budget: null,
      condition: null,
      freeShipping: 'off',
      origin: null,
      excludedMerchants: [],
      shipping: null,
      merchantAccounts: null,
    });
  });

  it('un budget bien formé est envoyé; un budget cassé est passé à null', () => {
    const good = buildOnboardingAnswers({
      budgetRaw: '250,5', condition: null, freeShipping: 'off', origin: null,
      shipping: {}, sharedAccounts: [], sharedExtra: '', excluded: [],
    });
    expect(good.budget).toEqual({ maxAmount: 250.5, currency: 'EUR' });

    const broken = buildOnboardingAnswers({
      budgetRaw: 'beaucoup', condition: null, freeShipping: 'off', origin: null,
      shipping: {}, sharedAccounts: [], sharedExtra: '', excluded: [],
    });
    expect(broken.budget).toBeNull();
  });

  it("consentement : un compte n'est partagé que si COCHÉ", () => {
    const ans = buildOnboardingAnswers({
      budgetRaw: '', condition: null, freeShipping: 'off', origin: null,
      shipping: {}, sharedAccounts: ['Amazon'], sharedExtra: '', excluded: [],
    });
    expect(ans.merchantAccounts).toEqual([{ merchantName: 'Amazon' }]);
  });

  it("un compte saisi librement (« autre marchand ») est ajouté après les connus", () => {
    const ans = buildOnboardingAnswers({
      budgetRaw: '', condition: null, freeShipping: 'off', origin: null,
      shipping: {}, sharedAccounts: ['Fnac'], sharedExtra: 'Librairie XYZ', excluded: [],
    });
    expect(ans.merchantAccounts).toEqual([{ merchantName: 'Fnac' }, { merchantName: 'Librairie XYZ' }]);
  });

  it("un champ d'adresse vide n'est pas envoyé comme un objet; un champ rempli oui", () => {
    const empty = buildOnboardingAnswers({
      budgetRaw: '', condition: null, freeShipping: 'off', origin: null,
      shipping: { street: '  ' }, sharedAccounts: [], sharedExtra: '', excluded: [],
    });
    expect(empty.shipping).toBeNull();

    const filled = buildOnboardingAnswers({
      budgetRaw: '', condition: null, freeShipping: 'off', origin: null,
      shipping: { city: 'Rennes' }, sharedAccounts: [], sharedExtra: '', excluded: [],
    });
    expect(filled.shipping).toEqual({ city: 'Rennes' });
  });

  it('KNOWN_MERCHANT_NAMES reste une liste contrôlée et non vide', () => {
    expect(KNOWN_MERCHANT_NAMES.length).toBeGreaterThan(0);
    expect(KNOWN_MERCHANT_NAMES.every((m) => m.trim().length > 0)).toBe(true);
  });
});