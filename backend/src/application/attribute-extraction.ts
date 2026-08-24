/**
 * Capucine — Attribute extraction
 *
 * Reads the concrete, checkable attributes out of a natural-language request:
 * brand, model, compatibility, quantities with units, connectivity, material,
 * delivery destination and delivery deadline.
 *
 * DESIGN RULES
 * ────────────
 * 1. NEVER GUESS A HARD CONSTRAINT. Every extractor returns a confidence, and
 *    only attributes above CRITERION_CONFIDENCE_THRESHOLD may become required
 *    criteria (see attributeToCriterion). A token that merely LOOKS like a
 *    model number is extracted as a low-confidence hint, not as a filter.
 * 2. THE EVIDENCE IS KEPT. Every attribute records the exact substring it came
 *    from, so an explanation can quote the user instead of paraphrasing them.
 * 3. UNKNOWN IS NOT A MISMATCH. Every categorical attribute this module emits
 *    uses unknownPolicy 'pass': a merchant who does not publish the brand is
 *    not thereby selling a different brand.
 * 4. DETERMINISTIC. Pure functions over the text; no clock, no I/O, no AI.
 *
 * Deliberately NOT here: usage context (domain/usage-context-mapping.ts) and
 * budget/RAM/storage/screen-size/condition/colour, which BasicPatternInterpreter
 * already extracts. This module extends that set, it does not duplicate it.
 */

import {
  AttributeKind,
  ExtractedAttribute,
  QuantityOperator,
  makeQuantity,
} from '../domain/attributes';

// ============================================================================
// SHARED
// ============================================================================

/** End-of-token lookahead. \b is unusable after an accented letter (see extractCondition). */
const END = String.raw`(?=[\s,.;:!?)]|$)`;

function attribute(
  kind: AttributeKind,
  criterionId: string,
  label: string,
  matchedText: string,
  confidence: number,
  extra: Partial<ExtractedAttribute> = {}
): ExtractedAttribute {
  return {
    kind,
    criterionId,
    label,
    classification: 'hard',
    provenance: { origin: 'user_explicit', matchedText: matchedText.trim(), confidence },
    unknownPolicy: 'pass',
    ...extra,
  };
}

// ============================================================================
// BRAND
//
// A maintained list, on purpose. Brand recognition by heuristic ("a
// capitalised word must be a brand") produces exactly the kind of invented
// constraint INVARIANT 9 forbids — it would turn "Je cherche un Casque
// Confortable" into brand=Casque. An unlisted brand is simply not extracted;
// it still reaches discovery as a search term, as it always did.
// ============================================================================

const BRANDS: Record<string, string[]> = {
  sony: ['sony'],
  bose: ['bose'],
  apple: ['apple'],
  samsung: ['samsung'],
  jabra: ['jabra'],
  sennheiser: ['sennheiser'],
  jbl: ['jbl'],
  beats: ['beats'],
  anker: ['anker', 'soundcore'],
  'audio-technica': ['audio-technica', 'audio technica'],
  bang_olufsen: ['bang & olufsen', 'bang and olufsen', 'b&o'],
  logitech: ['logitech'],
  razer: ['razer'],
  hyperx: ['hyperx'],
  steelseries: ['steelseries'],
  corsair: ['corsair'],
  keychron: ['keychron'],
  dell: ['dell'],
  hp: ['hp'],
  lenovo: ['lenovo'],
  asus: ['asus'],
  acer: ['acer'],
  msi: ['msi'],
  microsoft: ['microsoft'],
  google: ['google'],
  xiaomi: ['xiaomi'],
  oneplus: ['oneplus'],
  fairphone: ['fairphone'],
  nothing: ['nothing phone'],
  garmin: ['garmin'],
  nike: ['nike'],
  adidas: ['adidas'],
  dyson: ['dyson'],
  roborock: ['roborock'],
  irobot: ['irobot', 'roomba'],
  philips: ['philips'],
  lg: ['lg'],
  panasonic: ['panasonic'],
  canon: ['canon'],
  nikon: ['nikon'],
  fujifilm: ['fujifilm'],
  bosch: ['bosch'],
  siemens: ['siemens'],
};

/** Longest alias first, so "audio technica" wins over a hypothetical "audio". */
const BRAND_ALIASES: Array<{ id: string; alias: string }> = Object.entries(BRANDS)
  .flatMap(([id, aliases]) => aliases.map(alias => ({ id, alias })))
  .sort((a, b) => b.alias.length - a.alias.length);

