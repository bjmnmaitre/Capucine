/**
 * Capucine Application Layer — Public API
 *
 * Exports all application layer types for use by other layers.
 */

// Request & Query types
export * from './request';

// Provenance & Source tracking
export * from './provenance';

// Normalization & Data cleaning
export * from './normalization';

// Results & Explanations
export * from './results';

// Internationalization
export * from './i18n';

// AI Abstractions (provider-agnostic)
export * from './ai-abstractions';

// Deduplication Engine
export * from './deduplication';

// Search Plan (discovery strategy)
export * from './search-plan';

// Conversation Model + SearchState
export * from './conversation';

// AI Orchestrator
export * from './ai-orchestrator';

// In-Memory Discovery Strategy
export * from './in-memory-discovery';

// Clarification Engine
export * from './clarification-engine';

// Explanation Engine
export * from './explanation-engine';

// Model Router
export * from './model-router';

// No Results Analyzer
export * from './no-results-analyzer';

// Conflict Resolver
export * from './conflict-resolver';

// Normalization Engine (concrete implementation)
export * from './normalization-engine';

// Capucine Engine (full pipeline)
export * from './capucine-engine';

// Tool Abstraction Layer
export * from './tools';

// Web Search Adapters
export * from './web-search-adapters';

// Real Web Discovery Strategy
export * from './real-web-discovery';
