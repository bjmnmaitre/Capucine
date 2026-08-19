/**
 * Capucine — Server Entry Point
 *
 * This file is the sole entry point for starting the HTTP server.
 * It is intentionally separate from server.ts so that:
 *   - server.ts can be imported by tests without starting a listener
 *   - This file is never imported by tests (avoids ESM/jest conflicts)
 *
 * Usage:
 *   node dist/api/index.js
 *   PORT=3001 node dist/api/index.js
 */

import { startServer } from './server.js';

startServer();
