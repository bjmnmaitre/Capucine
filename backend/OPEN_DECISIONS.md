# OPEN_DECISIONS — Capucine Core

## Status

These decisions are NOT bugs. They are architectural choices that require validation from the business/product owner.

---

## OD-001: Hard Constraint Threshold

**Location**: `src/decision/priority-engine.ts` line 62

**Question**: What score minimum constitutes satisfying a `required` constraint?

**Current Implementation**:
```typescript
if (criterion.level === 'required' && score.score < 50) {
  // Reject offer
}
```

**Problem**: 
- Threshold 50 is hardcoded with no justification
- An offer scoring 49 is rejected, same as one scoring 0
- Could be too lenient (50 is "neutral") or too strict (should be 70?)

**Options**:
- A) Keep 50 (neutral = barely acceptable for hard constraint)
- B) Change to 70+ (required means actually good, not neutral)
- C) Make it configurable per criterion
- D) Different logic: required = must satisfy (binary), not gradual scoring

**Impact on Users**: High. Directly affects which offers appear in results.

**Recommendation**: Option D (binary logic for hard constraints) might be clearer. An offer either satisfies `required` or it doesn't. No gradual scoring.

---

## OD-002: Forbidden Threshold

**Location**: `src/decision/priority-engine.ts` line 53

**Question**: What score minimum constitutes violating a `forbidden` constraint?

**Current Implementation**:
```typescript
if (criterion.level === 'forbidden' && score.score > 0) {
  // Reject offer
}
```

**Problem**:
- Any value > 0 triggers rejection
- An offer scoring 1 and scoring 100 on forbidden criterion are treated identically
- No nuance for "maybe violates" vs "definitely violates"

**Options**:
- A) Keep binary: any positive = violation
- B) Threshold-based: violation only if score > X
- C) Bidirectional: forbidden criteria can have different logic than required

**Impact on Users**: High. Forbidden criteria completely eliminate offers.

**Recommendation**: Keep binary (A). Forbidden = must avoid. Either you avoid it or you don't.

---

## OD-003: Profile + Demand Weighting

**Location**: `src/decision/priority-engine.ts` lines 451-476

**Question**: When merging UserProfile criteria with CurrentSearchRequirements criteria, which should have priority?

**Current Behavior**:
```typescript
const merged = [...searchRequirements];  // Start with search
for (const profileCriterion of profileCriteria) {
  if (!alreadyInSearch) {
    merged.push(profileCriterion);  // Add profile if not in search
  }
}
```

**Problem**:
- SearchRequirements criteria come first (listed first = scored first, no semantic priority but affects display order)
- If profile has `country:very_important` and search has `price:required`, price gets weighted 8 and country gets weighted 5
- Hard constraints (required) can outweigh strong profile preferences (very_important)

**Scenario Example**:
```
Profile: country=very_important (weight 5)
Demand:  price=required (weight 8)

Offer A: country=EU (good), price=€600 (over budget)
Offer B: country=Unknown, price=€200 (great)

Result: B ranks higher because required weight > preference weight
```

**Options**:
- A) Current: Profile preferences + search constraints coexist by weight
- B) Profile-first: Profile preferences are hard floor, search adds on top
- C) Search-override: Search requirements completely replace profile for this session
- D) Weighted-union: Profile is 40% weight, search 60% weight in scoring

**Impact on Users**: HIGH. Determines whether permanent preferences or temporary searches drive results.

**Recommendation**: Need product decision. Current (A) might lose user intent. Suggest hybrid: Profile `required`/`forbidden` are always applied, profile `preferences` are guidelines that can be de-weighted by search constraints.

---

## OD-004: Unknown Data Handling for Hard Constraints

**Location**: `src/decision/priority-engine.ts` function `handleUnknownData()`

**Question**: When a `required` criterion has unknown data, should the offer be rejected?

**Current Implementation**:
```typescript
if (level === 'required') {
  return 25;  // Low score, may trigger rejection at threshold
}
```

**Problem**:
- Unknown data scores 25, which is < 50 threshold, so offer is rejected
- But unknown ≠ bad. We simply don't know.
- User might prefer "try with unknown" over "no result"

**Scenario**:
```
Requirement: Warranty must be at least 2 years (required)
Offer A: Warranty = 2 years (known) → score 100
Offer B: Warranty = unknown → score 25 → REJECTED

User feedback: "Why didn't you show offer B? Maybe it has warranty!"
```

**Options**:
- A) Current: Unknown = low score = likely rejected for `required`
- B) Unknown = neutral (50): offer passes, warranty just unknown
- C) Unknown = missing info, defer decision to user (show in "unverified" section)
- D) Configurable: require has parameter "acceptUnknown": true/false

**Impact on Users**: MEDIUM. Affects result count and completeness.

