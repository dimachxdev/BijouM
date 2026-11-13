# Déploiement — vitrine publique, QR, CGU et verrou des gestes

Mis à jour le 2026-11-02. À suivre dans l'ordre.

> **Ce déploiement porte quatre lots.** La vitrine et les CGU, prêts depuis le
> 2026-10-31 et jamais mis en ligne ; le verrou des gestes ; les sauvegardes
> avec le garde-fou de suppression — et, depuis le 2026-11-04, leur
> **téléchargement et leur restauration**, plus l'édition simple.
>
> Les migrations **032 à 040 sont appliquées et vérifiées**. La base accepte
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

## 2. Les quatorze fichiers à déployer

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

- `index.html` : `?v=2026-11-13a` · `operateur.html` : `?v=2026-11-12d`
- `APP_VERSION` : `2026-11-13-qr-telechargeable`
- `client.html` : `?v=2026-11-04b`
- `boutique.html` : `?v=2026-11-02a`

> **Les empreintes ne sont pas toutes identiques, et ce n'est pas un oubli** :
> chacune suit les fichiers que sa page charge. Le 2026-11-12 ont changé
> `index.html`, `js/app.js`, `js/auth.js`, `js/supabase.js`, `css/style.css`,
> `operateur.html` et `js/operateur.js` ; `client.js`, `boutique.js` et
> `qr.js` sont restés tels quels. Ce qui doit être juste,
> c'est qu'une page qui charge un fichier modifié porte une empreinte neuve.

---

## 3. Juste après le déploiement

**Rechargez avec Ctrl + Maj + R**, puis regardez la version sous l'écran de
connexion. Tant qu'elle n'affiche pas `2026-11-13-qr-telechargeable`, rien de ce
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

### c quinquies. Les deux éditions

Dans la console opérateur, ouvrez une boutique → **Édition** → « Simple —
facturation seule » → Appliquer. Puis reconnectez-vous dans cette boutique
(le drapeau est lu à la connexion).

> Attendu : **Stock et Sorties ont disparu** de la navigation, et le bouton
> flottant avec. « Nouvelle vente » ne demande plus d'article : on décrit le
> bijou (type, carat, provenance, poids) et la description devient
> obligatoire. Caisse, épargne, dépôts, décaissements et arrhes sont intacts.
>
> Repassez en « Complète » : les onglets reviennent, **et les articles sont
> toujours là**. Rien n'est effacé en basculant — la fonction serveur le
> rappelle d'ailleurs dans sa réponse.
>
> La contre-épreuve, à faire une fois : dans une boutique en édition
> **complète**, « Nouvelle vente » doit toujours refuser sans article, et
> déduire le stock après la vente.

### c septies. La colonne Carat de la facture

Ouvrez une facture : la colonne **Carat** doit lire « 18 carats », sans
« - Importé » ni « - Local ». Les écrans de gestion, eux, gardent le libellé
complet — c'est voulu, la provenance regarde le stock, pas la cliente.

### c octies. Plusieurs articles sur une facture

Migrations **041, 042 et 043 appliquées et vérifiées** : la base sait déjà
écrire une facture à plusieurs lignes. Le déploiement n'apporte que l'écran.

« Nouvelle vente » n'a **plus de champ Description en en-tête** : chaque
article porte le sien. Le **Total est en lecture seule** — il est la somme
des lignes.

**1. Deux articles.** Choisissez un article, « + Ajouter un article », un
second, chacun avec son montant.

> Attendu : le Total suit chaque frappe, en **francs formatés**. La facture
> imprime **deux lignes** et un pied « 2 articles · poids total · total ».
> Sur une facture d'un seul article, **pas de pied** — il répéterait le
> total qui figure déjà en dessous.
>
> En édition **complète**, une ligne n'offre **que** le sélecteur d'article :
> plus de saisie libre (migration 043). En édition **simple**, l'inverse —
> aucun sélecteur, tout se décrit à la main. Vérifiez les deux : c'est la
> même règle lue dans les deux sens, et se tromper de sens rendrait la
> facturation impossible dans l'une des deux éditions.

