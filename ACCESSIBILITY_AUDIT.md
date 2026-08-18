# AUDIT D'ACCESSIBILITÉ — CAPUCINE
## État initial du produit

**Date**: 18 Août 2026  
**Scope**: Application Web (shopping-assistant/frontend)  
**Standard**: WCAG 2.2 AA  
**Méthodologie**: Code review + heuristique (tests réels sur dispositif requis pour validation complète)

---

## 1. RÉSUMÉ EXÉCUTIF

### État Actuel
L'application shopping-assistant possède une **structure HTML basique** mais présentant **plusieurs écarts significatifs** par rapport à WCAG 2.2 AA :

- ❌ Structure HTML sémantique **partiellement implémentée**
- ❌ Labels associés aux inputs (OK) mais **aria-labels manquants**
- ❌ Pas de support pour **lecteur d'écran** (NVDA, JAWS, VoiceOver)
- ❌ Pas de **navigation au clavier complète**
- ❌ Contraste des couleurs **à vérifier** (dépend du rendu réel)
- ❌ Pas de support **texte agrandi**
- ❌ Pas de support **mode haut contraste**
- ❌ Modales **non accessibles** (pas d'ARIA, pas de gestion du focus)
- ❌ Aucune annonce de contenu dynamique (ARIA live regions)
- ❌ Pas de navigation par landmarks
- ⚠️ JavaScript **essentiel** — l'app ne fonctionne pas sans

### Conclusion Intermédiaire
L'application **nécessite des améliorations substantielles** pour atteindre WCAG 2.2 AA, mais elle n'est **pas un désastre**. C'est un point de départ normal pour une startup.

---

## 2. AUDIT DÉTAILLÉ PAR DOMAINE

### 2.1 STRUCTURE HTML & SÉMANTIQUE

#### Évaluation

| Critère | État | Détails |
|---------|------|---------|
| Doctype & langue | ✅ OK | `<!DOCTYPE html>`, `lang="fr"` présents |
| Titres (h1-h6) | ⚠️ Partiellement | h1 et h2 présents, hiérarchie à vérifier |
| Landmarks (nav, main, aside, footer) | ❌ Manquant | Pas de `<main>`, pas de `<footer>`, `<nav>` présente mais non sémantique |
| Sections logiques | ⚠️ Partiellement | Pages séparées par `<div>` avec id, pas de `<section>` ou `<article>` |
| Listes | ✅ OK | Listes HTML utilisées (`.nav-menu`, `.lists-grid`) |

#### Problèmes Identifiés

1. **Pas de landmark `<main>`**
   - Le contenu principal est dans `<div class="container">` au lieu de `<main>`
   - **Impact**: Lecteurs d'écran ne peuvent pas naviguer facilement vers le contenu principal

2. **Navigation non sémantique**
   ```html
   <div class="nav-menu" id="navMenu">
     <a href="#" class="nav-link">...</a>
   </div>
   ```
   Devrait être:
   ```html
   <nav role="navigation" aria-label="Navigation principale">
     <ul>
       <li><a href="...">...</a></li>
     </ul>
   </nav>
   ```

3. **Modales non sémantiques**
   ```html
   <div id="recommendationsModal" class="modal" style="display: none;">
   ```
   Pas d'attribut `role="dialog"`, pas de gestion du focus.

#### Recommandations P0

- [ ] Ajouter `<main>` autour du contenu principal
- [ ] Convertir `.nav-menu` en `<nav>` sémantique
- [ ] Ajouter `role="dialog"` et `aria-modal="true"` aux modales
- [ ] Utiliser `<section>` au lieu de `<div>` pour les sections logiques

---

### 2.2 LABELS & IDENTIFICATION DES FORMULAIRES

#### Évaluation

| Critère | État | Détails |
|---------|------|---------|
| Input labels | ✅ OK | `<label for="id">` utilisés correctement |
| Input grouping | ⚠️ Partiellement | Pas de `<fieldset>` autour des groupes |
| Placeholder | ❌ Problème | Placeholders utilisés à la place de labels secondaires |
| Required fields | ⚠️ Manquant | Attribut `required` présent dans HTML mais pas d'indication visuelle |
| Error messages | ❌ Manquant | Pas d'annonce d'erreur via ARIA |

#### Problèmes Identifiés

1. **Placeholders utilisés comme labels**
   ```html
   <input type="email" id="loginEmail" placeholder="votre@email.com" required>
   ```
   Le placeholder disparaît quand l'utilisateur tape. Les lecteurs d'écran ne le voient pas toujours.

2. **Pas d'indication visuelle pour les champs requis**
   ```html
   <label for="loginEmail">Email</label>
   <input type="email" id="loginEmail" ... required>
   ```
   Pas d'astérisque `*` ou `aria-required="true"`

3. **Pas de handling d'erreurs accessible**
   Les erreurs de validation ne sont probablement pas annoncées aux lecteurs d'écran.

#### Recommandations P0

- [ ] Ajouter `aria-label` ou `aria-describedby` pour tous les inputs sans labels explicites
- [ ] Ajouter `aria-required="true"` aux champs requis
- [ ] Ajouter indication visuelle (ex: `*`) pour champs requis
- [ ] Créer zone d'erreurs avec `role="alert"` et `aria-live="polite"`

---

### 2.3 NAVIGATION AU CLAVIER

#### Évaluation

| Critère | État | Détails |
|---------|------|---------|
| Tous éléments focusables | ❌ Non testé | Nécessite test réel du clavier |
| Tab order logique | ❌ Non spécifié | Aucun `tabindex` défini, l'ordre par défaut dépend du HTML |
| Focus visible | ⚠️ Partiellement | CSS minimal pour `:focus`, dépend du navigateur |
| Pas de keyboard trap | ❌ Non testé | Modales peuvent créer des traps |
| Skip links | ❌ Manquant | Pas de lien "Aller au contenu principal" |

#### Problèmes Identifiés

1. **Pas de skip link**
   - Utilisateur qui tabule doit traverser toute la navigation avant d'arriver au contenu
   - **Impact**: Utilisateurs au clavier naviguent lentement

2. **Modales sans gestion du focus**
   - La modale se superpose mais le focus peut s'échapper
   - Pas de `trap` ou de fermeture à l'Escape

3. **Pas de style `:focus` visible**
   - CSS n'a probablement pas de `.btn:focus`, `.input:focus` clair

#### Recommandations P0

- [ ] Ajouter skip link visible au clavier
- [ ] Ajouter CSS `:focus-visible` sur tous éléments interactifs
- [ ] Implémenter focus trap dans modales
- [ ] Tester navigation clavier complète

---

### 2.4 COULEURS & CONTRASTE

#### Évaluation (sur base palette CSS)

```css
--primary: #6366f1;        /* Indigo */
--primary-dark: #4f46e5;   /* Indigo dark */
--primary-light: #e0e7ff;  /* Indigo light */
--secondary: #ec4899;      /* Rose */
--danger: #ef4444;         /* Rouge */
--dark: #1f2937;           /* Gris foncé */
--light: #f9fafb;          /* Gris très clair */
--gray: #6b7280;           /* Gris moyen */
```

| Combinaison | Ratio | WCAG AA | WCAG AAA |
|-------------|-------|---------|----------|
| `#6366f1` (primary) sur blanc | ~4.5:1 | ✅ OK | ⚠️ Limite |
| `#4f46e5` (primary-dark) sur blanc | ~5.5:1 | ✅ OK | ✅ OK |
| `#6b7280` (gray) sur blanc | ~4.5:1 | ✅ OK | ⚠️ Limite |
| `#6b7280` (gray) sur fond gris clair | ? | ❌ Trop faible |
| `#1f2937` (dark) sur blanc | ~14:1 | ✅ OK | ✅ OK |

**⚠️ Note importante**: Les calculs ci-dessus sont des approximations. Un vrai audit nécessite:
- Mesure dans un vrai navigateur
- Vérification de tous les états (hover, active, disabled)
- Vérification des combinaisons de couleurs réelles utilisées

#### Problèmes Potentiels Identifiés

1. **Couleur grise sur fond blanc**
   - `.nav-link` utilise `color: var(--gray)` sur fond blanc
   - Ratio probable ~4.5:1 — à la limite

2. **Absence de mode haut contraste**
   - Aucun support CSS pour `prefers-contrast: more`
   - Pas de thème foncé (`prefers-color-scheme: dark`)

#### Recommandations P1

- [ ] Tester tous contrastes avec outils (WCAG Contrast Checker)
- [ ] Ajouter media query `@media (prefers-color-scheme: dark)`
- [ ] Ajouter media query `@media (prefers-contrast: more)`

---

### 2.5 TAILLE DE TEXTE & ZOOM

#### Évaluation

| Critère | État | Détails |
|---------|------|---------|
| Unités relatives (em, rem) | ✅ Partiellement | Certains rem utilisés, certains px |
| Responsive | ✅ Basique | Media queries probables mais à vérifier |
| Zoom navigateur | ⚠️ Non testé | HTML n'empêche pas `user-scalable=no` (mais c'est le cas ici) |
| Support agrandissement texte | ❌ Non testé | Nécessite test réel avec agrément texte du navigateur |

