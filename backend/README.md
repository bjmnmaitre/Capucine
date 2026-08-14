# Capucine Core Backend

TypeScript implementation of Capucine's core domain and decision-making engine.

## Architecture

```
src/
├── domain/              # Core domain entities (User, Product, Offer, etc.)
├── decision/            # Priority Engine and ranking logic
├── application/         # Application/API services (future)
└── infrastructure/      # Database, external services (future)
```

## Development

### Setup

```bash
npm install
npm run build
npm test
```

### Commands

- `npm run build` — Compile TypeScript to JavaScript
- `npm run dev` — Watch mode (compile on file changes)
- `npm test` — Run tests
- `npm test:watch` — Run tests in watch mode
- `npm run type-check` — Check types without emitting

## Key Principles

- **Deterministic**: The Priority Engine produces consistent results given the same inputs
- **Model-independent**: No dependency on Claude, OpenAI, or any specific AI provider
- **Data-source independent**: No assumption about where products/offers come from
- **Execution-independent**: Ranking is separate from how purchases are executed
- **Fully testable**: All core logic can be tested without external services

## Files Structure

When integrated, this module will export:

- `domain-types.ts` — TypeScript interfaces and types for core entities
- `priority-engine.ts` — Ranking and decision logic
- Tests in `tests/` directory

## Integration Status

🟡 **Pending Integration**: Core files from "Capucine 1" (domain-types.ts, priority-engine.ts, priority-engine.test.ts) are awaiting integration into this structure.
