# Capucine — Architecture & Audit Report

> **Date:** 2026-08-13  
> **Test count:** 364/364 passing  
> **TypeScript:** strict, 0 errors

---

## Purpose

Capucine is a deterministic product-search engine. It finds the product that best matches the user's stated needs. It does not promote products, has no affiliates, and never silently modifies a user's request to improve result volume.

---

## Absolute Invariants

These invariants are enforced by architecture, not convention.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| 1 | Capucine ranks the product that best matches the **request**, not the product it "prefers" | PriorityEngine is fully deterministic; no AI path reaches it |
| 2 | **Rarity does not reduce relevance** — a product is scored on its characteristics, not catalog scarcity | Score is computed per-offer independently; catalog size is invisible to scoring |
| 3 | **Source has no ranking privilege** — same data from any source → same score | Provenance is recorded but never fed into PriorityEngine |
| 4 | **Execution difficulty has no effect on ranking** — a hard-to-buy product is not penalized | `executionCapability` field is informational only; PriorityEngine ignores it |
| 5 | **Capucine never silently modifies the user's intent** — no threshold is raised, no criterion relaxed without explicit user confirmation | All `RecoveryOption` objects have `requiresUserConfirmation: true` hardcoded |

---

## Pipeline Architecture

```
USER INPUT (queryText)
  │
  ▼
[BasicPatternInterpreter]          ← heuristic NL parsing (EN + FR)
  │  extractedCriteria             ← skipped if preInterpretedCriteria provided
  ▼
[ProfileEngine.resolve()]          ← 3-layer merge: profile + request + overrides
  │  effectiveCriteria             ← immutable snapshot, never mutated
  ▼
[ClarificationEngine.analyze()]    ← detect ambiguities (deterministic rules)
  │  ClarificationAnalysis
  ▼
[DiscoveryOrchestrator]            ← pluggable strategy (in-memory / web / hybrid)
  │  DiscoveryResult (candidates)
  ▼
[NormalizationEngine]              ← normalize storage/RAM values, clean formats
  │  normalized Offer[]
  ▼
[DeduplicationEngine]              ← group same product from different sources
  │  one best Offer per product
  ▼
[AdmissibilityEngine.filter()]     ← HARD GATE — required/forbidden violations → reject
  │  eligibleOffers + rejectedOffers
  ▼
[rankOffers() / PriorityEngine]    ← deterministic scoring, AI cannot influence
  │  RankingResult (rankedOffers)
  ▼
[ExplanationEngine.explain()]      ← structured explanation (no AI invention)
  │  FullExplanation
  ▼
[NoResultsAnalyzer]  (if 0 ranked) ← diagnose why, suggest recovery (user confirms)
  │
  ▼
SearchEngineResult
```

**Critical constraint:** AI is only involved in Stage 0 (interpretation) and never reaches PriorityEngine. `AIAuditEntry.reachedRankingEngine = false` is hardcoded.

---

## Component Audit

### ✅ IMPLEMENTED — Fully functional, tested

| Component | File | Tests |
|-----------|------|-------|
| **Domain types** — `DataPoint<T>`, `Offer`, `Merchant`, `PreferenceCriterion` | `domain/types.ts` | — |
| **AdmissibilityEngine** — hard filter before ranking | `domain/admissibility.ts` | ✅ |
| **ProfileEngine** — 3-layer criteria merge | `domain/profile.ts` | ✅ |
| **PriorityEngine** — deterministic ranking | `decision/priority-engine.ts` | ✅ |
| **BasicPatternInterpreter** — NL → criteria (EN + FR) | `application/request-interpreter.ts` | ✅ |
| **CapucineEngine** — full pipeline wiring | `application/capucine-engine.ts` | ✅ |
| **InMemoryDiscoveryStrategy** — 25+ offers, 6 categories | `application/in-memory-discovery.ts` | ✅ |
| **NormalizationEngine** — storage/RAM normalization | `application/normalization-engine.ts` | ✅ |
| **DeduplicationEngine** | `application/deduplication.ts` | ✅ |
| **ClarificationEngine** — rule-based ambiguity detection | `application/clarification-engine.ts` | ✅ |
| **ExplanationEngine** — structured ranking explanation | `application/explanation-engine.ts` | ✅ |
| **NoResultsAnalyzer** | `application/no-results-analyzer.ts` | ✅ |
| **ConflictResolver** — 4-strategy resolution chain | `application/conflict-resolver.ts` | ✅ |
| **ModelRouter** — deterministic AI model selection | `application/model-router.ts` | ✅ |
| **Tool / ToolRegistry** — pluggable external capabilities | `application/tools.ts` | ✅ |
| **BraveSearchAdapter / SerperAdapter** — real web search | `application/web-search-adapters.ts` | — |
| **RealWebDiscoveryStrategy** | `application/real-web-discovery.ts` | — |
| **HTTP API** — `POST /search`, `GET /health`, `GET /tools` | `api/server.ts` | — |

### ⚠️ NOT_EXECUTABLE — Implemented but requires external configuration

