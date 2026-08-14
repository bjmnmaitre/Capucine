/**
 * Capucine Application Layer — AI Abstractions
 *
 * Provider-agnostic interfaces for AI integration.
 *
 * Key principle: AI should be swappable.
 * The domain should NOT know which AI model or vendor is being used.
 *
 * Supported providers (pluggable):
 * - Claude (Anthropic)
 * - OpenAI (GPT-4, etc.)
 * - Google Gemini
 * - Others (future)
 */

import { InterpretedRequest, ClarificationNeeded, UserQuery } from './request';
import { RankingExplanation } from './results';
import { PreferenceCriterion, RankedOffer, DataStatus } from '../domain/types';
import { Source } from './provenance';

// ============================================================================
// AI PROVIDER CONFIGURATION
// ============================================================================

/**
 * Configuration for an AI provider.
 * Allows swapping providers without code changes.
 */
export interface AIProviderConfig {
  // Provider identification
  provider: 'claude' | 'openai' | 'gemini' | 'custom';
  version?: string; // e.g., "claude-3-opus", "gpt-4-turbo"

  // Authentication (never store secrets in this config)
  // Instead, read from environment or secure vault
  authMethod: 'api_key' | 'oauth' | 'service_account';
  environmentVariables: string[]; // Which env vars contain secrets?

  // API configuration
  endpoint?: string; // For custom providers
  timeout?: number; // milliseconds
  retryPolicy?: {
    maxRetries: number;
    backoffMultiplier: number;
  };

  // Model-specific settings
  settings?: {
    temperature?: number; // 0-1, creativity
    maxTokens?: number; // Response length
    topP?: number; // Nucleus sampling
    frequencyPenalty?: number;
    presencePenalty?: number;
  };

  // Rate limiting
  rateLimit?: {
    requestsPerMinute?: number;
    tokensPerDay?: number;
  };

  // Fallback configuration
  fallback?: AIProviderConfig; // If this provider fails, try this
}

/**
 * Manages multiple AI provider configurations.
 */
export interface AIProviderRegistry {
  providers: Map<string, AIProviderConfig>;
  defaultProvider: string;
  addProvider(id: string, config: AIProviderConfig): void;
  getProvider(id: string): AIProviderConfig | undefined;
  setDefault(id: string): void;
}

// ============================================================================
// AI INTERPRETER — Convert user query to structured request
// ============================================================================

/**
 * Interprets user queries into structured requests.
 * This is where natural language understanding happens.
 *
 * CRITICAL: The interpreter produces InterpretedRequest, NOT decisions.
 * The Priority Engine makes decisions.
 */
export interface AIInterpreter {
  /**
   * Interpret a user query.
   * Returns structured criteria and detected ambiguities.
   */
  interpret(query: UserQuery, context?: InterpreterContext): Promise<InterpretedRequest>;

  /**
   * Quick parse without full interpretation (faster).
   * Useful for preview/validation before full processing.
   */
  quickParse?(query: UserQuery): Promise<Partial<InterpretedRequest>>;

  /**
   * Identify what's ambiguous in a query.
   * Doesn't try to resolve; just flags issues.
   */
  identifyAmbiguities(interpretedRequest: InterpretedRequest): Promise<string[]>;
}

/**
 * Context for interpretation.
 */
export interface InterpreterContext {
  userId: string;
  userLanguage: string; // ISO 639-1 code
  userCountry: string; // ISO 3166-1 alpha-2
  userProfile?: {
    preferences: PreferenceCriterion[];
    history?: {
      previousQueries: string[];
      purchaseHistory: string[];
    };
  };
  marketContext?: {
    availableCountries: string[];
    availableCategories: string[];
  };
}

/**
 * Mock interpreter for testing (doesn't call AI).
 */
export class MockAIInterpreter implements AIInterpreter {
  async interpret(query: UserQuery): Promise<InterpretedRequest> {
    return {
      id: `mock-${query.id}`,
      queryId: query.id,
      userId: query.userId,
      extractedCriteria: [],
      ambiguities: [],
      confidence: 0.5,
      clarificationsReceived: [],
      detectedProfileExceptions: [],
      createdAt: new Date(),
      interpretedAt: new Date(),
    };
  }

  async identifyAmbiguities(): Promise<string[]> {
    return [];
  }
}

// ============================================================================
// AI CLARIFIER — Ask follow-up questions
// ============================================================================

