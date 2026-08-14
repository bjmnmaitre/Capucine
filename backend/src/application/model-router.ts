/**
 * Capucine — ModelRouter
 *
 * Routes AI tasks to the appropriate model tier based on:
 * - Task complexity
 * - Required latency
 * - Required accuracy
 * - Cost constraints
 *
 * SECURITY INVARIANT: ModelRouter never sees API keys.
 * It produces a RoutingDecision that callers execute.
 *
 * Architecture:
 *   Task → ModelRouter.route() → RoutingDecision → AIOrchestrator.execute()
 */

// ============================================================================
// TASK TYPES
// ============================================================================

// Import ModelTier from ai-orchestrator (single source of truth)
export type { ModelTier } from './ai-orchestrator';
import type { ModelTier } from './ai-orchestrator';

export type AITaskType =
  | 'intent_classification'      // "Is this a price query or a product search?"  → fast
  | 'query_interpretation'       // Parse NL query into structured criteria        → balanced
  | 'search_term_generation'     // Generate search keywords / synonyms             → fast
  | 'clarification_phrasing'     // Rephrase clarification question naturally       → fast
  | 'explanation_prose'          // Convert structured explanation to readable prose → balanced
  | 'conflict_resolution'        // Resolve contradictory data from multiple sources → reasoning
  | 'ambiguity_detection'        // Detect ambiguities in query (fallback)           → balanced
  | 'product_entity_extraction'  // Extract product names, models, specs from query  → balanced
  | 'multilingual_normalization' // Translate/normalize non-FR queries               → balanced
  | 'complex_reasoning';         // Multi-step reasoning tasks                       → reasoning

// ============================================================================
// ROUTING DECISION
// ============================================================================

export interface RoutingDecision {
  taskType: AITaskType;
  recommendedTier: ModelTier;
  rationale: string;

  /** Estimated token count for cost planning */
  estimatedInputTokens: number;

  /** Whether this task can be cached */
  cacheable: boolean;

  /** Whether a lower-tier is acceptable as fallback */
  fallbackTier?: ModelTier;

  /** Whether this task can be retried if it fails */
  retryable: boolean;

  /** Max wait time in ms before timing out */
  timeoutMs: number;
}

export interface RoutingContext {
  taskType: AITaskType;

  /** Estimated input length in characters */
  inputLength?: number;

  /** Does the task require structured output (JSON)? */
  requiresStructuredOutput?: boolean;

  /** Is this task user-facing (affects latency tolerance)? */
  userFacing?: boolean;

  /** Current system load (0-1) */
  systemLoad?: number;

  /** Cost sensitivity (true = prefer cheaper models) */
  costSensitive?: boolean;
}

// ============================================================================
// ROUTING RULES
// ============================================================================

interface RoutingRule {
  taskType: AITaskType;
  defaultTier: ModelTier;
  cacheable: boolean;
  retryable: boolean;
  timeoutMs: number;
  rationale: string;
  fallbackTier?: ModelTier;
}