| Component | Blocker | Notes |
|-----------|---------|-------|
| **BraveSearchAdapter** | `BRAVE_API_KEY` env var | Returns `API_KEY_MISSING` without it |
| **SerperAdapter** | `SERPER_API_KEY` env var | Returns `API_KEY_MISSING` without it |
| **RealWebDiscoveryStrategy** | One of the above keys | Falls back gracefully with a clear warning |
| **ImageAnalysisTool** | Vision AI provider | Returns `API_KEY_MISSING` without it |
| **AI Orchestrator** | AI provider credentials | Mocked in tests; real calls need `OPENAI_API_KEY` or equivalent |

### 🔲 MOCKED / STUB — Exists as interface, not yet implemented

| Component | Status | Notes |
|-----------|--------|-------|
| **Persistent user profile storage** | No database yet | `createEmptyProfile()` used in tests; production needs a storage adapter |
| **Session / conversation state** | In-memory only | `ConversationModel` types exist; no persistence layer |
| **Multi-turn clarification loop** | Single-pass only | `ClarificationEngine` detects ambiguities; the conversation loop that drives follow-up questions is not built |
| **ProductSearchTool** | Returns empty list | Integration point for a real product catalog API; in-memory discovery used instead |

---

## Security Properties

All security constraints from the specification are met:

| Constraint | How it's enforced |
|------------|-------------------|
| No API key in client code | Keys read only from `process.env` inside adapter `search()` calls; never stored on objects |
| No hardcoded secrets | `isConfigured()` returns a boolean — key value is never exposed |
| No AI response treated as ranking truth | AI path ends at `extractedCriteria`; PriorityEngine receives only normalized data |
| No external data injected into ranking without normalization | Discovery → NormalizationEngine → DeduplicationEngine → Admissibility → PriorityEngine |
| No provenance suppressed during transformation | `normalizeCandidates()` preserves all `provenance` fields; only values are normalized |
| No silent intent modification | `RecoveryOption.requiresUserConfirmation = true` is non-optional; no auto-relaxation |

---

## French NL Patterns

`BasicPatternInterpreter` handles the following French query patterns:

**Budget extraction:**
- `moins de 500€` / `pas plus de 600€` / `budget de 800€`
- `jusqu'à 1000€` / `max 500€` / `500€ max`

**Requirements:**
- `impérativement bluetooth` / `obligatoirement` / `il me faut` / `j'ai besoin de`

**Exclusions:**
- `sans fil` / `pas de plastique` / `j'évite Amazon` / `surtout pas de`

**Preferences:**
- `de préférence` / `idéalement` / `si possible` / `j'aimerais`

**Ambiguity detection:**
- Vague budget: `pas trop cher`, `raisonnable`, `abordable`, `bon marché`
- Relative comparison: `plus léger`, `moins encombrant`, `plus autonome`

**Category detection (→ effectiveCriteria category):**
- `smartphone` / `téléphone` / `iphone` / `android` / `fairphone`
- `ordinateur` / `laptop` / `macbook` / `thinkpad`
- `casque` / `écouteur` / `airpod`
- `aspirateur` / `robot aspirateur` / `roborock`
- `clavier` / `keyboard` / `keychron`
- `livre` / `roman`

---

## Test Coverage

```
Test Suites: 16
Tests:       364

Domain:
  priority-engine.test.ts          — ranking invariants, scoring, AI exclusion
  admissibility.test.ts            — required/forbidden constraints

Application:
  capucine-engine.test.ts          — 65 end-to-end pipeline tests
  request-interpreter.test.ts      — NL parsing (EN + FR)
  normalization-engine.test.ts     — storage/RAM normalization
  clarification-engine.test.ts     — ambiguity detection rules
  conflict-resolver.test.ts        — 4-strategy resolution chain
  no-results-analyzer.test.ts      — diagnosis and recovery options
  in-memory-discovery.test.ts      — catalog data integrity

Integration:
  permutation-invariance.test.ts   — merchant / source / execution / order invariance
  business-scenarios.test.ts       — French scenarios: budget strict, produit rare,
                                     données contradictoires, parsing FR, invariant 5
  layer-contracts.test.ts          — cross-layer API contracts

Audit:
  capucine-audit.test.ts           — 20 critical invariants, continuous regression guard
```

---

## Running the HTTP API

```bash
# Install dependencies
cd backend && npm install

# Start server (in-memory discovery, no API keys needed)
PORT=3001 node dist/api/server.js

# Search
curl -X POST http://localhost:3001/search \
  -H "Content-Type: application/json" \
  -d '{"query": "je cherche un casque bluetooth moins de 200€"}'

# Enable real web search (optional)
BRAVE_API_KEY=your_key PORT=3001 node dist/api/server.js
```

---

## What's NOT built (by design)

Per the specification's explicit prohibitions:

- ❌ Payment, purchase automation, affiliate tracking
- ❌ Scraping (adapters use official APIs only)
- ❌ Integration of dozens of merchants (pluggable via `IDiscoveryStrategy`)
- ❌ Dependency on a single AI provider (pluggable via `AIOrchestrator`)
- ❌ Definitive production database (storage layer is an injection point)
- ❌ Framework lock-in (pipeline is plain TypeScript classes)
