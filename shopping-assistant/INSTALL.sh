#!/bin/bash

#  ============================================
#  Shopping Assistant - Script d'Installation
#  ============================================

set -e

echo "╔════════════════════════════════════════╗"
echo "║  Shopping Assistant Installation      ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Vérifier Node.js
echo -e "${BLUE}📋 Vérification des prérequis...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Node.js n'est pas installé${NC}"
  echo "Téléchargez-le sur: https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}✅ Node.js $NODE_VERSION détecté${NC}"

# Installer le backend
echo ""
echo -e "${BLUE}📦 Installation du backend...${NC}"
cd backend

# Vérifier si node_modules existe
if [ -d "node_modules" ]; then
  echo -e "${YELLOW}⚠️  node_modules existe déjà, passage du npm install${NC}"
else
  npm install
fi

# Créer le fichier .env s'il n'existe pas
if [ ! -f ".env" ]; then
  echo -e "${BLUE}🔧 Création du fichier .env...${NC}"
  cp .env.example .env

  echo ""
  echo -e "${YELLOW}⚠️  IMPORTANT: Configurez votre clé API Claude!${NC}"
  echo ""
  echo "1. Ouvrez le fichier .env:"
  echo "   nano .env"
  echo ""
  echo "2. Remplissez les variables (notamment ANTHROPIC_API_KEY)"
  echo ""
  echo "3. Obtenez votre clé API sur:"
  echo "   https://console.anthropic.com/"
  echo ""

  read -p "Appuyez sur Entrée quand le fichier .env est configuré..."
else
  echo -e "${GREEN}✅ Fichier .env trouvé${NC}"
fi

# Créer le répertoire data s'il n'existe pas
if [ ! -d "data" ]; then
  mkdir -p data
  echo -e "${GREEN}✅ Répertoire data créé${NC}"
fi

cd ..

echo ""
echo -e "${GREEN}✅ Installation terminée!${NC}"
echo ""
echo "╔════════════════════════════════════════╗"
echo "║  Étapes suivantes                      ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo -e "${BLUE}1. Lancer le backend:${NC}"
echo "   cd backend"
echo "   npm run dev"
echo ""
echo -e "${BLUE}2. Dans un autre terminal, lancer le frontend:${NC}"
echo "   cd frontend"
echo "   npx http-server -p 3000"
echo ""
echo -e "${BLUE}3. Ouvrir le navigateur:${NC}"
echo "   http://localhost:3000"
echo ""
echo -e "${YELLOW}📝 Documentation:${NC}"
echo "   - Setup: ./docs/SETUP.md"
echo "   - API: ./docs/API.md"
echo "   - Architecture: ./docs/ARCHITECTURE.md"
echo ""
echo -e "${GREEN}🎉 Bonne utilisation!${NC}"