**Recommendation**: Option C. For `required` constraints, maybe offer two result sections: "verified to match" and "possibly match (unverified data)".

---

## OD-005: Contradictory Data Handling

**Location**: `src/decision/priority-engine.ts` function `handleContradictoryData()`

**Question**: When data is contradictory, how should scoring work?

**Current Implementation**:
```typescript
if (level === 'required' || level === 'forbidden') {
  return 35;  // Lower score, likely rejection
}
// For preferences: return 50 (neutral)
```

**Problem**:
- Contradiction for `required` scores 35 (< 50) = rejection
- For `preference` = 50 (neutral)
- What if sources are equally credible but disagree?

**Scenario**:
```
Product: Repairable? 
Source A says: "Yes, user-repairable, all parts available"
Source B says: "No, design is sealed, not repairable"

Requirement: Must be repairable (required)
Result: Score 35 → REJECTED

But what if Source A is user review (opinion) and Source B is manufacturer (authority)?
```

**Options**:
- A) Current: Contradictory = uncertain = lower score
- B) Contradiction-aware: Score based on "best case" source
- C) Contradiction-aware: Score based on "worst case" source
- D) Ask user: Show contradiction, let user decide
- E) Defer to later: Store contradiction, let Discovery layer resolve via better sources

**Impact on Users**: MEDIUM-HIGH. Affects confidence in results.

**Recommendation**: Option E. Current layer flags contradictions. Future Discovery layer improves source quality. For now, flag but don't auto-reject.

---

## OD-006: Unknown Country vs Bad Country

**Location**: `src/decision/priority-engine.ts` function `evaluateDataValue()`

**Question**: How should string/enum criteria like country be scored when unknown vs mismatched?

**Current Implementation**:
```typescript
if (typeof value === 'string') {
  const preferredValues = criterion.parameters?.preferredValues;
  if (preferredValues && preferredValues.includes(value)) {
    return 100;
  }
  return 50; // Neutral for non-preferred
}
```

**Problem**:
- "France" (EU) → 50 (neutral) instead of 100
- "Unknown" → 50 (neutral)
- No way to express "strongly preferred" vs "neutral" vs "actively disliked"

**Scenario**:
```
Preference: EU-made products preferred
Offers:
- A: country="France" → score 50 (should be 100)
- B: country="Unknown" → score 50 (appropriate)
- C: country="China" → score 50 (should maybe be 25?)
```

**Options**:
- A) Current: All non-matching = neutral
- B) Add preferredValues vs dislikedValues: France=100, China=10
- C) Gradual scoring: EU=100, Europe=75, Asia=50, Unknown=25
- D) Configuration per criterion: supply scoring function

**Impact on Users**: MEDIUM. Affects ranking quality for regional preferences.

**Recommendation**: Option B. Extend `parameters` to support both `preferredValues` and `dislikedValues` arrays.

---

## OD-007: Warranty Heuristic

**Location**: `src/decision/priority-engine.ts` lines 263-270

**Question**: How should natural language warranty strings be interpreted?

**Current Implementation**:
```typescript
const yearMatch = value.match(/(\d+)\s*year/);
if (yearMatch) {
  const years = parseInt(yearMatch[1], 10);
  return Math.min(100, 40 + years * 15);  // 1yr=55, 2yr=70, 3yr=85, 5yr=100
}
```

**Problem**:
- Heuristic is ad-hoc and hardcoded
- Assumes warranty duration = quality (true, but maybe not all contexts)
- Fails on variations: "3-year", "trois ans", "lifetime", "no warranty"

**Examples of failures**:
- "1 years" (plural) → matches? Depends on regex
- "unlimited" → returns 50 (neutral), but should be high
- "lifetime" → returns 50
- "30 days" → returns 40 + 0*15 = 40

**Options**:
- A) Current: Simple regex + linear formula
- B) Better regex + mapped values: "lifetime"→100, "3yr+"→85, "1-2yr"→60
- C) Delegate to future Discovery/Normalization layer
- D) Don't score warranty automatically; flag for user decision

**Impact on Users**: LOW (warranty is preference, not constraint).

**Recommendation**: Option C. Normalization layer should clean data. Engine should receive clean, consistent data. Don't invent scoring from messy strings.

---

## OD-008: Missing Data Penalty

**Location**: `src/decision/priority-engine.ts` function `handleMissingData()`

**Question**: When a criterion is relevant but data is completely missing, how should it affect scoring?

**Current Implementation**:
```typescript
// Criterion not in offer at all
if (criterion.level === 'required') {
  return 30;  // Low, likely rejection
}
if (criterion.level === 'forbidden') {
  return 50;  // Neutral
}
// For preferences: return 50
```

