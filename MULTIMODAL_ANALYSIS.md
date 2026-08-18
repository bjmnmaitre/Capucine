# MULTIMODAL ARCHITECTURE ANALYSIS
## Speech-to-Text & Text-to-Speech for Capucine

**Date**: 18 Août 2026  
**Scope**: Evaluation des fournisseurs STT/TTS actuels  
**Objectif**: Déterminer l'architecture multimodale optimale pour Capucine  
**Méthodologie**: Comparaison fournisseurs (coût, qualité, latence, français, offline)

---

## EXECUTIVE SUMMARY

### Recommandation
Pour une implémentation d'accessibilité universelle, **stratégie multi-provider** :

1. **STT Primary**: Google Cloud Speech-to-Text
   - Meilleure qualité français (modèles spécialisés)
   - API REST stable
   - Support multi-formats audio

2. **STT Fallback**: OpenAI Whisper (self-hosted)
   - Open source, contrôle total
   - Offline capable (si compute local)
   - Qualité acceptable mais moins bonne pour français

3. **TTS Primary**: Azure Cognitive Services
   - Voix française naturelle + expressives
   - SSML support avancé
   - Pricing raisonnable

4. **TTS Fallback**: Google Cloud Text-to-Speech
   - Alternative fiable
   - Voix WaveNet haute qualité

### Budget Estimé (Production Year 1)
- STT: $3,000-5,000/mois (usage moyen)
- TTS: $2,000-3,500/mois (usage moyen)
- **Total**: ~$5,000-8,500/mois (~€4,500-7,500/mois)

### Timeline Implémentation
- **Phase 0 (Prototype)**: 2-3 semaines (POC avec Google Cloud)
- **Phase 1 (Alpha)**: 4-6 semaines (intégration complète Capucine)
- **Phase 2 (Beta)**: 2-3 semaines (fallbacks + testing)

---

## DETAILED PROVIDER ANALYSIS

### 1. SPEECH-TO-TEXT (STT)

#### Option A: Google Cloud Speech-to-Text ⭐⭐⭐⭐⭐

**URL**: https://cloud.google.com/speech-to-text

**Spécifications Techniques**:
- Langues supportées: 125+ (français compris)
- Modèles: `default`, `phone_call`, `latest_long`, `medical`, `numbers`
- Formats: WAV, FLAC, ULAW, MP3, OGG Opus, MULAW
- Tailles max: Streaming (5h), fichiers (15 sec/call ou streaming illimité)
- Latence: ~1-2 sec (streaming), <5 sec (fichier)
- Accuracy: 95%+ pour français clair
- Webhook support: Oui (pour long-audio)

**Pricing** (Août 2026):
- Premiers 60 minutes: Gratuit/mois
- Après 60 min: $0.006/minute (augmente avec volume)
- Streaming: $0.009/minute
- Bulk: ~$4,000/mois pour 1M de minutes

**Avantages** ✅
- Meilleure reconnaissance français de l'industrie
- Support POÉSIE (séparation haut-parleurs)
- Contextes (vocabulaire spécialisé: "écoutilles", "domotique", etc.)
- Confidence scores par mot
- Gestion bruit multimédia

**Inconvénients** ❌
- Dépendance Google Cloud
- Latence réseau (cloud-only)
- Coûts à l'usage (peut être élevé pour heavy use)
- Pas de modèle français spécialisé (default suffit bien)

**Compatibilité Capucine** ✅
- REST API facile à intégrer
- Multi-fournisseurs: ✅ (peut être primary provider)
- Fallback: ✅ (Whisper serait bon fallback)
- Architecture: ✅ (simple STTProvider adapter)

**Coût Estimé pour Capucine**:
- 10,000 utilisateurs actifs
- 50 searches/mois par utilisateur = 500k searches
- Moyenne 30 sec de voice/search = 250k minutes
- Coût: ~250k * $0.006 = **$1,500/mois**
- Avec pic: $3,000-5,000/mois possible

---

#### Option B: Azure Cognitive Services - Speech-to-Text ⭐⭐⭐⭐

**URL**: https://azure.microsoft.com/en-us/services/cognitive-services/speech-to-text/

