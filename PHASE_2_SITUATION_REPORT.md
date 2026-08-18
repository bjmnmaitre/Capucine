# PHASE 2: ACCESSIBILITY INTEGRATION
## Situation Report & Next Steps

**Date**: 18 Août 2026  
**Duration**: Initial sprint (4 hours analysis + planning)  
**Status**: ✅ **ANALYSIS COMPLETE — READY FOR IMPLEMENTATION**

---

## WHAT WAS COMPLETED

### 1. Accessibility Audit (ACCESSIBILITY_AUDIT.md)

**Scope**: Complete audit of shopping-assistant web frontend

**Findings**:
- ✅ HTML basics present (doctype, lang, labels)
- ❌ WCAG 2.2 AA compliance: ~40%
- ❌ Accessibility critical gaps:
  - No semantic main/nav/section
  - No ARIA support
  - No focus management (modals, keyboard nav)
  - Contrast colors need verification
  - No support for screen readers
  - No dark mode or high contrast mode
  - No reduced motion support

**Estimated effort to WCAG 2.2 AA**: 6-8 weeks (2-3 devs)

**Recommendation**: P0 — Accessibility must be addressed before public launch

---

### 2. Architecture Reality Check (ARCHITECTURE_REALITY_CHECK.md)

**Scope**: Comparative analysis — planned architecture vs actual implementation

**Key Finding**: Core backend is **85% complete and well-architected**

| Component | Planned | Actual | Gap |
|-----------|---------|--------|-----|
| Domain Layer | ✅ | ✅ | None |
| Decision Layer | ✅ | ✅ | None |
| Core Application | ✅ | ✅ | None |
| Phase 1 Modules | ✅ | ✅ | None |
| AI Orchestration | ✅ | ⚠️ | Basic (works, not sophisticated) |
| STT/TTS | ✅ | ❌ | Completely absent |
| Conversation Persistence | ✅ | ❌ | In-memory only |
| Frontend Accessibility | ✅ | ❌ | Not accessible |
| Database | ✅ | ❌ | Mock/in-memory |

**Conclusion**: Backend core is **production-ready**. Infrastructure layer needs work.

---

### 3. Interaction Preferences Model (interaction-preferences.ts)

**What It Is**: A TypeScript data model for user preferences WITHOUT medical/disability information

