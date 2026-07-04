# Questions pour des Cassos 2.0

Quiz temps reel mobile-first inspire de la logique host/joueurs du Loto des savoirs, mais sans grille ni mecanique de loto.

## Lancer le projet

```bash
npm install
npm start
```

Puis ouvrir :

- host : `http://localhost:3000`
- joueur : scanner le QR code ou ouvrir le lien de partie

## Fonctionnalites MVP

- creation de partie par host ;
- code de partie et QR code ;
- joueurs avec pseudo sur mobile ;
- selection 10 / 20 / toutes les questions ;
- questions a 4 choix ;
- une seule reponse acceptee par joueur et par question ;
- reveal de la bonne reponse ;
- score : bonne reponse = 1 point, premiere bonne reponse = 2 points ;
- question bonus finale avec vote entre joueurs : le nom le plus vote gagne 2 points ;
- classement final ;
- reset de partie ;
- banque de 60 questions ;
- visuels de themes par couleur.

## Structure

- `server.js` : serveur Express + Socket.IO ;
- `src/gameStore.js` : etat et regles de partie ;
- `src/themes.js` : association categories / visuels ;
- `data/questions.json` : banque de questions ;
- `public/host.html` : interface host ;
- `public/player.html` : interface joueur mobile ;
- `public/assets/themes/` : visuels importes.

## Déploiement Cloudflare

Le projet peut être déployé de deux façons :

- en serveur Node classique avec `npm start` ;
- sur Cloudflare Workers avec assets statiques et Durable Object pour le temps réel.

Pour Cloudflare, utiliser :

```bash
npm install
npm run deploy:cloudflare
```

Le deploiement Cloudflare utilise Wrangler 4 et demande Node 22 ou plus.

Dans l'interface Cloudflare, configurer le projet comme un deploy Workers/Wrangler :

- commande d'installation : `npm install` ;
- commande de deploiement : `npm run deploy:cloudflare`.

La configuration est dans `wrangler.toml`. Le dossier statique est `public/`, et le Worker `worker/index.mjs` remplace le serveur Socket.IO par un WebSocket natif compatible Cloudflare.
