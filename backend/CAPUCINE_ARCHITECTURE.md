# Capucine — Architecture Reference

## Principe fondamental

> **Capucine ne cherche pas le produit qu'elle préfère. Capucine cherche le produit qui correspond le mieux à ce que l'utilisateur a demandé.**

---

## Cinq invariants absolus

Ces règles ne peuvent jamais être violées par aucun code, aucune IA, aucune optimisation.

| # | Invariant |
|---|-----------|
| 1 | Capucine cherche le produit qui correspond le mieux à ce que l'utilisateur a demandé — pas celui qu'elle préfère. |
| 2 | La rareté d'un produit ne diminue pas sa pertinence. |
| 3 | La source qui permet de trouver une offre n'a aucun droit particulier sur son classement. |
| 4 | La difficulté d'exécution n'a aucun effet sur le classement. |
| 5 | Capucine ne modifie jamais silencieusement la volonté de l'utilisateur pour obtenir davantage de résultats. |

---

## Pipeline complet

```
USER REQUEST (texte naturel)
       │
       ▼
┌─────────────────┐
│  AIOrchestrator │  → Interprétation NL → critères structurés (PROPOSITION, pas commande)
└─────────────────┘
       │
       ▼
┌─────────────────┐
│  ProfileEngine  │  → Merge: PROFIL PERMANENT + REQUÊTE COURANTE + OVERRIDES TEMPORAIRES
└─────────────────┘    EffectiveCriteriaSet (immuable pour cette recherche)
       │
       ▼
┌─────────────────┐
│  SearchPlan     │  → Stratégie de découverte (niveaux 1-6, expansion contrôlée)
└─────────────────┘
       │
       ▼
┌─────────────────┐
│  Discovery      │  → Candidats bruts (multi-sources, merchant-neutral)
└─────────────────┘
       │
       ▼
┌──────────────────────┐
│  DeduplicationEngine │  → Groupement par EAN/ISBN/productId/modèle
└──────────────────────┘    Variantes (storage/color/size) = produits distincts
       │
       ▼
┌──────────────────────┐
│  AdmissibilityEngine │  → Filtre dur : required/forbidden AVANT le classement
└──────────────────────┘    INVARIANT : aucun score secondaire ne compense une violation
       │ (uniquement les offres eligibles passent)
       ▼
┌─────────────────┐
│  PriorityEngine │  → Classement déterministe (0-100 par critère)
└─────────────────┘    IA ne touche PAS ce module
       │
       ▼
┌──────────────────────┐
│  ResultsExplainer    │  → Explication structurée depuis les données (pas générée par IA)
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│  AIOrchestrator      │  → Traduction en langage naturel de l'explication calculée
└──────────────────────┘
       │
       ▼
CONVERSATIONAL RESPONSE → SearchSession → SearchState (versionné)
```

---

## Séparation des couches

### Couche Domaine (`src/domain/`)

| Fichier | Rôle |
|---------|------|
| `types.ts` | Types fondamentaux : `DataPoint<T>`, `PreferenceCriterion`, `UserProfile`, `Offer`, `RankingRequest` |
| `criterion.ts` | `GenericCriterion` avec opérateurs universels. `CriterionEvaluator`. `CriterionFactory`. |
| `profile.ts` | `ProfileEngine` (merge 3 couches), `ProfileSnapshot` (immuable), `ProfileOverride` |
| `admissibility.ts` | `AdmissibilityEngine` — filtre dur séparé du classement |

### Couche Décision (`src/decision/`)

| Fichier | Rôle |
|---------|------|
| `priority-engine.ts` | `rankOffers()` — classement déterministe, jamais influencé par l'IA |

**Cette couche ne connaît pas les fournisseurs IA. Elle ne connaît pas les marchands. Elle reçoit uniquement des critères et des offres.**

### Couche Application (`src/application/`)

| Fichier | Rôle |
|---------|------|
| `search-plan.ts` | `SearchPlan` — stratégie de découverte avec expansion progressive (niveaux 1-6) |
| `deduplication.ts` | `DeduplicationEngine` — groupement déterministe sans faux positifs |
| `ai-orchestrator.ts` | `AIOrchestrator` — point d'entrée unique vers les IA, audit complet |
| `conversation.ts` | `Conversation`, `SearchSession`, `SearchState` — modèle conversationnel versionné |
| `normalization.ts` | Normalisation sans destruction d'information brute |
| `provenance.ts` | Traçabilité complète de chaque donnée |
| `results.ts` | Types de résultats et explications |
| `i18n.ts` | Infrastructure internationale (devises, langues, régions) |

