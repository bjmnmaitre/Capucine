# 🚀 Guide d'Installation - Shopping Assistant

## 📋 Prérequis

- Node.js 18+ ([télécharger](https://nodejs.org/))
- npm 9+ (inclus avec Node.js)
- Une clé API Anthropic Claude ([obtenir une clé](https://console.anthropic.com/))
- Un navigateur moderne (Chrome, Firefox, Safari, Edge)

## 📦 Installation Complète

### Étape 1 : Préparer le projet

```bash
# Aller au répertoire du projet
cd ~/capucine/shopping-assistant

# Vérifier la structure
ls -la
```

Vous devriez voir :
```
backend/     (serveur API)
frontend/    (interface web)
docs/        (documentation)
README.md    (readme)
```

### Étape 2 : Installer le backend

```bash
# Aller au répertoire du backend
cd backend

# Installer les dépendances
npm install

# Créer le fichier d'environnement
cp .env.example .env

# Éditer le fichier .env
# Ouvrez .env et remplissez :
# - ANTHROPIC_API_KEY = votre clé API
# - JWT_SECRET = une clé secrète (peut être n'importe quoi, par exemple : "dev-secret-key")
```

**Fichier .env complété :**
```env
NODE_ENV=development
PORT=5000
HOST=localhost
DATABASE_PATH=./data/shopping_assistant.db
ANTHROPIC_API_KEY=sk-ant-...  # ← Votre clé API
JWT_SECRET=dev-secret-key-change-in-production
JWT_EXPIRE=7d
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=info
ENABLE_RECOMMENDATIONS=true
ENABLE_BUDGET_TRACKING=true
ENABLE_HISTORY=true
```

### Étape 3 : Lancer le backend

```bash
# Dans le répertoire backend/
npm run dev

# Vous devriez voir :
# ╔════════════════════════════════════════╗
# ║   Shopping Assistant Backend Ready     ║
# ╚════════════════════════════════════════╝
# 🚀 Serveur lancé sur http://localhost:5000
```

**Laissez le terminal ouvert !**

### Étape 4 : Lancer le frontend

```bash
# Ouvrir un nouveau terminal
# Aller au répertoire frontend
cd ~/capucine/shopping-assistant/frontend

# Option A : Utiliser http-server (simple)
npx http-server -p 3000

# Option B : Utiliser Python
python3 -m http.server 3000

# Vous devriez voir :
# HTTP server running at http://localhost:3000
```

### Étape 5 : Utiliser l'app

1. Ouvrir votre navigateur
2. Aller à `http://localhost:3000`
3. Créer un compte ou se connecter
4. Commencer à créer des listes de courses !

## 🎯 Premières étapes

1. **Créer un compte**
   - Email : votre@email.com
   - Mot de passe : au moins 6 caractères

2. **Créer une liste**
   - Cliquez sur "+ Nouvelle Liste"
   - Donnez-lui un nom

3. **Ajouter des articles**
   - Entrez un nom d'article
   - Cliquez sur "+"
   - Répétez

4. **Obtenir des recommandations**
   - Cliquez sur "✨ Recommandations"
   - Claude IA vous suggest des améliorations

## 🐛 Dépannage

### Erreur : "Cannot find module '@anthropic-ai/sdk'"

```bash
# Backend seulement
cd backend
npm install
```

### Erreur : "EADDRINUSE: address already in use :::5000"

Le port 5000 est déjà utilisé. Changez dans `.env` :
```env
PORT=5001  # ou un autre port
```

### Erreur : "Connection refused localhost:5000"

S'assurer que le backend est lancé :
```bash
cd backend
npm run dev
```

### Les images/styles ne se chargent pas

Assurez-vous que le frontend est servi correctement :
```bash
cd frontend
# Vérifier les chemins des fichiers CSS et JS dans index.html
```

### Erreur d'authentification

Vérifier que :
- Le backend et frontend tournent tous les deux
- Le fichier `.env` contient `JWT_SECRET`
- Les données sont en JSON valide

## 📚 Structure de fichiers

```
shopping-assistant/
├── backend/
│   ├── server.js          # Point d'entrée
│   ├── package.json
│   ├── .env.example
│   ├── middleware/        # Authentification, gestion d'erreur
│   ├── routes/            # API endpoints
│   ├── utils/             # Base de données, logger, Claude
│   └── data/              # Base de données SQLite
│
├── frontend/
│   ├── index.html         # Page principale
│   ├── css/style.css      # Styles
│   └── js/                # Logique JavaScript
│       ├── app.js         # Logique principal
│       ├── auth.js        # Authentification
│       └── recommendations.js
│
└── docs/                  # Documentation
```

## 🔐 Variables d'environnement importantes

| Variable | Description | Exemple |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Votre clé API Claude | `sk-ant-...` |
| `JWT_SECRET` | Clé secrète pour les tokens | `dev-key` |
| `PORT` | Port du serveur | `5000` |
| `CORS_ORIGIN` | URL du frontend | `http://localhost:3000` |
| `DATABASE_PATH` | Chemin de la base de données | `./data/shopping_assistant.db` |

## 🚀 Déploiement (Production)

### Sur Heroku / Railway / Replit

```bash
# Créer un fichier Procfile
echo "web: cd backend && npm start" > Procfile

# Définir les variables d'environnement
heroku config:set ANTHROPIC_API_KEY=sk-ant-...
```

### Configurer les variables critiques pour la production

```env
NODE_ENV=production
JWT_SECRET=generate-a-strong-random-key-here
CORS_ORIGIN=votre-domaine.com
```

## ✅ Vérification de l'installation

```bash
# Backend
curl http://localhost:5000/api/health

# Réponse attendue :
# {"status":"ok","timestamp":"...","environment":"development","uptime":...}

# Frontend
# Ouvrir http://localhost:3000 dans le navigateur
```

## 📞 Support et Aide

- Vérifier les logs du backend : voir les messages dans le terminal
- Vérifier les logs du frontend : F12 > Console
- Vérifier la base de données : `backend/data/shopping_assistant.db`

## 🎓 Prochaines étapes

1. Customizer le styling
2. Ajouter plus de fonctionnalités
3. Déployer en production
4. Intégrer d'autres APIs (prix, disponibilité)

**Bonne utilisation ! 🎉**
