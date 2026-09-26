/**
 * Hermetic test environment — no network, no real provider, ever.
 *
 * The suite is written against InMemoryDiscovery + MockAI. Two things used to
 * break that silently:
 *  - loading backend/.env into Jest (it carries SERPER_API_KEY and real AI
 *    keys) switched every HTTP search to the REAL web search: 0 local results,
 *    ~60 failures, and paid Serper calls on every `npm test`;
 *  - the same keys exported in the developer's shell would do the same.
 *
 * So: never load .env here, and scrub every provider key that may come from
 * the shell. A test that needs a key sets it itself (and restores it).
 */
const PROVIDER_KEYS = [
  'SERPER_API_KEY', 'BRAVE_API_KEY',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY',
  'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'FCC_PROXY_BASE_URL',
  'OLLAMA_MODEL', 'OLLAMA_HOST', 'OLLAMA_MODEL_REASONING', 'MODEL',
];
for (const k of PROVIDER_KEYS) delete process.env[k];

// Force MockAI for all tests — avoids rate limits on real providers.
process.env.USE_MOCK_AI = 'true';
