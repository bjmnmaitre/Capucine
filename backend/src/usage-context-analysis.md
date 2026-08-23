# Usage Context Flow Analysis in Capucine System

## Overview
This document traces how usage context flows through the Capucine architecture, identifying where it's correctly handled, where it's lost, and what needs to be fixed to ensure contextual signals (like "transports" or "musique") properly influence search and ranking without becoming hard constraints.

## Current Flow Analysis

### 1. Correct Extraction (RequestInterpreter)
**File**: `/Users/user/capucine/backend/src/application/request-interpreter.ts`
**Method**: `extractUsageContext()` (lines 364-478)
- ✅ Correctly identifies usage context patterns:
  - Transport: "pour les transports", "dans les transports", etc.
  - Music: "pour écouter de la musique", "principalement pour la musique", etc.
  - Other contexts: sport, office, gaming, travel, home
- ✅ Returns properly structured `UsageContext` object:
  ```typescript
  interpretation.usageContext = {
    usage,           // e.g., 'transport', 'music'
    context: context ?? undefined, // e.g., 'transport' for transport usage
    source: 'user',
    confidence,      // 0.9 for transport, 0.85 for music, etc.
    timestamp: new Date()
  }
  ```
- ✅ Returns matched substring for span-stripping (to prevent double counting)
- ❌ **Issue**: While extraction works, the context is not consistently propagated forward

### 2. Entry to ProfileEngine (Correct)
**File**: `/Users/user/capucine/backend/src/domain/profile.ts`
**Method**: `ProfileEngine.resolve()` (lines 137-265)
- ✅ Correctly accepts `request: CurrentSearchRequirements` parameter
- ✅ `CurrentSearchRequirements` (from types.ts line 246-271) includes:
  ```typescript
  usageContext?: UsageContext;
  ```
- ❌ **Issue**: Despite receiving usageContext, the method does NOT preserve it in output

### 3. Loss Point (ProfileEngine)
**File**: `/Users/user/capucine/backend/src/domain/profile.ts`
**Method**: `ProfileEngine.resolve()` (lines 137-265)
- ❌ **CRITICAL BREAK**: The method returns `EffectiveCriteriaSet` which has NO usageContext field:
  ```typescript
  export interface EffectiveCriteriaSet {
    criteria: PreferenceCriterion[];
    traceability: CriterionTrace[];
    appliedOverrides: ProfileOverride[];
    resolvedConflicts: ConflictResolution[];
    resolvedAt: Date;
    searchId: string;
    // MISSING: usageContext?: UsageContext;
  }
  ```
- ❌ **Consequence**: Usage context extracted from user query is completely discarded after profile merge
- ❌ **Impact**: Usage context never reaches discovery, ranking, or explanation components

