# ACCESSIBILITY ARCHITECTURE — CAPUCINE
## Minimal Real Architecture (Not Theoretical)

**Date**: 18 Août 2026  
**Principle**: Build only what's necessary. Leverage browser/OS native features. No over-engineering.  
**Scope**: Foundation architecture for accessible Capucine  
**Status**: Design phase (ready for implementation)

---

## EXECUTIVE SUMMARY

### What We're Building

An **accessible layer** on top of Capucine that:
1. **Doesn't ask medical questions** ("What's your disability?")
2. **Asks for functional preferences** ("I prefer voice" or "Make text bigger")
3. **Respects browser/OS native accessibility** (VoiceOver, TalkBack, zoom, etc.)
4. **Adds only what's necessary** to enable multimodal interaction

### What We're NOT Building

- ❌ Custom screen reader (browsers have VoiceOver, TalkBack, NVDA)
- ❌ Custom zoom (browsers have zoom)
- ❌ Custom high-contrast mode (browsers + OS have this)
- ❌ Medical profile system
- ❌ Proprietary motion reduction (browser: `prefers-reduced-motion`)

### Architecture in 3 Layers

```
┌──────────────────────────────────┐
│ User Interaction Preferences     │  ← User says "I prefer voice"
│ (InteractionPreferences)         │    Not: "I am deaf"
└────────────┬─────────────────────┘
             │
┌────────────▼─────────────────────┐
│ Capucine Engine                  │  ← Core business logic
│ (unchanged)                      │    Produces results
└────────────┬─────────────────────┘
             │
┌────────────▼──────────────────────────┐
│ Adaptive Output Layer                │  ← Chooses modality:
│ (determines response format)          │    Text? Voice? Both?
└────────────┬──────────────────────────┘
             │
      ┌──────┴──────┐
      │             │
   Text         Voice (TTS)
 (HTML) or     (Audio File)
```

---

## LAYER 1: USER PREFERENCES

**Already Designed**: See `src/application/interaction-preferences.ts`

### Key Decisions

✅ **Functional Only**: "I prefer voice" (not "I'm deaf")  
✅ **Session-Level**: User can override per-search  
✅ **RGPD-Friendly**: Explicit consent, data deletion, retention period  
✅ **Device-Aware**: Detects capabilities (microphone? speakers?)  
✅ **No Assumptions**: Empty microphone = missing hardware, not limitation  

### Data Model

```typescript
interface InteractionPreferences {
  inputModality: 'text' | 'voice' | 'hybrid';
  outputModality: 'text' | 'voice' | 'hybrid';
  textPresentation: { textSizeMultiplier, highContrast, ... };
  voiceSettings: { speechRate, voiceVariant, ... };
  userConsent: boolean;  // RGPD
}
```

---

## LAYER 2: CAPUCINE ENGINE

**No Changes Required**

The core Capucine engine already:
- Takes structured input (text from interpretation, or same via voice)
- Produces structured SearchEngineResult
- Is completely modality-agnostic

**Key Point**: Capucine doesn't know if input came from typing or voice. It doesn't care.

---

## LAYER 3: ADAPTIVE OUTPUT LAYER

### What It Does

Based on user's `EffectiveInteractionPreferences`, chooses HOW to present results.

### Three Presentation Modes

#### Mode 1: Text Output (Default)

```
User preference: text output

Result display:
┌─────────────────────────────────────┐
│ Top Result: Nike Air Max            │
│ Price: €129.99                      │
│ Delivery: Free, 2 days              │
│ Rating: 4.2/5 (2,341 reviews)       │
└─────────────────────────────────────┘

Accessibility Features:
✅ HTML semantic (h1, h2, p, button)
✅ ARIA labels (aria-label, aria-describedby)
✅ Focus indicators (outline, box-shadow)
✅ Keyboard navigation (tab order)
✅ Screen reader compatible
✅ Respects browser zoom
✅ High contrast option (CSS media query)
```

**Implementation**: Use semantic HTML + CSS, browser does the rest.

#### Mode 2: Voice Output (TTS)

```
User preference: voice output

Process:
1. CapucineEngine produces result
2. ResultFormatter applies voice reading style
   (essential vs standard vs detailed)
3. ResultToSpeech adapts text for speech:
   - Removes visual formatting
   - Expands abbreviations ("€" → "euros")
   - Adds pauses
4. TTS provider synthesizes audio
5. Audio streamed to user

Example (essential style):
Input:  SearchEngineResult with 3 ranked offers
Voice:  "I found three options under 150 euros.
         The best is Nike Air Max at 129.99 euros
         with free delivery, arriving in 2 days.
         Say yes to continue, or next for other options."
```

**Architecture**:

