/**
 * Capucine — AI Usage Tracking
 *
 * Tracks AI model usage (tokens, costs, budgets) across different providers.
 *
 * INVARIANTS:
 * 1. Budget limits are enforced per user tier (anonymous, free, premium)
 * 2. Token consumption is tracked per request, per model, per provider
 * 3. Costs are calculated based on current model pricing
 * 4. Budgets are checked BEFORE execution, not after
 * 5. Searches that would exceed budget are rejected with clear messaging
 * 6. Usage data is persistent (for billing/audit)
 *
 * Supported Tiers:
 * - anonymous: Limited daily budget (e.g., 10 searches/day)
 * - free: Medium budget (e.g., 50 searches/day)
 * - premium: High budget (e.g., unlimited)
 */

// ============================================================================
// USAGE & BUDGET TYPES
// ============================================================================

export type UserTier = 'anonymous' | 'free' | 'premium';

export type AIModelProvider = 'claude' | 'openai' | 'gemini' | 'custom';

export interface AIModel {
  provider: AIModelProvider;
  modelId: string; // e.g., 'claude-opus-5', 'gpt-4-turbo'

  // Cost per 1M tokens (input and output separately)
  costPerMillionInputTokens: number;
  costPerMillionOutputTokens: number;
}

/**
 * Single AI API call record.
 */
export interface AIUsageRecord {
  id: string;
  timestamp: Date;

  // Which request triggered this usage
  requestId: string;
  userId: string;

  // Model used
  model: AIModel;

  // Tokens consumed
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  // Cost
  estimatedCostUSD: number;

  // Context
  usage: 'interpretation' | 'clarification' | 'enrichment' | 'explanation' | 'other';
}

/**
 * Budget for a user tier.
 */
export interface BudgetPolicy {
  tier: UserTier;

  // Limits
  dailyBudgetUSD: number; // 0 = unlimited
  monthlyBudgetUSD: number; // 0 = unlimited
  maxTokensPerRequest: number; // Max tokens per single call
  maxRequestsPerDay: number; // 0 = unlimited

  // Fallback model if budget exhausted
  fallbackModel?: AIModel;
}

/**
 * Current user consumption against their budget.
 */
export interface UserBudgetStatus {
  userId: string;
  tier: UserTier;

  // Usage this period
  tokensUsedToday: number;
  costUsedToday: number;
  requestsToday: number;

  tokensUsedThisMonth: number;
  costUsedThisMonth: number;

  // Remaining
  dailyBudgetRemaining: number; // USD
  monthlyBudgetRemaining: number; // USD
  canMakeRequest: boolean;
}

// ============================================================================
// AI USAGE TRACKER
// ============================================================================

export class AIUsageTracker {
  private budgets: Map<UserTier, BudgetPolicy> = new Map();
  private usage: AIUsageRecord[] = [];
  private models: Map<string, AIModel> = new Map();

  constructor(budgets?: BudgetPolicy[], models?: AIModel[]) {
    // Set default budgets
    this.setDefaultBudgets();

    // Override with provided budgets
    if (budgets) {
      for (const budget of budgets) {
        this.budgets.set(budget.tier, budget);
      }
    }

    // Register models
    this.registerDefaultModels();
    if (models) {
      for (const model of models) {
        this.registerModel(model);
      }
    }
  }

  /**
   * Register an AI model with pricing info.
   */
  registerModel(model: AIModel): void {
    const key = `${model.provider}:${model.modelId}`;
    this.models.set(key, model);
  }

