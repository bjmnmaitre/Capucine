/**
 * Typed attribute extraction — brand, model, compatibility, connectivity,
 * material, quantities with units, destination, delivery deadline.
 *
 * Covers spec §21 A (French), B (English), G (compatibility), H (quantity),
 * I (units), J (price boundaries), K (delivery), plus the confidence gate that
 * keeps a guess from ever becoming a filter.
 */

import {
  extractAttributes,
  extractBrand,
  extractModel,
  extractCompatibility,
  extractConnectivity,
  extractMaterial,
  extractQuantitativeConstraints,
  extractQuantity,
  extractDestination,
  extractDeliveryDeadline,
} from '../../src/application/attribute-extraction';
import {
  attributeToCriterion,
  normalizeUnit,
  makeQuantity,
  CRITERION_CONFIDENCE_THRESHOLD,
} from '../../src/domain/attributes';
import { BasicPatternInterpreter } from '../../src/application/request-interpreter';

const interpreter = new BasicPatternInterpreter();

function interpret(text: string) {
  return interpreter.interpretSync({ id: 'q', userId: 'u', text, timestamp: new Date() });
}

// ============================================================================
// BRAND
// ============================================================================

describe('Brand — recognised from a maintained list, never guessed', () => {
  it.each([
    ['Je cherche un Sony WH-1000XM5', 'sony'],
    ['casque Bose QC45', 'bose'],
    ['un clavier Keychron K3', 'keychron'],
    ['audio technica ath-m50x', 'audio-technica'],
  ])('"%s" → brand %s', (text, expected) => {
    const brand = extractBrand(text);
    expect(brand).not.toBeNull();
    expect(brand!.values).toContain(expected);
    expect(brand!.classification).toBe('hard');
  });

  it('does not invent a brand from an unknown capitalised word', () => {
    expect(extractBrand('Je cherche un Casque Confortable')).toBeNull();
    expect(extractBrand('un aspirateur silencieux')).toBeNull();
  });

  it('records the exact words it read the brand from', () => {
    const brand = extractBrand('je veux un casque Sony noir')!;
    expect(brand.provenance.matchedText.toLowerCase()).toBe('sony');
    expect(brand.provenance.origin).toBe('user_explicit');
  });

  it('is confident enough to become a hard criterion', () => {
    const brand = extractBrand('casque Sony')!;
    expect(brand.provenance.confidence).toBeGreaterThanOrEqual(CRITERION_CONFIDENCE_THRESHOLD);
    expect(attributeToCriterion(brand)!.level).toBe('required');
  });
});

// ============================================================================
// MODEL
// ============================================================================

describe('Model — evidence required, never a bare guess', () => {
  it('recognises an unmistakable manufacturer reference', () => {
    const model = extractModel('Sony WH-1000XM5 noir', extractBrand('Sony WH-1000XM5 noir'));
    expect(model!.values).toEqual(['WH-1000XM5']);
    expect(model!.provenance.confidence).toBeGreaterThanOrEqual(CRITERION_CONFIDENCE_THRESHOLD);
  });

  it('trusts a short reference ONLY when a known brand is present', () => {
    const withBrand = extractModel('Sony XM5', extractBrand('Sony XM5'));
    expect(withBrand!.values).toEqual(['XM5']);
    expect(withBrand!.provenance.confidence).toBeGreaterThanOrEqual(CRITERION_CONFIDENCE_THRESHOLD);

    const withoutBrand = extractModel('un truc XM5', null);
    expect(withoutBrand!.provenance.confidence).toBeLessThan(CRITERION_CONFIDENCE_THRESHOLD);
    // Below the threshold it may NOT filter anybody's offer.
    expect(attributeToCriterion(withoutBrand!)!.level).not.toBe('required');
  });

  it('matches a partial reference against a fuller one, without inventing it', () => {
    const model = extractModel('Sony XM5', extractBrand('Sony XM5'))!;
    expect(model.matchMode).toBe('contains_any');
    // The stored value stays exactly what the user wrote.
    expect(model.values).toEqual(['XM5']);
  });

  it('does not mistake a platform name or a spec for a model', () => {
    expect(extractModel('casque compatible PS5', null)).toBeNull();
    expect(extractModel('écran 4k', null)).toBeNull();
  });
});

// ============================================================================
// G. COMPATIBILITY
// ============================================================================

