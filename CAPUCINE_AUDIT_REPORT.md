# CAPUCINE BEHAVIORAL AUDIT REPORT

**Date:** 2026-08-12  
**Status:** Critical Issues Identified  
**Test Results:** 6 passing, 3 failing (intentional)  
**Purpose:** Validate that Capucine's architecture supports its core mission

---

## EXECUTIVE SUMMARY

The core architecture is **structurally sound but has functional bugs that violate Capucine's design principles.**

### ✅ What Works
- Small specialists ARE found and ranked appropriately
- Merchant neutrality IS preserved (unknown vs known score identically)
- Unknown data IS handled without automatic penalty
- Required constraints ARE enforced correctly
- Rare products CAN be found on unknown sources

### ❌ What's Broken
- Price ranking is inverted in some cases (higher price ranks first)
- Boolean criteria score opposite of intention (BUG confirmed again)
- Some criteria differences don't produce scoring gaps (relevance: "moderate" vs "excellent" produces same score)

### 🚨 Impact on Capucine's Mission
These bugs prevent Capucine from reliably:
- Selecting cheaper products when price is the differentiator
- Properly handling "avoid marketplace" or "prefer specialist" type preferences
- Distinguishing between different quality levels of the same offer

---

## AUDIT TEST RESULTS

### Test Suite: capucine-audit.test.ts

```
PASS:  6 tests
FAIL:  3 tests
Total: 9 tests (67% pass rate)
```

### ✅ PASSING TESTS (Capucine CAN do these)

**AUDIT-2: Extremely rare vintage figurine (1998 Japanese version)**
- Status: ✅ PASS
- What it tests: Capucine can find products from small unknown specialists
- Result: Small specialist offer (exact match) properly found and ranked
- Conclusion: **Capucine can handle rare products from unknown merchants**

**AUDIT-4: Industrial spare part only from small specialist**
- Status: ✅ PASS
- What it tests: Products only available from niche sources are discovered
- Result: Marketplace offer rejected (not available), specialist ranked
- Conclusion: **Capucine can search beyond mainstream sources**

**AUDIT-16: Merchant neutrality - identical products from different merchants**
- Status: ✅ PASS
- What it tests: Unknown and famous merchants score identically
- Result: Unknown store (599€, 1yr warranty) = Best Buy (599€, 1yr warranty) = same score
- Conclusion: **Merchant identity does NOT bias ranking** ✓

**AUDIT-12: Unknown data is NOT penalized as negative**
- Status: ✅ PASS
- What it tests: Missing information isn't treated as bad information
- Result: Unknown warranty scores between good warranty and bad warranty
- Conclusion: **Unknown ≠ Bad** (PRESERVED) ✓

**AUDIT-20: Rare product on unknown source is preferred if exact match**
- Status: ✅ PASS
- What it tests: Unknown sources are acceptable if they have exact matches
- Result: Unknown blog store with exact match preferred over Etsy non-exact match
- Conclusion: **Quality of match > Source notoriety** ✓

**AUDIT-CRITICAL: Required constraints are NEVER silently weakened**
- Status: ✅ PASS
- What it tests: Budget constraints cannot be violated
- Result: Offers exceeding budget are correctly rejected, not ranked
- Conclusion: **Constraints are inviolable** ✓

---

### ❌ FAILING TESTS (Bugs Found)

**AUDIT-1: Common laptop with budget constraint**
```
EXPECTED: Cheaper offer (849€) ranks before expensive offer (899€)
ACTUAL:   Expensive offer (899€) ranks first
STATUS:   FAILED
```

**Root Cause Analysis:**
- Both offers have `gamingPerformance: high`
- Both within budget (900€ max)
- Price = 899€ vs 849€
- Expected: Cheaper should rank first
- Actual: Expensive ranks first

**Error Output:**
```
Expected: < 849
Received: 899
```

**Diagnosis:** The scoring logic for price is inverted or the weighting is backwards. When all else is equal, higher price should score lower, but it doesn't.

**Impact:** Users searching for products at the same quality level won't get the cheapest first. This **violates Capucine's principle of finding what the user actually needs.**

---

**AUDIT-3: Vintage mechanical watch (1970s)**
```
EXPECTED: Specialist (excellent, recently serviced) ranks before Marketplace (moderate service history unknown)
ACTUAL:   Marketplace ranks first
STATUS:   FAILED
```

**Test Setup:**
- Both 1970s mechanical watches
- Marketplace: price 250€, serviceHistory=unknown
- Specialist: price 280€, serviceHistory="recently serviced"
- Criterion: serviceHistory='important' (preference level)

**Expected Order:** Specialist > Marketplace (known good service > unknown)  
**Actual Order:** Marketplace > Specialist (unknown treated better than known?)

**Diagnosis:** This is the **boolean scoring inversion bug** again. The serviceHistory is likely coded as a boolean or similar, and:
- unknown → scores neutral (50)
- "recently serviced" → should score high (100), but scores the same

**Impact:** Users cannot distinguish products based on actual differences in service history, maintenance, or similar qualitative factors.

---

**AUDIT-17: Easy execution (API) vs hard execution but better match**
```
EXPECTED: Manual execution (excellent match) scores HIGHER than API (moderate match)
ACTUAL:   Both score identically (69)
STATUS:   FAILED
```