### 4. Missing Propagation to Discovery
**File**: `/Users/user/capucine/backend/src/application/capucine-engine.ts`
**Method**: `planToDiscoveryCriteria()` (lines 1052-1148)
- ❌ **Issue**: Even if usageContext made it here (it doesn't), there's no code to copy it:
  ```typescript
  private planToDiscoveryCriteria(
    plan: SearchPlan,
    queryText: string,
    phaseTerms?: PhaseTerms,
    language?: SupportedLanguage,
    additionalSearchLanguages?: SupportedLanguage[]
  ): DiscoveryCriteria {
    const criteria: DiscoveryCriteria = {};
    if (language) criteria.language = language;
    if (additionalSearchLanguages && additionalSearchLanguages.length > 0) {
      criteria.internationalLanguages = additionalSearchLanguages;
    }
    // ... copies keywords, exactRefs, categories, hardConstraints, etc.
    // BUT NO: if (plan.usageContext) criteria.usageContext = plan.usageContext;
  }
  ```
- ❌ **Reality**: Since ProfileEngine already lost usageContext, this is moot

### 5. DiscoveryCriteria Has The Field (But It's Empty)
**File**: `/Users/user/capucine/backend/src/domain/types.ts`
**Interface**: `DiscoveryCriteria` (lines 25-97)
- ✅ Correctly defines the field:
  ```typescript
  /**
   * Usage context from the request (contextual signals, not hard constraints).
   * This influences search strategy and ranking but does not affect admissibility.
   */
  usageContext?: UsageContext;
  ```
- ❌ **Reality**: This field is always undefined because nothing populates it

### 6. Where Usage Context SHOULD Be Used

#### A. Search Strategy Planner
**File**: `/Users/user/capucine/backend/src/application/search-strategy-planner.ts`
- Should modify strategy selection based on usageContext:
  - Transport usage → boost technical_specs strategy for weight/battery/portability
  - Music usage → boost technical_specs strategy for audioQuality/noiseCancellation/comfort
  - etc.

#### B. Priority Engine (Ranking)
**File**: `/Users/user/capucine/backend/src/decision/priority-engine.ts`
- In `scoreCriterion()`, usage context should adjust criterion weights:
  - For transport usage: increase weight of 'weight', 'battery_life', 'portability' criteria
  - For music usage: increase weight of 'audioQuality', 'noiseCancellation', 'comfort' criteria
  - Must NOT turn contextual signals into hard constraints (per requirements)

#### C. Explanation Engine
**File**: `/Users/user/capucine/backend/src/application/explanation-engine.ts`
- Should include usage context in explanations:
  - "Score: 85/100. Strengths: battery life (95/100 - critical for transport usage)"
  - "Rejected: fails weight constraint (180g > 150g max for transport usage)"

#### D. Normalization Engine (Optional)
Could normalize context-specific values, but less critical since usage context is about relevance, not data transformation

## Requirements Verification

Let's check each architectural constraint against the current broken implementation:

1. ✅ **No explicit constraint can be weakened** - Not violated yet since context isn't used at all
2. ❌ **Contextual inference never becomes hard constraint** - Can't verify since not used, but design is correct
3. ❌ **UNKNOWN ≠ FALSE** - Not applicable since context isn't propagated
4. ❌ **No penalty for unknown contextual characteristic** - Not applicable
5. ✅ **Determinism** - Current implementation is deterministically broken (always loses context)
6. ❌ **Provenance conserved** - Context provenance is lost
7. ❌ **Snapshot of profile respected** - Profile snapshot works, but context is separate
8. ❌ **Priority to explicit criteria over inferences** - Can't verify since inferences aren't used
9. ❌ **No second parallel architecture** - Not relevant
10. ❌ **No unnecessary duplication** - Not relevant

## Fix Implementation Plan

### Phase 1: Restore the Flow
1. **Add usageContext to EffectiveCriteriaSet** (profile.ts)
2. **Modify ProfileEngine.resolve() to preserve usageContext** 
3. **Update capucine-engine.ts to pass usageContext through to DiscoveryCriteria**
4. **Ensure SearchPlanBuilder and related components handle usageContext**

### Phase 2: Implement Usage
1. **Modify SearchStrategyPlanner to use usageContext for strategy selection**
2. **Update PriorityEngine to weight criteria based on usageContext**
3. **Enhance ExplanationEngine to reference usageContext in explanations**

### Phase 3: Add Tests
1. **Test usage context extraction from various phrases**
2. **Test that usage context flows through to DiscoveryCriteria**
3. **Test that usage context influences search strategy selection**
4. **Test that usage context affects ranking scores (without becoming hard constraint)**
5. **Test that usage context appears in explanations**
6. **Test edge cases: unknown context, conflicting contexts, etc.**

## Files That Need Modification

1. `/Users/user/capucine/backend/src/domain/profile.ts` 
   - Add usageContext to EffectiveCriteriaSet interface
   - Modify ProfileEngine.resolve() to preserve and return usageContext

2. `/Users/user/capucine/backend/src/application/capucine-engine.ts`
   - Update planToDiscoveryCriteria() to copy usageContext from plan to DiscoveryCriteria
   - Ensure SearchPlan includes usageContext (may need to update SearchPlanBuilder)

3. `/Users/user/capucine/backend/src/application/search-strategy-planner.ts`
   - Modify buildStrategies() and buildInternationalStrategies() to use usageContext

4. `/Users/user/capucine/backend/src/decision/priority-engine.ts`
   - Update scoreCriterion() to adjust weights based on usageContext

5. `/Users/user/capucine/backend/src/application/explanation-engine.ts`
   - Update explanation generation to include usage context rationale

## Estimated Effort
- Phase 1 (Restore flow): 2-3 hours
- Phase 2 (Implement usage): 4-6 hours  
- Phase 3 (Tests): 3-4 hours
- Total: ~9-13 hours

The fix is localized and architectural - once the flow is restored, implementing the usage logic follows naturally from the existing patterns in the codebase.