```typescript
// src/application/response-formatter.ts
interface ResponseFormatter {
  // Returns text optimized for the presentation mode
  formatForText(result: SearchEngineResult, style: ReadingStyle): string;
  formatForVoice(result: SearchEngineResult, style: ReadingStyle): string;
  formatForScreen(result: SearchEngineResult, style: ReadingStyle): HTMLString;
}
```

#### Mode 3: Hybrid (Text + Voice)

```
User preference: hybrid (text AND voice)

Display:
┌──────────────────────────────┐
│ [🔊 Tap to hear this result] │  ← Click to hear via TTS
│                              │
│ Top Result: Nike Air Max     │
│ Price: €129.99               │
│ ...                          │
└──────────────────────────────┘

Interaction:
- User reads text (visual)
- User can tap [🔊] to hear voice summary
- If reading on phone: voice can be primary
- If on desktop: text is primary, voice is supplement
```

---

## LAYER 3B: INPUT HANDLING (VOICE)

### When User Speaks

```
User says: "Find me black Nike shoes under 100 euros"

Process:
1. STT Provider (Google Cloud) transcribes
   → "find me black Nike shoes under 100 euros"
2. Transcription sent to CapucineEngine
   (exactly same as typed input)
3. Engine produces result
4. Result formatted based on outputModality preference
```

**Key Point**: STT → Text → Engine is clean separation.

### Fallbacks Built-In

```
STT Flow:
1. Try: Google Cloud Speech-to-Text
   ├─ Success → Use result
   └─ Fail (quota, network, auth)
2. Try: Whisper (if available)
   ├─ Success → Use result
   └─ Fail
3. Error: "Couldn't process voice input. Try typing instead?"
```

---

## LAYER 3C: PRESENTATION ADAPTATION

### CSS-Based Adaptations

The frontend should support:

```css
/* User selected: Large text (1.5x) */
body.prefs-text-size-large {
  --base-font-size: 1.5rem;
  font-size: var(--base-font-size);
}

/* User selected: High contrast */
body.prefs-high-contrast {
  --text-color: #000;
  --bg-color: #fff;
  --button-color: #000;
  --link-color: #0000ff;
  /* all colors flipped for contrast */
}

/* Browser user selected: Reduced motion */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### What Browser Already Handles

| Feature | Browser | Capucine |
|---------|---------|----------|
| Zoom (200%) | ✅ Native | Use `rem` units |
| High contrast | ✅ Native | Respond with CSS |
| Large text | ✅ Native | Use `rem` units |
| Dark mode | ✅ Native | Support `prefers-color-scheme` |
| Screen reader | ✅ Native | Use semantic HTML + ARIA |
| Reduced motion | ✅ Native | Respond with `prefers-reduced-motion` |
| Keyboard nav | ✅ Native | Make everything focusable |

**Capucine responsibility**: Respond to these, don't replicate.

---

## IMPLEMENTATION CHECKLIST

### Phase 0: Foundation (Weeks 1-2)

Frontend:
- [ ] Convert HTML to semantic (`<main>`, `<nav>`, `<section>`)
- [ ] Add ARIA labels (aria-label, aria-describedby, role)
- [ ] Add focus indicators (`:focus-visible`)
- [ ] Add skip link
- [ ] Respect `prefers-reduced-motion`
- [ ] Support `prefers-color-scheme: dark`

Backend:
- [ ] Export InteractionPreferences types
- [ ] Create profile storage adapter
- [ ] Add endpoint: `GET /user/preferences`
- [ ] Add endpoint: `POST /user/preferences`

### Phase 1: Multimodal Input (Weeks 3-4)

Backend:
- [ ] Implement STTProvider interface
- [ ] Create GoogleSTTAdapter
- [ ] Add fallback logic
- [ ] Endpoint: `POST /voice/transcribe`

Frontend:
- [ ] Add microphone recording UI
- [ ] Add "Play/Listen" button for TTS
- [ ] Validate STT output before sending to engine

### Phase 2: Multimodal Output (Weeks 5-6)

Backend:
- [ ] Implement TTSProvider interface
- [ ] Create AzureTTSAdapter
- [ ] Add ResponseFormatter
- [ ] Endpoint: `POST /voice/synthesize`

Frontend:
- [ ] Add audio playback UI
- [ ] Integrate with OutputModality preference
- [ ] Support hybrid (text + audio simultaneously)

### Phase 3: Presentation Adaptation (Weeks 7-8)

Frontend:
- [ ] Implement preference UI (settings page)
- [ ] Apply preference classes to body tag
- [ ] Responsive layout (text zoom up to 200%)
- [ ] Test with screen reader (NVDA)

### Phase 4: Testing & Validation (Weeks 9-10)

- [ ] User test with co-design partners
- [ ] WCAG 2.2 AA audit
- [ ] Screen reader testing (NVDA, VoiceOver)
- [ ] Keyboard navigation full test
- [ ] Performance testing (speech latency)

---

## WHAT NOT TO BUILD

### ❌ Don't Build

1. **Custom screen reader replacement**
   - VoiceOver (macOS/iOS), TalkBack (Android), NVDA (Windows) exist
   - We just make our HTML accessible TO them

2. **Custom zoom replacement**
   - Use `rem` units, not `px`
   - Let browser zoom handle scaling
   - Test at 200% zoom

3. **Custom color scheme**
   - Support browser's dark/light mode preference
   - User can already force high contrast via OS

4. **Custom gesture handling**
   - Mobile gesture navigation is OS-level
   - Just make buttons big (44×44pt minimum)

5. **Medical profile**
   - We never ask or store disability type
   - Only functional preferences ("voice input")

---

## ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│                        CAPUCINE SYSTEM                          │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                      ACCESSIBILITY LAYER                         │
│  (New — Weeks 1-10, integrated with core)                       │
└──────────────────────────────────────────────────────────────────┘

    User Input
    ↓ ↓ ↓
  Text Voice Touch (already supported)
    │   │   │
    └─┬─┴─┬─┘
      │   │
    [STT if voice]
      │
   ┌──▼───────────────────────────────────┐
   │  Query Text                          │
   └──┬───────────────────────────────────┘
      │
   ┌──▼──────────────────────────────────────────────────────┐
   │  CAPUCINE ENGINE (unchanged)                           │
   │  (interpretation → search → rank → explain)            │
   └──┬──────────────────────────────────────────────────────┘
      │
   ┌──▼──────────────────────────────────┐
   │  SearchEngineResult                  │
   └──┬────────────────────────────────────┘
      │
   ┌──▼──────────────────────────────────────────────────────────┐
   │  ADAPTIVE OUTPUT LAYER (new)                               │
   │  Chooses: Text? Voice? Both?                               │
   └──┬───────────┬──────────────┬────────────────────────────────┘
      │           │              │
   ┌──▼──┐     ┌──▼──┐        ┌──▼──┐
   │Text │ or  │Voice│ or    │Both │
   │     │     │(TTS)│       │     │
   └──┬──┘     └──┬──┘        └──┬──┘
      │           │              │
   HTML      AudioFile         Both
  + ARIA    + Metadata     (progressive)
      │           │              │
      └─────┬─────┴──────────────┘
            │
        User Output
   (screen / speakers)
```

