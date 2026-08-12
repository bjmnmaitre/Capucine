# 📡 Documentation API - Shopping Assistant

## Base URL

```
http://localhost:5000/api
```

## 🔐 Authentification

Tous les endpoints (sauf `/auth/*`) nécessitent un token JWT dans le header :

```
Authorization: Bearer {token}
```

---

## 🔑 Endpoints d'Authentification

### 1. Inscription

**POST** `/auth/register`

Créer un nouveau compte utilisateur.

**Body :**
```json
{
  "email": "user@example.com",
  "username": "username",
  "password": "securepassword",
  "fullName": "John Doe"
}
```

**Réponse (201) :**
```json
{
  "message": "Utilisateur créé avec succès",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "username",
    "fullName": "John Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Erreurs :**
- `400` : Email invalide ou données manquantes
- `409` : Email/username déjà utilisé

---

### 2. Connexion

**POST** `/auth/login`

Se connecter avec email et mot de passe.

**Body :**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Réponse (200) :**
```json
{
  "message": "Connexion réussie",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "username"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Erreurs :**
- `401` : Identifiants incorrects

---

### 3. Vérifier le token

**POST** `/auth/verify`

Vérifier la validité du token JWT.

**Réponse (200) :**
```json
{
  "valid": true,
  "user": {
    "userId": 1,
    "email": "user@example.com"
  }
}
```

---

## 🛒 Endpoints Shopping Lists

### 1. Récupérer toutes les listes

**GET** `/shopping/lists`

Récupérer toutes les listes de courses de l'utilisateur.

**Réponse (200) :**
```json
{
  "lists": [
    {
      "id": 1,
      "user_id": 1,
      "title": "Fruits et Légumes",
      "description": "Marché du samedi",
      "total_cost": 45.50,
      "is_completed": 0,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 1
}
```

---

### 2. Créer une nouvelle liste

**POST** `/shopping/lists`

Créer une nouvelle liste de courses.

**Body :**
```json
{
  "title": "Fruits et Légumes",
  "description": "Marché du samedi",
  "budget": 50
}
```

**Réponse (201) :**
```json
{
  "message": "Liste de courses créée",
  "list": {
    "id": 1,
    "user_id": 1,
    "title": "Fruits et Légumes",
    "description": "Marché du samedi",
    "total_cost": 0,
    "is_completed": 0,
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

---

### 3. Récupérer une liste et ses articles

**GET** `/shopping/lists/:listId`

Récupérer les détails d'une liste avec tous ses articles.

**Réponse (200) :**
```json
{
  "list": {
    "id": 1,
    "title": "Fruits et Légumes",
    "total_cost": 45.50,
    "is_completed": 0
  },
  "items": [
    {
      "id": 1,
      "list_id": 1,
      "name": "Pommes",
      "quantity": 2,
      "unit": "kg",
      "estimated_price": 3.50,
      "actual_price": null,
      "category": "Fruits",
      "is_checked": 0,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "itemCount": 1,
  "checkedCount": 0
}
```

---

### 4. Mettre à jour une liste

**PUT** `/shopping/lists/:listId`

Modifier le titre, description ou marquer comme complétée.

**Body :**
```json
{
  "title": "Fruits, Légumes et Produits Laitiers",
  "description": "Marché du samedi matin",
  "isCompleted": false
}
```

**Réponse (200) :**
```json
{
  "message": "Liste mise à jour",
  "list": { ... }
}
```

---

### 5. Supprimer une liste

**DELETE** `/shopping/lists/:listId`

Supprimer une liste et tous ses articles.

**Réponse (200) :**
```json
{
  "message": "Liste supprimée"
}
```

---

## 📦 Endpoints Shopping Items

### 1. Ajouter un article

**POST** `/shopping/items`

Ajouter un nouvel article à une liste.

**Body :**
```json
{
  "listId": 1,
  "name": "Pommes",
  "quantity": 2,
  "unit": "kg",
  "category": "Fruits",
  "estimatedPrice": 3.50
}
```

**Réponse (201) :**
```json
{
  "message": "Article ajouté",
  "item": {
    "id": 1,
    "list_id": 1,
    "name": "Pommes",
    "quantity": 2,
    "unit": "kg",
    "category": "Fruits",
    "estimated_price": 3.50,
    "is_checked": 0,
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

---

### 2. Mettre à jour un article

**PUT** `/shopping/items/:itemId`

Modifier un article ou le marquer comme acheté.

**Body :**
```json
{
  "name": "Pommes Red Delicious",
  "quantity": 3,
  "actualPrice": 4.20,
  "isChecked": true,
  "notes": "Très bonnes"
}
```

**Réponse (200) :**
```json
{
  "message": "Article mis à jour",
  "item": { ... }
}
```

---

### 3. Supprimer un article

**DELETE** `/shopping/items/:itemId`

Supprimer un article d'une liste.

**Réponse (200) :**
```json
{
  "message": "Article supprimé"
}
```

---

## ✨ Endpoints Recommandations

### 1. Obtenir des recommandations

**POST** `/recommendations/get`

Obtenir des recommandations IA pour une liste de courses.

**Body :**
```json
{
  "listId": 1
}
```

**Réponse (200) :**
```json
{
  "recommendations": [
    {
      "item": "Pommes",
      "suggestion": "Considérez les pommes Gala, souvent 20% moins chères que les Red Delicious",
      "type": "alternative",
      "savings": "~0.80€"
    },
    {
      "item": "Carottes",
      "suggestion": "Achetez en vrac plutôt qu'emballées pour économiser",
      "type": "conseil",
      "savings": "~1.50€"
    }
  ],
  "summary": "Vous pouvez économiser environ 5-10€ en cherchant les promotions...",
  "itemsCount": 5,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### 2. Recommandation rapide

**POST** `/recommendations/quick`

Obtenir une recommandation rapide pour un article spécifique.

**Body :**
```json
{
  "itemName": "Pommes",
  "quantity": 2
}
```

**Réponse (200) :**
```json
{
  "recommendation": {
    "item": "Pommes",
    "alternatives": ["Poires", "Raisins"],
    "tips": "Vérifiez les prix au kg plutôt qu'à la pièce",
    "estimatedPrice": "2-4€ / kg",
    "buyingTips": "Cherchez les fruits de saison"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### 3. Historique des recommandations

**GET** `/recommendations/history`

Récupérer l'historique des recommandations précédentes.

**Réponse (200) :**
```json
{
  "recommendations": [
    {
      "id": 1,
      "user_id": 1,
      "item_id": 5,
      "item_name": "Pommes",
      "recommendation_text": "Cherchez Gala...",
      "category": "alternative",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 15
}
```

---

## 🏥 Health Check

### Vérifier l'état du serveur

**GET** `/health`

Vérifier que le serveur fonctionne correctement.

**Réponse (200) :**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "environment": "development",
  "uptime": 3600
}
```

---

## ❌ Codes d'erreur

| Code | Message | Description |
|------|---------|-------------|
| `400` | Bad Request | Données invalides ou manquantes |
| `401` | Unauthorized | Token manquant ou expiré |
| `403` | Forbidden | Accès refusé (ressource d'un autre utilisateur) |
| `404` | Not Found | Ressource non trouvée |
| `409` | Conflict | La ressource existe déjà |
| `500` | Internal Server Error | Erreur du serveur |

**Format d'erreur :**
```json
{
  "error": "Description de l'erreur",
  "code": "ERROR_CODE"
}
```

---

## 📝 Exemples complets

### Flux complet : Créer une liste et ajouter des articles

```bash
# 1. S'inscrire
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "username": "john",
    "password": "password123",
    "fullName": "John Doe"
  }'

# Récupérer le token de la réponse...

# 2. Créer une liste
curl -X POST http://localhost:5000/api/shopping/lists \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "title": "Marché du samedi",
    "description": "Fruits et légumes"
  }'

# Récupérer l'ID de la liste de la réponse... (ex: 1)

# 3. Ajouter des articles
curl -X POST http://localhost:5000/api/shopping/items \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "listId": 1,
    "name": "Pommes",
    "quantity": 2,
    "unit": "kg",
    "category": "Fruits"
  }'

# 4. Obtenir les recommandations
curl -X POST http://localhost:5000/api/recommendations/get \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{"listId": 1}'
```

---

## 🔄 Rate Limiting

Les requêtes sont limitées à **100 requêtes par 15 minutes** pour éviter les abus.

Réponse si limite dépassée :
```json
{
  "error": "Trop de requêtes, réessayez plus tard",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

---

**Dernière mise à jour : Janvier 2024**
