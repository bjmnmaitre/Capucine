# Capucine — Cartographie réelle du flux (contexte d'usage)

Établie par lecture du code du dépôt, pas des rapports précédents.
Tous les numéros de ligne renvoient à l'état du dépôt AVANT le chantier.

## Flux réel

```
POST /search (api/server.ts:255)  |  POST /clarify (api/server.ts:362)
        │                                    │
        │  SearchRequest                     │  interpretFollowUp() (capucine-engine.ts:348)
        ▼                                    │  → ConversationManager.applyFollowUp() (conversation-manager.ts:424)
CapucineEngine.search() (capucine-engine.ts:388)
        │
   [0] BasicPatternInterpreter.interpret() (request-interpreter.ts:111)
        │   → InterpretedRequest (application/request.ts)
   [1] ClarificationEngine.analyze(criteria, queryText, requestId) (clarification-engine.ts:385)
   [2] ProfileEngine.resolve(profile, CurrentSearchRequirements, overrides, id) (domain/profile.ts)
        │   → EffectiveCriteriaSet
   [3] buildSearchPlan() (capucine-engine.ts:810) → SearchPlanBuilder.build() (search-plan.ts:440)
        │   → SearchPhaseQueryBuilder.buildPhaseTerms()
   [4] discoverWithEscalation() (capucine-engine.ts:987)
        │   → planToDiscoveryCriteria() (capucine-engine.ts:1059) → DiscoveryCriteria
        │   → DiscoveryOrchestrator.discover()
        │       → RealWebDiscoveryStrategy.discover() (real-web-discovery.ts:206)
        │           → SearchStrategyPlanner.buildStrategies() phases 1/2
        │           → computeSearchCoverage() (search-coverage.ts) gate phase 2, puis phase 3
        │       → InMemoryDiscoveryStrategy (catalogue local)
   [5] NormalizationEngine.normalizeOffer() (normalization-engine.ts:424)
   [6] DeduplicationEngine.deduplicate() + resolveOffers()
   [7] AdmissibilityEngine.filter(offers, effectiveCriteria) (domain/admissibility.ts:106)
        │   ne lit QUE les critères required/forbidden
   [8] rankOffers({offers, effectiveCriteria, ...}, resultsByOfferId) (decision/priority-engine.ts:632)
   [9] ExplanationEngine.explain(rankingResult) (explanation-engine.ts:192)
  [10] NoResultsAnalyzer
        ▼
   serializeResult() (api/server.ts:657)
```

## Réponses aux questions d'audit

| # | Question | Réalité du dépôt |
|---|---|---|
| A | Entrée utilisateur | `POST /search` (server.ts:255), `POST /clarify` (server.ts:362) |
| B | Interprétation | `BasicPatternInterpreter.interpret()` / `interpretSync()` (request-interpreter.ts:111/146) |
| C | Extractions existantes | budget, screen_size, ram, storage, condition (`extractCondition`:775), catégorie (`applyCategoryDetection`:196). **marque/modèle = uniquement `suggestedSearchTerms`, pas des critères. couleur = non extraite. quantité = non extraite.** usage = `extractUsageContext`:364 |
| D | Type des critères | `PreferenceCriterion` (domain/types.ts:165), `level: PreferenceLevel`, `parameters` libre |
| E | Fusion des tours | `ConversationManager.applyFollowUp()` fusionne `deltaCriteria` par `id` dans `session.currentCriteria` |
| F | Critères → DiscoveryCriteria | `buildSearchPlan()` → `SearchPlan` → `planToDiscoveryCriteria()` |
| G | Chargement profil | `profileStore.load(userId)` dans server.ts ; le moteur ne parle jamais au stockage |
| H | Snapshot | `ProfileEngine.resolve()` → `EffectiveCriteriaSet` (le pipeline n'utilise pas `ProfileEngine.snapshot()`) |
| I | Préférences persistantes | `UserProfile.preferences` via `profile-store.ts` |
| J | Temporaire vs permanent | `CurrentSearchRequirements` + `ProfileOverride` ; aucune écriture profil depuis le pipeline |
| K | Construction des requêtes | `SearchPlanBuilder` + `SearchPhaseQueryBuilder`, puis `SearchStrategyPlanner` dans `RealWebDiscoveryStrategy` |
| L | Escalade | 2 mécanismes distincts : `discoverWithEscalation()`/`SearchPlanBuilder.escalate()` (niveaux 1–6) et les phases 1/2/3 de `RealWebDiscoveryStrategy` gouvernées par `SearchCoverage` + `maxPhases`/`maxTotalTimeMs` |
| M | Influence sur le classement | `rankOffers()` — n'accepte QUE `effectiveCriteria` + offres |
| N | Explications | `ExplanationEngine.explain(RankingResult)` — n'accepte QUE le résultat de classement |
| O | SearchCoverage | `real-web-discovery.ts` lignes 315 (gate phase 2), 346 (gate phase 3), 373 (rapport final) |
| P | Où le contexte est perdu | voir ci-dessous |
| Q | Porteurs déjà disponibles | `InterpretedRequest.usageContext`, `CurrentSearchRequirements.usageContext`, `EffectiveCriteriaSet.usageContext`, `SearchPlan.usageContext`, `DiscoveryCriteria.usageContext`, `MergedContext.usageContext`, `UserProfile.usageContextHistory`, `domain/usage-context-mapping.ts`, `SearchStrategyPlanner.buildUsageTerms()` |
| R | Tests existants | **aucun** (`grep -r usageContext tests/` = 0 résultat) |

## Points de rupture identifiés (avant chantier)

1. **capucine-engine.ts:457** — le `CurrentSearchRequirements` passé à `ProfileEngine.resolve()`
   n'incluait pas `usageContext` ⇒ `EffectiveCriteriaSet.usageContext` toujours `undefined`.
2. **capucine-engine.ts:810/872** — `buildSearchPlan()` accepte un paramètre `usageContext`
   mais ne le transmet pas à `planBuilder.build()` ⇒ `SearchPlan.usageContext` toujours
   `undefined` ⇒ `DiscoveryCriteria.usageContext` toujours `undefined` ⇒
   `SearchStrategyPlanner.buildUsageTerms()` retourne toujours `[]` (code mort).
3. **capucine-engine.ts:348 / conversation-manager.ts:74** — `interpretFollowUp()` jette
   `interpreted.usageContext` ; `ConversationSession` n'a aucun champ pour le stocker ; les
   tours 2+ passent `skipAIInterpretation: true` ⇒ un usage énoncé au tour 2 est définitivement perdu.
4. **priority-engine.ts:632 / explanation-engine.ts:192** — aucun canal d'entrée pour le
   contexte : il ne peut, par construction, influencer ni le score ni l'explication.
5. **request-interpreter.ts:364** — l'extraction s'arrête au PREMIER motif trouvé, dans
   l'ordre de la table (transport avant musique). « pour écouter de la musique, surtout dans
   les transports » produisait `usage: 'transport'` et perdait `music`. Aucun motif anglais.
6. **searchSync()** — ne transmettait le contexte nulle part non plus.
