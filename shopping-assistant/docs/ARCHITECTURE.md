# 🏗️ Architecture - Shopping Assistant

## 📐 Vue d'ensemble

Shopping Assistant est une application full-stack construite avec :

- **Backend** : Node.js + Express.js + SQLite
- **Frontend** : HTML5 + CSS3 + JavaScript (Vanilla)
- **IA** : Anthropic Claude API
- **Authentification** : JWT (JSON Web Tokens)

```
┌─────────────────────────────────────────────┐
│         Client Browser (Frontend)            │
│  ┌─────────────────────────────────────┐   │
│  │  index.html (UI)                    │   │
│  │  css/style.css (Styling)            │   │
│  │  js/                                │   │
│  │  ├── app.js (Main Logic)            │   │
│  │  ├── auth.js (Authentication)       │   │
│  │  ├── shopping.js (Shopping Lists)   │   │
│  │  └── recommendations.js (AI)        │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
              ↕ HTTP/REST/JSON
┌─────────────────────────────────────────────┐
│       Express.js Backend (Node.js)           │
│  ┌─────────────────────────────────────┐   │
│  │  server.js (Entry Point)            │   │
│  │  middleware/                        │   │
│  │  ├── auth.js (JWT Verification)     │   │
│  │  └── errorHandler.js (Error Mgmt)   │   │
│  │  routes/                           │   │
│  │  ├── auth.js (Register/Login)       │   │
│  │  ├── shopping.js (Lists/Items)      │   │
│  │  └── recommendations.js (Claude AI) │   │
│  │  utils/                            │   │
│  │  ├── database.js (SQLite ORM)       │   │
│  │  └── logger.js (Logging)            │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
         ↕ SQL              ↕ HTTP REST
   ┌─────────────┐     ┌─────────────────┐
   │  SQLite DB  │     │  Claude API     │
   │  Local File │     │  Anthropic      │
   └─────────────┘     └─────────────────┘
```

---

## 📁 Structure des fichiers

### Backend (`backend/`)

```
backend/
├── server.js              # Point d'entrée principal
├── package.json           # Dépendances et scripts
├── .env.example          # Variables d'environnement
│
├── middleware/
│   ├── auth.js           # Vérification JWT
│   └── errorHandler.js   # Gestion centralisée des erreurs
│
├── routes/
│   ├── auth.js           # POST /register, /login, /verify
│   ├── shopping.js       # CRUD listes et articles
│   └── recommendations.js # Claude API intégration
│
├── utils/
│   ├── database.js       # SQLite gestion + schémas
│   └── logger.js         # Système de logging
│
├── data/
│   └── shopping_assistant.db  # Base de données (créée à l'exécution)
```

### Frontend (`frontend/`)

```
frontend/
├── index.html            # Page HTML principale
│
├── css/
│   └── style.css        # Styles (responsive design)
│
└── js/
    ├── app.js           # Logique principale (routing, CRUD)
    ├── auth.js          # Gestion authentification
    ├── shopping.js      # Gestion listes (extensible)
    └── recommendations.js # Recommandations (extensible)
```

---

## 🗄️ Schéma de base de données

### Table: `users`
```sql
id (INT, PK)
email (TEXT, UNIQUE)
username (TEXT, UNIQUE)
password_hash (TEXT)
full_name (TEXT)
budget (REAL)
currency (TEXT)
preferences (JSON)
created_at (DATETIME)
updated_at (DATETIME)
```

### Table: `shopping_lists`
```sql
id (INT, PK)
user_id (INT, FK → users)
title (TEXT)
description (TEXT)
total_cost (REAL)
is_completed (BOOLEAN)
created_at (DATETIME)
updated_at (DATETIME)
```

### Table: `shopping_items`
```sql
id (INT, PK)
list_id (INT, FK → shopping_lists)
name (TEXT)
quantity (REAL)
unit (TEXT)
estimated_price (REAL)
actual_price (REAL)
category (TEXT)
is_checked (BOOLEAN)
notes (TEXT)
created_at (DATETIME)
updated_at (DATETIME)
```

### Table: `purchase_history`
```sql
id (INT, PK)
user_id (INT, FK → users)
list_id (INT, FK → shopping_lists)
total_spent (REAL)
items_bought (INT)
date (DATETIME)
notes (TEXT)
```

### Table: `recommendations`
```sql
id (INT, PK)
user_id (INT, FK → users)
item_id (INT, FK → shopping_items)
recommendation_text (TEXT)
category (TEXT)
created_at (DATETIME)
```

---

## 🔐 Flux d'authentification

### 1. Inscription

```
User Input (email, password)
    ↓
Validate Input
    ↓
Hash Password (bcryptjs)
    ↓
Insert into DB
    ↓
Generate JWT Token
    ↓
Return Token + User Data
    ↓
Frontend: Save Token in localStorage
```

### 2. Login

```
User Input (email, password)
    ↓
Query User by Email
    ↓
Compare Password Hash
    ↓
Generate JWT Token
    ↓
Return Token
    ↓
Frontend: Save Token in localStorage
```

### 3. Protected Routes

```
Frontend Request
    ↓
Add Token to Header: Authorization: Bearer {token}
    ↓
Backend: authMiddleware
    ↓
Verify Token Signature
    ↓
Extract userId
    ↓
Proceed or Return 401
```

---

