# ARCHITECTURE REALITY CHECK
## Capucine — Écarts Architecture Prévue vs Implémentation Réelle

**Date**: 18 Août 2026  
**Scope**: Backend (src/)  
**Méthodologie**: Inspection du code + test suite execution  
**Conclusion**: L'architecture prévue est **largement implémentée**. Peu d'écarts majeurs.

---

## 1. RÉSUMÉ EXÉCUTIF

### État de Conformité

| Composant | Prévue | Réelle | Statut |
|-----------|--------|--------|--------|
| **Domaine Types** | ✅ Complet | ✅ Complet | ✓ Match |
| **AdmissibilityEngine** | ✅ Spécifié | ✅ Implémenté | ✓ Match |
| **ProfileEngine** | ✅ Spécifié | ✅ Implémenté | ✓ Match |
| **PriorityEngine** | ✅ Spécifié | ✅ Implémenté | ✓ Match |
| **CapucineEngine** | ✅ Spécifié | ✅ Implémenté | ✓ Match |
| **AIOrchestrator** | ✅ Spécifié | ⚠️ Partiellement | ⚠️ Écart |
| **MultimodalInput** | ✅ Spécifié | ❌ Manquant | ❌ Écart |
| **MultimodalOutput** | ✅ Spécifié | ❌ Manquant | ❌ Écart |
| **ConversationManager** | ✅ Spécifié | ⚠️ Basique | ⚠️ Écart |
| **UserProfileStorage** | ✅ Spécifié | ❌ Mock (in-memory) | ❌ Écart |
| **Accessible Frontend** | ✅ Spécifié | ❌ Pas accessible | ❌ Écart |

### Scorecard

**Implémentation Core**: 85% ✅  
**Implémentation Infra/UI**: 20% ❌  
**Test Coverage**: 794 tests, 31 suites ✅

---

## 2. COMPOSANTS ANALYSÉS

### 2.1 DOMAIN LAYER ✅

**Fichiers**:
- `domain/types.ts` — DataPoint, PreferenceCriterion, UserProfile, Offer, Merchant
- `domain/criterion.ts` — CriterionEvaluator, GenericCriterion
- `domain/profile.ts` — ProfileEngine, merge 3 couches
- `domain/admissibility.ts` — AdmissibilityEngine, hard filtering

**État**: ✅ **COMPLET & TESTÉ**

| Composant | État | Détails |
|-----------|------|---------|
| DataPoint\<T\> | ✅ Complet | Type + statuts (verified/known/unknown/contradictory/unverifiable) |
| PreferenceCriterion | ✅ Complet | Tous niveaux (forbidden/required/very_important/important/preference/low/none) |
| UserProfile | ✅ Complet | Profil permanent + critères par défaut |
| Offer | ✅ Complet | Merchant, price, characteristics, availability, provenance |
| ProfileEngine | ✅ Complet | Merge (permanent + request + overrides) avec audit trail |
| AdmissibilityEngine | ✅ Complet | Hard filter (required/forbidden) avant ranking |

**Test Coverage**: ✅ 11 test suites dédiés aux types et moteurs de domaine

**Conclusion**: La couche domaine est **architecturalement pure** et bien testée. Les invariants absolus sont respectés.

---

### 2.2 DECISION LAYER ✅

**Fichier**:
- `decision/priority-engine.ts` — rankOffers()

**État**: ✅ **COMPLET & TESTÉ**

| Capacité | État | Détails |
|----------|------|---------|
| Scoring déterministe | ✅ | Algorithme scoring-par-critère, pas d'aléa |
| Indépendance IA | ✅ | PriorityEngine ne voit pas l'IA, que critères normalisés |
| Isolation marchands | ✅ | Provenance enregistrée mais non utilisée pour ranking |
| Prise en compte du contexte utilisateur | ✅ | Weights basés sur PreferenceCriterion |

**Test Coverage**: ✅ Multiple test suites (scenarios, edge cases)

**Tests benchmark**: 794 tests passent — aucun échec.

**Conclusion**: Le moteur de classement est **solide et architecturalement correct**.

---

### 2.3 APPLICATION LAYER — CORE ✅

#### SearchOrchestration ✅