#### Problèmes Identifiés

1. **Viewport correctement configuré**
   ```html
   <meta name="viewport" content="width=device-width, initial-scale=1.0">
   ```
   ✅ Bon — Pas de `user-scalable=no`, permet zoom

2. **Certains pixels utilisés**
   - Probablement des `font-size: 14px` ou similaire au lieu de `0.875rem`
   - Cela complique l'agrandissement

#### Recommandations P1

- [ ] Convertir tous `px` en `rem` ou `em` pour font-sizes
- [ ] Tester avec zoom navigateur à 200%
- [ ] S'assurer que layout reste utilisable

---

### 2.6 CONTENU DYNAMIQUE & ANNONCES

#### Évaluation

| Critère | État | Détails |
|---------|------|---------|
| ARIA live regions | ❌ Manquant | Pas de `aria-live` sur contenu qui change |
| Annonce de chargement | ❌ Manquant | Pas de feedback pour utilisateur lecteur d'écran lors de fetch |
| Annonce de notification | ⚠️ Partiellement | `.notification` peut exister mais sans `role="alert"` |
| Annonce de pagination | ❌ Manquant | Si pagination existe, pas d'annonce |

#### Problèmes Identifiés

1. **Pas d'annonce lors de chargement de données**
   ```javascript
   fetch(...).then(data => {
     // Affiche les données
     // Mais un utilisateur lecteur d'écran ne sait pas qu'il y a du contenu nouveau
   })
   ```