export function extractBrand(text: string): ExtractedAttribute | null {
  const lower = text.toLowerCase();
  for (const { id, alias } of BRAND_ALIASES) {
    const pattern = new RegExp(`(?:^|[\\s,.;:('"])${escapeRegExp(alias)}${END}`, 'i');
    const match = lower.match(pattern);
    if (!match) continue;
    const matchedText = match[0].replace(/^[\s,.;:('"]+/, '');
    return attribute('brand', 'brand', 'Marque', matchedText, 0.95, {
      // Both the canonical id and every spelling: an offer may publish
      // "Audio-Technica" or "audio technica" for the same brand.
      values: [...new Set([id.replace(/_/g, ' '), ...BRANDS[id]])],
      matchMode: 'equals',
    });
  }
  return null;
}

// ============================================================================
// MODEL
//
// A model reference is only accepted when there is real evidence it IS one:
//   - it is quoted by the user, or
//   - it sits next to a recognised brand, or
//   - it has the unmistakable shape of a manufacturer reference
//     (letters + digits + a hyphen, e.g. WH-1000XM5, ATH-M50xBT2).
// A bare alphanumeric token ("iphone15", "k3") is extracted with LOW
// confidence, which keeps it out of admissibility while still recording it.
//
// matchMode is 'contains_any': the user's "XM5" must match a merchant's
// "WH-1000XM5". That is substring recognition of what the user actually wrote,
// not an invented expansion — Capucine never turns "XM5" INTO "WH-1000XM5".
// ============================================================================

const STRONG_MODEL_SHAPE = /\b([A-Za-z]{1,6}-\d{1,6}[A-Za-z0-9]{0,8}|[A-Za-z]{1,4}\d{2,6}[A-Za-z]{0,4}-[A-Za-z0-9]{1,6})\b/;
const WEAK_MODEL_SHAPE = /\b([A-Za-z]{2,6}\d{1,5}[A-Za-z]{0,4})\b/;

/** Tokens that look like a model but are a unit, a spec, or a common word. */
const MODEL_STOPWORDS = new Set([
  'ps4', 'ps5', 'xbox', 'usb2', 'usb3', 'mp3', 'mp4', 'hd', 'fhd', 'uhd', '4k', '8k',
  'wifi6', 'wifi7', 'bt5', 'ip67', 'ip68', 'ipx4', 'ipx5', 'ipx7', 'a4', 'a3',
]);

export function extractModel(text: string, brand: ExtractedAttribute | null): ExtractedAttribute | null {
  // 1. Quoted — the user is being deliberately precise.
  const quoted = text.match(/["«»""]([^"«»""]{2,40})["«»""]/);
  if (quoted && /\d/.test(quoted[1])) {
    return modelAttribute(quoted[1].trim(), quoted[0], 0.95);
  }

  // 2. Unmistakable manufacturer-reference shape.
  const strong = text.match(STRONG_MODEL_SHAPE);
  if (strong && !MODEL_STOPWORDS.has(strong[1].toLowerCase())) {
    return modelAttribute(strong[1], strong[0], 0.9);
  }

  // 3. Weak shape — only trusted when a recognised brand is present in the
  //    same sentence, which is what makes "XM5" a model rather than noise.
  const weak = text.match(WEAK_MODEL_SHAPE);
  if (weak && !MODEL_STOPWORDS.has(weak[1].toLowerCase())) {
    const isBrandItself = brand?.values?.some(v => v.toLowerCase() === weak[1].toLowerCase());
    if (!isBrandItself) {
      return modelAttribute(weak[1], weak[0], brand ? 0.8 : 0.5);
    }
  }

  return null;
}

function modelAttribute(reference: string, matchedText: string, confidence: number): ExtractedAttribute {
  return attribute('model', 'model', 'Modèle', matchedText, confidence, {
    values: [reference],
    matchMode: 'contains_any',
  });
}

// ============================================================================
// COMPATIBILITY
//
// "compatible PS5", "fonctionne avec mon iPhone", "compatible Mac".
// Explicitly asked for → a real constraint. But an offer that says nothing
// about compatibility is UNKNOWN, never INCOMPATIBLE (spec §9) — hence
// unknownPolicy 'pass', and matchMode 'contains_any' because a compatibility
// field is naturally a list ("PS5, PC, Switch").
// ============================================================================

const COMPATIBILITY_TARGETS: Array<{ id: string; values: string[]; patterns: RegExp[] }> = [
  { id: 'ps5', values: ['ps5', 'playstation 5', 'playstation5'], patterns: [/\bps\s?5\b/i, /\bplaystation\s?5\b/i] },
  { id: 'ps4', values: ['ps4', 'playstation 4'], patterns: [/\bps\s?4\b/i, /\bplaystation\s?4\b/i] },
  { id: 'xbox', values: ['xbox', 'xbox series x', 'xbox series s'], patterns: [/\bxbox(?:\s+series\s+[xs])?\b/i] },
  { id: 'switch', values: ['switch', 'nintendo switch'], patterns: [/\bnintendo\s+switch\b/i, /\bswitch\b/i] },
  { id: 'iphone', values: ['iphone', 'ios', 'apple'], patterns: [/\biphone\b/i, /\bios\b/i] },
  { id: 'android', values: ['android'], patterns: [/\bandroid\b/i] },
  { id: 'mac', values: ['mac', 'macos', 'macbook'], patterns: [/\bmac(?:os|book)?\b/i] },
  { id: 'windows', values: ['windows', 'pc', 'windows 11'], patterns: [/\bwindows(?:\s+1[01])?\b/i] },
  { id: 'pc', values: ['pc', 'windows'], patterns: [/\bpc\b/i] },
];

/**
 * Compatibility is only a CONSTRAINT when the user framed it as one —
 * "compatible X", "fonctionne avec X", "works with X", "pour mon X".
 * A bare mention of a device name is not a demand, so the marker is required.
 */
const COMPATIBILITY_MARKERS = [
  new RegExp(String.raw`compatible\s+(?:avec\s+)?(?:mon\s+|ma\s+|le\s+|la\s+|les\s+|un\s+|une\s+)?([\w\s-]{2,25})`, 'i'),
  new RegExp(String.raw`fonctionne\s+(?:avec|sur)\s+(?:mon\s+|ma\s+|le\s+|la\s+|un\s+|une\s+)?([\w\s-]{2,25})`, 'i'),
  new RegExp(String.raw`works?\s+with\s+(?:my\s+|a\s+|an\s+|the\s+)?([\w\s-]{2,25})`, 'i'),
  new RegExp(String.raw`compatible\s+with\s+(?:my\s+|a\s+|an\s+|the\s+)?([\w\s-]{2,25})`, 'i'),
  new RegExp(String.raw`pour\s+(?:mon|ma)\s+([\w-]{2,25})`, 'i'),
];

export function extractCompatibility(text: string): ExtractedAttribute[] {
  const found: ExtractedAttribute[] = [];
  const seen = new Set<string>();

  for (const marker of COMPATIBILITY_MARKERS) {
    const match = text.match(marker);
    if (!match) continue;
    const scope = match[1];

    for (const target of COMPATIBILITY_TARGETS) {
      if (seen.has(target.id)) continue;
      if (!target.patterns.some(p => p.test(scope))) continue;
      seen.add(target.id);
      found.push(
        attribute('compatibility', `compatible_${target.id}`, `Compatibilité ${target.id.toUpperCase()}`, match[0], 0.85, {
          values: target.values,
          matchMode: 'contains_any',
        })
      );
    }
  }

  return found;
}

// ============================================================================
// CONNECTIVITY — "USB-C", "Bluetooth 5.2", "jack 3.5"
//
// Stated as a plain fact about the product the user wants. Treated as a SOFT
// attribute unless the user framed it with an obligation marker, because
// "casque bluetooth" is closer to a product family than to a filter.
// ============================================================================

const CONNECTIVITY_TARGETS: Array<{ id: string; values: string[]; pattern: RegExp }> = [
  { id: 'usb_c', values: ['usb-c', 'usb c', 'type-c'], pattern: /\busb[\s-]?c\b|\btype[\s-]?c\b/i },
  { id: 'usb_a', values: ['usb-a', 'usb a'], pattern: /\busb[\s-]?a\b/i },
  { id: 'jack', values: ['jack', 'jack 3.5', '3.5mm'], pattern: /\bjack(?:\s*3[.,]5)?\b|\b3[.,]5\s*mm\b/i },
  { id: 'bluetooth', values: ['bluetooth'], pattern: /\bbluetooth\b/i },
  { id: 'wifi', values: ['wifi', 'wi-fi'], pattern: /\bwi[\s-]?fi\b/i },
  { id: 'optical', values: ['optique', 'optical', 'toslink'], pattern: /\boptique\b|\boptical\b|\btoslink\b/i },
];

const OBLIGATION_MARKER = /\b(?:absolument|imp[ée]rativement|obligatoire(?:ment)?|il\s+me\s+faut|je\s+veux\s+absolument|must\s+have|mandatory|required)\b/i;

export function extractConnectivity(text: string): ExtractedAttribute[] {
  const obligatory = OBLIGATION_MARKER.test(text);
  const found: ExtractedAttribute[] = [];

  for (const target of CONNECTIVITY_TARGETS) {
    const match = text.match(target.pattern);
    if (!match) continue;
    found.push(
      attribute('connectivity', `connectivity_${target.id}`, `Connectique ${target.values[0]}`, match[0], 0.8, {
        values: target.values,
        matchMode: 'contains_any',
        // Without an obligation marker this only influences ranking: naming a
        // connector describes the product wanted, it does not forbid the rest.
        classification: obligatory ? 'hard' : 'soft',
      })
    );
  }

  return found;
}

// ============================================================================
// MATERIAL — "en cuir", "en aluminium", "leather"
// ============================================================================

const MATERIALS: Array<{ id: string; values: string[]; pattern: RegExp }> = [
  { id: 'cuir', values: ['cuir', 'leather'], pattern: new RegExp(String.raw`en\s+cuir` + END, 'i') },
  { id: 'aluminium', values: ['aluminium', 'aluminum', 'alu'], pattern: new RegExp(String.raw`en\s+alu(?:minium)?` + END, 'i') },
  { id: 'acier', values: ['acier', 'steel', 'inox'], pattern: new RegExp(String.raw`en\s+(?:acier|inox)` + END, 'i') },
  { id: 'bois', values: ['bois', 'wood'], pattern: new RegExp(String.raw`en\s+bois` + END, 'i') },
  { id: 'plastique', values: ['plastique', 'plastic'], pattern: new RegExp(String.raw`en\s+plastique` + END, 'i') },
  { id: 'coton', values: ['coton', 'cotton'], pattern: new RegExp(String.raw`en\s+coton` + END, 'i') },
  { id: 'verre', values: ['verre', 'glass'], pattern: new RegExp(String.raw`en\s+verre` + END, 'i') },
];

export function extractMaterial(text: string): ExtractedAttribute | null {
  for (const material of MATERIALS) {
    const match = text.match(material.pattern);
    if (!match) continue;
    return attribute('material', 'material', 'Matière', match[0], 0.85, {
      values: material.values,
      matchMode: 'contains_any',
    });
  }
  return null;
}

// ============================================================================
// QUANTITATIVE CONSTRAINTS
//
// "moins de 1 kg", "au moins 30 h", "entre 200 et 300 €", "2 exemplaires".
//
// Boundary semantics are explicit and tested: "maximum 300 €" ACCEPTS 300 and
// rejects 301. An inclusive bound stated by the user stays inclusive — that is
// what INVARIANT 1 protects on both sides.
// ============================================================================

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT_WORD = String.raw`(kg|kilos?|kilogrammes?|g|gr|grammes?|mg|mm|cm|m|ml|cl|l|litres?|min|minutes?|h|heures?|hours?|mo|mb|go|gb|to|tb)`;

/** Attribute a unit belongs to, so "moins de 1 kg" targets `weight`. */
const UNIT_TO_ATTRIBUTE: Array<{ pattern: RegExp; kind: AttributeKind; criterionId: string; label: string }> = [
  { pattern: /^(kg|kilos?|kilogrammes?|g|gr|grammes?|mg)$/i, kind: 'weight', criterionId: 'weight', label: 'Poids' },
  { pattern: /^(mm|cm|m)$/i, kind: 'dimension', criterionId: 'dimension', label: 'Dimension' },
  { pattern: /^(ml|cl|l|litres?)$/i, kind: 'capacity', criterionId: 'volume', label: 'Contenance' },
  { pattern: /^(min|minutes?|h|heures?|hours?)$/i, kind: 'battery_life', criterionId: 'battery_life', label: 'Autonomie' },
  { pattern: /^(mo|mb|go|gb|to|tb)$/i, kind: 'capacity', criterionId: 'storage', label: 'Capacité' },
];

const COMPARATORS: Array<{ operator: QuantityOperator; pattern: RegExp }> = [
  { operator: 'lte', pattern: new RegExp(String.raw`(?:moins\s+de|maximum|max\.?|au\s+plus|pas\s+plus\s+de|under|less\s+than|at\s+most|up\s+to)\s+${NUMBER}\s*${UNIT_WORD}` + END, 'i') },
  { operator: 'gte', pattern: new RegExp(String.raw`(?:au\s+moins|minimum|min\.?|plus\s+de|à\s+partir\s+de|at\s+least|more\s+than|over)\s+${NUMBER}\s*${UNIT_WORD}` + END, 'i') },
  { operator: 'between', pattern: new RegExp(String.raw`entre\s+${NUMBER}\s*${UNIT_WORD}?\s+et\s+${NUMBER}\s*${UNIT_WORD}` + END, 'i') },
];

export function extractQuantitativeConstraints(text: string): ExtractedAttribute[] {
  const found: ExtractedAttribute[] = [];
  const usedCriteria = new Set<string>();

  // 'between' first: "entre 200 et 300 g" also contains a bare "300 g".
  for (const { operator, pattern } of [...COMPARATORS].sort((a, b) => (a.operator === 'between' ? -1 : b.operator === 'between' ? 1 : 0))) {
    const regex = new RegExp(pattern.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const isBetween = operator === 'between';
      const rawUnit = (isBetween ? match[4] ?? match[2] : match[2]) ?? '';
      const target = UNIT_TO_ATTRIBUTE.find(t => t.pattern.test(rawUnit));
      if (!target) continue;
      if (usedCriteria.has(target.criterionId)) continue;

      const value = parseFloat((isBetween ? match[1] : match[1]).replace(',', '.'));
      const maxValue = isBetween ? parseFloat(match[3].replace(',', '.')) : undefined;
      const quantity = makeQuantity(operator, value, rawUnit, maxValue);
      if (!quantity) continue;

      usedCriteria.add(target.criterionId);
      found.push(
        attribute(target.kind, target.criterionId, target.label, match[0], 0.9, {
          quantity,
          // A verifiable spec: "moins de 1 kg" cannot be reported as satisfied
          // by an offer that never published its weight. Rejecting there is the
          // honest option — the same rule ram/storage/screen_size already follow.
          unknownPolicy: 'reject',
        })
      );
    }
  }

  return found;
}

// ============================================================================
// QUANTITY (how many items)
// ============================================================================

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six_en: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const QUANTITY_NOUNS = String.raw`(?:exemplaires?|pi[èe]ces?|unit[ée]s?|paires?|lots?|items?|pieces?|units?)`;

export function extractQuantity(text: string): ExtractedAttribute | null {
  const digits = text.match(new RegExp(String.raw`\b(\d{1,3})\s+${QUANTITY_NOUNS}` + END, 'i'));
  if (digits) {
    const quantity = makeQuantity('eq', parseInt(digits[1], 10), '');
    if (quantity) {
      return attribute('quantity', 'quantity', 'Quantité', digits[0], 0.9, {
        quantity,
        // Quantity is about the ORDER, not about whether an offer qualifies —
        // it must never filter offers out. Soft by construction.
        classification: 'soft',
      });
    }
  }

  const words = text.match(new RegExp(String.raw`\b(${Object.keys(NUMBER_WORDS).filter(w => !w.includes('_')).join('|')})\s+${QUANTITY_NOUNS}` + END, 'i'));
  if (words) {
    const n = NUMBER_WORDS[words[1].toLowerCase()];
    const quantity = n !== undefined ? makeQuantity('eq', n, '') : null;
    if (quantity) {
      return attribute('quantity', 'quantity', 'Quantité', words[0], 0.85, {
        quantity,
        classification: 'soft',
      });
    }
  }

  return null;
}

// ============================================================================
// DELIVERY DEADLINE
//
// "je dois l'avoir vendredi", "avant lundi", "pour demain".
//
// A date is only a CONSTRAINT when the user framed it as an obligation. "livré
// vendredi ce serait bien" is a wish; "je dois l'avoir vendredi" is a
// requirement. An ambiguous mention becomes a SOFT attribute — spec §13.
//
// Resolution to an actual calendar date is deliberately NOT done here: it
// depends on "now", which would make extraction non-deterministic. The
// attribute carries the raw temporal expression plus a normalised token; the
// layer that owns a clock resolves it.
// ============================================================================

const WEEKDAYS: Record<string, string> = {
  lundi: 'monday', mardi: 'tuesday', mercredi: 'wednesday', jeudi: 'thursday',
  vendredi: 'friday', samedi: 'saturday', dimanche: 'sunday',
  monday: 'monday', tuesday: 'tuesday', wednesday: 'wednesday', thursday: 'thursday',
  friday: 'friday', saturday: 'saturday', sunday: 'sunday',
};

const RELATIVE_DAYS: Record<string, string> = {
  "aujourd'hui": 'today', demain: 'tomorrow', "après-demain": 'day_after_tomorrow',
  today: 'today', tomorrow: 'tomorrow',
};

const DEADLINE_OBLIGATION = /\b(?:je\s+dois\s+l['’]avoir|il\s+me\s+le\s+faut|il\s+me\s+la\s+faut|imp[ée]rativement|absolument|avant|pas\s+plus\s+tard\s+que|i\s+need\s+it\s+by|must\s+arrive|no\s+later\s+than|by)\b/i;

export function extractDeliveryDeadline(text: string): ExtractedAttribute | null {
  const dayPattern = [...Object.keys(WEEKDAYS), ...Object.keys(RELATIVE_DAYS)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const match = text.match(new RegExp(String.raw`(?:livr[ée]e?\s+|re[çc]u\s+|pour\s+|avant\s+|d['’]ici\s+|by\s+|before\s+)?\b(${dayPattern})\b`, 'i'));
  if (!match) return null;

  const token = match[1].toLowerCase();
  const normalized = WEEKDAYS[token] ?? RELATIVE_DAYS[token];
  if (!normalized) return null;

  // Obligation must be stated somewhere in the sentence for this to bind.
  const isObligation = DEADLINE_OBLIGATION.test(text);

  return attribute('delivery_deadline', 'delivery_deadline', 'Délai de livraison', match[0], isObligation ? 0.85 : 0.5, {
    values: [normalized],
    matchMode: 'equals',
    // Ambiguous mentions stay soft: Capucine must not refuse offers over a
    // date the user merely mentioned in passing (spec §13).
    classification: isObligation ? 'hard' : 'soft',
    unknownPolicy: 'pass',
  });
}

// ============================================================================
// DESTINATION — "livré en France", "delivered to Belgium"
//
// Where the product must actually arrive. Distinct from the SEARCH scope
// (which countries Capucine looks in) — conflating the two is the mistake the
// conversation layer already documents at length. unknownPolicy 'pass': a
// merchant who publishes no shipping destination is unknown, not proven
// undeliverable.
// ============================================================================

const DESTINATION_COUNTRIES: Record<string, string> = {
  france: 'FR', belgique: 'BE', belgium: 'BE', suisse: 'CH', switzerland: 'CH',
  allemagne: 'DE', germany: 'DE', espagne: 'ES', spain: 'ES',
  italie: 'IT', italy: 'IT', portugal: 'PT', luxembourg: 'LU',
};

export function extractDestination(text: string): ExtractedAttribute | null {
  const names = Object.keys(DESTINATION_COUNTRIES).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
  const pattern = new RegExp(
    String.raw`(?:livr[ée]e?s?\s+(?:en|au|aux|à|a|vers)|livraison\s+(?:en|au|aux|vers)|exp[ée]di[ée]e?\s+(?:en|au|vers)|delivered\s+(?:to|in)|shipped\s+to|ship\s+to)\s+(${names})` + END,
    'i'
  );
  const match = text.match(pattern);
  if (!match) return null;
  const code = DESTINATION_COUNTRIES[match[1].toLowerCase()];
  if (!code) return null;
  return attribute('destination', 'deliversTo', 'Livrable à destination', match[0], 0.9, {
    values: [code],
    matchMode: 'contains_any',
  });
}

// ============================================================================
// ORCHESTRATION
// ============================================================================

export interface AttributeExtractionResult {
  attributes: ExtractedAttribute[];
  /** Every matched substring, so callers can keep them out of search terms. */
  spans: string[];
}

/**
 * Run every extractor over one request text.
 * Order is fixed, so the output is fully deterministic.
 */
export function extractAttributes(text: string): AttributeExtractionResult {
  const attributes: ExtractedAttribute[] = [];

  const brand = extractBrand(text);
  if (brand) attributes.push(brand);

  const model = extractModel(text, brand);
  if (model) attributes.push(model);

  attributes.push(...extractCompatibility(text));
  attributes.push(...extractConnectivity(text));

  const material = extractMaterial(text);
  if (material) attributes.push(material);

  attributes.push(...extractQuantitativeConstraints(text));

  const quantity = extractQuantity(text);
  if (quantity) attributes.push(quantity);

  const destination = extractDestination(text);
  if (destination) attributes.push(destination);

  const deadline = extractDeliveryDeadline(text);
  if (deadline) attributes.push(deadline);

  return {
    attributes,
    spans: attributes.map(a => a.provenance.matchedText).filter(Boolean),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
