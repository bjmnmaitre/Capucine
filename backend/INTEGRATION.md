# Integration Guide for Capucine 1 Files

This document describes how to integrate the three core files from Capucine 1 into this TypeScript backend structure.

## Files to Integrate

When available, the following files from Capucine 1 must be integrated:

1. **`domain-types.ts`** → `src/domain/types.ts`
2. **`priority-engine.ts`** → `src/decision/priority-engine.ts`
3. **`priority-engine.test.ts`** → `tests/decision/priority-engine.test.ts`

## Current Structure

```
backend/
├── src/
│   ├── domain/           ← domain-types.ts goes here
│   ├── decision/         ← priority-engine.ts goes here
│   ├── application/      ← (for future API/application layer)
│   ├── infrastructure/   ← (for future DB/external services)
│   └── index.ts          ← Main export point
│
├── tests/
│   └── decision/         ← priority-engine.test.ts goes here
│
├── package.json          ← Already configured with Jest + TypeScript
├── tsconfig.json         ← Strict mode enabled
└── jest.config.js        ← Configured for ts-jest
```

## Integration Steps

### 1. Receive Files
Once the three files are available, they will be provided in this session.

### 2. Place Files
```bash
# Move/copy to correct locations
cp domain-types.ts backend/src/domain/types.ts
cp priority-engine.ts backend/src/decision/priority-engine.ts
cp priority-engine.test.ts backend/tests/decision/priority-engine.test.ts
```

### 3. Create Missing Directories (if needed)
```bash
mkdir -p backend/src/domain
mkdir -p backend/src/decision
mkdir -p backend/tests/decision
```

### 4. Update Entry Point
Modify `backend/src/index.ts` to export domain and decision engine:

```typescript
// src/index.ts
export * from './domain/types';
export { scoreAndRank, filterEligible, mergeProfileAndRequirements } from './decision/priority-engine';
```

### 5. Verify Integration
```bash
# TypeScript compilation
npm run build

# Run all tests (including priority-engine tests)
npm test

# Type checking
npm run type-check
```

## Expected Results After Integration

### Successful Build
- `npm run build` completes without errors
- `dist/` directory contains compiled JavaScript + type declarations
- All `.ts` files in `src/` compile to `.js` in `dist/`

### Successful Tests
- `npm test` runs priority-engine test suite
- All tests pass ✓
- No type errors

## Key Principles Maintained

- ✅ **Deterministic**: Priority Engine produces consistent results
- ✅ **Model-independent**: No Claude/OpenAI dependencies in core
- ✅ **Data-source independent**: No assumptions about data origin
- ✅ **Execution-independent**: Ranking separate from purchase execution
- ✅ **Fully testable**: All logic testable without external services
- ✅ **Strict TypeScript**: No `any`, no loose types

## Known Dependencies

The integrated files may depend on:

- Standard TypeScript types (`string`, `number`, `boolean`, `array`, etc.)
- JSON/object literals
- Possibly `Date` for timestamps
- No external npm packages (to keep core lightweight)

## Post-Integration

Once successfully integrated:

1. The Priority Engine becomes the decision-making core of Capucine
2. Application layer can call `scoreAndRank()` to rank offers
3. Tests can be extended with additional scenarios
4. New domain models can be added without touching the engine
5. The API layer can eventually build on top of this core

## Architecture Layers (Progressive)

```
1. DOMAIN         ← domain-types.ts (entities, interfaces)
2. DECISION       ← priority-engine.ts (ranking logic)
3. APPLICATION   ← (services, business logic - future)
4. API            ← (Express routes - future)
5. UI             ← (frontend - existing at capucine_prototype.html)
```
