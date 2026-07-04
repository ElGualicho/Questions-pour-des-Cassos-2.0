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
- score simple : bonne reponse = 1 point ;
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
