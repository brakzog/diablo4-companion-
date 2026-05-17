# D4 Companion v19-tal — support Talion guide mode

## Lancer

```bash
npm install
npm start
```

Puis ouvrir :

```txt
http://localhost:4734
```

## Importer un build Talion depuis une URL

Une fois le serveur lancé, ouvrir dans le navigateur :

```txt
http://localhost:4734/api/import-talion?url=https://www.talion.tv/diablo-4/builds/demoniste-apocalypse
```

Puis revenir sur :

```txt
http://localhost:4734
```

## Ce qui est supporté

- Détection/normalisation Talion
- Import endpoint `/api/import-talion`
- Import JSON direct `/api/push-talion`
- Onglet `Guide Talion`
- Affichage des onglets Talion : équipement, arbre, mécanique, parangons, charmes, mercenaires, filtre de butin
- Extraction du filtre de butin dans une zone copiable
- Extraction de l’ordre des glyphes quand visible dans le texte

## Limite actuelle

Talion expose ce build principalement en HTML avec images base64 intégrées. Le "next skill" automatique ne peut pas encore être aussi propre que Mobalytics tant qu’on n’a pas une source structurée point-par-point.