**Spécifications Techniques**:
- Langues: 90+ (français inclus)
- Modèles: `base`, `conversational`, `meeting`, `dictation`
- Formats: PCM, WAV, OGG, MP3, FLAC, ALAW, MULAW
- Tailles max: 600 secondes/call en streaming
- Latence: ~1-2 sec (streaming), <5 sec (batch)
- Accuracy: ~94% français
- Language Understanding (LUIS): Optionnel, peut intégrer NLU

**Pricing** (Août 2026):
- Free tier: 5,000 API calls/mois
- Ensuite: $0.008/minute audio (Speech recognition)
- Bulk: $4,000-6,000/mois pour 1M minutes

**Avantages** ✅
- Intégration LUIS (NLU) possible
- Modèles conversationnels bons
- Markdown support pour output
- Phrase hints (comme Google)
- SSML input support

**Inconvénients** ❌
- Qualité français légèrement inférieure à Google
- Support haut-parleurs POÉSIE moins avancé
- Même dépendance cloud

**Compatibilité Capucine** ✅
- Intégration facile
- Good fallback option
- LUIS could enhance NLU layer (future)

**Coût Estimé**: ~$1,500-3,000/mois (similaire Google)

---

#### Option C: OpenAI Whisper ⭐⭐⭐⭐

**URL**: https://openai.com/research/whisper | GitHub: openai/whisper

**Spécifications Techniques**:
- Langues: 99+ (français inclus)
- Modèles: `tiny`, `base`, `small`, `medium`, `large`
- Accuracy (français): ~90-93% (légèrement moins que Google)
- Model size: 39M - 1.5B parameters
- Format support: MP3, MP4, MPEG, MPGA, M4A, WAV, WEBM

**Modes d'utilisation**:

A) **Whisper API** (cloud):
- $0.006/minute (identique Google Cloud)
- Latency: ~2-3 sec
- Cloud-hosted, zero setup

B) **Whisper Local** (self-hosted):
- Téléchargement model: gratuit (39M-1.5B)
- Compute requis: CPU capable (ou GPU)
- Pour 10k users, need: 4-8 vCPUs + 8GB RAM
- Monthly infrastructure: ~$200-500/mois (EC2/GCP instances)
- Latency: 1-3 sec (dépend de hardware)

**Avantages** ✅
- **Open source** — contrôle total
- **Offline capable** — auto-hosted
- **Pas de vendor lock-in**
- **Coûts prévisibles** si self-hosted
- **Multilingual** — un seul modèle pour toutes les langues
- **Qualité acceptable** pour français

**Inconvénients** ❌
- Qualité français légèrement inférieure
- Infrastructure required for self-hosting
- Opérational burden
- Setup + maintenance requis

**Compatibilité Capucine** ✅✅
- Perfect pour fallback
- Self-hosted option = zero cloud dependency
- Multi-provider: ✅ (excellent secondary option)

**Coût Estimé**:
- Via API: $1,500/mois (même Google)
- Via self-hosted: $200-500/mois (infrastructure) + $0 (software)

---

#### Option D: Autres Fournisseurs

**Amazon AWS Transcribe**:
- Pricing: $0.024/minute (3x plus cher)
- Qualité: bonne mais pas meilleure
- **Non recommandé**

**Speechmatics**:
- Pricing: $0.0032/minute (50% moins cher)
- Qualité français: comparable Google
- Support: bon pour contextes spécialisés
- **Alternative sérieuse** mais moins mature que Google/Azure

**IBM Watson Speech-to-Text**:
- Pricing: variable
- Qualité: bonne
- Adoption: baissante
- **Non recommandé** (legacy)

---

### 2. TEXT-TO-SPEECH (TTS)

#### Option A: Azure Cognitive Services - Text-to-Speech ⭐⭐⭐⭐⭐

**URL**: https://azure.microsoft.com/en-us/services/cognitive-services/text-to-speech/

**Spécifications Techniques**:

Voix françaises disponibles:
- `fr-FR-DeniseNeural` — Féminin, naturel, conversationnel
- `fr-FR-HenriNeural` — Masculin, naturel
- `fr-FR-VivienneMultilingualNeural` — Multilingue, flexible
- `fr-CA-SylvieNeural` — Français canadien
- `fr-CA-JeanNeural` — Français canadien

Formats: MP3, WAV, OGG, FLAC, PCM (raw)
Bitrates: 8kHz - 48kHz
SSML: Support complet (pitch, rate, volume, pause, sub, lang, etc.)
Expressivité: Oui (joie, tristesse, colère, surprise - style tags)
Streaming: Oui (latency: <1 sec pour premiers caractères)