| Composant | Fichier | État | Test |
|-----------|---------|------|------|
| BasicPatternInterpreter | `request-interpreter.ts` | ✅ Implémenté | ✅ Testé |
| ClarificationEngine | `clarification-engine.ts` | ✅ Implémenté | ✅ Testé |
| SearchPlanBuilder | `search-plan.ts` | ✅ Implémenté | ✅ Testé |
| DiscoveryOrchestrator | `discovery.ts` | ✅ Implémenté | ✅ Testé |
| NormalizationEngine | `normalization-engine.ts` | ✅ Implémenté | ✅ Testé |
| DeduplicationEngine | `deduplication.ts` | ✅ Implémenté | ✅ Testé |
| ExplanationEngine | `explanation-engine.ts` | ✅ Implémenté | ✅ Testé |
| NoResultsAnalyzer | `no-results-analyzer.ts` | ✅ Implémenté | ✅ Testé |
| ConflictResolver | `conflict-resolver.ts` | ✅ Implémenté | ✅ Testé |

#### SearchProviderOrchestrator ✅ (NEW from Phase 1)

**Fichier**: `search-provider-orchestrator.ts` (410 lignes)

**Capacités**:
- Orchestration parallèle Brave + Serper
- Gestion des timeouts individuels
- Déduplication par URL avec provenance préservée
- Confidence scoring

**Test Coverage**: ✅ 11 tests

#### PromotionEngine ✅ (NEW from Phase 1)

**Fichier**: `promotion-engine.ts` (330 lignes)

**Capacités**:
- Enregistrement codes promos
- Validation des conditions
- Calcul des remises (%, fixe, livraison)
- Tri par meilleures économies

**Test Coverage**: ✅ 22 tests

#### CartPreparationEngine ✅ (NEW from Phase 1)

**Fichier**: `cart-preparation-engine.ts` (310 lignes)

**Capacités**:
- Sélection du handler (UCP, merchant_api, oauth, web_redirect)
- Préparation du panier
- Génération des URLs de checkout

**Test Coverage**: ✅ Tests intégrés

#### AIUsageTracker ✅ (NEW from Phase 1)

**Fichier**: `ai-usage-tracking.ts` (280 lignes)

**Capacités**:
- Suivi tokens/coûts
- Budgets par tier (anonymous, free, premium)
- Vérification avant exécution
- Support multi-modèles

**Test Coverage**: ✅ Testé

**Conclusion**: La couche application est **très bien implémentée et testée**. Les 4 modules nouveaux (Phase 1) sont en place et fonctionnels.

---

### 2.4 APPLICATION LAYER — AI ⚠️

#### AIOrchestrator ⚠️ (PARTIALLY COMPLETE)

**Fichier**: `ai-orchestrator.ts`

**État**:
- ✅ Infrastructure créée
- ✅ Audit trail implémenté
- ✅ Multi-fournisseurs supportés (Claude, OpenAI, Gemini)
- ⚠️ **Paramètres réels de configuration** non exposés

**Problèmes Identifiés**:

1. **Configuration de modèles**
   ```typescript
   // Modèles enregistrés avec pricing en dur
   registerModel(model: AIModel): void
   ```
   Les coûts sont en dur, pas de configuration dynamique.

2. **Pas de stratégie de fallback réelle**
   ```typescript
   // Si le modèle préféré échoue, aucun fallback défini
   async callAI(request: AIRequest): Promise<AIResponse>
   ```

3. **Tête de pont avec ConversationManager**
   - AIOrchestrator existe
   - ConversationManager existe (basique)
   - Mais l'intégration pour **tour-par-tour** est minimale

#### ModelRouter ⚠️ (BASIC IMPLEMENTATION)

**Fichier**: `model-router.ts`

**État**:
- ✅ Architecture créée
- ⚠️ Logique de routage très simple (pas de coût réel, pas de latence)
- ❌ Pas de contexte utilisateur (tier, budget)

**Problèmes**:
```typescript
// Routage déterministe mais sans coût réel
selectModel(task: AITask, models: AIModel[]): AIModel
```

**Conclusion**: Le framework **existe** mais manque de sophistication pour cas réels (fallback automatique, coût réel, etc.)

---

### 2.5 APPLICATION LAYER — CONVERSATION ⚠️

#### ConversationManager ⚠️ (BASIC)

**Fichier**: `conversation-manager.ts`

**État**:
- ✅ Types créés (Conversation, SearchSession, SearchState)
- ✅ Historique versionné (append-only)
- ⚠️ **Pas de persistance réelle** (in-memory uniquement)
- ⚠️ **Pas de tour-par-tour conversationnel réel**

**Fonctionnalités Implémentées**:
- Création de sessions
- Historique des messages
- Versionning des états de recherche

**Manques**:
- ❌ Pas de **multi-turn clarification loop**
- ❌ Pas d'**intent understanding avancé**
- ❌ Pas de **context retention** pour user preferences

