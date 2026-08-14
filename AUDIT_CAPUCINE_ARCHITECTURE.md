# AUDIT ARCHITECTURE CAPUCINE
## État du Socle Technique — État Initial Réel

**Date**: 14 Août 2026  
**Projet**: Capucine — Assistant d'Achat IA  
**État Global**: **ARCHITECTURE SOLIDE, CŒUR MÉTIER IMPLÉMENTÉ, GAPS IDENTIFIÉS POUR PARCOURS COMPLET**

---

## 1. ÉTAT RÉELLEMENT OBSERVÉ

### Code Source
- **Langage**: TypeScript (17,981 lignes)
- **Tests**: 747 tests passants (28 suites)
- **Structure**: Organisée en couches (domain, application, decision, api)
- **Dépôt**: Déjà en git avec commit history

### Exécution
```
Test Suites: 28 passed, 28 total
Tests:       1 todo, 747 passed, 748 total
Time:        62.487 s
```

---

## 2. ARCHITECTURE RÉELLEMENT EXISTANTE

### 2.1 Couche Domaine (SOLIDE ✓)

**Fichier**: `src/domain/types.ts`

Implémentations observées:

| Concept | État | Qualité |
|---------|------|---------|
| PreferenceLevel (forbidden, required, very_important, ...) | ✓ IMPLÉMENTÉ | Excellent |
| DataStatus (verified, known, unknown, contradictory, unverifiable) | ✓ IMPLÉMENTÉ | Excellent |
| DataPoint<T> (avec provenance) | ✓ IMPLÉMENTÉ | Excellent |
| UserProfile vs CurrentSearchRequirements | ✓ IMPLÉMENTÉ | Excellent — Séparation stricte |
| Product / Offer / Merchant (distinctions nettes) | ✓ IMPLÉMENTÉ | Excellent |
| ExecutionCapability (ucp, merchant_api, oauth_redirect, web_redirect, browser_automation) | ✓ IMPLÉMENTÉ | Bon — Types définis, pas d'implémentation exécutive |
| RankedOffer avec CriterionScore détaillé | ✓ IMPLÉMENTÉ | Excellent |
| MergedContext (fusion profil + requirements) | ✓ IMPLÉMENTÉ | Bon |

**Verdict**: La couche domaine est **COMPLÈTE et BIEN PENSÉE**.

---

### 2.2 Couche Décision — Priority Engine (IMPLÉMENTÉ ✓)

**Fichier**: `src/decision/priority-engine.ts`

Implémentations observées:

| Capacité | État | Détails |
|----------|------|---------|
| Scoring par critère | ✓ IMPLÉMENTÉ | Gère known, unknown, contradictory |
| Pondération par PreferenceLevel | ✓ IMPLÉMENTÉ | Weights appliqués correctement |
| Contraintes dures (forbidden, required) | ✓ IMPLÉMENTÉ | Filtre avant scoring |
| Explication per-critère | ✓ IMPLÉMENTÉ | CriterionScore avec reasoning |
| Déterminisme | ✓ IMPLÉMENTÉ | Pas d'aléatoire, même input = même output |
| Indépendance marchands | ✓ IMPLÉMENTÉ | Merchant.id n'influence pas le score |

**Verdict**: Priority Engine est **COMPLÈTEMENT FONCTIONNEL** et répond à la spécification.

---

### 2.3 Couche Application — Orchestration (PARTIELLEMENT IMPLÉMENTÉ ⚠)

**Fichier principal**: `src/application/capucine-engine.ts`

#### 2.3.1 Pipeline Existant ✓

```
USER REQUEST (text)
  → [BasicPatternInterpreter] heuristic NL → structured criteria
  → [ClarificationEngine] detect ambiguities
  → [ProfileEngine] merge PROFILE + REQUEST + OVERRIDES
  → [SearchPlanBuilder] build discovery strategy + escalation policy
  → [AIOrchestrator] (optional) enrich plan with synonyms
  → [DiscoveryOrchestrator] find candidates (auto-escalation on 0 results)
  → [NormalizationEngine] normalize characteristic values
  → [DeduplicationEngine] group identical products
  → [AdmissibilityEngine] hard filter (required/forbidden)
  → [rankOffers (PriorityEngine)] deterministic scoring
  → [ExplanationEngine] generate structured explanations
  → [NoResultsAnalyzer] if 0 results: diagnose why
  → SearchEngineResult
```

