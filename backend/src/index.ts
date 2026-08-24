/**
 * Capucine Core
 *
 * Main entry point for the Capucine core domain and decision engine.
 *
 * This module exports the core components that make up Capucine's decision-making system:
 * - Domain entities (User profiles, preferences, products, offers)
 * - Priority Engine (deterministic, AI-independent ranking)
 * - Business logic for agent decision-making
 *
 * The core is designed to remain:
 * - Independent of any AI model
 * - Independent of any data source
 * - Independent of any execution mechanism
 * - Fully testable in isolation
 */

// Domain types
export * from './domain/types';

// Priority Engine and decision logic
export { rankOffers, mergeProfileAndRequirements, filterEligible } from './decision/priority-engine';

// Contextual relevance (usage context → ranking bonus, after admissibility)
export * from './decision/contextual-relevance';

// Usage context mapping table (usage → relevant attributes)
export * from './domain/usage-context-mapping';

// Typed attribute model (brand, model, compatibility, quantities, …)
export * from './domain/attributes';

// Data quality / confidence (informational — never an admissibility input)
export * from './domain/data-quality';

// Purchase readiness (stock, delivery, buyability — separate dimensions)
export * from './domain/purchase-readiness';

// Application Layer (Request, Provenance, Normalization, Results, i18n, etc.)
export * from './application';

// Domain extensions
export * from './domain/criterion';
export * from './domain/profile';
export * from './domain/admissibility';