/**
 * Asks clarifying questions when interpretation is ambiguous.
 * Generates minimal, targeted questions.
 */
export interface AIClarifier {
  /**
   * Generate clarification questions for ambiguities.
   * Should prioritize critical ambiguities.
   */
  generateQuestions(
    interpretedRequest: InterpretedRequest,
    context?: ClarifierContext
  ): Promise<ClarificationNeeded[]>;

  /**
   * Parse user answer to a clarification question.
   */
  parseAnswer(question: ClarificationNeeded, userAnswer: string): Promise<string>;

  /**
   * Can this ambiguity be resolved without asking?
   */
  canResolveWithoutAsking?(ambiguityId: string, context?: ClarifierContext): Promise<boolean>;
}

/**
 * Context for clarification.
 */
export interface ClarifierContext {
  userId: string;
  userLanguage: string;
  previousClarifications?: { question: string; answer: string }[];
  interactionStyle?: 'brief' | 'detailed' | 'conversational'; // How to phrase questions?
}

/**
 * Mock clarifier (doesn't ask questions).
 */
export class MockAIClarifier implements AIClarifier {
  async generateQuestions(): Promise<ClarificationNeeded[]> {
    return [];
  }

  async parseAnswer(question: ClarificationNeeded, userAnswer: string): Promise<string> {
    return userAnswer;
  }
}

// ============================================================================
// AI EXPLAINER — Generate human-readable explanations
// ============================================================================

/**
 * Generates natural language explanations for ranking results.
 * Converts deterministic scores into understandable language.
 */
export interface AIExplainer {
  /**
   * Explain why an offer ranked where it did.
   * Takes the deterministic ranking data and makes it readable.
   */
  explain(rankedOffer: RankedOffer, context: ExplainerContext): Promise<RankingExplanation>;

  /**
   * Explain why one offer ranked better than another.
   */
  explainComparison(topOffer: RankedOffer, otherOffer: RankedOffer, context: ExplainerContext): Promise<string>;

  /**
   * Generate a conversational summary of all results.
   */
  summarizeResults(rankedOffers: RankedOffer[], context: ExplainerContext): Promise<string>;

  /**
   * Explain what would improve a rejected offer.
   */
  explainRejection(rejectedOffer: RankedOffer, rejectionReason: string, context: ExplainerContext): Promise<string>;
}

/**
 * Context for explanation.
 */
export interface ExplainerContext {
  userId: string;
  userLanguage: string;
  tone?: 'technical' | 'conversational' | 'concise';
  verbose?: boolean; // Detailed vs brief explanations?
  includeAlternatives?: boolean; // Mention other offers?
  userPreferences?: {
    emphasizeBudget?: boolean;
    emphasizeQuality?: boolean;
    emphasizeSpeed?: boolean;
  };
}

/**
 * Mock explainer (basic explanations, no AI).
 */
export class MockAIExplainer implements AIExplainer {
  async explain(rankedOffer: RankedOffer): Promise<RankingExplanation> {
    const scores = rankedOffer.criterionScores;
    return {
      offerId: rankedOffer.offer.id,
      rankNumber: 1,
      summary: `Offer ${rankedOffer.offer.id}: ${rankedOffer.overallScore}/100`,
      criterionExplanations: scores.map((cs) => ({
        criterion: { id: cs.criterionId, name: cs.criterionName, level: cs.level },
        score: cs,
        reasoning: cs.reasoning,
        dataUsed: {
          value: cs.dataUsed.value,
          status: cs.dataUsed.status as DataStatus,
          source: cs.dataUsed.source ? { id: 's1', name: cs.dataUsed.source, type: 'other' as const, verification: 'unverified' as const, isActive: true, canProvide: {}, createdAt: new Date() } : undefined,
          confidence: 0.8,
        },
        metExpectation: cs.score > 50,
        contributionToRanking: 100 / scores.length,
      })),
      improvementPotentials: [],
      sensitivityFactors: [],
    };
  }

  async explainComparison(): Promise<string> {
    return 'Offer A is better than Offer B';
  }

  async summarizeResults(): Promise<string> {
    return 'Summary of results';
  }

  async explainRejection(): Promise<string> {
    return 'This offer was rejected';
  }
}

// ============================================================================
// AI SERVICE FACTORY
// ============================================================================

/**
 * Factory for creating AI service instances.
 * Handles provider selection and initialization.
 */
