# Lancer Capucine dans Expo Go

Deux cas : même Wi-Fi (simple), ou réseau public / partagé (tunnel).

## Avant de commencer

- L'app **Expo Go** doit être installée sur le téléphone.
- Le fichier `backend/.env` doit contenir une clé de recherche Web valide :
  `SERPER_API_KEY=...`
  Sans elle, Capucine démarre quand même mais ne trouvera aucune offre réelle —
  et `/health` le dira franchement (`no_real_source`).

## Terminal 1 — le backend (toujours)

```bash
cd backend
npm run dev
```

Vérifier que la ligne « Web search » indique `serper (configured)`.

---

## Cas A — Mac et téléphone sur le même Wi-Fi

```bash
cd frontend
npx expo start
```

Scanner le QR code. L'application **déduit automatiquement** l'adresse du
backend depuis l'hôte LAN par lequel Expo lui a servi le bundle, et y remplace
le port par 3001. Rien à configurer.

## Cas B — réseau public, réseau invité, isolation des clients

Sur ces réseaux le téléphone ne peut PAS joindre l'adresse LAN du Mac. Il faut
un tunnel — **un pour Metro, un pour le backend**. Le domaine du tunnel Expo
(`*.exp.direct`) ne sert QUE Metro ; l'app ne le prend jamais pour le backend
(voir `frontend/src/api.ts`).

Un seul script gère les deux :

```bash
cd frontend
npm run start:tunnel          # tunnel backend (ngrok) + `expo start --tunnel`
```

Le script :
1. vérifie que le backend répond sur `:3001` ;
2. ouvre (ou réutilise) un tunnel `ngrok http 3001` ;
3. récupère son URL publique et la passe à Expo via `EXPO_PUBLIC_API_URL` ;
4. lance `expo start --tunnel`.

Pré-requis : `ngrok` installé et configuré une fois avec un authtoken
(`ngrok config add-authtoken <token>`). `expo start --tunnel` peut demander à
installer `@expo/ngrok` au premier lancement — accepter.

Pour garder Metro en LAN mais tunneller seulement le backend :
`npm run start:tunnel -- --lan`.

## Si l'application affiche un problème de connexion

- **« Capucine ne parvient pas à se connecter »** : le backend est configuré
  mais injoignable. Vérifier le Terminal 1, puis relancer depuis l'app.
- **« pas encore configurée pour se connecter … sur cet appareil »** : session
  tunnelée sans URL backend → utiliser `npm run start:tunnel` (Cas B).

Aucune adresse technique n'est affichée à l'utilisateur ; le développeur voit
l'URL résolue dans les logs Metro (`[Capucine] backend = …`).

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
