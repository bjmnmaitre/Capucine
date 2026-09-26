/**
 * Clear search cache before each test to prevent cross-test pollution.
 * The search cache is a singleton that persists across tests.
 */
import { searchCache } from '../src/api/server';

beforeEach(() => {
  if (searchCache && typeof searchCache.clear === 'function') {
    searchCache.clear();
  }
});