2. **Notifications toast sans accessibilité**
   ```html
   <div id="notification" class="notification"></div>
   ```
   Devrait avoir `role="alert"` ou `aria-live="polite"`

#### Recommandations P1

- [ ] Ajouter `aria-live="polite"` et `role="alert"` au #notification
- [ ] Ajouter zone de statut avec `aria-live="assertive"` pour chargements
- [ ] Annoncer nombre de résultats quand contenu se charge

---

### 2.7 IMAGES & CONTENU MULTIMÉDIA

#### Évaluation

| Critère | État | Détails |
|---------|------|---------|
| Alt text | ⚠️ Partiellement | Emoji seul (🛒) n'a pas d'alt |
| Icônes | ❌ Problème | Emoji utilisés comme icônes sans fallback texte |
| Images décoratives | ❌ Non applicable | Pas d'images, que emoji |

#### Problèmes Identifiés

1. **Emoji sans description texte**
   ```html
   <span class="logo-icon">🛒</span>
   ```
   Un lecteur d'écran dit "shopping cart emoji" mais c'est peu utile.
   Devrait avoir `aria-label="Shopping Assistant"` sur le logo parent.

2. **Emoji dans les boutons**
   ```html
   <button class="btn-primary" id="newListBtn">+ Nouvelle Liste</button>
   <button class="btn-secondary" id="recommendationsBtn">✨ Recommandations</button>
   ```
   L'emoji ne porte pas de label sémantique.

#### Recommandations P0

- [ ] Ajouter `aria-label` sur `.logo` pour décrire le logo
- [ ] Ajouter `aria-label` sur les boutons avec emoji uniquement

---

### 2.8 MODALES & DIALOGS

#### État Actuel

```html
<div id="recommendationsModal" class="modal" style="display: none;">
  <div class="modal-content">
    <button class="modal-close" id="closeRecommendationsBtn">&times;</button>
    <h2>✨ Recommandations Intelligentes</h2>
    ...
  </div>
</div>
```

#### Problèmes

1. ❌ Pas de `role="dialog"` ou `role="alertdialog"`
2. ❌ Pas de `aria-modal="true"`
3. ❌ Pas de `aria-labelledby` pointant vers le titre
4. ❌ Pas de gestion du focus (le focus peut sortir de la modale)
5. ❌ Pas de fermeture à Escape
6. ❌ Pas d'overlay transparent accessible

#### Recommandations P0