describe('G. Compatibility — a demand, not a passing mention', () => {
  it.each([
    ['casque compatible PS5', 'compatible_ps5'],
    ['un casque qui fonctionne avec mon iPhone', 'compatible_iphone'],
    ['compatible Android', 'compatible_android'],
    ['headphones compatible with Mac', 'compatible_mac'],
    ['works with my PS5', 'compatible_ps5'],
  ])('"%s" → %s', (text, criterionId) => {
    const found = extractCompatibility(text);
    expect(found.map(a => a.criterionId)).toContain(criterionId);
  });

  it('a bare device name is NOT a compatibility demand', () => {
    expect(extractCompatibility('manette PS5 sans fil')).toHaveLength(0);
    expect(extractCompatibility('je viens de vendre mon iPhone')).toHaveLength(0);
  });

  it('never treats unknown compatibility as incompatible', () => {
    const [compat] = extractCompatibility('casque compatible PS5');
    // 'pass': an offer that says nothing about PS5 is unknown, not rejected.
    expect(compat.unknownPolicy).toBe('pass');
    expect(attributeToCriterion(compat)!.parameters!.unknownPolicy).toBe('pass');
  });

  it('matches against a multi-valued compatibility field', () => {
    const [compat] = extractCompatibility('casque compatible PS5');
    expect(compat.matchMode).toBe('contains_any');
  });

  it('handles several demanded targets without duplicating them', () => {
    const found = extractCompatibility('compatible PS5 et compatible Mac');
    const ids = found.map(a => a.criterionId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ============================================================================
// I. UNITS
// ============================================================================

describe('I. Units — normalised to one canonical scale', () => {
  it.each([
    [1, 'kg', 'g', 1000],
    [250, 'g', 'g', 250],
    [1.5, 'l', 'ml', 1500],
    [30, 'cm', 'mm', 300],
    [45, 'min', 'h', 0.75],
    [2, 'h', 'h', 2],
    [512, 'Mo', 'GB', 0.512],
    [1, 'To', 'GB', 1000],
  ])('%s %s → %s %s', (value, rawUnit, unit, normalized) => {
    const result = normalizeUnit(value as number, rawUnit as string);
    expect(result).not.toBeNull();
    expect(result!.unit).toBe(unit);
    expect(result!.normalized).toBeCloseTo(normalized as number, 4);
  });

  it('refuses to convert a unit it does not know — no guessed factor', () => {
    expect(normalizeUnit(3, 'furlongs')).toBeNull();
    expect(makeQuantity('lte', 3, 'furlongs')).toBeNull();
  });

  it('two values in different units become directly comparable', () => {
    const inKg = makeQuantity('lte', 1, 'kg')!;
    const inG = makeQuantity('lte', 900, 'g')!;
    expect(inG.normalized).toBeLessThan(inKg.normalized);
  });
});

// ============================================================================
// H. QUANTITATIVE CONSTRAINTS
// ============================================================================

describe('H. Quantitative constraints — operator, value, unit, all preserved', () => {
  it('"moins de 1 kg" → weight ≤ 1000 g', () => {
    const [weight] = extractQuantitativeConstraints('un casque de moins de 1 kg');
    expect(weight.criterionId).toBe('weight');
    expect(weight.quantity).toMatchObject({ operator: 'lte', value: 1, rawUnit: 'kg', unit: 'g', normalized: 1000 });
    expect(attributeToCriterion(weight)!.parameters!.maxValue).toBe(1000);
  });

  it('"au moins 30 h" → battery ≥ 30 h', () => {
    const [battery] = extractQuantitativeConstraints("au moins 30 h d'autonomie");
    expect(battery.criterionId).toBe('battery_life');
    expect(battery.quantity!.operator).toBe('gte');
    expect(attributeToCriterion(battery)!.parameters!.minValue).toBe(30);
  });

  it('"entre 200 et 300 g" → both bounds', () => {
    const [weight] = extractQuantitativeConstraints('entre 200 et 300 g');
    expect(weight.quantity!.operator).toBe('between');
    const criterion = attributeToCriterion(weight)!;
    expect(criterion.parameters!.minValue).toBe(200);
    expect(criterion.parameters!.maxValue).toBe(300);
  });

  it('English comparators work the same way', () => {
    const [weight] = extractQuantitativeConstraints('less than 500 g');
    expect(weight.quantity!.operator).toBe('lte');
    expect(weight.quantity!.normalized).toBe(500);
  });

  it('a verifiable spec constraint does not silently accept unverifiable offers', () => {
    const [weight] = extractQuantitativeConstraints('moins de 1 kg');
    // Unknown weight cannot be reported as complying with "moins de 1 kg".
    expect(weight.unknownPolicy).toBe('reject');
  });

  it('a bare number with no comparator is not turned into a constraint', () => {
    expect(extractQuantitativeConstraints('casque 250 g')).toHaveLength(0);
  });
});

// ============================================================================
// QUANTITY (how many)
// ============================================================================

describe('Quantity — how many items, never a filter on offers', () => {
  it.each([
    ['je veux 2 exemplaires', 2],
    ['trois pièces', 3],
    ['5 unités', 5],
  ])('"%s" → %s', (text, expected) => {
    const quantity = extractQuantity(text)!;
    expect(quantity.quantity!.value).toBe(expected);
  });

  it('is soft: wanting two of something never disqualifies an offer', () => {
    const quantity = extractQuantity('je veux 2 exemplaires')!;
    expect(quantity.classification).toBe('soft');
    expect(attributeToCriterion(quantity)!.level).not.toBe('required');
  });
});

// ============================================================================
// CONNECTIVITY & MATERIAL
// ============================================================================

describe('Connectivity and material', () => {
  it('naming a connector describes the product, it does not filter', () => {
    const [usbc] = extractConnectivity('un hub usb-c');
    expect(usbc.classification).toBe('soft');
  });

  it('an obligation marker makes it a real constraint', () => {
    const found = extractConnectivity('il me faut absolument de l\'usb-c');
    expect(found.find(a => a.criterionId === 'connectivity_usb_c')!.classification).toBe('hard');
  });

  it('extracts a stated material', () => {
    const material = extractMaterial('un sac en cuir')!;
    expect(material.values).toContain('cuir');
    expect(material.matchMode).toBe('contains_any');
  });
});

// ============================================================================
// K. DELIVERY — destination and deadline
// ============================================================================

describe('K. Delivery destination and deadline', () => {
  it.each([
    ['livré en France', 'FR'],
    ['livraison en Belgique', 'BE'],
    ['delivered to Germany', 'DE'],
  ])('"%s" → %s', (text, code) => {
    const destination = extractDestination(text)!;
    expect(destination.values).toEqual([code]);
    expect(destination.criterionId).toBe('deliversTo');
  });

  it('an unknown shipping policy is never read as "does not deliver"', () => {
    const destination = extractDestination('livré en France')!;
    expect(destination.unknownPolicy).toBe('pass');
  });

  it('an explicit deadline is a constraint', () => {
    const deadline = extractDeliveryDeadline("je dois l'avoir vendredi")!;
    expect(deadline.values).toEqual(['friday']);
    expect(deadline.classification).toBe('hard');
  });

  it('a date merely mentioned stays soft — Capucine does not invent an obligation', () => {
    const deadline = extractDeliveryDeadline('livré vendredi ce serait bien')!;
    expect(deadline.classification).toBe('soft');
    expect(attributeToCriterion(deadline)!.level).not.toBe('required');
  });

  it('resolves the weekday to a stable token, not to a calendar date', () => {
    // Resolving to a date needs a clock; extraction must stay deterministic.
    const deadline = extractDeliveryDeadline('avant lundi')!;
    expect(deadline.values).toEqual(['monday']);
  });
});

// ============================================================================
// ORCHESTRATION + WIRING INTO THE INTERPRETER
// ============================================================================

describe('The interpreter folds attributes into its criteria', () => {
  it('the reference request yields every explicit constraint', () => {
    const result = interpret(
      'Je cherche un Sony WH-1000XM5 noir pour écouter de la musique, surtout dans les transports, moins de 300 €, neuf uniquement, livré en France'
    );
    const ids = result.extractedCriteria.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['brand', 'model', 'color', 'budget', 'condition', 'deliversTo']));

    const byId = (id: string) => result.extractedCriteria.find(c => c.id === id)!;
    expect(byId('brand').parameters!.preferredValues).toContain('sony');
    expect(byId('model').parameters!.preferredValues).toContain('WH-1000XM5');
    expect(byId('budget').parameters!.maxBudget).toBe(300);
  });

  it('keeps the usage contextual — it never joins the constraints', () => {
    const result = interpret('Sony WH-1000XM5 pour écouter de la musique, surtout dans les transports');
    expect(result.usageContext!.usage).toBe('music');
    const ids = result.extractedCriteria.map(c => c.id);
    for (const contextual of ['weight', 'battery_life', 'anc', 'portability', 'comfort']) {
      expect(ids).not.toContain(contextual);
    }
  });

  it('exposes every attribute, including the ones too uncertain to filter on', () => {
    const result = interpret('un truc XM5');
    const model = (result.attributes ?? []).find(a => a.kind === 'model');
    expect(model).toBeDefined();
    expect(model!.provenance.confidence).toBeLessThan(CRITERION_CONFIDENCE_THRESHOLD);
    expect(result.extractedCriteria.find(c => c.id === 'model')!.level).not.toBe('required');
  });

  it('keeps brand and model in the SEARCH TERMS — they are the best query there is', () => {
    const result = interpret('Sony WH-1000XM5 noir moins de 300 euros');
    const terms = (result.suggestedSearchTerms ?? []).join(' ').toLowerCase();
    expect(terms).toContain('sony');
    expect(terms).toContain('wh-1000xm5');
    // …while the measurement noise is stripped, as it always was.
    expect(terms).not.toContain('300');
  });

  it('strips a measurement from the search terms but keeps it as a constraint', () => {
    const result = interpret('casque de moins de 1 kg');
    expect((result.suggestedSearchTerms ?? []).join(' ')).not.toContain('1');
    expect(result.extractedCriteria.find(c => c.id === 'weight')!.parameters!.maxValue).toBe(1000);
  });

  it('is deterministic — same text, same attributes', () => {
    const text = 'Sony WH-1000XM5 noir compatible PS5 moins de 300 €, livré en France';
    expect(JSON.stringify(extractAttributes(text).attributes))
      .toBe(JSON.stringify(extractAttributes(text).attributes));
  });

  it('a request with none of these attributes produces none of them', () => {
    const result = extractAttributes('je cherche quelque chose de sympa');
    expect(result.attributes).toHaveLength(0);
  });
});
