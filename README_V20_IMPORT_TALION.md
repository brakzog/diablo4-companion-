# D4 Companion v20 - Import Talion visible

## Ce qui change

- Ajout d'une barre **Import URL** visible dans l'app.
- Import direct d'une URL Talion, par exemple :

```txt
https://www.talion.tv/diablo-4/builds/demoniste-apocalypse
```

- Après import, l'app recharge automatiquement le build courant.
- Si le build vient de Talion, l'onglet **Guide Talion** s'ouvre automatiquement.
- Badge provider visible dans le header : `Talion` ou `Mobalytics`.

## Lancer

```bash
npm install
npm start
```

Puis ouvrir :

```txt
http://localhost:4734
```

## Note

Talion expose surtout le guide sous forme HTML/images. L'import affiche donc proprement le guide Talion. Le next-skill automatique nécessitera encore un mapping plus fin de l'arbre de talents.