  /**
   * Check if a user can make an AI request.
   */
  canMakeRequest(userId: string, tier: UserTier): {allowed: boolean; reason?: string} {
    const budget = this.budgets.get(tier);
    if (!budget) {
      return { allowed: false, reason: 'Unknown user tier' };
    }

    const status = this.getBudgetStatus(userId, tier);

    // Check daily budget
    if (budget.dailyBudgetUSD > 0 && status.costUsedToday >= budget.dailyBudgetUSD) {
      return {
        allowed: false,
        reason: `Daily budget exhausted (${budget.dailyBudgetUSD}USD). Try again tomorrow.`,
      };
    }

    // Check monthly budget
    if (budget.monthlyBudgetUSD > 0 && status.costUsedThisMonth >= budget.monthlyBudgetUSD) {
      return {
        allowed: false,
        reason: `Monthly budget exhausted (${budget.monthlyBudgetUSD}USD). Try again next month.`,
      };
    }

    // Check request count
    if (budget.maxRequestsPerDay > 0 && status.requestsToday >= budget.maxRequestsPerDay) {
      return {
        allowed: false,
        reason: `Daily request limit reached (${budget.maxRequestsPerDay}). Try again tomorrow.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record an AI API call.
   */
  recordUsage(record: Omit<AIUsageRecord, 'estimatedCostUSD'>): void {
    const cost = this.calculateCost(record.model, record.inputTokens, record.outputTokens);
    const completeRecord: AIUsageRecord = {
      ...record,
      estimatedCostUSD: cost,
    };

    this.usage.push(completeRecord);
  }

  /**
   * Get current budget status for a user.
   */
  getBudgetStatus(userId: string, tier: UserTier): UserBudgetStatus {
    const budget = this.budgets.get(tier);
    if (!budget) {
      throw new Error(`Unknown tier: ${tier}`);
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Aggregate usage for this user
    const todayUsage = this.usage.filter(
      (u) =>
        u.userId === userId &&
        new Date(u.timestamp) >= today
    );

    const monthUsage = this.usage.filter(
      (u) =>
        u.userId === userId &&
        new Date(u.timestamp) >= monthStart
    );

    const tokensUsedToday = todayUsage.reduce((sum, u) => sum + u.totalTokens, 0);
    const costUsedToday = todayUsage.reduce((sum, u) => sum + u.estimatedCostUSD, 0);

    const tokensUsedThisMonth = monthUsage.reduce((sum, u) => sum + u.totalTokens, 0);
    const costUsedThisMonth = monthUsage.reduce((sum, u) => sum + u.estimatedCostUSD, 0);

    // Calculate canMakeRequest directly (avoid loop with canMakeRequest method)
    const canMakeRequestFlag =
      (budget.dailyBudgetUSD === 0 || costUsedToday < budget.dailyBudgetUSD) &&
      (budget.monthlyBudgetUSD === 0 || costUsedThisMonth < budget.monthlyBudgetUSD) &&
      (budget.maxRequestsPerDay === 0 || todayUsage.length < budget.maxRequestsPerDay);

    return {
      userId,
      tier,

      tokensUsedToday,
      costUsedToday,
      requestsToday: todayUsage.length,

      tokensUsedThisMonth,
      costUsedThisMonth,

      dailyBudgetRemaining: Math.max(0, budget.dailyBudgetUSD - costUsedToday),
      monthlyBudgetRemaining: Math.max(0, budget.monthlyBudgetUSD - costUsedThisMonth),

      canMakeRequest: canMakeRequestFlag,
    };
  }

  /**
   * Calculate cost for a request.
   */
  private calculateCost(model: AIModel, inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1_000_000) * model.costPerMillionInputTokens;
    const outputCost = (outputTokens / 1_000_000) * model.costPerMillionOutputTokens;
    return inputCost + outputCost;
  }

  /**
   * Get usage history for a user.
   */
  getUsageHistory(userId: string, limit = 100): AIUsageRecord[] {
    return this.usage
      .filter((u) => u.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get total cost for a user (all time).
   */
  getTotalCost(userId: string): number {
    return this.usage
      .filter((u) => u.userId === userId)
      .reduce((sum, u) => sum + u.estimatedCostUSD, 0);
  }

  /**
   * Set default budgets for tiers.
   */
  private setDefaultBudgets(): void {
    this.budgets.set('anonymous', {
      tier: 'anonymous',
      dailyBudgetUSD: 2,
      monthlyBudgetUSD: 10,
      maxTokensPerRequest: 10000,
      maxRequestsPerDay: 5,
    });

    this.budgets.set('free', {
      tier: 'free',
      dailyBudgetUSD: 10,
      monthlyBudgetUSD: 50,
      maxTokensPerRequest: 50000,
      maxRequestsPerDay: 50,
    });

    this.budgets.set('premium', {
      tier: 'premium',
      dailyBudgetUSD: 0, // Unlimited
      monthlyBudgetUSD: 0, // Unlimited
      maxTokensPerRequest: 100000,
      maxRequestsPerDay: 0, // Unlimited
    });
  }

  /**
   * Register default models with pricing.
   */
  private registerDefaultModels(): void {
    this.registerModel({
      provider: 'claude',
      modelId: 'claude-opus-5',
      costPerMillionInputTokens: 15,
      costPerMillionOutputTokens: 75,
    });

    this.registerModel({
      provider: 'claude',
      modelId: 'claude-sonnet-5',
      costPerMillionInputTokens: 3,
      costPerMillionOutputTokens: 15,
    });

    this.registerModel({
      provider: 'claude',
      modelId: 'claude-haiku-4-5',
      costPerMillionInputTokens: 0.8,
      costPerMillionOutputTokens: 4,
    });

    this.registerModel({
      provider: 'openai',
      modelId: 'gpt-4-turbo',
      costPerMillionInputTokens: 10,
      costPerMillionOutputTokens: 30,
    });

    this.registerModel({
      provider: 'openai',
      modelId: 'gpt-4-mini',
      costPerMillionInputTokens: 0.15,
      costPerMillionOutputTokens: 0.6,
    });

    this.registerModel({
      provider: 'gemini',
      modelId: 'gemini-pro',
      costPerMillionInputTokens: 0.5,
      costPerMillionOutputTokens: 1.5,
    });
  }

  /**
   * Export usage for billing.
   */
  exportForBilling(userId: string, startDate: Date, endDate: Date): AIUsageRecord[] {
    return this.usage.filter(
      (u) =>
        u.userId === userId &&
        u.timestamp >= startDate &&
        u.timestamp <= endDate
    );
  }
}

// ============================================================================
// FACTORY HELPERS
// ============================================================================

/**
 * Create a default AI usage tracker with standard budgets and models.
 */
export function createDefaultAIUsageTracker(): AIUsageTracker {
  return new AIUsageTracker();
}