**Exemple de ce qui manque**:
```
User: "Find me a bike"
Capucine: "Budget? Brand? Type (road/mountain/hybrid)?"
User: "Less than 300€, Decathlon is fine"
Capucine: [Should remember "Decathlon" preference + "< 300€"]
```

Actuellement, chaque requête est isolée.

**Conclusion**: **Infrastructure existe** mais **pas de vrai conversation yet**. C'est acceptable pour MVP.

---

### 2.6 INPUT/OUTPUT ❌

#### STT (Speech-to-Text) ❌ MANQUANT

**État**: ❌ **Aucune implémentation**

**Fichier** qui devrait exister: Aucun

**Nécessaire pour**: Interaction vocale

**Dépendances potentielles à ajouter**:
- Google Cloud Speech-to-Text
- Azure Cognitive Services
- OpenAI Whisper

#### TTS (Text-to-Speech) ❌ MANQUANT

**État**: ❌ **Aucune implémentation**

**Fichier** qui devrait exister: Aucun

**Nécessaire pour**: Réponses vocales

**Dépendances potentielles à ajouter**:
- Google Cloud Text-to-Speech
- Azure Cognitive Services
- ElevenLabs

#### API HTTP ✅ (BASIC)

**Fichier**: `api/server.ts`

**État**: ✅ Basique mais fonctionnel

**Endpoints**:
- `POST /search` — Exécute une recherche
- `GET /health` — Health check
- `GET /tools` — Liste tools

**Problème**: 
- ❌ Pas d'endpoint pour voix (STT/TTS)
- ❌ Pas d'endpoint pour préférences utilisateur
- ❌ Pas d'endpoint pour conversation persistée

---

### 2.7 STORAGE & PERSISTENCE ❌

#### User Profile Storage ❌ MOCK

**État**: ❌ **In-memory uniquement**

**Fichier**: `profile-store.ts`

**Implémentation Actuelle**:
```typescript
class InMemoryProfileStore implements ProfileStore {
  private profiles = new Map<string, UserProfile>();
  
  async getProfile(userId: string): Promise<UserProfile> {
    return this.profiles.get(userId) || createEmptyProfile(userId);
  }
}
```

**Problème**: Données perdues au redémarrage

**Nécessaire pour Production**:
- Database (PostgreSQL, MongoDB, etc.)
- Schema migration
- RGPD compliance (deletion, export)

#### Conversation Persistence ❌ MOCK

**État**: ❌ **In-memory uniquement**

**Implémenté**: ConversationManager (types)  
**Non implémenté**: Sauvegarde/chargement persistant

#### Search History ❌ MANQUANT

**État**: ❌ **Aucune implémentation**

**Nécessaire pour**: Recommandations, analytics, learning

---

### 2.8 FRONTEND (Web) ❌

**Localisation**: `shopping-assistant/frontend/`

**État**: ❌ **Pas accessible, pas multimodale**

**Détails**: Voir ACCESSIBILITY_AUDIT.md

**Manques**:
- ❌ Accessibilité WCAG 2.2 AA
- ❌ Support lecteur d'écran
- ❌ Interface vocale
- ❌ Mode texte agrandi
- ❌ Mode haut contraste

---

## 3. TABLEAU RÉCAPITULATIF COMPLET

| Couche | Composant | Prévue | Réelle | Écart | Impact |
|--------|-----------|--------|--------|-------|--------|
| **Domain** | Types | ✅ | ✅ | — | 0 |
| **Domain** | ProfileEngine | ✅ | ✅ | — | 0 |
| **Domain** | AdmissibilityEngine | ✅ | ✅ | — | 0 |
| **Decision** | PriorityEngine | ✅ | ✅ | — | 0 |
| **Application** | CapucineEngine | ✅ | ✅ | — | 0 |
| **Application** | NormalizationEngine | ✅ | ✅ | — | 0 |
| **Application** | DeduplicationEngine | ✅ | ✅ | — | 0 |
| **Application** | DiscoveryOrchestrator | ✅ | ✅ | — | 0 |
| **Application** | SearchProviderOrchestrator | ✅ | ✅ | — | 0 |
| **Application** | PromotionEngine | ✅ | ✅ | — | 0 |
| **Application** | CartPreparationEngine | ✅ | ✅ | — | 0 |
| **Application** | AIUsageTracker | ✅ | ✅ | — | 0 |
| **Application** | ExplanationEngine | ✅ | ✅ | — | 0 |
| **Application** | ClarificationEngine | ✅ | ✅ | — | 0 |
| **Application** | AIOrchestrator | ✅ | ⚠️ | Partiellement | 1 |
| **Application** | ModelRouter | ✅ | ⚠️ | Basique | 1 |
| **Application** | ConversationManager | ✅ | ⚠️ | Basique | 2 |
| **Infrastructure** | STT | ✅ | ❌ | Absent | 3 |
| **Infrastructure** | TTS | ✅ | ❌ | Absent | 3 |
| **Infrastructure** | ProfileStorage | ✅ | ❌ | Mock | 2 |
| **Infrastructure** | ConversationStorage | ✅ | ❌ | Mock | 2 |
| **UI** | Web Frontend | ✅ | ❌ | Non accessible | 3 |
| **UI** | Mobile Apps | ✅ | ❌ | Absent | 3 |

