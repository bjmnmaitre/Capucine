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

// Application Layer (Request, Provenance, Normalization, Results, i18n, etc.)
export * from './application';

// Domain extensions
export * from './domain/criterion';
export * from './domain/profile';
export * from './domain/admissibility';