export interface AIServiceFactory {
  /**
   * Create an interpreter using the configured provider.
   */
  createInterpreter(provider?: string, context?: InterpreterContext): Promise<AIInterpreter>;

  /**
   * Create a clarifier using the configured provider.
   */
  createClarifier(provider?: string, context?: ClarifierContext): Promise<AIClarifier>;

  /**
   * Create an explainer using the configured provider.
   */
  createExplainer(provider?: string, context?: ExplainerContext): Promise<AIExplainer>;

  /**
   * Register a custom provider implementation.
   */
  registerProvider(name: string, config: AIProviderConfig): void;

  /**
   * Check if a provider is available/configured.
   */
  isProviderAvailable(provider: string): boolean;
}

/**
 * Default mock factory (uses mock implementations).
 */
export class MockAIServiceFactory implements AIServiceFactory {
  async createInterpreter(): Promise<AIInterpreter> {
    return new MockAIInterpreter();
  }

  async createClarifier(): Promise<AIClarifier> {
    return new MockAIClarifier();
  }

  async createExplainer(): Promise<AIExplainer> {
    return new MockAIExplainer();
  }

  registerProvider(): void {
    // No-op for mock
  }

  isProviderAvailable(): boolean {
    return false; // Mock provider not configured
  }
}

// ============================================================================
// AI PIPELINE
// ============================================================================

/**
 * Complete AI pipeline orchestrating interpretation, clarification, and explanation.
 * This is the main interface applications use.
 */
export interface AIPipeline {
  /**
   * Process a user query through the full pipeline:
   * 1. Interpret query
   * 2. Identify ambiguities
   * 3. Ask clarifications if needed
   * 4. Resolve to deterministic request
   */
  processQuery(query: UserQuery, context: ProcessQueryContext): Promise<AIPipelineResult>;

  /**
   * Explain ranking results.
   */
  explainResults(rankedOffers: RankedOffer[], context: ExplainerContext): Promise<RankingExplanation[]>;
}

/**
 * Context for processing a query.
 */
export interface ProcessQueryContext {
  userId: string;
  userLanguage: string;
  userCountry: string;
  maxAmbiguitiesBeforeFailing?: number; // How many ambiguities is too many?
  allowInteractiveDisambiguation?: boolean; // Can we ask the user?
  userProfile?: {
    preferences: PreferenceCriterion[];
  };
}

/**
 * Result of AI pipeline processing.
 */
export interface AIPipelineResult {
  status: 'success' | 'partial' | 'ambiguous' | 'failed';
  interpretedRequest?: InterpretedRequest;
  questionsAsked?: ClarificationNeeded[];
  questionsAnswered?: Map<string, string>;
  finalRequest?: InterpretedRequest;
  errors?: string[];
  warnings?: string[];
}

// ============================================================================
// AI PROVIDER IMPLEMENTATIONS (Placeholders)
// ============================================================================

/**
 * Implementation for Claude (Anthropic).
 * Actual implementation would use the Anthropic SDK.
 * This is a placeholder/interface.
 */
export class ClaudeInterpreter implements AIInterpreter {
  constructor(private config: AIProviderConfig) {}

  async interpret(_query: UserQuery): Promise<InterpretedRequest> {
    throw new Error('ClaudeInterpreter not yet implemented. Use mock for now.');
  }

  async identifyAmbiguities(): Promise<string[]> {
    throw new Error('ClaudeInterpreter not yet implemented. Use mock for now.');
  }
}

/**
 * Implementation for OpenAI.
 * Placeholder for future integration.
 */
export class OpenAIInterpreter implements AIInterpreter {
  constructor(private config: AIProviderConfig) {}

  async interpret(_query: UserQuery): Promise<InterpretedRequest> {
    throw new Error('OpenAIInterpreter not yet implemented. Use mock for now.');
  }

  async identifyAmbiguities(): Promise<string[]> {
    throw new Error('OpenAIInterpreter not yet implemented. Use mock for now.');
  }
}

/**
 * Implementation for Google Gemini.
 * Placeholder for future integration.
 */
export class GeminiInterpreter implements AIInterpreter {
  constructor(private config: AIProviderConfig) {}

  async interpret(_query: UserQuery): Promise<InterpretedRequest> {
    throw new Error('GeminiInterpreter not yet implemented. Use mock for now.');
  }

  async identifyAmbiguities(): Promise<string[]> {
    throw new Error('GeminiInterpreter not yet implemented. Use mock for now.');
  }
}