---

## 4. ÉCARTS CRITIQUES

### Écart 1: Pas de STT/TTS ❌

**Composant**: Multimodalité vocale

**État**: ❌ Absent

**Impact**: Pas d'interaction vocale possible actuellement

**Priorité**: P1 — Nécessaire pour accessibilité universelle

**Effort estimé**: 2-3 semaines (1 dev)

**Dépendances**: Google Cloud Speech, Azure, ou Whisper

---

### Écart 2: Conversation non persistée ⚠️

**Composant**: Gestion de session

**État**: ⚠️ In-memory uniquement

**Impact**: Conversations perdues au redémarrage, pas d'analytics

**Priorité**: P2 — Nécessaire pour production

**Effort estimé**: 2-3 semaines (1 dev DB + 1 dev backend)

**Dépendances**: Base de données, schema migrations

---

### Écart 3: Frontend non accessible ❌

**Composant**: Interface utilisateur

**État**: ❌ Pas WCAG 2.2 AA

**Impact**: Inaccessible aux personnes avec handicap

**Priorité**: P0 — Critique pour stratégie d'accessibilité

**Effort estimé**: 6-8 semaines (2-3 devs)

**Dépendances**: WCAG knowledge, screen reader testing

---

### Écart 4: Pas d'app mobile ❌

**Composant**: Plateforme iOS/Android

**État**: ❌ Absent

**Impact**: Non-disponibilité sur mobile

**Priorité**: P3 — Futur, pas immédiat

**Effort estimé**: 12-16 semaines (3-4 devs)

**Dépendances**: React Native ou native dev

---

## 5. ÉLÉMENTS POSITIFS À RETENIR

### ✅ Architecture Core Solidement Implémentée

La **couche décision** et **couche domaine** sont architecturalement excellentes:
- Séparation des responsabilités claire
- Invariants appliqués par l'architecture
- Tests exhaustifs (794 tests passent)
- Pas de dépendances sur un fournisseur IA unique

### ✅ Pattern multi-fournisseurs en Place

Même si non totalement exploité:
- AIOrchestrator existe
- ModelRouter existe
- Possibilité d'ajouter fournisseurs facilement

### ✅ Phase 1 Implémentation Complète

Les 4 modules nouveaux (Phase 1) sont en place:
- SearchProviderOrchestrator
- PromotionEngine
- CartPreparationEngine
- AIUsageTracker

### ✅ Pas de Dépendance Vendor Lock-in

Architecture permet de changer:
- Fournisseur de recherche
- Fournisseur d'IA
- Base de données

---

## 6. RECOMMANDATIONS

### Pour Phase 2 (Accessibilité)

**Priorité P0**:
1. [ ] Rendre frontend WCAG 2.2 AA accessible
2. [ ] Implémenter STT/TTS
3. [ ] Tester avec lecteurs d'écran réels

**Priorité P1**:
4. [ ] Persistance conversation (database)
5. [ ] Persistance profil utilisateur
6. [ ] API endpoints pour accessibilité

**Priorité P2**:
7. [ ] Multi-turn conversation loop
8. [ ] Context retention utilisateur
9. [ ] Recommandations basées sur historique

---

## 7. CONCLUSION

### État Global

**Core Engine**: 95% ✅  
**Infrastructure**: 20% ⚠️  
**UI/UX**: 10% ❌  
**Overall**: ~40% complète pour production

### Chemin Avant Production Publique

L'architecture **core est solide**. Les écarts restants sont **intégrables progressivement** sans refonte majeure.

**Chantier suivant**: Accessibilité universelle (Frontend + Multimodalité)

---

**Document généré par**: Architecture Review  
**Prochaine étape**: Phase 2 Implementation Planning