**2. Le piège du multi-articles, et c'est l'essai qui compte.** Mettez
**deux lignes sur le même article**, dont les poids cumulés dépassent son
stock — par exemple 6 g + 6 g sur un article qui en a 11.

> Attendu : les **deux** lignes affichent « Reste −1.00 g … — autres lignes
> comprises » en rouge, et l'enregistrement est refusé. Vérifiées une par
> une, ces deux lignes passent chacune : c'est tout l'intérêt du contrôle
> agrégé, côté serveur comme à l'écran.
>
> Retirez une ligne : l'autre doit **retrouver sa disponibilité pleine**
> immédiatement.

**3. Ce qui doit refuser**, chacun avec son message et **sa ligne nommée** :
une ligne sans article en édition complète, une ligne sans description en
édition simple, un montant à zéro, un acompte supérieur au total, un article
disparu de l'inventaire — et **l'épargne dès la deuxième ligne** (« une
vente réglée sur l'épargne ne porte qu'un article pour l'instant »).

**4. La vente sur épargne et la commande avec acompte** doivent continuer de
fonctionner comme avant, à un article.

> Et les ventes **antérieures** : ouvrez une facture de la semaine dernière.
> La migration 041 leur a donné leur ligne n° 1 ; elle doit s'imprimer
> exactement comme avant.

**5. Modifier une facture à plusieurs articles doit être refusé** — ses
colonnes de marchandise sont un résumé, et les corriger les ferait diverger
de ses lignes.

### c nonies. Le stock compté en pièces

Migration **044 appliquée et vérifiée**. Console opérateur → une boutique →
**Édition** → « Articles — comptage en pièces seulement » → Appliquer, puis
reconnectez-vous dans cette boutique (le réglage est lu à la connexion).

> Attendu, et **c'est l'essai qui compte** : la liste des articles d'une
> nouvelle vente **n'est pas vide**. Le filtre portait sur le seul poids, et
> dans ce mode aucun article n'en a — la liste l'était, et le mode entier
> était inutilisable. Le défaut ne se voyait pas en relisant le filtre, qui
> avait l'air juste.
>
> Puis : plus aucun champ « Poids » — ni sur la ligne de vente, ni sur la
> fiche article, ni sur une sortie de stock. La disponibilité se lit
> « Reste N article(s) », et passe en rouge si on dépasse la quantité.
>
> La facture imprimée n'a **que trois colonnes** : Description, Carat,
> Montant. Vérifiez la largeur du Montant — les largeurs sont posées par
> rang, donc retirer une colonne les décale toutes.

**La contre-épreuve** : ouvrez une facture **antérieure** à la bascule, qui
portait de vrais poids. Sa colonne Poids doit **revenir**. La condition porte
sur les lignes, pas sur le mode de la boutique.

**Et le droit** : sous l'identité d'une propriétaire, `stock_par_poids` doit
être refusé à l'écriture directe **et** son adresse doit toujours passer —
sans ce second essai, le premier ne prouve rien.

### c decies. Le paiement en tuiles

« Nouvelle vente » n'a plus de liste déroulante pour le paiement : **six
tuiles visibles d'un coup**, trois par rangée sur un écran large, deux sur un
téléphone.

> Attendu : la tuile choisie prend la couleur de son service — la même qu'au
> journal — et les cinq autres restent sur fond neutre avec leur pictogramme
> en couleur. **Wave** montre son manchot sur carré cyan et **Orange Money**
> ses deux flèches : ces deux-là gardent leurs couleurs de marque quel que
> soit l'état de la tuile.
>
> **L'essai qui compte**, parce qu'il porte un vrai piège : choisissez
> **Épargne** pour une cliente **qui n'a pas de compte**. Le serveur refuse,
> le message le dit, et la tuile doit **retomber sur Espèces** — pas rester
> sur Épargne. Même chose sans cliente choisie du tout.
>
> Puis avec une cliente qui a un compte : le bloc vert du solde apparaît.

**Sur la facture imprimée, le paiement reste du texte** — pas de pictogramme.
Un code composé (`compte+wave`) n'a pas d'icône unique, et une facture
s'imprime souvent en noir et blanc.

### c undecies. Télécharger le QR de la vitrine

*Profil de la boutique → carte **Vitrine publique**, tout en bas.*

Un aperçu du code apparaît, avec le logo de la boutique en son centre, et un
bouton le télécharge en PNG.

> Attendu : après avoir changé le logo et enregistré, **l'aperçu montre le
> nouveau logo sans qu'on rouvre l'écran**. Sans logo enregistré, le code
> s'affiche nu — jamais avec la marque du logiciel.
>
> Le logo doit être **entier et centré**, quelle que soit sa forme : un logo
> large garde ses bords gauche et droit, un logo haut ses bords haut et bas.
> Vérifié sur trois formes (3:1, 1:3, carré) — rapport conservé, écart au
> centre nul ou d'un demi-pixel.

**Et l'essai qui compte, celui qu'aucune mesure ne remplace : imprimez-le et
scannez-le avec un vrai téléphone.** La pastille du logo couvre 5,1 % des
modules là où le niveau M en récupère environ 15 %, et les trois motifs de
position sont intacts — mais un encodeur QR faux produit une image
parfaitement plausible (§ 3). Scanner une fois avant d'imprimer en nombre.

### c sexies. Télécharger une sauvegarde, et la remettre

Carte **Sauvegardes et structure** de la console opérateur. Les migrations
**039 et 040 sont appliquées** : la base sait déjà exporter, importer et
réinjecter. Le déploiement n'ajoute que l'écran.

**1. Télécharger.** Choisissez une sauvegarde dans la liste → **⤓ Télécharger**.

> Attendu : un fichier `kayor-sauvegarde-<n°>-<date>.json` d'environ 500 Ko.
> La date du nom est celle des **données**, pas celle du clic.
>
> **Rangez ce fichier comme la base elle-même** : il contient les données de
> toutes les boutiques, empreintes de code PIN comprises. C'est la seule
> copie qui survit à la perte du projet Supabase — et c'est aussi la raison
> pour laquelle la MFA sur le compte opérateur n'est plus une bonne pratique
> mais la serrure de ce coffre (§ 9).

**2. Le remettre.** Choisissez ce même fichier dans « Remettre un fichier » →
**⤒ Importer ce fichier**.

> Attendu : il apparaît dans la liste, marqué **FICHIER IMPORTÉ**, à la date
> de ses données. **Aucune donnée n'a bougé** — vérifiez-le : le nombre de
> ventes à l'écran est inchangé.
>
> Et le point qui compte : **« Dernière sauvegarde » ne doit pas changer.**
> La fraîcheur se juge sur les instantanés pris dans la base, jamais sur un
> fichier remis — sinon importer une archive de la semaine dernière éteindrait
> l'alerte des 48 h au moment précis où elle sert. C'est ce que ferme la
> migration 040.

**3. Restaurer ce qui manque — l'essai qui compte.** Supprimez une ligne sans
conséquence (une sortie d'essai), puis **⚖ Comparer à la base** → la table
passe à « des lignes manquent » → **Examiner**.

> Attendu, dans cet ordre :
>
> - un encadré ambre qui **nomme les clés primaires** qui reviendraient, et
>   rappelle que des lignes ont peut-être été supprimées volontairement ;
> - **rien n'est écrit** à ce stade — l'essai à blanc est le défaut de la
>   fonction serveur, pas une option de l'écran ;
> - **Réinjecter** sans retaper le nom de la table : refusé par le serveur ;
> - avec le nom retapé : la ligne revient, et le compte rendu vert donne
>   **les clés exactes à supprimer pour défaire le geste** ;
> - refaire **Examiner** : « Rien ne manque ».
>
> La contre-épreuve : une ligne **présente** ne doit jamais être modifiée.
> Changez le montant d'une sortie existante, réinjectez la table, et vérifiez
> que votre montant est toujours là. S'il est revenu à sa valeur d'hier, la
> fonction écrase — ne plus s'en servir.

**4. Le journal.** Sous la carte, « Journal des exports et restaurations »
doit porter une ligne par geste, avec qui l'a fait. Il n'a ni `UPDATE` ni
`DELETE` : personne ne peut l'effacer, pas même l'opérateur qu'il enregistre.
C'est la contrepartie de l'export, pas une décoration.

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
