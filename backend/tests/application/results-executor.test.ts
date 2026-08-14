/**
 * Tests for Results Executor and Formatter
 *
 * Validates result compilation and explanation generation.
 */

import { ResultsExecutor, ResultsFormatter } from '../../src/application/results-executor';
import { RankingResult, RankedOffer, Offer, Merchant, DataPoint, DataStatus } from '../../src/domain/types';

describe('ResultsExecutor', () => {
  let executor: ResultsExecutor;
  let mockMerchant: Merchant;
  let mockOffer: Offer;
  let mockRankingResult: RankingResult;

  beforeEach(() => {
    executor = new ResultsExecutor();

    mockMerchant = {
      id: 'm1',
      name: 'TestMerchant',
      country: 'FR',
      executionCapabilities: ['web_redirect'],
    };

    mockOffer = {
      id: 'o1',
      productId: 'p1',
      merchant: mockMerchant,
      price: { value: 599, status: 'verified' as DataStatus },
      currency: 'EUR',
      shippingCost: { value: 10, status: 'known' as DataStatus },
      characteristics: {},
      createdAt: new Date(),
      retrievedAt: new Date(),
      provenance: { source: 'test', retrievedAt: new Date() },
    };

    mockRankingResult = {
      requestId: 'req1',
      rankedOffers: [
        {
          offer: mockOffer,
          overallScore: 95,
          criterionScores: [
            {
              criterionId: 'c1',
              criterionName: 'Price',
              level: 'important',
              score: 90,
              reasoning: 'Good price',
              dataUsed: { value: 599, status: 'verified' },
            },
          ],
          summary: 'Excellent offer',
          satisfiesAllConstraints: true,
        },
      ],
      generatedAt: new Date(),
    };
  });

  describe('Result Execution', () => {
    it('should compile ranking results into ShoppingResults', () => {
      executor.setRankingResults(mockRankingResult);
      const results = executor.execute();

      expect(results.requestId).toBe('req1');
      expect(results.timestamp).toBeInstanceOf(Date);
      expect(results.summary).toBeDefined();
      expect(results.topRecommendations.length).toBeGreaterThan(0);
    });

    it('should limit top recommendations to 5', () => {
      const manyOffers: RankedOffer[] = Array(20)
        .fill(null)
        .map((_, i) => ({
          offer: { ...mockOffer, id: `o${i}` },
          overallScore: 100 - i,
          criterionScores: [],
          summary: `Offer ${i}`,
          satisfiesAllConstraints: true,
        }));

      mockRankingResult.rankedOffers = manyOffers;
      executor.setRankingResults(mockRankingResult);

      const results = executor.execute();
      expect(results.topRecommendations.length).toBe(5);
    });

    it('should include all options when more than 5 offers', () => {
      const manyOffers: RankedOffer[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          offer: { ...mockOffer, id: `o${i}` },
          overallScore: 100 - i,
          criterionScores: [],
          summary: `Offer ${i}`,
          satisfiesAllConstraints: true,
        }));

      mockRankingResult.rankedOffers = manyOffers;
      executor.setRankingResults(mockRankingResult);

      const results = executor.execute();
      expect(results.allOptions).toBeDefined();
      expect(results.allOptions?.length).toBe(10);
    });

    it('should return empty results when no ranking data', () => {
      const results = executor.execute();

      expect(results.summary).toContain('No results');
      expect(results.topRecommendations.length).toBe(0);
    });

    it('should include data quality assessment', () => {
      executor.setRankingResults(mockRankingResult);
      const results = executor.execute();

      expect(results.dataQualityAssessment).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(results.dataQualityAssessment.overallConfidence);
    });

    it('should include execution context', () => {
      executor.setRankingResults(mockRankingResult);
      const results = executor.execute();

      expect(results.executionContext).toBeDefined();
      expect(typeof results.executionContext.timeoutOccurred).toBe('boolean');
      expect(typeof results.executionContext.cacheHit).toBe('boolean');
    });
  });

  describe('Offer Explanations', () => {
    it('should build explanation for each ranked offer', () => {
      executor.setRankingResults(mockRankingResult);
      const results = executor.execute();

      const explanation = results.topRecommendations[0];
      expect(explanation.offerId).toBe('o1');
      expect(explanation.merchantName).toBe('TestMerchant');
      expect(explanation.overallScore).toBe(95);
    });

    it('should rank offers by position', () => {
      const offers: RankedOffer[] = [
        {
          offer: { ...mockOffer, id: 'o1' },
          overallScore: 95,
          criterionScores: [],
          summary: 'Best',
          satisfiesAllConstraints: true,
        },
        {
          offer: { ...mockOffer, id: 'o2' },
          overallScore: 85,
          criterionScores: [],
          summary: 'Good',
          satisfiesAllConstraints: true,
        },
      ];

      mockRankingResult.rankedOffers = offers;
      executor.setRankingResults(mockRankingResult);

      const results = executor.execute();
      expect(results.topRecommendations[0].rankPosition).toBe(1);
      expect(results.topRecommendations[1].rankPosition).toBe(2);
    });

    it('should include score breakdown', () => {
      executor.setRankingResults(mockRankingResult);
      const results = executor.execute();

      const explanation = results.topRecommendations[0];
      expect(explanation.scoreBreakdown.length).toBeGreaterThan(0);
      expect(explanation.scoreBreakdown[0].criterion).toBeDefined();
      expect(explanation.scoreBreakdown[0].score).toBeGreaterThan(0);
    });

    it('should extract highlights from offer', () => {
      executor.setRankingResults(mockRankingResult);
      const results = executor.execute();

      const explanation = results.topRecommendations[0];
      expect(explanation.highlights.length).toBeGreaterThan(0);
    });

    it('should include how-to-buy information', () => {
      executor.setRankingResults(mockRankingResult);
      const results = executor.execute();

      const explanation = results.topRecommendations[0];
      expect(explanation.howtoBuy).toBeDefined();
      if (explanation.howtoBuy) {
        expect(explanation.howtoBuy.merchant).toBe('TestMerchant');
        expect(explanation.howtoBuy.method).toBeDefined();
      }
    });
  });

  describe('Statistics', () => {
    it('should track discovered vs filtered offers', () => {
      executor.setRankingResults(mockRankingResult);
      const results = executor.execute();

      expect(results.statistics.totalOffersDiscovered).toBeGreaterThanOrEqual(0);
      expect(results.statistics.offersAfterFiltering).toBeGreaterThanOrEqual(0);
    });

    it('should count ransomed offers', () => {
      mockRankingResult.rejectedOffers = [
        { offer: mockOffer, reason: 'Violates constraint' },
      ];

      executor.setRankingResults(mockRankingResult);
      const results = executor.execute();

      expect(results.statistics.ransomWalks).toBe(1);
    });
  });

  describe('Determinism', () => {
    it('should produce identical results for identical input', () => {
      executor.setRankingResults(mockRankingResult);

      const results1 = executor.execute();
      const results2 = executor.execute();

      expect(results1.topRecommendations.length).toBe(results2.topRecommendations.length);
      expect(results1.topRecommendations[0].overallScore).toBe(
        results2.topRecommendations[0].overallScore
      );
    });
  });
});