**Pricing** (Août 2026):
- Free: 5,000 caractères/mois
- Ensuite: $6-16/million de caractères (dépend format)
- Standard (MP3): $15/1M caractères
- Neural: $25-40/1M caractères
- Streaming: $25-40/1M caractères

**Avantages** ✅
- Meilleures voix françaises du marché (très naturelles)
- SSML complet (+ stylisation des émotions)
- Streaming = latency faible
- Marque française très bien supportée
- Support parlé de ponctuation

**Inconvénients** ❌
- Coût un peu élevé (mais justifié par qualité)
- Dépendance Microsoft/Azure

**Compatibilité Capucine** ✅
- Parfait pour output principal
- Qualité voix = accessibilité améliorée

**Coût Estimé**:
- 10k users
- 30 searches/mois par utilisateur = 300k recherches
- Moyenne 100 caractères de réponse TTS = 30M caractères
- Pricing: $30M * $25/1M = **$750/mois**
- Avec détails: $1,500-2,500/mois

---

#### Option B: Google Cloud Text-to-Speech ⭐⭐⭐⭐

**URL**: https://cloud.google.com/text-to-speech

**Spécifications Techniques**:

Voix françaises:
- `fr-FR-Neural2-A` — Féminin
- `fr-FR-Neural2-B` — Féminin (alternative)
- `fr-FR-Neural2-C` — Féminin (variation)
- `fr-FR-Neural2-D` — Masculin
- `fr-FR-Neural2-E` — Masculin (alternative)

WaveNet: Oui (ultra-naturel)
Streaming: Non (full synthesis required)
SSML: Support partiel
Langues: 50+ (mais français bon)

**Pricing** (Août 2026):
- Free: 1M characters/mois
- Ensuite: $16/1M caractères (WaveNet: $25/1M)

**Avantages** ✅
- Coût identique Azure
- Qualité WaveNet comparable
- Fiabilité Google

**Inconvénients** ❌
- Pas de streaming = latency plus haute (~2-3 sec)
- Pas de support SSML complet
- Pas de stylisation émotions

**Compatibilité Capucine** ✅
- Fallback option good
- Moins premium que Azure

**Coût Estimé**: ~$750-1,500/mois (similaire Azure)

---

#### Option C: ElevenLabs (Premium, Startup-focused) ⭐⭐⭐⭐⭐

**URL**: https://elevenlabs.io/

**Spécifications Techniques** (Août 2026):
- Voix: 30+ prédéfinis, possibilité voice cloning
- Langues: 15+ (français inclus, qualité bonne)
- Formats: MP3, µ-law (telephony), PCM
- Streaming: Oui (super low latency)
- Accent control: Oui
- Dubbing API: Oui (audio file translation)
- Models: Standard, Multilingual, Turbo

**Pricing** (Août 2026):
- Free: 10,000 caractères/mois
- Starter: $11/mois → 100k chars
- Professional: $99/mois → 1M chars (meilleure valeur)
- Business: Custom pricing

