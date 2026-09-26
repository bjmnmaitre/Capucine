/**
 * Tests must never read or write real user profiles.
 *
 * FileProfileStore falls back to `<cwd>/.data/profiles` when nothing is
 * configured, which under Jest is the repository itself — the suite was
 * creating and mutating files inside the working tree. Every test run gets
 * its own throwaway directory instead. Tests that care about persistence pass
 * an explicit directory of their own and are unaffected by this default.
 */
const os = require('node:os');
const path = require('node:path');

process.env.PROFILE_STORE_DIR = path.join(
  os.tmpdir(),
  `capucine-test-profiles-${process.pid}-${Date.now()}`
);

// Clear search cache between test files to prevent cross-test pollution
const { searchCache } = require('../src/api/server');
if (searchCache && typeof searchCache.clear === 'function') {
  searchCache.clear();
}
