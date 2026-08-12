# ⚡ Démarrage Rapide - Shopping Assistant

## 🚀 5 minutes pour démarrer

### Prérequis
- Node.js 18+
- Clé API Anthropic Claude

### Étape 1 : Configuration (2 min)

```bash
cd ~/capucine/shopping-assistant

# Installer le backend
cd backend
npm install

# Configurer l'API
cp .env.example .env
# Éditer .env et ajouter: ANTHROPIC_API_KEY=sk-ant-...

cd ..
```

### Étape 2 : Lancer le backend (1 min)

```bash
cd backend
npm run dev
```

Vous devriez voir :
```
🚀 Serveur lancé sur http://localhost:5000
```

### Étape 3 : Lancer le frontend (1 min)

Dans un **nouveau terminal** :

```bash
cd ~/capucine/shopping-assistant/frontend
npx http-server -p 3000
```

### Étape 4 : Ouvrir l'app (1 min)

Ouvrir le navigateur :
```
http://localhost:3000
```

## ✅ Vérifier que ça marche

1. **Créer un compte**
   - Email : test@example.com
   - Mot de passe : password123

2. **Créer une liste**
   - Titre : "Mon marché"

3. **Ajouter un article**
   - Tapez "Pommes" + appuyez sur Enter

4. **Obtenir des recommandations**
   - Cliquez sur "✨ Recommandations"
   - Claude devrait suggérer des alternatives

✅ **Si ça marche, tout est bon !**

## 🛑 Problèmes courants

### "Cannot connect to localhost:5000"
→ S'assurer que le backend tourne (`npm run dev`)

### "ANTHROPIC_API_KEY not set"
→ Éditer `backend/.env` et ajouter votre clé API

### "Port 5000 already in use"
→ Changer `PORT=5001` dans `backend/.env`

## 📚 Documentation complète

- **Installation détaillée** : [SETUP.md](./docs/SETUP.md)
- **Documentation API** : [API.md](./docs/API.md)
- **Architecture** : [ARCHITECTURE.md](./docs/ARCHITECTURE.md)

## 🎯 Prochaines étapes

1. Explorer l'interface
2. Créer plusieurs listes
3. Tester les recommandations IA
4. Lire la documentation pour déployer en production

## 💬 Besoin d'aide ?

Consultez la section "Dépannage" dans [SETUP.md](./docs/SETUP.md)

---

**Bonne utilisation de Shopping Assistant ! 🎉**