**Avantages** ✅
- **Meilleure qualité voix** (subjective mais widely praised)
- **Streaming** = latency ultra-faible (<500ms)
- **Pricing prédictible** (pas à l'usage)
- **Startup-friendly** (crédits de démarrage)
- **Voice cloning** (créer voix "maison")
- **Dubbing** (video voice-over)

**Inconvénients** ❌
- Jeune entreprise (risk de viabilité)
- Pas de français "régional"
- Support français moins mature que Azure/Google

**Compatibilité Capucine** ✅✅
- **Recommended for premium experience**
- Streaming = meilleure UX
- Pricing = prédictible (charge forfaitaire)
- Peut être primary si budget permet

**Coût Estimé**:
- Professional tier: $99/mois (1M chars)
- Pour 30M chars usage: need to upgrade
- Business tier: ~$500-1,000/mois estimé

---

#### Option D: Amazon Polly ⭐⭐⭐

**URL**: https://aws.amazon.com/polly/

**Spécifications Techniques**:
- Voix: 100+ (plusieurs français)
- Formats: MP3, JSON, OggVorbis, PCM
- SSML: Support bon
- Pricing: $0.004/sec (ou $3.50/1M chars)

**Avantages** ✅
- Mature et stable
- Bon SSML support

**Inconvénients** ❌
- Qualité inférieure aux concurrents modernes
- Coût élevé
- **Non recommandé** (legacy player)

---

### 3. ARCHITECTURE MULTIMODALE RECOMMANDÉE

#### Provider Stack

```
┌─────────────────────────────────────┐
│  USER INPUT (voice or text)         │
└──────────────┬──────────────────────┘
               │
       ┌───────▼────────┐
       │ Is Voice Input?│
       └───────┬────────┘
       Yes: STT Service
       ├─ Primary: Google Cloud Speech-to-Text
       │  (95%+ reliability, best français)
       │
       └─ Fallback: Whisper Local
          (self-hosted, offline capable)

┌──────────────────────────────────────┐
│  CAPUCINE ENGINE (core logic)        │
│  (identical for voice or text input) │
└──────────────┬───────────────────────┘
               │
       ┌───────▼──────────┐
       │ Output Modality? │
       └───────┬──────────┘
       
       Text: Render to screen
       Voice: TTS Service
       ├─ Primary: Azure Cognitive Services
       │  (best French voices, SSML, streaming)
       │
       ├─ Alternative: ElevenLabs
       │  (if budget + ultra-low latency needed)
       │
       └─ Fallback: Google Cloud TTS
          (reliable, good quality)

┌─────────────────────────────────────┐
│  OUTPUT (text on screen + voice)    │
└─────────────────────────────────────┘
```

---

### 4. IMPLEMENTATION ARCHITECTURE

#### Layer 1: Provider Abstraction

```typescript
// src/application/stt-provider.ts
interface STTProvider {
  transcribe(audioData: Buffer, format: 'wav' | 'mp3'): Promise<TranscriptionResult>;
  streamingTranscribe(audioStream: Stream): AsyncGenerator<PartialTranscription>;
  isConfigured(): boolean;
}

// src/application/tts-provider.ts
interface TTSProvider {
  synthesize(text: string, options: TTSOptions): Promise<AudioBuffer>;
  synthesizeStream(text: string, options: TTSOptions): Stream;
  getAvailableVoices(language: string): Promise<Voice[]>;
  isConfigured(): boolean;
}
```

#### Layer 2: Concrete Implementations

```
src/application/
├── stt/
│   ├── google-stt.ts          (Google Cloud STT adapter)
│   ├── whisper-stt.ts         (OpenAI Whisper adapter)
│   └── stt-orchestrator.ts    (fallback logic)
├── tts/
│   ├── azure-tts.ts           (Azure TTS adapter)
│   ├── google-tts.ts          (Google Cloud TTS adapter)
│   ├── elevenlabs-tts.ts      (ElevenLabs adapter)
│   └── tts-orchestrator.ts    (fallback logic)
```

#### Layer 3: Integration with CapucineEngine

```
SearchRequest (voice)
  │
  ├─ STTOrchestrator.transcribe()
  │  └─ Try Google, fallback to Whisper
  │
  └─ InterpretedRequest (text)
     │
     └─ [CapucineEngine proceeds normally]
         │
         └─ SearchEngineResult
            │
            ├─ If voice output requested:
            │  └─ TTSOrchestrator.synthesize()
            │     └─ Try Azure, fallback to Google
            │
            └─ AudioBuffer + Metadata
```

---

## 5. COST PROJECTION (Year 1 Production)

### Scenario: 10,000 Active Users

#### Conservative Usage

- 20 searches/user/month = 200k searches/month
- Voice input: 30% adoption = 60k voice inputs
- Average: 20 sec audio = 20k minutes
- Voice output: 50% of searches = 100k searches
- Average: 150 chars response = 15M chars

**STT Costs**:
- Google Cloud: 20k min * $0.006 = $120/mois
- **Total STT**: $120/mois

**TTS Costs**:
- Azure Neural: 15M chars * $25/1M = $375/mois
- **Total TTS**: $375/mois

**Monthly Total**: ~$500/mois (~€450)
**Annual**: ~$6,000/an (~€5,400)

#### Aggressive Usage

- 50 searches/user/month = 500k searches
- Voice input: 60% adoption = 300k voice inputs
- Average: 30 sec audio = 150k minutes
- Voice output: 80% of searches = 400k searches
- Average: 200 chars = 80M chars

**STT Costs**:
- Google Cloud: 150k min * $0.006 = $900/mois

**TTS Costs**:
- Azure Neural: 80M chars * $25/1M = $2,000/mois

**Monthly Total**: ~$2,900/mois (~€2,600)
**Annual**: ~$35,000/an (~€31,500)

#### Recommendation

**Budget planning**: Reserve $2,000-3,000/month for production
- Covers most realistic scenarios
- Allows for growth
- Leaves room for premium TTS (ElevenLabs) if desired

---

## 6. MIGRATION STRATEGY

### Phase 1: Prototype (Weeks 1-2)

**Goal**: Validate STT/TTS integration concept

**Actions**:
1. Setup Google Cloud STT + Azure TTS trial accounts
2. Create STTProvider & TTSProvider interfaces
3. Implement GoogleSTTAdapter + AzureTTSAdapter
4. Build simple webapp testing STT → CapucineEngine → TTS
5. User test with 5-10 real users

**Cost**: ~$50 (trial credits)
**Output**: Proof of concept, integration complexity assessment

### Phase 2: Alpha Integration (Weeks 3-6)

**Goal**: Full integration with Capucine, basic fallback

**Actions**:
1. Integrate into CapucineEngine pipeline
2. Add STTOrchestrator (Google primary)
3. Integrate with InteractionPreferences
4. Add recording UI (frontend)
5. Add playback UI (frontend)
6. Unit + integration tests

**Cost**: ~$200-500 (alpha user testing)
**Output**: Alpha version with voice I/O

### Phase 3: Production Readiness (Weeks 7-9)

**Goal**: Fallback system, error handling, cost tracking

**Actions**:
1. Implement Whisper fallback for STT
2. Cost tracking + budget enforcement
3. Error recovery (network, quota limits)
4. User analytics (which provider used, latency)
5. Production infrastructure (monitoring, logging)

**Cost**: ~$500-1,000 (small production load)
**Output**: Production-ready voice layer

---

## 7. DECISION MATRIX

### For MVP (Minimal Viable Product)

| Requirement | Google STT | Azure TTS |
|-------------|-----------|-----------|
| French quality | ✅✅✅ | ✅✅✅ |
| Cost | ✅✅ (good) | ✅✅ (good) |
| Streaming | ✅ | ⚠️ (async) |
| Setup time | ✅ (2h) | ✅ (2h) |
| TOTAL | ✅✅✅ RECOMMENDED | ✅✅✅ RECOMMENDED |

### For Premium (Best-in-class)

| Requirement | Google STT | Whisper Fallback | Azure TTS | ElevenLabs |
|-------------|-----------|------------------|-----------|-----------|
| French quality | ✅✅✅ | ✅✅ | ✅✅✅ | ✅✅✅ |
| Cost | ✅✅ | ✅✅✅ (free) | ✅ | ⚠️ ($500+) |
| Streaming latency | ✅ | ✅ | ⚠️ | ✅✅✅ |
| Voice options | ⚠️ (limited) | N/A | ✅✅ | ✅✅✅ |
| TOTAL | ✅✅✅ | ✅✅ | ✅✅✅ | ✅✅✅ |

---

## 8. FINAL RECOMMENDATION

### Immediate Action (This Quarter)

**Implement**:
1. **STT**: Google Cloud Speech-to-Text (primary)
2. **TTS**: Azure Cognitive Services Text-to-Speech (primary)
3. **Cost**: ~€500-1,000/month for MVP phase

### 3-6 Months (Once Usage Patterns Clear)

**Consider adding**:
1. **STT Fallback**: Whisper (self-hosted or API)
   - Reduces Google cloud dependency
   - Better cost control at scale

2. **TTS Alternative**: ElevenLabs (if ultra-low latency needed)
   - Premium voice quality
   - Streaming support
   - Predictable costs

### 12+ Months (As Business Scales)

**Optimize for**:
1. Cost: Whisper self-hosted (if >500k requests/month)
2. Quality: ElevenLabs premium (if user satisfaction critical)
3. Reliability: Multi-region failover

---

## NEXT STEPS

1. ✅ **Decision**: Approved Google STT + Azure TTS for MVP
2. [ ] **Setup**: Create GCP/Azure accounts, get API keys
3. [ ] **Implementation**: Start Phase 1 (STT/TTS providers)
4. [ ] **Testing**: User validation with real voice I/O
5. [ ] **Monitoring**: Cost tracking + performance metrics

---

**Document prepared by**: CTO / Architecture  
**Next review**: After Phase 1 prototype completion