**Verdict**: Pipeline complet et **OPÉRATIONNEL**.

#### 2.3.2 Qualité de l'Orchestration

| Module | Fichier | État | Notes |
|--------|---------|------|-------|
| BasicPatternInterpreter | `request-interpreter.ts` | ✓ IMPLÉMENTÉ | Extraction heuristique de critères |
| ClarificationEngine | `clarification-engine.ts` | ✓ IMPLÉMENTÉ | Détection d'ambiguïtés |
| ProfileEngine | `profile.ts` | ✓ IMPLÉMENTÉ | Fusion profil + requirements |
| SearchPlanBuilder | `search-plan.ts` | ✓ IMPLÉMENTÉ | Escalation sur 6 niveaux |
| AIOrchestrator | `ai-orchestrator.ts` | ✓ IMPLÉMENTÉ | Rephrasing IA optionnel |
| DiscoveryOrchestrator | `discovery.ts` | ✓ IMPLÉMENTÉ | Abstraction pluggable |
| NormalizationEngine | `normalization-engine.ts` | ✓ IMPLÉMENTÉ | Normalise valeurs produit |
| DeduplicationEngine | `deduplication.ts` | ✓ IMPLÉMENTÉ | Groupage intelligente |
| AdmissibilityEngine | `domain/admissibility.ts` | ✓ IMPLÉMENTÉ | Filtre constraints durs |
| ExplanationEngine | `explanation-engine.ts` | ✓ IMPLÉMENTÉ | Génère explications texte |
| NoResultsAnalyzer | `no-results-analyzer.ts` | ✓ IMPLÉMENTÉ | Diagnose si 0 résultats |

**Verdict**: Orchestration **COMPLÈTE et TESTÉE**.

---

### 2.4 Couche Découverte — Web Search (PARTIELLEMENT IMPLÉMENTÉ ⚠)

**Fichiers**: `src/application/discovery.ts`, `real-web-discovery.ts`, `web-search-adapters.ts`

#### État:

| Aspect | État | Détails |
|--------|------|---------|
| Abstraction DiscoveryStrategy | ✓ IMPLÉMENTÉ | Interface cleanly defined |
| RealWebDiscoveryStrategy | ✓ IMPLÉMENTÉ | Peut utiliser WebSearchAdapter |
| In-memory mock strategy | ✓ IMPLÉMENTÉ | Pour tests, pas de web réel |
| DiscoveryStatus sémantique | ✓ IMPLÉMENTÉ | RESULTS, NO_RESULTS, NOT_CONFIGURED, etc. |
| WebSearchAdapter interface | ✓ IMPLÉMENTÉ | Contrats pour Brave, Serper |
| Brave adapter | ⚠️ PRÉPARÉ | Types définis, implémentation mock |
| Serper adapter | ⚠️ PRÉPARÉ | Types définis, implémentation mock |
| **Multi-provider orchestration (Brave + Serper parallèle)** | ❌ NON IMPLÉMENTÉ | SearchProviderOrchestrator n'existe pas |

**Verdict**: Découverte a une bonne abstraction, mais **RECHERCHE RÉELLE EST MOCKÉE** et **PAS DE VRAI MULTI-PROVIDER**.

---

### 2.5 AI Gateway (PARTIELLEMENT IMPLÉMENTÉ ⚠)

**Fichiers**: `ai-abstractions.ts`, `ai-providers.ts`, `ai-orchestrator.ts`

#### État:

| Aspect | État | Détails |
|--------|------|---------|
| AIProviderConfig (Claude, OpenAI, Gemini) | ✓ IMPLÉMENTÉ | Types flexibles |
| AIProviderRegistry | ✓ IMPLÉMENTÉ | Gestion multiple providers |
| AIInterpreter interface | ✓ IMPLÉMENTÉ | Contract pour extraction critères |
| Fallback config | ✓ IMPLÉMENTÉ | Possibilité cascade (A → B → C) |
| **Vrai appel Claude via API** | ❌ NON IMPLÉMENTÉ | MockAI utilisé en tests |
| **Vrai appel OpenAI** | ❌ NON IMPLÉMENTÉ | Types seulement |
| **Gestion du budget IA** (jetons/coûts/limites) | ⚠️ PRÉPARÉ | Structure present, logique manquante |
| **Suivi de consommation** | ❌ NON IMPLÉMENTÉ | Pas de metrics de tokens |

**Verdict**: AI Gateway a une **BONNE ABSTRACTION** mais est surtout une **ENVELOPPE MOCK**.

---

### 2.6 Conversation & Memory (IMPLÉMENTÉ ✓)

**Fichiers**: `conversation.ts`, `conversation-manager.ts`, `profile-store.ts`

État: Bien structuré, tests passants.

---

## 3. MATRICE D'IMPLÉMENTATION — 4 NIVEAUX

### 3.1 IMPLÉMENTÉ (Fonctionnel, Testé)

✓ Types domaine complets  
✓ Priority Engine déterministe  
✓ Pipeline orchestration (11 étapes)  
✓ ProfileEngine (fusion profil + requirements)  
✓ SearchPlan avec escalation (6 niveaux)  
✓ NormalizationEngine  
✓ DeduplicationEngine  
✓ AdmissibilityEngine  
✓ ExplanationEngine  
✓ NoResultsAnalyzer  
✓ ClarificationEngine  
✓ Conversation management  
✓ Profile storage  

**Total**: ~15 modules fondamentaux

---

### 3.2 PARTIELLEMENT IMPLÉMENTÉ (Structure prête, Logique manquante)

⚠️ RealWebDiscoveryStrategy — structure OK, appels réels mockés  
⚠️ WebSearchAdapter (Brave, Serper) — types OK, implémentation mock  
⚠️ AIOrchestrator — interface OK, intégration réelle mockée  
⚠️ AIProviderRegistry — structure OK, pas d'appels réels  
⚠️ ToolRegistry — existe, mais web_search retourne mock  

---

### 3.3 PRÉPARÉ ARCHITECTURALEMENT (Types définis, Zéro implémentation)

🟡 ExecutionCapability — types existants, pas d'orchestration exécutive  
🟡 Promotion / PromoCode — pas de modèle de domaine  
🟡 CurrencyConversion — pas de service de taux  
🟡 CartPreparation — pas de pipeline  
🟡 MerchantRedirection — pas de gestion de liens  
🟡 PurchaseState management — pas de machine d'états  

---

### 3.4 NON IMPLÉMENTÉ (Manquant complètement)

❌ SearchProviderOrchestrator (Brave + Serper en parallèle)  
❌ Promotion engine (recherche + validation de codes promos)  
❌ CartPreparationEngine  
❌ PurchaseStateOrchestrator  
❌ RealWebSearch client (Brave API keys)  
❌ RealWebSearch client (Serper API keys)  
❌ AIUsageTracking (jetons, coûts, budgets)  
❌ CurrencyConversionService  
❌ MerchantIntegrationRegistry  
❌ OAuth/Redirect handler  

---

## 4. TESTS EXISTANTS

### 4.1 Couverture de tests

| Domaine | Fichier test | État |
|---------|--------------|------|
| Priority Engine | `tests/decision/priority-engine.test.ts` | ✓ Passant |
| Domain Admissibility | `tests/domain/admissibility.test.ts` | ✓ Passant |
| Pipeline End-to-End | `tests/integration/end-to-end-pipeline.test.ts` | ✓ Passant |
| Business Scenarios | `tests/integration/business-scenarios.test.ts` | ✓ Passant |
| Capucine Engine | `tests/integration/capucine-engine.test.ts` | ✓ Passant |
| Normalization | `tests/application/normalization-engine.test.ts` | ✓ Passant |
| Request Interpretation | `tests/application/request-interpreter.test.ts` | ✓ Passant |
| Conversation | `tests/application/conversation-manager.test.ts` | ✓ Passant |
| Profile Store | `tests/application/profile-store.test.ts` | ✓ Passant |