## 🤖 Intégration Claude API

### Flux de recommandation

```
User List Items
    ↓
Format Prompt
    ↓
Call Claude API
    ↓
claude-opus-4-6 Model (max 2000 tokens)
    ↓
Parse JSON Response
    ↓
Save to DB (recommendations table)
    ↓
Display to Frontend
```

### Prompt Structure

```
[System Context]
You are a smart shopping assistant.

[User Data]
Shopping list items with categories/prices

[Request]
Generate recommendations for:
1. Cheaper alternatives
2. Common promotions
3. Complementary items
4. Buying tips

[Response Format]
{
  "recommendations": [
    { "item": "", "suggestion": "", "type": "", "savings": "" }
  ],
  "summary": ""
}
```

---

## 🔄 Flux de données

### Créer une liste

```
Frontend:                Backend:
1. POST /shopping/lists  → Receive request
                         → Validate data
                         → Insert into DB
2. ← Return list object
3. Update UI
```

### Ajouter un article

```
Frontend:               Backend:
1. POST /shopping/items → Receive request
2. ← Return item       ← Insert into DB
3. Append to UI        ← Return item object
4. Refresh stats
```

### Obtenir recommandations

```
Frontend:                  Backend:
1. POST /recommendations   → Fetch items from DB
   {"listId": 1}          → Format prompt
                          → Call Claude API
                          → Parse response
2. ← Return recommendations ← Save to DB
3. Display in modal
```

---

## 🛡️ Sécurité

### Mesures implémentées

1. **Authentification JWT**
   - Tokens expirés après 7 jours
   - Secret clé sauvegardée en variables d'environnement

2. **Hachage des mots de passe**
   - bcryptjs avec 10 rounds
   - Mots de passe jamais stockés en clair

3. **CORS**
   - Autorise seulement localhost:3000 en dev
   - À configurer pour domaines production

4. **Validation des inputs**
   - Emailjs validation
   - Longueurs minima/maxima
   - Echappement HTML côté frontend

5. **Gestion des erreurs**
   - Middleware centralisé
   - Pas de fuites d'informations système
   - Logging sécurisé

6. **Base de données**
   - Prepared statements (protection SQL injection)
   - Foreign keys activées
   - Transactions où approprié

---

## 📊 Performance

### Optimisations

1. **Indexing**
   - Index sur `user_id` pour chaque table
   - Accélère les requêtes filtrées

2. **Queries**
   - Requêtes minimales
   - Pas de N+1 queries
   - Données paginées si nécessaire

3. **Caching**
   - Listes côté localStorage (frontend)
   - Évite requêtes inutiles

4. **Frontend**
   - CSS Vanilla (pas de framework lourd)
   - JS moderne (pas de jQuery)
   - Images optimisées (emojis SVG)

---

## 🚀 Scalabilité

### Pour passer à la production

1. **Database**
   ```
   SQLite → PostgreSQL
   Meilleure concurrence et performance
   ```

2. **Caching**
   ```
   Ajouter Redis
   Cache les listes fréquemment consultées
   ```

3. **API Optimization**
   ```
   Ajouter pagination
   Compresser les réponses (gzip)
   Implémenter rate limiting
   ```

4. **Frontend Build**
   ```
   React/Vue si nécessaire
   Minification + bundling
   CDN pour assets statiques
   ```

5. **Deployment**
   ```
   Docker containerization
   CI/CD pipeline
   Load balancer
   ```

---

## 🧪 Testing

### Tests à implémenter

```bash
# Backend
npm test                    # Run Jest tests
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report

# Frontend
npm run test:e2e          # End-to-end tests (Cypress)
```

### Couverture recommandée

- **Backend** : 80%+
  - Routes (auth, shopping, recommendations)
  - Middleware
  - Utilities

- **Frontend** : 60%+
  - Authentication flow
  - CRUD operations
  - Error handling

---

## 📈 Monitoring

### Points clés à monitorer

1. **Backend**
   - Temps de réponse des endpoints
   - Erreurs 5xx
   - Utilisation DB
   - Appels Claude API (coût + latence)

2. **Frontend**
   - Performance de chargement
   - Erreurs JavaScript
   - Utilisation du cache

3. **Utilisateurs**
   - Taux de conversion
   - Engagement
   - Abandon de listes

---

## 📝 Conventions de code

### Backend

```javascript
// Nommage
- Variables/Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Classes: PascalCase

// Structure de fichier
- 1 route = 1 fichier
- Middleware réutilisable
- Utils indépendants
```

### Frontend

```javascript
// Nommage
- Functions: camelCase
- IDs: kebab-case
- CSS Classes: kebab-case

// Organisation
- Séparation concerns (auth, shopping, etc.)
- Event listeners centralisés
- Helper functions à la fin du fichier
```

---

## 🎓 Extension future

### Features à ajouter

1. **Partage de listes**
   - Collaborateurs
   - Permissions

2. **Intégrations**
   - Prix en temps réel
   - Disponibilité magasins
   - Codes promo

3. **Mobile**
   - App React Native
   - Offline-first sync

4. **Analytics**
   - Patterns de dépense
   - Prédictions budgetaires

5. **Social**
   - Recommandations communautaires
   - Recipes partagés

---

**Version** : 1.0.0  
**Dernière mise à jour** : Janvier 2024  
**Mainteneur** : Shopping Assistant Team
