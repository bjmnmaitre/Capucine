# Capucine — application Expo

Premier parcours utilisateur complet : recherche → résultats → détail d’une offre → préparation d’achat.

## Lancer

Deux processus, dans deux terminaux.

**1. Le backend** (port 3001 par défaut) :

```bash
cd backend
npm run dev
```

**2. L’application** :

```bash
cd frontend
npm start
```

Puis scannez le QR code avec **Expo Go** (le téléphone doit être sur le même Wi-Fi que la machine).

## Adresse du service

L’application déduit l’adresse du backend à partir de l’hôte servi par Expo — c’est ainsi qu’elle
fonctionne depuis un téléphone, où `localhost` désignerait le téléphone lui-même. L’adresse
réellement utilisée est affichée en bas de l’écran de recherche.

Pour pointer ailleurs (tunnel, backend déployé) :

```bash
EXPO_PUBLIC_API_URL=https://mon-backend.example.com npm start
```

## Ce que l’application garantit

- Aucune donnée produit n’est codée en dur : tout vient de `POST /search`.
- Une valeur inconnue s’affiche « inconnu », jamais 0 ni un tiret.
- Un coût partiellement connu est présenté comme « au moins X », jamais comme un total.
- Aucune URL n’est fabriquée : sans URL vérifiée, l’écran le dit.
- Aucun paiement n’est effectué ; la validation reste chez le marchand, par l’utilisateur.
