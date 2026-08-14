# Capucine — AI-Powered Shopping Agent Architecture

## Project Status

**Current Phase**: Foundation Setup (Core Domain + Decision Engine Integration)

**Stage**: TypeScript backend infrastructure ready. Awaiting integration of core files from Capucine 1.

## Repository Structure

```
capucine/
├── backend/                          # ← NEW: TypeScript core backend
│   ├── src/
│   │   ├── domain/                   # ← PENDING: domain-types.ts
│   │   ├── decision/                 # ← PENDING: priority-engine.ts
│   │   ├── application/              # (Future: business logic)
│   │   └── infrastructure/           # (Future: DB, external services)
│   ├── tests/
│   │   └── decision/                 # ← PENDING: priority-engine.test.ts
│   ├── package.json                  # TypeScript + Jest configured
│   ├── tsconfig.json                 # Strict mode
│   ├── jest.config.js                # ts-jest configured
│   └── README.md
│
├── shopping-assistant/               # Existing parallel implementation (optional reference)
├── mon-projet-anthropic/             # Existing experimentation (can reference)
├── server.js                         # Existing simple proxy (deprecated)
├── capucine_prototype.html           # Existing prototype UI (reference)
├── index.html                        # Existing landing page
│
└── .gitignore                        # Covers node_modules/, dist/, .env, etc.
```

## Architecture Layers (Planned)

### 1. DOMAIN (foundation)
**Status**: 🟡 Pending — `domain-types.ts` awaiting integration

Core entities:
- `UserProfile` — User preferences (permanent)
- `PreferenceCriterion` — Individual preference levels
- `CurrentSearchRequirements` — Contextual search constraints
- `Product` — Generic product metadata
- `Offer` — Specific offer from a merchant
- `RankedOffer` — Offer with scoring results
- `CriterionMatch` — Score for a single criterion

Key principles:
- All types are **interfaces**, not implementations
- No side effects or I/O
- Completely independent of any AI model or data source

### 2. DECISION ENGINE (core logic)
**Status**: 🟡 Pending — `priority-engine.ts` awaiting integration

Deterministic functions:
- `mergeProfileAndRequirements()` — Combine permanent + contextual preferences
- `filterEligible()` — Apply hard constraints (required/forbidden)
- `scoreAndRank()` — Calculate ranking scores, produce ordered results

Properties:
- ✅ **Deterministic** — Same input = same output, always
- ✅ **Testable** — No network, no AI, no DB calls
- ✅ **AI-independent** — Claude, OpenAI, Gemini all equally supported
- ✅ **Merchant-independent** — No bias toward specific vendors
- ✅ **Execution-independent** — Ranking ≠ purchase method

### 3. APPLICATION LAYER (future)
**Status**: ⭕ Not yet started

Will include:
- Business logic for shopping workflows
- Intent interpretation (from AI)
- Multi-source research coordination
- Offer normalization
- User profile persistence

### 4. API / ROUTES (future)
**Status**: ⭕ Not yet started

Will provide:
- Express.js routes (or alternative)
- Request/response handling
- Authentication
- Error handling

### 5. USER INTERFACE (future)
**Status**: ⭕ Existing reference — `capucine_prototype.html`

Will include:
- Chat interface for user interaction
- Agentic decision presentation
- Purchase facilitation UI

## Technologies

### Current Setup
- **Language**: TypeScript 5.9.3 (strict mode)
- **Runtime**: Node.js 18+
- **Testing**: Jest 29.7.0 + ts-jest
- **Module System**: ESNext with Node.js resolution

### Future Considerations (NOT implemented yet)
- Express.js (for API layer)
- SQLite or PostgreSQL (for persistence)
- Anthropic SDK (for Claude integration)
- Additional AI model SDKs (OpenAI, Gemini, etc.) — optional
- Merchant APIs (future integration points)

### NOT adding yet
- Next.js, React (UI can remain static HTML initially)
- Docker (can add when deployment strategy is clear)
- Load balancers, caching (premature for MVP)
- Payment processing (user always finalizes purchase)
- Affiliate systems (independent of merchant)

## Key Design Decisions

### 1. Deterministic Ranking
The Priority Engine must **never** depend on:
- Current AI model state
- Current prices (which may change during execution)
- Network availability
- Merchant API responses

It produces a **deterministic order** based on:
- Explicit criteria in search
- Permanent user preferences
- Preference hierarchy (forbidden → required → very important → important → preference → low → none)

### 2. AI as Interpreter, Not Decider
Claude (or other AI) is used to:
- Parse user intent → `CurrentSearchRequirements`
- Interpret implicit preferences → structured criteria
- Generate explanations for rankings