**Problem**:
- Missing data = score 30 for required = near-rejection
- But missing ≠ bad. If field doesn't apply to product, score 50.
- No distinction between "not applicable" and "applicable but unknown"

**Scenario**:
```
Product: Acoustic guitar
Criterion: Wireless connectivity (required)
Offer: No data on wireless (because guitars aren't wireless)

Result: Score 30 → REJECTED

But guitarist probably expected this (wireless = N/A for acoustic guitar)
```

**Options**:
- A) Current: Missing = low score
- B) Missing = neutral (50): assume "N/A unless proven"
- C) Distinguish: Missing vs NotApplicable (different scores)
- D) Require explicit "notApplicable" field

**Impact on Users**: MEDIUM. Affects how to handle product-category mismatches.

**Recommendation**: Option C. Add `NotApplicable` as a DataStatus so we can distinguish "data doesn't exist" from "data is unknown" from "criterion doesn't apply".

---

## OD-009: Flexible Budget Interpretation

**Location**: Scoring logic for "budget flexibility"

**Question**: When user says "budget €600, but can exceed by 10-15% if quality really better", how is this modeled?

**Current Status**: Not implemented. `mergeProfileAndRequirements` doesn't have logic for this.

**Problem**:
- "really better" is ambiguous
- 10-15% range is clear
- But how much quality increase justifies budget increase?

**Scenario**:
```
Budget: €600, flexibility: 10-15% (€60-90 range)
Quality preferred: high

Offer A: €600, quality=good → in budget ✓
Offer B: €650, quality=better → €50 over budget
Offer C: €680, quality=much better → €80 over budget
Offer D: €700, quality=slightly better → €100 over budget, violates flexibility

Which should rank highest?
Currently: A (within budget)
With flexibility: C (at limit of flexibility, high quality boost)?
```

**Options**:
- A) Hardcode: €600 is hard limit, no flexibility
- B) Soft limit: €600 preferred, €660-€690 acceptable, >€690 rejected
- C) Formula: (budget × 1.15) + quality_improvement allowed
- D) AI interpretation: Claude determines if quality boost justifies budget increase

**Impact on Users**: MEDIUM. Affects budget-quality tradeoff.

**Recommendation**: Option C. Model as: `maxPrice = baseBudget × (1 + flexibilityPercent)`. Quality bonus doesn't further increase limit. Then user can adjust if needed.

---

## OD-010: Determinism vs Explainability

**Location**: General design

**Question**: How much explainability can Priority Engine provide without sacrificing determinism?

**Current Status**: High determinism (good). Explanations present but could be richer.

**Problem**:
- Full explainability might require non-deterministic tie-breaking
- "Why was offer A ranked before B when scores are identical?" requires additional logic

**Scenario**:
```
Offer A: price=€599, warranty=2yr → score 75
Offer B: price=€599, warranty=2yr → score 75 (TIED)

Which ranks first?
Engine: Iteration order (undefined)
User: "Why was A first? They're identical!"
```

**Options**:
- A) Current: Deterministic order, minimal explanation for ties
- B) Add tiebreaker: price ascending, then merchant alphabetical
- C) Mark ties explicitly: "Equivalent offers A and B"
- D) Add confidence metric: "A scored 75±2, B scored 75±3"

**Impact on Users**: LOW-MEDIUM. Affects edge cases.

**Recommendation**: Option C. For ties, group together and present as equivalent. Let user choose any. Don't force artificial ordering.

---

## SUMMARY TABLE

| Decision ID | Topic | Severity | Status | Recommended Action |
|--|--|--|--|--|
| OD-001 | Required threshold | HIGH | Block ranking | Clarify: gradient vs binary? |
| OD-002 | Forbidden threshold | HIGH | Block ranking | Keep binary? |
| OD-003 | Profile + demand weighting | HIGH | Affects results | Hybrid approach needed |
| OD-004 | Unknown hard constraint | MEDIUM | Affects coverage | Add "unverified" result section? |
| OD-005 | Contradictory data | MEDIUM-HIGH | Affects confidence | Defer to better sources |
| OD-006 | String criterion scoring | MEDIUM | Affects ranking | Support preferred/disliked values |
| OD-007 | Warranty heuristic | LOW | Affects specifics | Move to normalization layer |
| OD-008 | Missing data penalty | MEDIUM | Affects categories | Add NotApplicable status |
| OD-009 | Budget flexibility | MEDIUM | Affects budget-quality | Use formula approach |
| OD-010 | Tie-breaking | LOW | Edge cases | Mark as equivalent |

---

## NEXT STEPS

1. **Immediate**: Decide OD-001 through OD-003 (affect scoring fundamentally)
2. **Phase 2**: Implement decisions with code changes
3. **Phase 3**: Extended testing with decided behaviors