---

## DataPoint\<T\> — La règle d'or

Toute donnée dans Capucine est un `DataPoint<T>` avec un statut explicite :

```typescript
type DataStatus = 'verified' | 'known' | 'unknown' | 'contradictory' | 'unverifiable';

interface DataPoint<T> {
  value: T | null;
  status: DataStatus;
  provenance?: DataProvenance;
}
```

**INVARIANT critique** : `UNKNOWN ≠ négatif`. Une donnée inconnue ne pénalise jamais une offre dans les critères de préférence. Elle pénalise uniquement si le critère est `required` et que la donnée est nécessaire pour confirmer la satisfaction.

---

## Niveaux de préférence

```
forbidden      → Rejet immédiat si présent (AdmissibilityEngine)
required       → Rejet immédiat si absent ou non satisfait (AdmissibilityEngine)
very_important → Fort poids dans le score (PriorityEngine)
important      → Poids significatif
preference     → Poids modéré
low            → Poids faible
none           → Ignoré dans le classement
```

Les niveaux `forbidden` et `required` sont traités par l'**AdmissibilityEngine** avant que l'offre n'atteigne le PriorityEngine.

---

## ProfileEngine — Merge à 3 couches

```
PROFIL PERMANENT  ←  jamais modifié pendant la recherche
      +
REQUÊTE COURANTE  ←  gagne sur conflit avec le profil
      +
OVERRIDES         ←  gagne sur tout (traçables dans appliedOverrides)
      ↓
EffectiveCriteriaSet (immuable, versionné par searchId)
```

**Règle** : Un override temporaire ne modifie **jamais** le `UserProfile` persistant.

---

## SearchPlan — Expansion progressive

| Niveau | Nom | Auto-escalade | Permission requise |
|--------|-----|---------------|--------------------|
| 1 | Exact Match | ✓ | — |
| 2 | Variantes lexicales | ✓ | — |
| 3 | Références fabricant | ✓ | — |
| 4 | Sources spécialisées | ✓ | — |
| 5 | Marché secondaire | — | — (avertissement) |
| 6 | Expansion géographique | — | ✓ obligatoire |

**INVARIANT** : L'expansion ajoute des candidats mais ne relâche **jamais** les contraintes hard.

---

## Conversation Model

```
Conversation (persistante)
  └── SearchSession (une intention de recherche)
        └── SearchState v1  ← originalRequest jamais modifié
        └── SearchState v2  ← nouvelle version après modification utilisateur
        └── SearchState v3  ← ...
        messages[]          ← historique complet des échanges
```

**INVARIANT** : Les versions d'état sont append-only. Aucune version passée n'est modifiée ou supprimée.

---

## AIOrchestrator — Isolation stricte

L'IA peut :
- Parser le langage naturel → critères structurés (PROPOSITION)
- Générer des termes de recherche et synonymes
- Expliquer en prose les résultats déjà calculés
- Identifier des opportunités de clarification

L'IA ne peut **jamais** :
- Influencer le `PriorityEngine`
- Modifier le niveau d'un critère sans confirmation utilisateur
- Ajouter des contraintes non exprimées par l'utilisateur
- Injecter des données non vérifiées avec le statut `verified`

**Garantie auditée** : `AIAuditEntry.reachedRankingEngine === false` pour chaque appel IA.

---

## Règles de sécurité

- Aucune clé API dans le code client
- Aucun secret hardcodé
- Aucune réponse IA considérée automatiquement comme vérité
- Aucune donnée externe injectée directement dans le ranking sans normalisation
- Aucune provenance supprimée lors d'une transformation

---

## État des tests

| Suite | Tests | Statut |
|-------|-------|--------|
| Priority Engine | ~50 | ✅ |
| Business Scenarios | 35 | ✅ |
| Audit Invariants | 20 | ✅ |
| New Layers (Gates 3-30) | 74 | ✅ |
| Integration Contracts | ~20 | ✅ |
| **Total** | **273** | **✅ 273/273** |

---

*Dernière mise à jour : 2026-08-13*