```html
<div id="recommendationsModal" class="modal" role="dialog" aria-modal="true" 
     aria-labelledby="modalTitle" aria-hidden="true" style="display: none;">
  <div class="modal-overlay"></div>
  <div class="modal-content">
    <button class="modal-close" aria-label="Fermer">×</button>
    <h2 id="modalTitle">✨ Recommandations Intelligentes</h2>
    ...
  </div>
</div>
```

---

### 2.9 LECTEUR D'ÉCRAN — ESTIMATION

#### Test Non Réalisé

Je ne peux pas tester réellement avec NVDA, JAWS ou VoiceOver sans avoir accès à un navigateur réel avec ces outils installés.

**Cependant**, basé sur l'analyse du code, les résultats attendus seraient:

**NVDA (Windows)**
- Navigation par headings: ⚠️ Incomplet (pas de `<main>`)
- Navigation par landmarks: ❌ Très limité
- Navigation par forms: ⚠️ OK (labels présents)
- Navigation par listes: ✅ OK
- Annonce du titre de page: ✅ OK
- Contenu dynamique: ❌ Pas annoncé

**VoiceOver (Mac/iOS)**
- Essentiellement similaire à NVDA

---

## 3. NORMES ET RÉGLEMENTATIONS APPLICABLES

### 3.1 WCAG 2.2

WCAG 2.2 est la norme actuelle (publiée juin 2023, adoptée par W3C).

**Principes:**
- **Perceivable** — Les utilisateurs doivent percevoir le contenu
- **Operable** — Les utilisateurs doivent pouvoir contrôler le contenu
- **Understandable** — Les utilisateurs doivent comprendre le contenu
- **Robust** — Le contenu doit fonctionner avec technologies d'assistance

**Niveau de conformité:**
- **A** (minimum)
- **AA** (recommandé, cible générale)
- **AAA** (avancé, pour sites spécialisés)

### 3.2 Exigences Européennes

**European Accessibility Act (EAA)** - applicable depuis 2025:
- Applicables aux produits et services numériques
- Exigence de conformité WCAG 2.1 AA minimum
- Déclaration d'accessibilité requise

**RGPD** - implications:
- Données d'accessibilité (ex: profil utilisateur) peuvent être sensibles
- Nécessite consentement explicite pour stockage
- Droit à l'oubli applicable

### 3.3 Exigences Françaises

**Loi Handicap 2005** (modifiée):
- Accessibilité obligatoire pour services publics
- Accessibilité recommandée pour secteur privé
- Standard RGAA 4.1 (adaptation française de WCAG 2.1)

**RGAA 4.1** — 106 critères (plus strict que WCAG 2.1 AA)

---

## 4. TABLEAU RÉCAPITULATIF WCAG 2.2 AA

### Critères Actuellement Non Respectés

| ID WCAG | Critère | État | Sévérité |
|---------|---------|------|----------|
| 1.1.1 | Alternative textuelle (images/emojis) | ⚠️ Partiellement | A |
| 1.4.3 | Contraste minimum | ⚠️ À vérifier | AA |
| 1.4.10 | Reflow (zoom 200%) | ⚠️ Non testé | AA |
| 1.4.13 | Contenu au survol/focus | ⚠️ Partiellement | AA |
| 2.1.1 | Clavier | ❌ Incomplet | A |
| 2.1.2 | Pas de keyboard trap | ⚠️ Non testé | A |
| 2.4.3 | Focus order | ⚠️ Non défini | A |
| 2.4.5 | Accès alternatif (en-têtes) | ⚠️ Limité | A |
| 2.4.7 | Focus visible | ⚠️ Insuffisant | AA |
| 3.2.1 | Change on focus | ⚠️ À vérifier | A |
| 3.2.2 | Change on input | ⚠️ À vérifier | A |
| 3.3.1 | Identification d'erreur | ❌ Manquant | A |
| 3.3.2 | Labels ou instructions | ⚠️ Partiellement | A |
| 4.1.2 | Nom, rôle, valeur | ❌ Incomplet | A |
| 4.1.3 | Messages de statut | ❌ Manquant | AA |

**Estimé: ~40-50% de conformité WCAG 2.2 AA actuellement**

---

## 5. MOBILE ACCESSIBILITY

### iOS VoiceOver

