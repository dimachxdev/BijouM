# Déploiement du 2026-10-31 — vitrine publique et QR

Écrit à la fin de la session du 2026-10-31. À suivre dans l'ordre.

---

## 1. Ce qui est DÉJÀ fait — ne rien refaire

**En base.** Huit migrations appliquées et vérifiées sur le corps réel des
fonctions, pas sur le « succès » de la migration :

| | |
|---|---|
| 019 | `supprimer_boutique()` — quatre verrous éprouvés |
| 023 · 024 | portail cliente et dépôt au comptoir étanches |
| 025 · 026 | identité cliente par `client_id` |
| 027 | abonnement non auto-attribuable, `DELETE` conditionné |
| 028 · 029 · 030 | vitrine publique, site internet, image de couverture |

**L'Edge Function `membres-admin`** est déployée (version 13,
`verify_jwt: false`), avec `creer_proprietaire`, `supprimer_comptes` et le
garde-fou du plan service.

> **Note** : la migration 022 n'apparaît pas dans l'historique Supabase, mais
> son contenu **est** en base — vérifié en lisant `vente_sur_compte_epargne`,
> qui porte ses six filtres et le poids. Elle a dû être passée par l'éditeur
> SQL. Rien à refaire.

**La base est donc en avance sur le code en ligne, et c'est sans danger** :
027 à 029 n'ont qu'élargi des droits ou ajouté une fonction que le code
déployé n'appelle pas encore. Rien n'est cassé en production à cet instant.

---

## 2. Les neuf fichiers à déployer

```
boutique.html          ← NOUVEAU
js/boutique.js         ← NOUVEAU
js/qr.js               ← NOUVEAU
index.html
operateur.html
css/style.css
js/app.js
js/auth.js
js/operateur.js
```

**Les trois premiers sont des fichiers neufs.** C'est le piège d'un
déploiement fichier par fichier : on envoie ce qu'on a modifié et on oublie
ce qui n'existait pas. Si la vitrine renvoie une page blanche après
déploiement, c'est presque toujours l'un des trois.

Le plus sûr est de publier **le dossier entier** : `.vercelignore` écarte
déjà `migrations/`, les `*.md`, `config_backup.json` et `.claude/`.

Repères de version, pour vérifier que le déploiement a bien pris :

- empreintes de cache : `?v=2026-10-31b`
- `APP_VERSION` : `2026-10-31-vitrine-qr`

`client.html` n'a pas changé (`?v=2026-10-21d`) — c'est normal, le portail
cliente ne consomme que le JSON de `portail_donnees()`, dont la forme est
restée identique.

---

## 3. Juste après le déploiement

**Rechargez avec Ctrl + Maj + R**, puis regardez la version sous l'écran de
connexion. Tant qu'elle n'affiche pas `2026-10-31-vitrine-qr`, rien de ce
qui suit n'a de sens : c'est le cache, pas un bug. C'est la première chose à
vérifier devant tout comportement incohérent.

---

## 4. Les vérifications, dans l'ordre

Chacune prouve une chose précise. Si l'une échoue, inutile de continuer :
les suivantes en dépendent.

### a. Le profil se remplit et s'enregistre

Profil de la boutique → carte **Vitrine publique**. Remplissez au moins
**image de couverture**, **présentation**, **horaires** et **site
internet**, puis Enregistrer.

La couverture est plafonnée à 300 Ko : une photo sortie d'un téléphone fait
plusieurs méga-octets et sera refusée avec son poids affiché. Réduisez-la
avant de la téléverser — format paysage, le logo vient se poser dessus en
rond, centré.

> *Prouve* : les colonnes des migrations 028/029 sont écrivables, et la
> liste `select` d'`auth.js` les relit. Si le champ se vide après
> rechargement, c'est cette liste qui manque le champ.

Un refus affiche désormais **le message du serveur**, plus un code HTTP nu :
« lien de carte sans https », « pseudo avec un caractère interdit »…

### b. La page publique s'ouvre

Allez sur `https://www.kayor.net/boutique.html?b=MBSS`, de préférence
**depuis un téléphone**.

> *Prouve* : `boutique_publique()` est joignable par `anon` et la page rend
> correctement. Les blocs sans donnée doivent rester **invisibles**, pas
> vides.

### c. La facture porte le code

Ouvrez une facture. Le QR est en haut, **du côté des coordonnées**, 70 px,
sans légende.

> *Prouve* : `js/qr.js` est bien chargé avant `js/app.js`. S'il manque, la
> facture s'affiche quand même sans code — c'est volontaire, une vente ne
> doit pas échouer parce qu'une vitrine est indisponible. Regardez alors la
> console : « QR vitrine indisponible ».

### d. **Scanner le code avec un vrai téléphone**

Imprimez la facture, scannez-la.

> *Prouve* la chaîne entière. **C'est la seule vérification qui compte.** Un
> encodeur QR faux produit une image parfaitement plausible — deux bogues
> l'ont montré le 2026-10-31, et mes propres tests passaient sur un encodeur
> illisible. Le téléphone a le dernier mot.

---

## 5. Ce qui reste ouvert ensuite

- **Le test des deux clientes homonymes** — le seul qui démontre la
  correction des migrations 025/026. Deux fiches du même nom, une vente et
  un compte pour chacune, un code PIN sur la première, puis son portail :
  elle ne doit voir que les siens.
- **Suspendre puis supprimer `MBD` et `BJS`** avec le bouton 🗑. Garder
  `MBSS`, qui porte les données réelles.
- **`marjanbijouterie@gmail.com`** est un compte orphelin — rattaché à
  aucune boutique, pas opérateur. Inoffensif, mais à retirer depuis
  *Authentication → Users* si vous n'en voulez plus.
- Le site internet **n'est pas** sur la ligne de contact de la facture. À
  décider : il n'y coûterait aucune hauteur.

Le reste de la liste est au § 9 de `CLAUDE.md`.
