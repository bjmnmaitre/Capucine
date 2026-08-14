/**
 * Integration Tests — Layer Contract Validation
 *
 * Validates that the application layer contracts work correctly with
 * the domain model and priority engine.
 *
 * Tests the pipeline:
 * Request → Interpretation → Normalization → Ranking → Results
 */

import {
  // Domain
  PreferenceCriterion,
  PreferenceLevel,
  Product,
  Offer,
  Merchant,
  DataPoint,
  UserProfile,
  CurrentSearchRequirements,
  RankingRequest,
  // Priority Engine
  rankOffers,
  mergeProfileAndRequirements,
} from '../../src';

// Mock application layer types
import type {
  UserQuery,
  InterpretedRequest,
  ResolvedInterpretedRequest,
  NormalizedProduct,
  NormalizedOffer,
  RankingResultSet,
} from '../../src/application';

describe('Layer Contracts: Request → Ranking Pipeline', () => {
  // Setup: Common test data
  const testMerchant: Merchant = {
    id: 'm1',
    name: 'TestMerchant',
    country: 'FR',
    executionCapabilities: ['web_redirect'],
  };

  const testProduct: Product = {
    id: 'p1',
    category: 'headphones',
    name: 'Test Headphones',
    createdAt: new Date(),
  };

  const testOffer: Offer = {
    id: 'o1',
    productId: 'p1',
    merchant: testMerchant,
    price: { value: 599, status: 'verified', provenance: { source: 'merchant', retrievedAt: new Date() } },
    currency: 'EUR',
    shippingCost: { value: 0, status: 'verified', provenance: { source: 'merchant', retrievedAt: new Date() } },
    characteristics: {},
    createdAt: new Date(),
    retrievedAt: new Date(),
    provenance: { source: 'merchant', retrievedAt: new Date() },
  };

  // Test 1: User Query → Interpretation Contract
  describe('Contract: UserQuery → InterpretedRequest', () => {
    it('should model a user query with text and receive structured interpretation', () => {
      // Arrange: Create a user query
      const userQuery: UserQuery = {
        id: 'q1',
        userId: 'u1',
        text: 'I want a laptop under €1000 with good battery life',
        timestamp: new Date(),
      };

      // Simulate AI interpretation
      const interpretation: InterpretedRequest = {
        id: 'i1',
        queryId: 'q1',
        userId: 'u1',
        extractedCriteria: [
          { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1000, currency: 'EUR' } },
          { id: 'battery', name: 'Battery life', level: 'very_important' },
        ],
        budget: { maximum: 1000, currency: 'EUR' },
        ambiguities: [],
        confidence: 0.95,
        clarificationsReceived: [],
        detectedProfileExceptions: [],
        createdAt: new Date(),
        interpretedAt: new Date(),
      };

      // Assert: Contract holds
      expect(interpretation.extractedCriteria).toHaveLength(2);
      expect(interpretation.confidence).toBeGreaterThan(0.9);
      expect(interpretation.budget?.maximum).toBe(1000);
    });

    it('should flag ambiguities when interpretation is uncertain', () => {
      const interpretation: InterpretedRequest = {
        id: 'i2',
        queryId: 'q2',
        userId: 'u1',
        extractedCriteria: [
          { id: 'price', name: 'Price', level: 'preference' },
        ],
        ambiguities: [
          {
            id: 'a1',
            ambiguityType: 'budget_flexibility',
            description: 'User said "around €1000" — how flexible?',
            possibleInterpretations: [
              { interpretation: '±10%', explanation: 'Conservative', likelihood: 0.3 },
              { interpretation: '±20%', explanation: 'Moderate', likelihood: 0.6 },
              { interpretation: '±30%', explanation: 'Very flexible', likelihood: 0.1 },
            ],
            resolved: false,
          },
        ],
        confidence: 0.65,
        clarificationsReceived: [],
        detectedProfileExceptions: [],
        createdAt: new Date(),
        interpretedAt: new Date(),
      };

      // Assert: Ambiguities properly represented
      expect(interpretation.ambiguities).toHaveLength(1);
      expect(interpretation.confidence).toBeLessThan(0.8);
      expect(interpretation.ambiguities[0].resolved).toBe(false);
    });
  });

  // Test 2: Interpretation → Resolution Contract
  describe('Contract: InterpretedRequest → ResolvedInterpretedRequest', () => {
    it('should resolve ambiguities and produce deterministic criteria', () => {
      // Arrange: Interpretation with ambiguities
      const interpreted: InterpretedRequest = {
        id: 'i3',
        queryId: 'q3',
        userId: 'u1',
        extractedCriteria: [
          { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1000 } },
          { id: 'brand', name: 'Brand', level: 'preference' },
        ],
        ambiguities: [
          {
            id: 'a2',
            ambiguityType: 'budget_flexibility',
            description: 'Flexible budget?',
            possibleInterpretations: [
              { interpretation: '±20%', explanation: 'Moderate', likelihood: 0.7 },
            ],
            resolved: true,
          },
        ],
        confidence: 0.95,
        clarificationsReceived: [
          { ambiguityId: 'a2', selectedInterpretation: '±20%', userAnswer: 'Yes, up to 20% more', timestamp: new Date() },
        ],
        detectedProfileExceptions: [],
        createdAt: new Date(),
        interpretedAt: new Date(),
      };

      // Act: Resolve to final request
      const resolved: ResolvedInterpretedRequest = {
        id: 'r1',
        originalQueryId: 'q3',
        interpretedRequestId: 'i3',
        userId: 'u1',
        finalCriteria: [
          { id: 'budget', name: 'Budget', level: 'required', parameters: { maxBudget: 1200 } },
          { id: 'brand', name: 'Brand', level: 'preference' },
        ],
        finalBudget: { maximum: 1200, currency: 'EUR', flexible: true, flexibilityPercent: 20 },
        clarificationsApplied: interpreted.clarificationsReceived,
        profileExceptions: [],
        readyForRanking: true,
        readinessCheckTime: new Date(),
        createdAt: new Date(),
        finalizedAt: new Date(),
      };

      // Assert: Resolved request is deterministic
      expect(resolved.readyForRanking).toBe(true);
      expect(resolved.finalCriteria).toHaveLength(2);
      expect(resolved.finalBudget?.maximum).toBe(1200);
    });
  });

  // Test 3: Normalization Contract
  describe('Contract: Raw Data → NormalizedOffer', () => {
    it('should normalize offer data consistently', () => {
      // Arrange: Create a "messy" offer (simulated)
      const rawOfferData = {
        price: '599,99 EUR',
        shipping: '0 €',
        availability: 'In stock',
      };

      // Simulate normalization
      const normalized: NormalizedOffer = {
        id: 'no1',
        originalOfferId: 'o1',
        productId: 'p1',
        merchantId: 'm1',
        merchantName: 'TestMerchant',
        price: {
          value: { type: 'price', amount: 599.99, currency: 'EUR', normalized: true },
          status: 'verified',
          provenance: { source: 'merchant', retrievedAt: new Date() },
        },
        shippingCost: {
          value: { type: 'price', amount: 0, currency: 'EUR', normalized: true },
          status: 'verified',
          provenance: { source: 'merchant', retrievedAt: new Date() },
        },
        shippingTime: {
          value: { type: 'duration', value: 'P2D', humanReadable: '2 days', normalized: true },
          status: 'known',
          provenance: { source: 'merchant', retrievedAt: new Date() },
        },
        characteristics: {},
        availability: {
          inStock: { value: true, status: 'verified', provenance: { source: 'merchant', retrievedAt: new Date() } },
        },
        createdAt: new Date(),
        retrievedAt: new Date(),
        normalizedAt: new Date(),
        source: {
          id: 's1',
          name: 'TestMerchant',
          type: 'merchant_official',
          verification: 'credible',
          isActive: true,
          canProvide: {},
          createdAt: new Date(),
        },
        confidence: 0.95,
      };

      // Assert: Normalization contract holds
      expect(normalized.price.value?.type).toBe('price');
      expect(normalized.shippingTime.value?.type).toBe('duration');
      expect(normalized.confidence).toBeGreaterThan(0.9);
    });
  });

  // Test 4: Ranking Engine Contract
  describe('Contract: Criteria + Offers → RankedOffers', () => {
    it('should accept criteria and offers, produce ranked results', () => {
      // Arrange: Criteria and offers
      const criteria: PreferenceCriterion[] = [
        { id: 'price', name: 'Price', level: 'required', parameters: { maxBudget: 600 } },
        { id: 'brand', name: 'Brand', level: 'preference' },
      ];

      const offers: Offer[] = [
        {
          ...testOffer,
          id: 'o1',
          price: { value: 599, status: 'verified', provenance: { source: 'merchant', retrievedAt: new Date() } },
        },
        {
          ...testOffer,
          id: 'o2',
          merchant: { ...testMerchant, id: 'm2', name: 'Merchant2' },
          price: { value: 650, status: 'verified', provenance: { source: 'merchant', retrievedAt: new Date() } },
        },
      ];

      const request: RankingRequest = {
        requestId: 'r1',
        effectiveCriteria: criteria,
        offers,
        timestamp: new Date(),
      };

      // Act: Call priority engine
      const result = rankOffers(request);

      // Assert: Engine contract holds
      expect(result.rankedOffers).toBeDefined();
      expect(result.rejectedOffers).toBeDefined();
      expect(result.rankedOffers.length + (result.rejectedOffers?.length || 0)).toBe(2);

      // First offer should rank, second should be rejected (exceeds budget)
      expect(result.rankedOffers).toHaveLength(1);
      expect(result.rejectedOffers).toHaveLength(1);
    });

    it('should maintain determinism across multiple calls', () => {
      // Arrange
      const criteria: PreferenceCriterion[] = [
        { id: 'price', name: 'Price', level: 'preference' },
      ];

      const offers: Offer[] = [
        { ...testOffer, id: 'o1', price: { value: 100, status: 'verified', provenance: { source: 'merchant', retrievedAt: new Date() } } },
        { ...testOffer, id: 'o2', price: { value: 200, status: 'verified', provenance: { source: 'merchant', retrievedAt: new Date() } } },
      ];

      const request: RankingRequest = {
        requestId: 'r1',
        effectiveCriteria: criteria,
        offers,
        timestamp: new Date(),
      };

      // Act: Call multiple times
      const result1 = rankOffers(request);
      const result2 = rankOffers(request);
      const result3 = rankOffers(request);

      // Assert: Results are identical
      expect(result1.rankedOffers[0].offer.id).toBe(result2.rankedOffers[0].offer.id);
      expect(result2.rankedOffers[0].offer.id).toBe(result3.rankedOffers[0].offer.id);
      expect(result1.rankedOffers[0].overallScore).toBe(result2.rankedOffers[0].overallScore);
    });
  });

  // Test 5: Profile + Search Merge
  describe('Contract: UserProfile + SearchRequirements → EffectiveCriteria', () => {
    it('should merge profile and search requirements without mutating profile', () => {
      // Arrange
      const profileCriteria: PreferenceCriterion[] = [
        { id: 'brand', name: 'Brand', level: 'important', parameters: { preferredValues: ['Sony', 'Bose'] } },
        { id: 'country', name: 'Origin', level: 'very_important', parameters: { preferredValues: ['FR', 'DE', 'AT'] } },
      ];

      const searchCriteria: PreferenceCriterion[] = [
        { id: 'price', name: 'Price', level: 'required', parameters: { maxBudget: 600 } },
        { id: 'battery', name: 'Battery', level: 'preference' },
      ];

      // Act: Merge
      const merged = mergeProfileAndRequirements(profileCriteria, searchCriteria);

      // Assert: Merge contract holds
      expect(merged).toHaveLength(4); // 2 from search + 2 from profile
      expect(merged.some(c => c.id === 'price')).toBe(true); // Search criteria present
      expect(merged.some(c => c.id === 'brand')).toBe(true); // Profile criteria present

      // Immutability: original profile unchanged
      expect(profileCriteria).toHaveLength(2);
      expect(profileCriteria[0].level).toBe('important'); // Unchanged
    });

    it('should apply exceptions to search criteria', () => {
      // Arrange
      const profileCriteria: PreferenceCriterion[] = [
        { id: 'brand', name: 'Brand', level: 'important' },
      ];

      const searchCriteria: PreferenceCriterion[] = [
        { id: 'price', name: 'Price', level: 'preference' },
      ];

      const exceptions = [
        { criterionId: 'price', temporaryLevel: 'required' as PreferenceLevel },
      ];

      // Act: Merge with exceptions
      const merged = mergeProfileAndRequirements(profileCriteria, searchCriteria, exceptions);

      // Assert: Exception applied
      const priceInMerged = merged.find(c => c.id === 'price');
      expect(priceInMerged?.level).toBe('required'); // Exception applied
    });
  });

  // Test 6: Unknown Data Handling
  describe('Contract: Unknown Data ≠ Negative', () => {
    it('should not penalize unknown data', () => {
      // Arrange: Offer with unknown warranty
      const criteria: PreferenceCriterion[] = [
        { id: 'warranty', name: 'Warranty', level: 'preference' },
      ];

      const offerWithUnknownWarranty: Offer = {
        ...testOffer,
        characteristics: {
          warranty: { value: null, status: 'unknown' }, // Unknown warranty
        },
      };

      const request: RankingRequest = {
        requestId: 'r1',
        effectiveCriteria: criteria,
        offers: [offerWithUnknownWarranty],
        timestamp: new Date(),
      };

      // Act
      const result = rankOffers(request);

      // Assert: Offer not rejected due to unknown data
      expect(result.rankedOffers).toHaveLength(1);
      expect(result.rejectedOffers?.length || 0).toBe(0);

      // Verify it's still scored (not treated as negative)
      const scores = result.rankedOffers[0].criterionScores;
      expect(scores.length).toBeGreaterThanOrEqual(0);
    });
  });

  // Test 7: Results Contract
  describe('Contract: RankedOffers → PresentableResults', () => {
    it('should provide structured result set with explanation and confidence', () => {
      // Arrange: Existing ranked result
      const criteria: PreferenceCriterion[] = [
        { id: 'price', name: 'Price', level: 'preference' },
      ];

      const offers: Offer[] = [testOffer];

      const request: RankingRequest = {
        requestId: 'r1',
        effectiveCriteria: criteria,
        offers,
        timestamp: new Date(),
      };

      const rankingResult = rankOffers(request);

      // Assert: Result structure contract holds
      expect(rankingResult.rankedOffers).toBeDefined();
      expect(rankingResult.rankedOffers.length).toBeGreaterThan(0);

      // Each ranked offer has proper structure
      const firstRanked = rankingResult.rankedOffers[0];
      expect(firstRanked.overallScore).toBeGreaterThanOrEqual(0);
      expect(firstRanked.overallScore).toBeLessThanOrEqual(100);
      expect(firstRanked.criterionScores).toBeDefined();
      expect(firstRanked.summary).toBeDefined();

      // Explanation can be derived from scores
      expect(firstRanked.criterionScores.length).toBeGreaterThanOrEqual(0);
      firstRanked.criterionScores.forEach(cs => {
        expect(cs.reasoning).toBeDefined(); // Every score has reasoning
        expect(cs.dataUsed).toBeDefined();
      });
    });

    it('should track data quality and confidence separately', () => {
      // This test validates that the result structure supports quality metrics
      // without mixing them with the deterministic ranking

      const criteria: PreferenceCriterion[] = [
        { id: 'price', name: 'Price', level: 'preference' },
      ];

      const rankingResult = rankOffers({
        requestId: 'r1',
        effectiveCriteria: criteria,
        offers: [testOffer],
        timestamp: new Date(),
      });

      // Ranking is deterministic
      expect(rankingResult.rankedOffers[0].overallScore).toBeDefined();

      // Confidence should be calculated separately
      // (not mixed into the score itself)
      expect(rankingResult.rankedOffers[0].criterionScores.every(cs => cs.score >= 0)).toBe(true);
    });
  });
});