Claude is **not** used to:
- Decide which product is best (Priority Engine does that)
- Rank offers (Priority Engine does that)
- Apply business logic (Priority Engine does that)

### 3. Independence Principle
The core decision logic must work:
- ✅ Without Claude
- ✅ Without any API calls
- ✅ Without a database
- ✅ Without knowing which merchant supplies what
- ✅ Without knowing how the purchase will be executed

This ensures:
- Testability without mocking external services
- Model portability (swap AI providers easily)
- Scalability (core is lightweight)
- Auditability (no hidden dependencies)

## Integration Workflow

### Phase 1 ✅ (CURRENT)
- [x] Create TypeScript infrastructure
- [x] Configure strict TypeScript
- [x] Setup Jest testing
- [x] Create directory structure for domain + decision
- [ ] ✏️ Integrate `domain-types.ts`
- [ ] ✏️ Integrate `priority-engine.ts`
- [ ] ✏️ Integrate `priority-engine.test.ts`

### Phase 2 (NEXT)
- [ ] Verify all tests pass
- [ ] Create first commit of integrated core
- [ ] Create application layer stubs
- [ ] Design AI intent → domain mapping

### Phase 3 (PLANNED)
- [ ] Build RESEARCH/DISCOVERY layer
- [ ] Build OFFER_NORMALIZATION layer
- [ ] Connect to sample merchant data sources
- [ ] Test end-to-end ranking

### Phase 4 (PLANNED)
- [ ] Build API routes
- [ ] Connect frontend to API
- [ ] Implement user authentication
- [ ] Build user profile persistence

### Phase 5+ (FUTURE)
- [ ] Production deployment strategy
- [ ] Multi-merchant integration
- [ ] International support
- [ ] Advanced user features

## Development Commands

```bash
# From backend/ directory

# Compilation
npm run build          # Compile TypeScript to JavaScript
npm run dev            # Watch mode

# Testing
npm test               # Run Jest suite
npm test:watch         # Watch mode for tests
npm run type-check     # Check types without emitting

# Status
git status            # Show changes
git diff              # Show diffs
```

## Current Blockers / Next Actions

**Awaiting**: Three files from Capucine 1 session
- `domain-types.ts`
- `priority-engine.ts`
- `priority-engine.test.ts`

**When available**:
1. Copy files to `backend/src/domain/` and `backend/src/decision/`
2. Run `npm run build` — should compile without errors
3. Run `npm test` — all tests including priority-engine tests should pass
4. Create commit: "integrate: Add domain types and priority engine from Capucine 1"

## Architecture Diagram (ASCII)

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INTERFACE                          │
│              (capucine_prototype.html or React)             │
└────────────────────┬────────────────────────────────────────┘
                     │ User input → JSON
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                        API LAYER                            │
│              Express.js routes (future)                     │
│                   /search, /rank, etc.                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                 APPLICATION LAYER                           │
│           Business logic, workflow orchestration            │
│                     (future)                                │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    ┌────────┐   ┌────────┐   ┌────────┐
    │RESEARCH│   │NORMALIZE   │DECISION│
    │(future)│   │(future)│   │(NOW)   │
    └────────┘   └────────┘   └────┬───┘
                                   │
                                   ▼
                     ┌──────────────────────────┐
                     │   PRIORITY ENGINE        │
                     │   (Capucine 1 core)      │
                     │ scoreAndRank()           │
                     │ filterEligible()         │
                     │ mergeProfile+Req()       │
                     └──────────────────────────┘
                                   │
                                   ▼
                     ┌──────────────────────────┐
                     │   DOMAIN ENTITIES        │
                     │   (Capucine 1 core)      │
                     │ UserProfile              │
                     │ Product/Offer            │
                     │ PreferenceCriterion      │
                     │ RankedOffer              │
                     └──────────────────────────┘
```

## FAQ

**Q: Why TypeScript for the core, not JavaScript?**
A: Type safety prevents subtle ranking errors. The core must be bulletproof.

**Q: Why not use a framework like NestJS immediately?**
A: Keep the core lightweight. Add frameworks only when needed.

**Q: When will we connect to real merchants?**
A: Phase 3. First, nail the ranking logic.

**Q: Will Capucine work with GPT, Claude, Gemini?**
A: Yes. The core is model-agnostic. Just interpret intent differently per model.

**Q: When do we build the UI?**
A: UI skeleton exists. Full implementation after API layer is ready (Phase 4).

## References

- Capucine Product Vision: (internal document)
- Priority Engine Spec: (in domain-types.ts + priority-engine.ts)
- Test Suite: (priority-engine.test.ts)