**Verdict**: 747 tests, bonne couverture des briques fondamentales.

---

## 5. GAPS IDENTIFIÉS — TRAVAIL À FAIRE

### 5.1 Critiques (Bloquent parcours complet)

1. **SearchProviderOrchestrator** — Recherche multi-source (Brave + Serper parallèle)
   - Statut: ❌ NON IMPLÉMENTÉ
   - Dépendance: Priority Engine, DiscoveryOrchestrator
   - Effort: Moyen (~150-200 lignes)

2. **RealWebSearch integration** — Appels réels vs mocks
   - Statut: ⚠️ PARTIELLEMENT
   - Bloquant: Nécessite clés API (BRAVE_API_KEY, SERPER_API_KEY)
   - Effort: Petit (intégration des adapters existants)

3. **PromotionEngine** — Recherche + gestion codes promos
   - Statut: ❌ NON IMPLÉMENTÉ
   - Dépendance: Product/Offer models
   - Effort: Gros (~300-400 lignes + tests)

4. **CartPreparationEngine** — Préparation panier
   - Statut: ❌ NON IMPLÉMENTÉ
   - Dépendance: MerchantIntegrationRegistry
   - Effort: Gros (~250-350 lignes + tests)

5. **AIUsageTracking** — Budget IA, consommation jetons
   - Statut: ❌ NON IMPLÉMENTÉ
   - Dépendance: AIProviderRegistry
   - Effort: Moyen (~150 lignes)

### 5.2 Importants (Complètent le parcours)

6. **CurrencyConversionService** — Support devises multiples
   - Statut: ❌ NON IMPLÉMENTÉ
   - Effort: Petit (~100 lignes)

7. **PurchaseStateOrchestrator** — Machine d'états pour parcours
   - Statut: ❌ NON IMPLÉMENTÉ
   - Dépendance: CartPreparation, MerchantRedirection
   - Effort: Moyen (~200 lignes)

8. **14 Cas de test métier** — Couverture complète spec
   - Statut: ❌ NON IMPLÉMENTÉ
   - Effort: Petit-moyen (~400 lignes tests)

---

## 6. CONCLUSIONS

### 6.1 Force du Socle

✓ **Domaine riche et bien modélisé** — Types précis, invariants explicites  
✓ **Orchestration complète** — 11 étapes clairement articulées  
✓ **Priority Engine robuste** — Déterministe, testable  
✓ **Abstractions flexibles** — Discovery, AI, Web Search bien généralisées  
✓ **Tests existants** — 747 cas couvrant briques centrales  

### 6.2 Besoins pour Parcours Complet

❌ **Recherche multi-source** — Brave + Serper orchestrés  
❌ **Promotions** — Système complet de codes promos  
❌ **Panier & Achat** — Pipeline de préparation & redirection  
❌ **Budget IA** — Suivi consommation jetons/coûts  
❌ **14 cas métier** — Couverture complète spec  

### 6.3 Recommandation

**Le socle est solide. Les gaps sont localisés, et non architecturaux.**

Le travail consiste à:
1. Wirer les pièces existantes (MultiProviderSearch)
2. Implémenter 5 modules clés (Promotions, Cart, AIUsage, State, CurrencyConversion)
3. Ajouter 14 tests métier obligatoires

**Effort estimé**: 1500-2000 lignes de code + tests  
**Complexité**: Moyenne (aucun refactoring délicat, extensions linéaires)

---

## 7. NEXT STEPS

### Phase 1 (Court terme)
1. Implémenter SearchProviderOrchestrator (Brave + Serper parallèle)
2. Implémenter PromotionEngine
3. Ajouter 6 premiers cas de test

### Phase 2 (Moyen terme)
4. Implémenter CartPreparationEngine
5. Implémenter PurchaseStateOrchestrator
6. Ajouter 8 cas de test restants

### Phase 3 (Validation)
7. AIUsageTracking + CurrencyConversion
8. Tests complets + validation
9. Documentation

---

**FIN DE L'AUDIT INITIAL**