---

## PRINCIPLES SUMMARY

### 1. FUNCTIONAL NOT MEDICAL
- Ask: "How do you prefer to interact?"
- Not: "What's your disability?"

### 2. BROWSER-NATIVE FIRST
- Use browser accessibility (zoom, dark mode, screen reader)
- Don't replicate what OS already does

### 3. PROGRESSIVE ENHANCEMENT
- Core works text-only
- Voice is enhancement, not replacement
- Hybrid is best-effort

### 4. NO ASSUMPTIONS
- Empty microphone = missing device, not user limitation
- Slow speech input = network, not user issue

### 5. RGPD COMPLIANCE
- Explicit consent for preference storage
- User can delete anytime
- No medical data

### 6. TESTABLE
- Every feature tested with real users
- Screen reader testing (NVDA, VoiceOver)
- Keyboard navigation only
- No assumptions about assistive tech

---

## NEXT STEPS

1. ✅ **Design complete** (this document)
2. [ ] **Review** with accessibility expert
3. [ ] **Implement Phase 0** (semantic HTML + ARIA)
4. [ ] **User test** with co-design partners
5. [ ] **Iterate** based on feedback

---

## METRICS FOR SUCCESS

### WCAG 2.2 AA Compliance
- [ ] 100% of pages: WCAG 2.2 AA
- [ ] Tested with: NVDA (Windows), VoiceOver (Mac)
- [ ] Keyboard navigation: fully operable without mouse

### User Research
- [ ] 5+ co-design sessions with accessibility partners
- [ ] 50%+ of participants: can complete search independently
- [ ] NPS > 8/10 for ease of use

### Performance
- [ ] STT latency: <3 sec (transcription complete)
- [ ] TTS latency: <1 sec (first audio chunk)
- [ ] No regression in core search performance

### Cost/Sustainability
- [ ] Monthly cost: <€1,000 (for MVP phase)
- [ ] Server resources: No additional hardware
- [ ] Maintenance: 1 dev part-time (ongoing)

---

**Document prepared by**: Architecture + Accessibility Analysis  
**Status**: Ready for implementation  
**Next review**: End of Phase 0 (2 weeks)