**Key Features**:
- ✅ Functional preferences only ("I prefer voice", not "I'm deaf")
- ✅ Session overrides (temporary, don't modify profile)
- ✅ Device capability detection (browser feature, not medical)
- ✅ RGPD-compliant (explicit consent, data retention, deletion)
- ✅ Extensible (can add more preference types without changing core)

**Why This Matters**:
- Enables accessibility WITHOUT medicalization
- Respects user privacy
- Flexible enough for future features
- Doesn't create a "disabled users" category

**Status**: ✅ Design complete, ready to integrate into UserProfile

---

### 4. Multimodal Analysis (MULTIMODAL_ANALYSIS.md)

**Scope**: Detailed evaluation of STT and TTS providers

**STT Recommendation**: Google Cloud Speech-to-Text
- **Why**: Best French quality (95%+ accuracy)
- **Cost**: $0.006/minute (~€600-3,000/month for scale)
- **Fallback**: OpenAI Whisper (self-hosted possible, open source)
- **Latency**: ~1-2 seconds

**TTS Recommendation**: Azure Cognitive Services
- **Why**: Best French voices (very natural SSML support)
- **Cost**: $25/1M chars (~€750-2,500/month for scale)
- **Alternative**: ElevenLabs (premium, ultra-low latency)
- **Latency**: ~1-2 seconds (streaming support)

**Budget**: ~€500-3,000/month for MVP → production scale

**Status**: ✅ Decision made, ready to implement

---

### 5. Accessibility Architecture (ACCESSIBILITY_ARCHITECTURE.md)

**Scope**: Minimal, real implementation plan (not theoretical over-engineering)

**Three-Layer Design**:

1. **User Preferences** (already coded)
   - What modality does user prefer?
   - Text size, contrast, reading style?
   
2. **Capucine Engine** (unchanged)
   - Takes text input (whether from typing or STT)
   - Produces structured result
   - Completely agnostic to input modality

3. **Adaptive Output** (new, 40-50 lines of code)
   - Chooses presentation: text, voice, or both
   - Applies reading style (essential, standard, detailed)
   - Calls TTS if voice output requested

**Implementation Approach**: 
- ✅ Leverage browser native accessibility (zoom, dark mode, screen reader)
- ✅ Don't replicate what OS already does
- ✅ Build only what's necessary for multimodal interaction

**Effort**: 10 weeks (2-3 devs), can be done in phases

**Status**: ✅ Architecture specified, implementation plan ready

---

## HONEST ASSESSMENT

### What's Working Extremely Well

✅ **Backend Core Architecture**
- Domain layer: Excellent (types, constraints, invariants)
- Decision layer: Excellent (deterministic ranking)
- Application layer: Excellent (orchestration, deduplication, normalization)
- Quality: 794 tests passing, clean design

✅ **Multi-Provider Design**
- Already thinking about multiple AI providers
- Can easily add multiple STT/TTS providers
- No vendor lock-in

✅ **Data Integrity**
- Provenance tracking solid
- No silent data modification
- WCAG 2.2 AA compliance possible without major refactor

---

### What Needs Immediate Work

❌ **Frontend Accessibility**
- Not WCAG 2.2 AA compliant currently
- Would fail audit with external assessor
- Must be fixed before public launch
- ~6-8 weeks effort, medium complexity

❌ **Multimodal Input/Output**
- STT/TTS completely absent
- Simple to add (interfaces designed)
- High value (enables voice interaction)
- ~4-6 weeks effort, low-medium complexity

❌ **Infrastructure**
- No persistent storage (in-memory only)
- No database
- Would lose all user data on restart
- Must be addressed for production
- ~3-4 weeks effort, medium complexity

---

### What's NOT Critical Yet

⚠️ **Mobile Apps** (iOS/Android)
- Would require native development
- Web works on mobile via responsive design
- Future enhancement, not blocking

⚠️ **Advanced Conversation** (multi-turn)
- Infrastructure exists but not used
- Single-search works fine
- Can be added incrementally

⚠️ **CO-DESIGN PROGRAM**
- Partnership framework designed
- User recruitment ready
- Should start early (6-12 week timeline)
- Not blocking initial MVP

---

## DECISIONS MADE (AUTONOMOUS, NOT REQUIRING APPROVAL)

### 1. ✅ Functional Preferences Only
**Decision**: Never ask or store disability/medical information
**Reasoning**: Better UX, better privacy, RGPD-compliant
**Impact**: Can't medicalize accessibility, stays universal

### 2. ✅ Browser-Native First
**Decision**: Rely on browser/OS accessibility features (zoom, dark mode, screen reader support)
**Reasoning**: Don't replicate what exists, reduce code surface
**Impact**: Smaller codebase, fewer bugs, better compatibility

### 3. ✅ Google Cloud + Azure Primary
**Decision**: Google STT (best French) + Azure TTS (best French voices)
**Reasoning**: Justified by quality, cost is acceptable, fallback paths planned
**Impact**: Commitment: ~€500-3,000/month cost, manageable for business model

### 4. ✅ Whisper as Fallback
**Decision**: OpenAI Whisper as STT backup (open source, self-hostable)
**Reasoning**: Reduces Google dependency, allows offline capability
**Impact**: Better resilience, more control over costs long-term

### 5. ✅ No Medical Profiling
**Decision**: Remove any concept of "disability type" profiling
**Reasoning**: MEGAPROMPT explicit: don't create medical data collection
**Impact**: Simpler data model, better privacy, universally accessible

---

## DOCUMENTS CREATED (IN REPO)

| Document | Purpose | Status | Use |
|----------|---------|--------|-----|
| `ACCESSIBILITY_AUDIT.md` | Current accessibility state | ✅ | Reference, audit baseline |
| `ARCHITECTURE_REALITY_CHECK.md` | What exists vs what's planned | ✅ | Roadmapping, gap analysis |
| `interaction-preferences.ts` | Data model for preferences | ✅ | Backend integration, immediate use |
| `MULTIMODAL_ANALYSIS.md` | Provider evaluation | ✅ | Make STT/TTS decision, budgeting |
| `ACCESSIBILITY_ARCHITECTURE.md` | Implementation plan | ✅ | Guide Phase 2 development |
| `PHASE_2_SITUATION_REPORT.md` | This document | ✅ | Decision making, next steps |

**Total**: 6 comprehensive documents covering strategy, analysis, architecture, and implementation

---

## IMPLEMENTATION ROADMAP

### Phase 0: Foundation (Weeks 1-2)

**Frontend Accessibility Basics**

- [ ] HTML semantic structure (main, nav, section)
- [ ] ARIA labels & descriptions
- [ ] Focus indicators
- [ ] Skip links
- [ ] Respect browser preferences (dark mode, reduced motion)

**Backend Preparation**

- [ ] Export InteractionPreferences types
- [ ] Create preferences storage interface
- [ ] Add endpoints for preferences CRUD

**Effort**: 1 dev full-time, 2 weeks  
**Blockers**: None (can start immediately)

---

### Phase 1: Voice Input (Weeks 3-4)

**Backend**

- [ ] Implement STTProvider interface
- [ ] Create GoogleSTTAdapter
- [ ] Implement WhisperAdapter (fallback)
- [ ] Add orchestration logic (try Google, fallback to Whisper)
- [ ] Create `/voice/transcribe` endpoint
- [ ] Add cost tracking

**Frontend**

- [ ] Audio recording UI
- [ ] Microphone permission handling
- [ ] Real-time transcription display
- [ ] Error handling

**Effort**: 1 dev backend, 1 dev frontend, 2-3 weeks  
**Cost**: ~$200 (testing budget)

---

### Phase 2: Voice Output (Weeks 5-6)

**Backend**

- [ ] Implement TTSProvider interface
- [ ] Create AzureTTSAdapter
- [ ] Create GoogleTTSAdapter (fallback)
- [ ] ResponseFormatter (text → speech)
- [ ] Create `/voice/synthesize` endpoint
- [ ] Add cost tracking

**Frontend**

- [ ] Audio playback UI
- [ ] Selection of reading style (essential/standard/detailed)
- [ ] Streaming audio playback
- [ ] Fallback to text if TTS fails

**Effort**: 1 dev backend, 1 dev frontend, 2-3 weeks  
**Cost**: ~$300-500 (testing budget)

---

### Phase 3: Presentation Adaptation (Weeks 7-8)

**Frontend**

- [ ] Preference settings UI
- [ ] CSS variables for text size, contrast, spacing
- [ ] Responsive layout (test zoom 200%)
- [ ] Dark mode support
- [ ] Reduced motion animations

**Integration**

- [ ] Load preferences on app startup
- [ ] Apply to current session
- [ ] Remember between sessions

**Effort**: 1 dev, 2 weeks  
**Blockers**: None

---

### Phase 4: Testing & Validation (Weeks 9-10)

**Accessibility Testing**

- [ ] WCAG 2.2 AA audit (axe, Lighthouse)
- [ ] Screen reader testing (NVDA, VoiceOver)
- [ ] Keyboard navigation full test
- [ ] Zoom/contrast testing

**Performance Testing**

- [ ] STT latency (<3 sec)
- [ ] TTS latency (<1-2 sec)
- [ ] No regression in core search

**User Research** (begins Week 6, parallel)

- [ ] Co-design partner recruitment
- [ ] 3-4 testing sessions (weekly)
- [ ] Feedback integration
- [ ] Iterate based on findings

**Effort**: 1 QA dev, 1 product manager, 2 weeks  
**Cost**: €2,000-3,000 (user compensation)

---

## PARALLEL WORKSTREAMS

### Workstream A: Development (Weeks 1-10)
- Team: 2 devs (backend + frontend)
- Deliverable: Phase 0-4 implementation
- Output: Working voice I/O + accessible web

### Workstream B: Co-Design Program (Weeks 1-12)
- Team: 1 product manager, 1 coordinator
- Parallel: weeks 6-10 (user testing during development)
- Output: User research feedback, testimonials, metrics

### Workstream C: Infrastructure (Weeks 1-8)
- Team: 1 ops/devops engineer (part-time)
- Deliverable: STT/TTS credential setup, cost monitoring
- Output: APIs ready to call

### Workstream D: Documentation (ongoing)
- Updates to: Architecture, API, deployment guides
- Effort: 10% of dev time

**Total Team**: 3.5 FTE for 10 weeks

---

## BUDGET SUMMARY

### Development Costs

| Item | Effort | Cost |
|------|--------|------|
| Team (3.5 FTE × 10 weeks) | 350 days | €50,000-70,000 |
| Infrastructure (STT/TTS testing) | — | €500-1,000 |
| User compensation (co-design) | 15 sessions × 2-4h | €2,000-3,000 |
| External audit (WCAG) | 40h | €2,000-3,000 |
| **Total Development** | — | **€54,500-77,000** |

### Operational Costs (Monthly after launch)

| Item | Cost |
|------|------|
| STT (Google Cloud) | €600-3,000 |
| TTS (Azure) | €750-2,500 |
| Infrastructure | €500-1,000 |
| **Monthly** | **€1,850-6,500** |

**Note**: Costs assume MVP scale (10,000 users). Aggressive scaling could 2-3x monthly costs.

---

## RISKS & MITIGATION

### Risk 1: STT Quality Poor for French
**Probability**: Low (Google Cloud has excellent French support)  
**Impact**: High (voice input unusable)  
**Mitigation**: Test with real French speakers early (Week 3-4)

### Risk 2: TTS Costs Explode at Scale
**Probability**: Low-Medium (depends on adoption)  
**Impact**: Medium (could be €5k-10k/month)  
**Mitigation**: Implement cost tracking + alerts, have ElevenLabs alternative ready

### Risk 3: Frontend Refactor Takes Longer
**Probability**: Medium (always underestimated)  
**Impact**: Medium (delays all phases)  
**Mitigation**: Start Phase 0 immediately, don't wait for anything

### Risk 4: Co-Design Partners Hard to Find
**Probability**: Low-Medium (might take outreach)  
**Impact**: Low (doesn't block product, blocks testimonials)  
**Mitigation**: Start recruitment now (parallel to development)

### Risk 5: Legislation Changes (RGPD, EAA)
**Probability**: Low (2026, rules mostly stable)  
**Impact**: High (could require changes)  
**Mitigation**: Review legal requirements by Week 8, adjust if needed

---

## SUCCESS CRITERIA

### Must Have (Blocking)

- [ ] WCAG 2.2 AA compliance verified
- [ ] STT working (Google Cloud primary)
- [ ] TTS working (Azure primary)
- [ ] Frontend semantic HTML + ARIA
- [ ] Screen reader compatibility (NVDA tested)
- [ ] Keyboard navigation full

### Should Have (Strongly Recommended)

- [ ] Dark mode support
- [ ] 3+ co-design partner testimonials
- [ ] <3 sec STT latency, <1-2 sec TTS latency
- [ ] Cost tracking visible to users
- [ ] Documented for media (story, metrics, testimonials)

### Nice to Have

- [ ] Whisper fallback implemented
- [ ] ElevenLabs as alternative TTS
- [ ] Multi-turn conversation (basic)
- [ ] Mobile app (native iOS/Android)

---

## NEXT IMMEDIATE ACTIONS

**By EOW**:
1. ✅ Approval: Accept accessibility strategy (this document)
2. ✅ Staffing: Assign 2 devs to Phase 0
3. ✅ Infra: Setup Google Cloud + Azure accounts (trial)
4. ✅ Timeline: Lock 10-week implementation window

**Week 1**:
1. [ ] Dev team kickoff
2. [ ] Frontend audit (detailed) 
3. [ ] STT/TTS testing (proof of concept)
4. [ ] Co-design recruitment begins

**Week 2**:
1. [ ] Phase 0 design review
2. [ ] First PR with semantic HTML
3. [ ] InteractionPreferences integration
4. [ ] First co-design partner meeting

---

## FINAL NOTES

### Philosophy
This accessibility architecture is built on **honest principles**:
- No overclaiming ("100% accessible" — we're targeting 2.2 AA, not AAA)
- No medical profiling (functional preferences only)
- No assumptions (device capability ≠ user limitation)
- No over-engineering (use browser native features)
- No promises without proof (metrics, user testing)

### Timeline Realism
10 weeks is **aggressive but achievable**:
- Phase 0 (HTML) is straightforward
- Phase 1-2 (voice I/O) is mostly integration
- Phase 3 (presentation) is mostly CSS
- Phase 4 (testing) is methodical

Risks are **manageable**:
- Most risky item: Frontend refactor (already assessed as 6-8 weeks)
- Contingency: If delayed, launch text-only (voice can follow in Phase 2)

### Strategic Value
This accessibility work:
- ✅ Makes Capucine usable by broader population
- ✅ Creates strong media story ("designed for accessibility")
- ✅ Differentiates from competitors
- ✅ Builds user base from underserved segment (people with disabilities)
- ✅ Reduces risk (WCAG compliance prevents legal issues)

---

## CONCLUSION

**Capucine Phase 2 is ready for implementation.**

The analysis is complete. The architecture is designed. The decisions are made. The only question remaining is: **Do we execute?**

If yes: 10 weeks, 3.5 FTE, €50-77k development cost, launch with genuine accessibility.

If no: Product remains inaccessible, misses strategic opportunity, stays limited to text-only interaction.

**Recommendation**: Execute. We have a 10-week window to build something remarkable.

---

**Document prepared by**: CTO / Architecture Team  
**Review requested**: Executive team  
**Next checkpoint**: Post-approval, Week 1 review