**Test Setup:**
- API offer: relevance="moderate"
- Manual offer: relevance="excellent", price 500€ cheaper
- Criterion: relevance='very_important', price='important'

**Expected:** Manual (excellent relevance) > API (moderate relevance)  
**Actual:** Both score 69/100 (same)

**Diagnosis:** The "relevance" criterion doesn't have scoring logic in `evaluateDataValue`. It falls through to the default `return 50` case. Both offers end up with neutral scores, so only price matters equally.

**Impact:** Custom criteria that aren't specifically handled (price, warranty) don't produce scores that reflect actual quality differences.

---

## DETAILED BUG ANALYSIS

### Bug #1: Price ranking inversion in common scenarios
**Severity:** HIGH  
**Affected:** Basic shopping scenarios  
**Code:** `priority-engine.ts:231-237`

The price scoring formula or weighting is producing counterintuitive results. When two offers are otherwise identical, cheaper doesn't rank first.

### Bug #2: Boolean/unknown criterion scoring
**Severity:** CRITICAL  
**Affected:** All non-price criteria  
**Code:** `priority-engine.ts:242-243` + data handling

Boolean values and unknown statuses produce inverted or flat scoring. This affects:
- "Avoid marketplace" (false should be good, true should be bad)
- Service history (known good should be better than unknown)
- Warranty status
- Authenticity verification

### Bug #3: Missing scoring logic for custom criteria
**Severity:** MEDIUM  
**Affected:** Any criterion not explicitly handled  
**Code:** `priority-engine.ts:264` (default `return 50`)

Criteria like "relevance", "compatibility", "rarity" etc. that aren't in the if/else chain all get neutral score (50). This makes them non-differentiating.

---

## ASSESSMENT AGAINST CAPUCINE PRINCIPLES

### Principle 1: "Find the offer that matches what the user asked for"
**Status:** ⚠️ PARTIALLY COMPROMISED

- CAN find rare products ✓
- CAN find on unknown sources ✓
- CAN avoid mainstream bias ✓
- CANNOT properly compare price when equivalent ✗
- CANNOT distinguish quality differences ✗

### Principle 2: "Rareity doesn't diminish relevance"
**Status:** ✅ WORKS

Tests show small specialists and unknown sources are correctly handled.

### Principle 3: "Source doesn't have special rights"
**Status:** ✅ WORKS

Merchant neutrality test confirms merchant identity has zero effect.

### Principle 4: "Execution difficulty doesn't affect ranking"
**Status:** ⚠️ PARTIALLY WORKS

Tested with UCP vs web_redirect. Problem: difficulty doesn't modify ranking, but similarly, QUALITY differences might not either (see Bug #3).

### Principle 5: "Unknown ≠ Bad"
**Status:** ✅ WORKS

Unknown warranty scores between good and bad, not worse than bad.

### Principle 6: "Never silently weaken constraints"
**Status:** ✅ WORKS

Required budget is enforced correctly.

---

## VERDICT

### What Can Capucine Do NOW?
- ✅ Find rare products on unknown sources
- ✅ Maintain merchant neutrality
- ✅ Preserve unknown data integrity
- ✅ Enforce hard constraints

### What CANNOT Capucine Do Until Bugs Fixed?
- ❌ Reliably select cheaper products when quality is equal
- ❌ Distinguish offers based on custom quality criteria
- ❌ Properly handle boolean preferences ("Avoid X" type)
- ❌ Score qualitative differences consistently

### Capucine is Mission-Ready For:
- Niche, rare, specialized products ✓
- Finding beyond Amazon/Fnac ✓
- Respecting user constraints ✓

### Capucine is NOT Mission-Ready For:
- Common products requiring price/quality comparison ✗
- Boolean preferences (avoid, prefer) ✗
- Custom quality criteria ✗

---

## RECOMMENDED ACTIONS

### CRITICAL (Must fix before continuing)
1. **Fix price scoring inversion** (AUDIT-1)
   - Work: 2-3 hours diagnosis + test
   - Blocking: Basic shopping scenarios
   
2. **Fix boolean criterion scoring** (AUDIT-3)
   - Work: 4-6 hours (implement desiredValue parameter)
   - Blocking: "Avoid X" preferences

### HIGH (Fix before production)
3. **Implement scoring for custom criteria** (AUDIT-17)
   - Work: 6-8 hours (generic scoring framework)
   - Blocking: Quality differentiation

### MEDIUM (Can defer slightly)
4. **Add more comprehensive criterion scoring**
   - Duration/warranty/condition/authenticity
   - Work: 8-12 hours

---

## CONCLUSION

**Capucine's architecture is sound for finding rare/niche products, but it has bugs that prevent it from functioning as a general shopping agent until they're fixed.**

The tests prove:
- Small/unknown merchants work ✓
- Neutral ranking works ✓
- Constraints work ✓
- But basic price/quality comparison is broken ✗

**DO NOT** deploy or build further layers until these bugs are fixed.

**NEXT PHASE:** Fix the 3 identified bugs, re-run audit tests until all 9 pass, then proceed with discovery and execution layers.

---

**Audit Completed:** 2026-08-12  
**Status:** BLOCKED until critical bugs fixed  
**Next Step:** Modify Priority Engine and re-validate