État non testé. Points clés:
- Pas d'accessibilité native iOS identifiée dans le code
- Application Web uniquement (pas d'app native identifiée)
- VoiceOver testera les `aria-*` attributes

### Android TalkBack

État non testé. Points clés:
- Même que iOS — basé sur application Web
- TalkBack testera ARIA

### Considérations

- Zones tactiles minimum: 44×44pt (ok pour la plupart des boutons)
- Support du zoom: ✅ Viewport correctement configuré
- Réduction de mouvement: ❌ Pas de support `prefers-reduced-motion`

---

## 6. RISQUES & IMPLICATIONS

### Risques Légaux

1. **EAA** (2025): Conformité WCAG 2.1 AA requise
   - Non-conformité peut entraîner amendes
   - Capucine doit se conformer si opère en UE

2. **RGAA** (France): 106 critères
   - Plus strict que WCAG
   - Applicable potentiellement en France

3. **Plaintes utilisateurs**: Risque de litigation si client handicapé ne peut pas utiliser

### Risques d'Image

1. **Positif**: Conformité = storytelling fort ("accessible dès la conception")
2. **Négatif**: Non-conformité + affichage de prétention = backlash

---

## 7. PLAN DE REMÉDIATION

### Phase 0 (Urgent — Semaines 1-2)

- [ ] Ajouter sémantique HTML basique (main, nav, roles)
- [ ] Ajouter aria-labels manquants
- [ ] Ajouter focus styles visibles
- [ ] Ajouter role="alert" aux notifications
- [ ] Tests clavier basiques

**Estimated effort**: 1 semaine (1 dev)

### Phase 1 (Important — Semaines 3-6)

- [ ] Tester avec NVDA (Windows) + VoiceOver (Mac)
- [ ] Corriger focus order + keyboard traps
- [ ] Implémenter gestion des modales accessibles
- [ ] Tester tous contrastes + implémenter dark mode
- [ ] Implémenter skip links

**Estimated effort**: 2-3 semaines (1 dev)

### Phase 2 (Nice-to-have — Semaines 7-12)

- [ ] Simplification cognitive (interface simplifiée)
- [ ] Interaction vocale
- [ ] Text-to-Speech
- [ ] Agrément texte avancé

**Estimated effort**: 4-6 semaines (2 devs)

---

## 8. NOTES MÉTHODOLOGIQUES

### Ce qui a été analysé

- ✅ Code HTML statique
- ✅ Palette CSS et styles
- ✅ Structure des fichiers JS
- ⚠️ Rendu réel (limité — basé sur inspection)

### Ce qui nécessite test réel

- ❌ Lecteur d'écran (NVDA, JAWS, VoiceOver, TalkBack)
- ❌ Navigation clavier complète
- ❌ Contrastes exacts (dépend du rendu navigateur)
- ❌ Zoom et reflow à 200%
- ❌ Clignotement (si animation présente)

### Outils recommandés pour vérification complète

1. **WCAG Contrast Checker** — Vérifier tous les contrastes
2. **axe DevTools** — Extension Chrome/Firefox, détecte 50+ violations
3. **NVDA** — Lecteur d'écran gratuit (Windows)
4. **JAWS** — Lecteur d'écran professionnel (Windows, ~90€/an)
5. **VoiceOver** — Intégré macOS/iOS
6. **TalkBack** — Intégré Android
7. **Lighthouse** — Audit d'accessibilité dans Chrome DevTools

---

## 9. CONCLUSION

### État Résumé

Capucine Web est une **application standard** avec une **accessibilité basique** mais présentant plusieurs **écarts significatifs** pour WCAG 2.2 AA.

### Chemin Avant de Lancer Publiquement

**Avant la sortie publique**, il est impératif de:

1. ✅ Atteindre **WCAG 2.2 AA minimum** (recommandé)
2. ✅ Tester avec **lecteurs d'écran réels** (NVDA + 1 autre)
3. ✅ Tester **navigation clavier complète**
4. ✅ Implémenter **interaction vocale** (au moins STT)
5. ✅ Communiquer la **déclaration d'accessibilité**

### Priorités Immédiates

**P0 (Cette semaine)**:
- Sémantique HTML (main, nav, roles, aria-labels)
- Focus visible
- Notifications accessibles

**P1 (Prochaines 2-3 semaines)**:
- Tests avec lecteurs d'écran
- Keyboard navigation
- Contrastes + dark mode

**P2 (Après 1 mois)**:
- Simplification cognitive
- Interaction vocale
- Co-design avec associations

---

**Rapport préparé par**: Architecture & Accessibility Analysis  
**Prochaine étape**: Implémentation Phase 0 (HTML sémantique)
