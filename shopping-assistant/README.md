# 🛒 Shopping Assistant - Assistant IA d'Achat Intelligent

Une application web complète pour gérer intelligemment vos listes de courses avec l'aide de Claude AI.

## ✨ Fonctionnalités

- **Gestion de liste de courses** : Ajoutez, modifiez, supprimez des articles
- **Assistant IA Claude** : Obtient des recommandations intelligentes basées sur votre liste
- **Budget tracking** : Suivezvos dépenses et restez dans le budget
- **Historique d'achat** : Accédez à vos précédentes listes et articles fréquents
- **Authentification sécurisée** : Enregistrement et connexion utilisateur
- **Suggestions intelligentes** : Claude propose des substituts, des réductions, etc.

## 🏗️ Architecture

```
shopping-assistant/
├── backend/           # API Express.js
├── frontend/          # Interface utilisateur
├── docs/              # Documentation
└── docker-compose.yml # Configuration Docker
```

## 🚀 Démarrage rapide

### Prérequis
- Node.js 18+
- npm ou yarn
- Clé API Anthropic Claude

### Installation

```bash
# 1. Cloner/Naviguer au projet
cd shopping-assistant

# 2. Installation backend
cd backend
npm install
cp .env.example .env
# Remplir les variables d'environnement dans .env

# 3. Lancer le serveur
npm run dev

# 4. Dans un autre terminal, lancer le frontend
cd ../frontend
# Servir les fichiers avec http-server ou autre serveur
npx http-server -p 3000

# 5. Ouvrir http://localhost:3000
```

## 📚 Documentation

- [API Documentation](./docs/API.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Setup Guide](./docs/SETUP.md)

## 🔐 Sécurité

- JWT pour authentification
- Passwords hashés avec bcrypt
- Protection CORS
- Validation des inputs
- Variables d'environnement protégées

## 📄 Licence

MIT
