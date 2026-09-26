/**
 * Local sanity check: is Groq configured in backend/.env?
 *
 * The suite is hermetic (tests/setup-mock-ai.ts scrubs every provider key),
 * so this file reads .env explicitly, and only for itself. Without a
 * GROQ_API_KEY in .env (CI, a fresh clone) it is skipped, not failed.
 */
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { GroqProvider } from '../src/application/ai-providers';

const fromDotenv = dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true } as dotenv.DotenvConfigOptions).parsed ?? {};
const groqKey = fromDotenv['GROQ_API_KEY'];

(groqKey ? test : test.skip)('groq is configured from backend/.env', () => {
  const saved = process.env['GROQ_API_KEY'];
  process.env['GROQ_API_KEY'] = groqKey;
  try {
    expect(new GroqProvider().isConfigured).toBe(true);
  } finally {
    if (saved === undefined) delete process.env['GROQ_API_KEY'];
    else process.env['GROQ_API_KEY'] = saved;
  }
});
