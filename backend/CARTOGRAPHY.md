# Cartographie Complète du Modèle Capucine

## 1. CONCEPTS MÉTIER IMPLÉMENTÉS

### 1.1 Hiérarchie des Préférences (`PreferenceLevel`)
**Fichier**: `src/domain/types.ts` (lignes 24-31)
**Responsabilité**: Exprimer l'importance d'un critère de classement
**Valeurs**:
- `forbidden` (Hard constraint): Offre doit l'éviter
- `required` (Hard constraint): Offre doit le satisfaire
- `very_important` (Soft preference): Poids fort (5x)
- `important` (Soft preference): Poids modéré (3x)
- `preference` (Soft preference): Poids faible (1.5x)
- `low` (Soft preference): Poids très faible (0.5x)
- `none` (Soft preference): Neutre (0x, n'affecte pas)

**Propriétés architecturales**:
✅ Hard constraints éliminent offres non conformes
✅ Soft preferences pèsent différemment
✅ `none` permet exclure un critère sans supprimer

**LIMITATION IDENTIFIÉE**: Pas de mécanisme pour adapter dynamiquement les poids. Les poids sont fixes dans `getLevelWeight()`.

---

### 1.2 Qualité des Données (`DataStatus` + `DataPoint<T>`)
**Fichier**: `src/domain/types.ts` (lignes 43-71)
**Responsabilité**: Représenter l'état de confiance d'une donnée

**DataStatus enum**:
- `verified`: Confirmation d'une source autoritaire
- `known`: Information réputée
- `unknown`: Aucune information disponible
- `contradictory`: Plusieurs sources en désaccord
- `unverifiable`: Information existe mais non-vérifiable

**DataPoint<T>**:
```typescript
{
  value: T | null;
  status: DataStatus;
  provenance?: DataProvenance;
  conflictingValues?: T[]; // Si contradictory
}
```

**Propriétés architecturales**:
✅ Unknown ne peut pas avoir de valeur (`value` null si `status === 'unknown'`)
✅ Provenance conservée (source, date, fiabilité optionnelle)
✅ Conflits explicitement stockés

**INVARIANT CRITIQUE**: Unknown DOIT rester unknown, jamais transformé en BAD

---

### 1.3 Critères (`PreferenceCriterion`)
**Fichier**: `src/domain/types.ts` (lignes 81-96)
**Responsabilité**: Représenter un axe d'évaluation

**Champs**:
- `id`: Identifiant unique (ex: "price", "warranty", "country")
- `name`: Libellé humain
- `level`: PreferenceLevel (seen above)
- `evaluationType`: Optionnel (ex: "price-ascending", "boolean")
- `parameters`: Configuration flexible (ex: `{maxBudget: 600, currency: 'EUR'}`)

**Propriétés architecturales**:
✅ Extensible (parameters dict)
✅ Évaluation peut être spécialisée
✅ Neutre quant au domaine (works for any product category)

**LIMITATION IDENTIFIÉE**: 
- Pas de notion de « critère multi-valué » (ex: country: France OR Germany)
- `evaluationType` est une string libre (pas d'enum) → risque confusion

---

### 1.4 Profils Permanents (`UserProfile` + `CriteriaProfile`)
**Fichier**: `src/domain/types.ts` (lignes 101-132)
**Responsabilité**: Représenter les préférences durables d'un utilisateur

**Propriétés architecturales**:
✅ Séparé de la demande courante
✅ Immutable pendant recherche (commentaire d'invariant présent)
✅ Contient uniquement criteria (liste de PreferenceCriterion)

**LIMITATION IDENTIFIÉE**:
- Pas de mécanisme pour exprimer que le profil a "changé" (updatedAt est présent mais non utilisé)
- Pas de versioning ou historique des changements de profil

---

### 1.5 Demandes Contextuelles (`CurrentSearchRequirements`)
**Fichier**: `src/domain/types.ts` (lignes 147-169)
**Responsabilité**: Exprimer ce que l'utilisateur cherche MAINTENANT

**Champs**:
- `criteria`: Les critères spécifiques à cette recherche
- `profileExceptions`: Surcharges temporaires du profil (reason documentée)
- `clarifications`: Questions posées et réponses de l'utilisateur

**Propriétés architecturales**:
✅ Exceptions sont explicites
✅ Raison des exceptions documentée
✅ Clarifications conservées pour traçabilité

**LIMITATION IDENTIFIÉE**:
- Pas de notion de durée/portée de l'exception (est-elle juste pour cette recherche ou durée d'une session?)
- Pas de priorité explicitée entre criteria (tous les criteria de la demande sont au même niveau)

---

### 1.6 Merchant (Entité Commerciale)
**Fichier**: `src/domain/types.ts` (lignes 193-205)
**Responsabilité**: Identifier qui propose l'offre

**Champs**:
- `id`: Identifiant unique
- `name`: Nom affichable
- `country`: Pays (ISO?)
- `executionCapabilities`: Types d'automatisation possibles

**Propriétés architecturales**:
✅ AUCUNE field pour partnerships, affiliate, ou preferences cachées
✅ Commentaires explicites listent ce qui EST INTERDIT

**INVARIANT CRITIQUE**: Merchant.id n'affecte jamais le ranking

---

### 1.7 Product (Objet Commercial)
**Fichier**: `src/domain/types.ts` (lignes 217-231)
**Responsabilité**: Représenter l'objet en soi

**Champs**:
- `id`: Identifiant unique
- `category`: Catégorisation
- `name`: Nom du produit
- `specifications`: Record de DataPoint (caractéristiques objectives)

**Propriétés architecturales**:
✅ Distinct de Offer
✅ Specifications utilisent DataPoint (peuvent être unknown/contradictory)

**LIMITATION IDENTIFIÉE**:
- Pas de mécanisme de déduplication (comment reconnaître que deux Product enregistrements parlent du même produit?)
- `source` est juste un string, pas de traçabilité complète

---

### 1.8 Offer (Proposition Commerciale)
**Fichier**: `src/domain/types.ts` (lignes 242-269)
**Responsabilité**: Représenter une proposition spécifique

**Champs**:
- `id`: Identifiant unique
- `productId`: Référence au Product
- `merchant`: Qui propose
- `price`: DataPoint<number> (peut être unknown!)
- `currency`: ISO code
- `shippingCost`: DataPoint<number>
- `shippingTime`: DataPoint<string> (optionnel)
- `characteristics`: Toutes les autres DataPoints
- `executionCapability`: Comment acheter (UCP, API, redirect, etc.)
- `executionUrl`: Lien ou endpoint

**Propriétés architecturales**:
✅ Price est toujours DataPoint (peut être unknown)
✅ ExecutionCapability séparé (n'affecte pas ranking)
✅ Characteristics uniformément typé

**CRITICAL**: Toutes les données sont DataPoint (donc statut de confiance préservé)

---

### 1.9 Résultats de Ranking

#### 1.9.1 CriterionScore (Score par critère)
**Fichier**: `src/domain/types.ts` (lignes 278-295)
**Responsabilité**: Expliquer le score sur UN critère

**Champs**:
- `criterionId`, `criterionName`, `level`: Identification du critère
- `score`: 0-100
- `reasoning`: Explication textuelle
- `dataUsed`: Quelle donnée a été utilisée + son statut

**Propriétés architecturales**:
✅ Traçabilité complète (why this score?)
✅ DataStatus conservé dans explanation

#### 1.9.2 RankedOffer (Offre classée)
**Fichier**: `src/domain/types.ts` (lignes 301-322)
**Responsabilité**: Offre + son classement + explication

**Champs**:
- `offer`: L'Offer complète
- `overallScore`: Score global 0-100
- `criterionScores`: Breakdown par critère
- `summary`: Résumé lisible
- `satisfiesAllConstraints`: Boolean
- `violatedConstraints`: Détail des violations

**Propriétés architecturales**:
✅ Explication multi-niveaux (overall + per-criterion)
✅ Constraints violations explicites

#### 1.9.3 RankingResult (Résultat complet)
**Fichier**: `src/domain/types.ts` (lignes 348-365)
**Responsabilité**: Résultat d'un ranking complet

**Champs**:
- `rankedOffers`: Offres classées (triées best-first)
- `rejectedOffers`: Offres rejetées (constraint violations)
- `checksum`: Hash pour reproductibilité

**Propriétés architecturales**:
✅ Offres rejetées SÉPARÉES des classées
✅ Checksum pour vérifier déterminisme

---

### 1.10 MergedContext (Fusion profil + demande)
**Fichier**: `src/domain/types.ts` (lignes 378-394)
**Responsabilité**: Critères effectifs après fusion

**Propriétés architecturales**:
✅ Ne modifie pas UserProfile ni CurrentSearchRequirements
✅ Traçabilité: chaque critère a une `source` (profile/search/exception)

**LIMITATION IDENTIFIÉE**:
- Actuellement non utilisé par Priority Engine (rankOffers reçoit directement effectiveCriteria)
- Utile pour audit mais pas critique au fonctionnement

---

### 1.11 AIInterpretationResult (Output IA)
**Fichier**: `src/domain/types.ts` (lignes 410-439)
**Responsabilité**: Résultat de l'interprétation IA (future)

**Champs**:
- `extractedCriteria`: Critères compris
- `ambiguities`: Cas où plusieurs interprétations sont possibles
- `resolvedClarifications`: Réponses utilisateur aux questions
- `detectedExceptions`: Exceptions au profil détectées
- `confidence`: 0-1 score de confiance

**Propriétés architecturales**:
✅ L'IA NE DÉCIDE PAS, elle PROPOSTE
✅ Ambiguïtés flaggées pour clarification
✅ Raison de confiance basse documentée

---

## 2. CONCEPTS CLÉS DANS LE PRIORITY ENGINE

### 2.1 Logique de Scoring
**Fichier**: `src/decision/priority-engine.ts`

**Workflow**:
```
RankingRequest (offers + criteria)
  ↓
Pour chaque Offer:
  ↓
  Pour chaque Criterion:
    - Trouver la donnée correspondante
    - Évaluer son statut (verified/known/unknown/contradictory/unverifiable)
    - Scorer selon le statut ET la valeur
    - Appliquer le poids (getLevelWeight)
  ↓
  Score global = moyenne pondérée
  ↓
  Vérifier constraints durs (forbidden/required)
  ↓
RankingResult
```

**Fonctions critiques**:

#### `scoreOffer()`
- Itère sur tous les criteria
- Accumule scores pondérés
- Vérifie hard constraints
- Retourne: scores breakdown + overall + constraint violations

#### `scoreCriterion()`
- Étape CAPITALE: gère DataStatus correctement
- `unknown` → handleUnknownData (NOT automatic penalty)
- `contradictory` → handleContradictoryData (flag it)
- `verified`/`known` → evaluateDataValue (score la valeur)

#### `evaluateDataValue()`
- Heuristique pour scorer une valeur
- **IMPORTANT**: Distinction CONSTRAINT vs PREFERENCE
  - Si `required`: résultat binaire (OK ou FAIL)
  - Si `preference`: graduel (meilleur = plus haut score)

#### Poids (`getLevelWeight()`)
```
forbidden    → 10  (Heavy penalty if violated)
required     → 8   (Must satisfy)
very_important → 5
important    → 3
preference   → 1.5
low          → 0.5
none         → 0   (N'affecte rien)
```

### 2.2 Utilitaires Publics
- `rankOffers()`: Main entry point
- `mergeProfileAndRequirements()`: Fusionne profil + demande + exceptions
- `filterEligible()`: Sépare offres valides / rejetées

---

## 3. CONCEPTS MANQUANTS OU PAS ENCORE IMPLÉMENTÉS

| Concept | Statut | Raison |
|---------|--------|--------|
| Déduplication Product | ❌ Missing | Comment reconnaître deux Product records du même produit? |
| Versioning Profil | ❌ Missing | Historique des changements de préférences utilisateur |
| Portée Exception | ❌ Missing | Durée/scope de l'exception temporaire? |
| Mécanisme Clarification | ❌ Missing | Comment IA demande clarification et intègre réponse? |
| Discovery / Search | ❌ Missing | Comment trouver Product/Offer (abstractions pour sources) |
| Normalisation | ❌ Missing | Comment harmoniser données contradictoires |
| Explications IA | ❌ Missing | Comment IA explique le ranking post-hoc |
| Exécution | ❌ Missing | Comment utiliser executionCapability pour acheter |
| Persistance | ❌ Missing | Stockage UserProfile, historique, etc. |
| Authentification | ❌ Missing | Qui est l'utilisateur? |

---

## 4. PROBLÈMES IDENTIFIÉS DANS LE CODE

### 4.1 Score Threshold pour Required Constraint
**Ligne**: `priority-engine.ts` ligne 62
```typescript
if (criterion.level === 'required' && score.score < 50) {
```
**Problème**: Hardcoded threshold de 50. Pourquoi 50 et pas 40 ou 75?
**Impact**: Une offre peut barely scorer 50 et être considérée conforme alors qu'elle n'est pas réellement satisfactory
**OPEN_DECISION**: Quel score minimum pour satisfaire `required`?

### 4.2 Forbidden Threshold
**Ligne**: `priority-engine.ts` ligne 53
```typescript
if (criterion.level === 'forbidden' && score.score > 0) {
```
**Problème**: Toute valeur > 0 est rejetée. Trop strict?
**Impact**: Une offre with score 1 est rejetée de la même façon qu'une offer avec score 100
**OPEN_DECISION**: Quel score minimum pour violer `forbidden`?

### 4.3 Heuristique Warranty
**Ligne**: `priority-engine.ts` lignes 263-270
```typescript
const yearMatch = value.match(/(\d+)\s*year/);
if (yearMatch) {
  const years = parseInt(yearMatch[1], 10);
  return Math.min(100, 40 + years * 15);
}
```
**Problème**: Heuristique ad-hoc pour interpréter "3 years" → 85 points
**Impact**: Non documentée, non configurable, peut échouer sur variantes ("3-year", "trois ans", etc.)
**OPEN_DECISION**: Devrait-on avoir un système plus générique d'évaluation?

### 4.4 Missing Data Handling
**Fonction**: `handleMissingData()` - Applique une pénalité fixe selon level
**Problème**: Si critère est `preference` mais data est missing, score = 50 (neutre). Est-ce correct ou faut-il penaliser?
**OPEN_DECISION**: Penalty pour données manquantes selon le contexte?

### 4.5 Contradictory Data
**Fonction**: `handleContradictoryData()` - Retourne 35 ou 50
**Problème**: Réduction arbitraire de 15 points pour hard constraints
**OPEN_DECISION**: Quand contradictions, comment classuer l'offre?

### 4.6 Merchant Identity Hidden in Offer
**Problème**: `Offer.merchant` contient l'identité complète
**Impact**: Priority Engine pourrait accidentellement utiliser merchant.name ou merchant.id pour scoring (bien que actuellement ça ne le fasse pas)
**Recommendation**: Peut-être séparer ExecutionInfo de Merchant pour plus de clarté?

### 4.7 No Deduplication Logic
**Problème**: Si deux Offers ont productId="A" mais proviennent de sources différentes, elles sont considérées comme deux offers distinctes
**Impact**: Utilisateur voit plusieurs fois le même produit avec des prix différents
**Status**: Expected (Discovery layer will handle dedup later), but noted

---

## 5. FORCE DU MODÈLE ACTUEL

✅ **DataPoint<T>** : Excellent design pour unknown/contradictory
✅ **Séparation Profile/Request** : Permet exceptions sans mutation
✅ **Merchant Neutral** : Pas de fields pour bias commercial
✅ **Product ≠ Offer** : Distinction clairement maintenue
✅ **Deterministic** : Pas de external calls, pas de random
✅ **Traceable** : Reasoning présent à chaque niveau
✅ **Extensible** : parameters dict permet ajouter config
✅ **Hard vs Soft Constraints** : Bien modélisé avec PreferenceLevel
✅ **ExecutionCapability Separated** : N'affecte pas ranking

---

## 6. FAIBLESSES / LIMITATIONS

⚠️ Hard thresholds (50 pour required, 0 pour forbidden) non justifiés
⚠️ Heuristiques ad-hoc pour types spécifiques (warranty, price)
⚠️ Pas de système de résolution pour données contradictoires
⚠️ Pas de déduplication Product
⚠️ Pas de versioning / historique Profil
⚠️ Pas de notion de confiance/reliability sur données
⚠️ Poids fixes pour PreferenceLevel (pas adaptables)
⚠️ evaluationType est string libre (risque confusion)

---

## 7. PRÊT POUR SUITE?

✅ Core model is sound
✅ Invariants are well-represented
❌ Needs deeper testing of edge cases
❌ Needs documentation of scoring decisions (why 50? why 0?)
❌ Needs expansion of test scenarios to 14 detailed cases