describe('ResultsFormatter', () => {
  let mockResults: ReturnType<ResultsExecutor['execute']>;

  beforeEach(() => {
    mockResults = {
      requestId: 'req1',
      timestamp: new Date(),
      summary: 'Found 2 top recommendations',
      topRecommendations: [
        {
          offerId: 'o1',
          productName: 'Sony WH-1000XM5',
          merchantName: 'Amazon',
          overallScore: 95,
          rankPosition: 1,
          scoreBreakdown: [
            {
              criterion: 'Price',
              weight: 'important',
              score: 90,
              reasoning: 'Good price',
            },
          ],
          highlights: ['€599', 'Free shipping'],
          howtoBuy: { merchant: 'Amazon', method: 'web_redirect' },
        },
      ],
      statistics: {
        totalOffersDiscovered: 10,
        offersAfterFiltering: 2,
        offersExamined: 2,
      },
      dataQualityAssessment: {
        overallConfidence: 'high',
      },
      executionContext: {
        timeoutOccurred: false,
        sourcesQueried: 1,
        cacheHit: false,
      },
    };
  });

  describe('JSON Formatting', () => {
    it('should format results as JSON', () => {
      const json = ResultsFormatter.toJSON(mockResults);

      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.requestId).toBe('req1');
    });

    it('should produce valid JSON', () => {
      const json = ResultsFormatter.toJSON(mockResults);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  describe('Markdown Formatting', () => {
    it('should format results as markdown', () => {
      const markdown = ResultsFormatter.toMarkdown(mockResults);

      expect(markdown).toContain('# Shopping Results');
      expect(markdown).toContain('Found 2 top recommendations');
      expect(markdown).toContain('Sony WH-1000XM5');
    });

    it('should include rankings in markdown', () => {
      const markdown = ResultsFormatter.toMarkdown(mockResults);

      expect(markdown).toContain('### 1.');
      expect(markdown).toContain('Score:');
    });
  });

  describe('Plain Text Formatting', () => {
    it('should format results as plain text', () => {
      const text = ResultsFormatter.toText(mockResults);

      expect(text).toContain('SHOPPING RESULTS');
      expect(text).toContain('Sony WH-1000XM5');
    });

    it('should include structured information in text', () => {
      const text = ResultsFormatter.toText(mockResults);

      expect(text).toContain('Merchant:');
      expect(text).toContain('Score:');
    });

    it('should be human-readable', () => {
      const text = ResultsFormatter.toText(mockResults);

      // Should have line breaks and structure
      const lines = text.split('\n');
      expect(lines.length).toBeGreaterThan(3);
    });
  });

  describe('Format Consistency', () => {
    it('should include same data across formats', () => {
      const json = ResultsFormatter.toJSON(mockResults);
      const markdown = ResultsFormatter.toMarkdown(mockResults);
      const text = ResultsFormatter.toText(mockResults);

      // All should include the summary
      expect(json).toContain('Found 2 top recommendations');
      expect(markdown).toContain('Found 2 top recommendations');
      expect(text).toContain('Found 2 top recommendations');

      // All should include product name
      expect(json).toContain('Sony WH-1000XM5');
      expect(markdown).toContain('Sony WH-1000XM5');
      expect(text).toContain('Sony WH-1000XM5');
    });
  });
});
