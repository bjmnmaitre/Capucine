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

Sur le même Wi-Fi, l’application déduit l’adresse du backend à partir de l’hôte **LAN** servi
par Expo (où `localhost` désignerait le téléphone lui-même). Un hôte de **tunnel**
(`*.exp.direct`, ngrok…) n’est jamais réutilisé comme backend — il ne relaie que le port de
Metro. Aucune adresse n’est affichée à l’utilisateur ; le développeur la lit dans les logs
Metro (`[Capucine] backend = …`).

Réseau public / isolation des clients : `npm run start:tunnel` (ouvre un tunnel ngrok vers
`:3001` et l’injecte dans `EXPO_PUBLIC_API_URL`). Voir `../LANCEMENT.md`.

Pour pointer ailleurs (backend déployé) :

```bash
EXPO_PUBLIC_API_URL=https://mon-backend.example.com npm start
```

## Ce que l’application garantit

- Aucune donnée produit n’est codée en dur : tout vient de `POST /search`.
- Une valeur inconnue s’affiche « inconnu », jamais 0 ni un tiret.
- Un coût partiellement connu est présenté comme « au moins X », jamais comme un total.
- Aucune URL n’est fabriquée : sans URL vérifiée, l’écran le dit.
- Aucun paiement n’est effectué ; la validation reste chez le marchand, par l’utilisateur.