const ROUTING_RULES: Record<AITaskType, RoutingRule> = {
  intent_classification: {
    taskType: 'intent_classification',
    defaultTier: 'fast',
    cacheable: true,
    retryable: true,
    timeoutMs: 3000,
    rationale: 'Classification binaire simple, latence prioritaire',
    fallbackTier: 'balanced',
  },
  search_term_generation: {
    taskType: 'search_term_generation',
    defaultTier: 'fast',
    cacheable: true,
    retryable: true,
    timeoutMs: 5000,
    rationale: 'Génération de synonymes simples, faible coût prioritaire',
    fallbackTier: 'balanced',
  },
  clarification_phrasing: {
    taskType: 'clarification_phrasing',
    defaultTier: 'fast',
    cacheable: false,
    retryable: true,
    timeoutMs: 4000,
    rationale: 'Reformulation simple, contenu déjà structuré',
  },
  query_interpretation: {
    taskType: 'query_interpretation',
    defaultTier: 'balanced',
    cacheable: false,
    retryable: true,
    timeoutMs: 10000,
    rationale: 'Parse NL → critères structurés, précision requise',
    fallbackTier: 'fast',
  },
  explanation_prose: {
    taskType: 'explanation_prose',
    defaultTier: 'balanced',
    cacheable: false,
    retryable: true,
    timeoutMs: 8000,
    rationale: 'Traduction de données structurées en prose lisible',
    fallbackTier: 'fast',
  },
  ambiguity_detection: {
    taskType: 'ambiguity_detection',
    defaultTier: 'balanced',
    cacheable: false,
    retryable: true,
    timeoutMs: 8000,
    rationale: 'Détection de nuances, précision modérée requise',
  },
  product_entity_extraction: {
    taskType: 'product_entity_extraction',
    defaultTier: 'balanced',
    cacheable: true,
    retryable: true,
    timeoutMs: 10000,
    rationale: 'Extraction de modèles/marques, précision des noms propres',
  },
  multilingual_normalization: {
    taskType: 'multilingual_normalization',
    defaultTier: 'balanced',
    cacheable: true,
    retryable: true,
    timeoutMs: 8000,
    rationale: 'Normalisation multilingue, qualité de traduction requise',
  },
  conflict_resolution: {
    taskType: 'conflict_resolution',
    defaultTier: 'reasoning',
    cacheable: false,
    retryable: false, // Retry could give different resolutions
    timeoutMs: 20000,
    rationale: 'Résolution de contradictions entre sources — raisonnement profond requis',
    fallbackTier: 'balanced',
  },
  complex_reasoning: {
    taskType: 'complex_reasoning',
    defaultTier: 'reasoning',
    cacheable: false,
    retryable: false,
    timeoutMs: 30000,
    rationale: 'Raisonnement multi-étapes, précision maximale requise',
    fallbackTier: 'balanced',
  },
};

// ============================================================================
// MODEL ROUTER
// ============================================================================

export class ModelRouter {
  /**
   * Compute a routing decision for a given task context.
   * DETERMINISTIC: Same context always gives same decision.
   */
  route(context: RoutingContext): RoutingDecision {
    const rule = ROUTING_RULES[context.taskType];

    let tier = rule.defaultTier;

    // Adjustments based on context
    if (context.costSensitive && tier === 'reasoning') {
      tier = rule.fallbackTier ?? 'balanced';
    }

    if (context.userFacing && tier === 'reasoning') {
      // Real-time user interactions should not block on slow reasoning models
      tier = 'balanced';
    }

    if (context.systemLoad !== undefined && context.systemLoad > 0.8) {
      // High load: downgrade to faster tier
      if (tier === 'reasoning') tier = 'balanced';
      else if (tier === 'balanced') tier = 'fast';
    }

    // Estimate input tokens (rough: 4 chars ≈ 1 token)
    const estimatedInputTokens = context.inputLength
      ? Math.ceil(context.inputLength / 4)
      : this.defaultTokenEstimate(context.taskType);

    return {
      taskType: context.taskType,
      recommendedTier: tier,
      rationale: rule.rationale,
      estimatedInputTokens,
      cacheable: rule.cacheable,
      fallbackTier: rule.fallbackTier,
      retryable: rule.retryable,
      timeoutMs: rule.timeoutMs,
    };
  }

  /**
   * Recommend tier for multiple tasks (e.g. for planning a pipeline).
   */
  routeBatch(
    contexts: RoutingContext[]
  ): Map<AITaskType, RoutingDecision> {
    const result = new Map<AITaskType, RoutingDecision>();
    for (const ctx of contexts) {
      result.set(ctx.taskType, this.route(ctx));
    }
    return result;
  }

  /**
   * Total estimated token cost for a pipeline.
   */
  estimatePipelineCost(
    contexts: RoutingContext[]
  ): { totalTokens: number; breakdown: Record<string, number> } {
    const breakdown: Record<string, number> = {};
    let total = 0;

    for (const ctx of contexts) {
      const decision = this.route(ctx);
      breakdown[ctx.taskType] = decision.estimatedInputTokens;
      total += decision.estimatedInputTokens;
    }

    return { totalTokens: total, breakdown };
  }

  private defaultTokenEstimate(taskType: AITaskType): number {
    const estimates: Record<AITaskType, number> = {
      intent_classification: 100,
      search_term_generation: 150,
      clarification_phrasing: 200,
      query_interpretation: 500,
      explanation_prose: 800,
      ambiguity_detection: 400,
      product_entity_extraction: 300,
      multilingual_normalization: 300,
      conflict_resolution: 600,
      complex_reasoning: 1000,
    };
    return estimates[taskType] ?? 300;
  }
}
