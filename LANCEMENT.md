# Lancer Capucine dans Expo Go

Trois étapes. Compter deux minutes.

## Avant de commencer

- Le Mac et le téléphone doivent être sur **le même réseau Wi-Fi**.
- L'app **Expo Go** doit être installée sur le téléphone.
- Le fichier `backend/.env` doit contenir une clé de recherche Web valide :
  `SERPER_API_KEY=...`
  Sans elle, Capucine démarre quand même mais ne trouvera aucune offre réelle —
  et `/health` le dira franchement (`no_real_source`).

## Terminal 1 — le backend

```bash
cd backend
npm run dev
```

Au démarrage, le serveur affiche l'adresse à laquelle le **téléphone** doit le
joindre :

```
[CapucineAPI] Sur cette machine : http://localhost:3001/health
[CapucineAPI] Depuis le téléphone (en0) : http://192.168.1.16:3001/health
```

L'adresse `en0` **change avec le réseau** (Wi-Fi, partage de connexion de
l'iPhone…). Toujours lire celle que le Terminal 1 vient d'afficher — ne pas se
fier à une adresse notée ailleurs.

Vérifier que la ligne « Web search » indique `serper (configured)`.

## Terminal 2 — l'application

```bash
cd frontend
npx expo start
```

Un QR code s'affiche.

## Le téléphone

Scanner le QR code avec l'appareil photo (iOS) ou depuis Expo Go (Android).

L'application résout **automatiquement** l'adresse du backend : elle reprend
l'adresse réseau par laquelle Expo lui a servi le bundle, et y remplace le port
par 3001. Aucune configuration à faire.

## Si l'application dit « Capucine n'a pas pu joindre son service »

Elle affiche l'adresse qu'elle a essayée. Dans l'ordre :

1. Comparer cette adresse à celle annoncée par le Terminal 1. Si elles
   diffèrent, le téléphone et le Mac ne sont pas sur le même réseau.
2. Ouvrir l'adresse `/health` du Terminal 1 dans le navigateur du **téléphone**.
   Si elle ne répond pas, c'est le réseau — pare-feu du Mac, ou réseau invité
   qui isole les appareils entre eux.
3. Forcer l'adresse en dernier recours :
   ```bash
   cd frontend
   EXPO_PUBLIC_API_URL=http://<adresse-en0-du-Terminal-1>:3001 npx expo start --clear
   ```

## Vérifier avant de tester

```bash
cd backend
npm run diagnose        # 15 contrôles de configuration
npm run smoke           # 15 contrôles d'honnêteté de la chaîne
npm run smoke:product   # 32 contrôles du parcours réel, du /health au panier
```

`smoke:product` rejoue exactement ce que fait l'utilisateur — recherche,
résultats, coût, provenance, URL, préparation — et échoue si Capucine affirme
quoi que ce soit qu'elle ne peut pas prouver. Il n'échoue PAS parce qu'une
donnée est inconnue : une inconnue annoncée comme telle est un succès.

## Ce que ce parcours permet aujourd'hui

Rechercher un produit, voir de vraies offres du Web, ouvrir une offre,
comprendre son coût réel et ce qui reste inconnu, puis être redirigé vers la
page du marchand.

**Capucine ne prend jamais le paiement.** Le dernier écran le dit, et aucune
étape ne prétend qu'une commande a été passée.
