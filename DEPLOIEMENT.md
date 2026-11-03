# Déploiement — vitrine publique, QR, CGU et verrou des gestes

Mis à jour le 2026-11-02. À suivre dans l'ordre.

> **Ce déploiement porte trois lots.** La vitrine et les CGU, prêts depuis le
> 2026-10-31 et jamais mis en ligne ; le verrou des gestes ; et les sauvegardes
> avec le garde-fou de suppression.
>
> Les migrations **032 à 036 sont appliquées et vérifiées**. La base accepte
> déjà la clé de geste et l'ignore tant que le code en ligne ne l'envoie pas
> (`p_cle` a une valeur par défaut). Rien n'est cassé en attendant.
>
> **Deux choses tournent déjà côté serveur, sans rien déployer :** le
> `DROP TABLE` sur `public` est refusé depuis la 034, et l'instantané
> quotidien est planifié à 02h15 (`cron.job`, travail `kayor-sauvegarde-quotidienne`).
> Le déploiement n'ajoute que leur affichage dans la console opérateur.

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
| 028 → 031 | vitrine publique, site internet, couverture, coordonnées GPS |

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

## 2. Les treize fichiers à déployer

```
boutique.html          ← NOUVEAU
cgu.html               ← NOUVEAU
js/boutique.js         ← NOUVEAU
js/qr.js               ← NOUVEAU
js/verrou.js           ← NOUVEAU
index.html
operateur.html
client.html
css/style.css
js/app.js
js/auth.js
js/operateur.js
js/supabase.js
js/client.js
```

> **`js/verrou.js` se charge EN PREMIER** sur les trois pages : `js/app.js`,
> `js/supabase.js`, `js/client.js` et `js/operateur.js` l'appellent tous. S'il
> manque, chaque écriture tombe sur « Verrou is not defined » — et plus rien
> ne s'enregistre. C'est le fichier à vérifier d'abord si le comptoir se bloque
> après déploiement.
>
> **`client.html` change pour la première fois depuis le 2026-10-21.** Son
> empreinte passe de `?v=2026-10-21d` à `?v=2026-11-02b` : le portail cliente
> envoie désormais la clé de geste avec son dépôt.

> **`CGU.md` ne se déploie pas** — `.vercelignore` écarte les `*.md`, et
> c'est voulu : son § 12 énumère les faiblesses du service. La version
> publique est `cgu.html`, sans ce paragraphe. Toute modification du texte
> doit être reportée dans les deux.

**Les trois premiers sont des fichiers neufs.** C'est le piège d'un
déploiement fichier par fichier : on envoie ce qu'on a modifié et on oublie
ce qui n'existait pas. Si la vitrine renvoie une page blanche après
déploiement, c'est presque toujours l'un des trois.

Le plus sûr est de publier **le dossier entier** : `.vercelignore` écarte
déjà `migrations/`, les `*.md`, `config_backup.json` et `.claude/`.

Repères de version, pour vérifier que le déploiement a bien pris :

- empreintes de cache : `?v=2026-11-03a`
- `APP_VERSION` : `2026-11-03-portail-boutiques`

---

## 3. Juste après le déploiement

**Rechargez avec Ctrl + Maj + R**, puis regardez la version sous l'écran de
connexion. Tant qu'elle n'affiche pas `2026-11-03-portail-boutiques`, rien de ce
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

**Les coordonnées GPS sont ce qui fait apparaître la carte.** Dans Google
Maps, appuyez longuement sur la boutique, copiez les coordonnées, collez-les
dans le champ. Sans elles, la vitrine n'affiche pas de carte — c'est voulu :
une adresse approximative poserait l'épingle au mauvais endroit, ce qui est
pire que rien.

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

### c bis. **Le double-clic, et c'est le test qui compte**

Ouvrez « Nouvelle vente », remplissez-la, puis **cliquez deux fois de suite,
vite, sur Enregistrer**. Recommencez sur un dépôt et sur un encaissement.

Attendu, à chaque fois :

- un filet or traverse le haut de l'écran pendant l'écriture ;
- les boutons de la modale deviennent inertes et se grisent ;
- **une seule ligne** apparaît dans la liste.

> *Prouve* la chaîne entière. Avant, deux clics faisaient deux ventes, avec
> deux numéros distincts — et rien en base ne pouvait les distinguer d'un
> travail légitime.

Puis le cas que le navigateur ne peut pas fermer, le seul qui démontre les
migrations 032/033 : faites un encaissement, et **avant** qu'il réponde,
coupez les données du téléphone. Le geste échoue. Rétablissez, recliquez sur
le même bouton sans fermer la fenêtre.

> *Prouve* que le serveur reconnaît le réessai : l'acompte doit monter **une
> seule fois**. S'il monte deux fois, la clé n'a pas été renvoyée — regardez
> si `js/verrou.js` est bien en ligne.
>
> Aucune fenêtre de confirmation ne doit apparaître ici : un geste qui a
> échoué n'est pas retenu, et c'est voulu.

### c ter. Le troisième cran : la fenêtre de confirmation

Enregistrez une sortie. Attendez qu'elle s'affiche dans la liste. **Puis
refaites exactement la même**, sans vous presser.

> Attendu : une fenêtre qui rappelle ce qui vient d'être enregistré et depuis
> combien de temps, et demande s'il s'agit d'un second enregistrement réel.
> *Annuler* ne doit **rien** écrire.
>
> Recommencez en changeant le poids : **aucune fenêtre** — c'est le même geste
> mais un autre contenu, et faire confirmer deux ventes différentes
> apprendrait à cliquer sans lire.
>
> Enfin, enregistrez une sortie, **rechargez la page avec F5**, et refaites la
> même : la fenêtre doit encore apparaître. C'est le cas que ni le verrou ni
> la clé ne couvrent, et il passe par `localStorage` — donc par appareil.

### c quater. Le portail nomme la bijouterie

Ouvrez `client.html` avec une cliente qui a un code. L'en-tête doit afficher
le **nom de la bijouterie** — plus « KAYOR », qui y figurait en dur — et la
fenêtre de dépôt doit dire « Dépôt chez … ».

> *Prouve* que `portail_donnees()` renvoie bien la boutique (migration 037).
> Si l'en-tête reste vide, c'est `client.html` qui n'est pas à jour.

**L'essai qui démontre la migration 037** demande une préparation : donnez à
une même cliente **le même numéro et le même code** dans deux boutiques.

> Attendu : un écran « Vos bijouteries » avec les deux noms, puis, pour
> chacune, **son** solde et **son** historique. Le bouton « ⇄ Changer » passe
> de l'une à l'autre sans se reconnecter.
>
> Avec un code **différent** dans chaque boutique, pas d'écran de choix :
> elle entre directement dans celle dont le code a été tapé. C'est voulu.
>
> Et pour une cliente d'**une seule** boutique — le cas de presque toutes —
> rien ne doit changer : pas d'écran de choix, pas de bouton « Changer ».

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
