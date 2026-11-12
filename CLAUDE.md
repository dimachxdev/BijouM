# KAYOR — règles du projet

Application de gestion de bijouterie, **multi-boutiques (SaaS)**.
SPA en JavaScript sans framework ni build, adossée à Supabase (PostgreSQL + RLS).

Chaque règle ci-dessous vient d'un incident réel sur ce projet. Elles ne sont
pas des préférences de style : les enfreindre a déjà cassé des données ou
ouvert un accès.

---

## Règle d'or

> **Le navigateur ne décide d'aucune autorisation. PostgreSQL décide.**

Tout `isAdmin()`, `peutAcceder()`, `peutVoirCaisse()` ou bouton masqué est du
**confort d'affichage**. La protection réelle est la policy RLS. Si une règle
n'existe que dans `js/`, elle n'existe pas : `STATE.currentUser.role = 'admin'`
tapé dans la console la contourne en une seconde.

**Toute nouvelle restriction s'écrit d'abord en SQL, ensuite dans l'interface.**

---

## 1. Base de données

### Ne jamais rouvrir un `UPDATE` « pour que ça marche »

Encaisser un versement et modifier une vente touchent la **même ligne**. Ouvrir
l'UPDATE pour permettre le premier autorise aussi le second.

Chaque geste légitime qui exige une écriture passe par sa **propre fonction
`SECURITY DEFINER`**, qui ne sait faire qu'une chose :

| Geste | Fonction |
|---|---|
| Encaisser un versement sur une commande | `enregistrer_paiement_vente()` |
| Vente réglée sur l'épargne | `vente_sur_compte_epargne()` |
| Ouvrir un compte épargne | `ouvrir_compte_epargne()` |
| Enregistrer un dépôt | `depot_compte_epargne()` |
| Poser ou retirer un code PIN | `definir_pin_client()` |
| Réserver un identifiant | `prochain_id()` |

Besoin d'une écriture pour un rôle qui ne l'a pas ? **Ajouter une fonction, pas
une permission.**

### RLS filtre, RLS ne lève pas d'erreur

Un rôle sans droit de lecture reçoit **une liste vide**, pas un refus. Donc tout
écran qui déduit un état de l'**absence** d'une ligne se met à mentir
silencieusement.

Vécu : après avoir fermé la lecture des décaissements au vendeur, la colonne
« Sortie caisse » affichait « + Enregistrer » sur des reprises pourtant payées.
Garder ces écrans derrière `peutVoirCaisse()`.

### Ne jamais charger une ressource par un identifiant venu du client sans filtre

Un `id` envoyé par le navigateur ne prouve rien. La protection contre l'IDOR
*(accès à l'objet d'autrui en changeant un identifiant dans l'URL)* repose
entièrement sur RLS : chaque policy porte `organisation_id = app.current_org()`.

**Donc une nouvelle table sans cette clause est une fuite entre boutiques.**
Toute table métier naît avec `organisation_id` et sa policy, dans la même
migration.

### Une fonction `SECURITY DEFINER` contourne RLS : elle filtre elle-même

C'est le corollaire qu'on oublie. La policy ne protège **pas** le corps d'une
fonction `SECURITY DEFINER` — elle s'exécute avec les droits de son
propriétaire. Chaque lecture et chaque écriture y porte donc
`and organisation_id = v_org`, avec `v_org := app.current_org()` en tête de
fonction. `vider_compte_epargne()` (migration 013) est le modèle.

**Et les clés primaires sont composées `(organisation_id, id)` : `id` seul
n'est pas unique.** `CC-0001` existe dans chaque boutique qui en a ouvert un.

Vécu le 2026-10-23 : `vente_sur_compte_epargne()` cherchait un compte par son
seul identifiant. Avec une boutique, cela marchait. À la seconde, toute vente
sur épargne est tombée sur
« *more than one row returned by a subquery used as an expression* ».

**L'erreur était le bon scénario.** Une sous-requête scalaire proteste ; un
`limit 1`, un `select ... into` ou un agrégat auraient pris en silence la
ligne d'une **autre boutique** — et crédité, débité ou vendu chez la voisine.
Un bogue mono-boutique est une fuite multi-boutiques qui attend son deuxième
tenant.

Toute fonction qui reçoit un identifiant métier du navigateur se relit sous
cet angle avant d'être considérée comme correcte.

**`SELECT ... INTO` ne proteste pas.** Avec plusieurs lignes, PL/pgSQL prend
la première en silence. Une sous-requête scalaire, elle, lève une erreur.
Donc les fonctions qui ne cassent pas sont plus dangereuses que celle qui a
cassé — c'est ainsi que `portail_donnees()` fusionne aujourd'hui les
mouvements d'épargne des deux boutiques sans que rien ne le signale.

### Le multi-boutiques ne se teste qu'avec deux boutiques

Tout a été construit et vérifié sur une seule. Avec un seul tenant, aucun
identifiant ne se recoupe : l'absence de filtre est **invisible par
construction**, et le reste jusqu'au jour du deuxième client.

Le jeu d'essai doit comporter **deux boutiques portant les mêmes
identifiants** (`CC-0001`, `CL-0001`, `V-0001`). Les six gestes à rejouer
dans chacune, en vérifiant à chaque fois que l'autre n'a pas bougé, sont
listés en fin de `migrations/021_audit_filtre_organisation.sql`.

Tant qu'ils n'ont pas été faits dans les deux, le multi-boutiques n'est pas
testé : il est supposé.

### Une cliente se désigne par son identifiant, jamais par son nom

`ventes`, `comptes_clients`, `reprises` et `bijoux_arrhes` portaient un **nom**
dans leur colonne `client`. Deux clientes homonymes d'une même boutique
partageaient donc épargne, commandes et reprises — et `portail_donnees()` les
rapprochait par ce nom.

Ce n'était pas un filtre oublié : c'était le modèle, antérieur au
multi-boutiques. Les migrations 022 à 024 n'y touchaient pas.

Vécu le 2026-10-27 : **quatre fiches « astou »** à Saint-Louis, quatre
numéros de téléphone différents, et chacune « voyait » les sept mêmes ventes
et le même compte `CC-0001`. Aucune n'avait encore de code PIN — la première
à en recevoir un aurait ouvert au portail les commandes des quatre.

Depuis les migrations 025 et 026 :

- **`client_id`** porte l'identité, avec une clé étrangère **composée**
  `(organisation_id, client_id)` → `clients (organisation_id, id)`. Sur la
  seule colonne `client_id`, une vente pourrait pointer la cliente d'une
  autre boutique : `CL-0001` existe partout.
- **`client` (le nom) est conservée** : c'est ce qui a été imprimé sur la
  facture ce jour-là. Une cliente qui se marie change de nom, la facture
  d'hier non. Ne pas la resynchroniser depuis `clients`.
- **`client_id` à NULL veut dire « on ne sait pas »**, et le portail ne
  montre alors la ligne à personne. L'ancien comportement la montrait à
  toutes les homonymes. En gestion elle reste visible : c'est un humain qui
  tranche.
- `on delete restrict` : une cliente qui a un historique ne peut plus être
  effacée. L'ordre des `delete` de `supprimer_boutique()` (migration 019)
  devient donc porteur de sens — les enfants avant `clients`. Ne plus le
  réarranger.
- Côté navigateur, le champ caché de `initClientPicker()` porte
  l'**identifiant**. `clientParId()` et `nomClientParId()` sont le seul pont
  vers le nom — ne pas en recalculer un ailleurs.
- `vente_sur_compte_epargne()` ne reçoit pas d'identifiant : elle le prend
  **sur le compte**. La vente appartient à celle à qui appartient l'épargne
  qui la paie. Une identité qui se propage ne se re-saisit pas.

### Une cliente peut être cliente de deux bijouteries

Signalé le 2026-11-03. `portail_login()` cherchait la fiche ainsi :

```sql
   where regexp_replace(c.tel,'\D','','g') = v_tel
     and c.pin_hash = crypt(p_pin, c.pin_hash)
   limit 1;                          -- ni ordre, ni boutique
```

C'est, mot pour mot, le motif du § 1 : **« un `limit 1` aurait pris en silence
la ligne d'une autre boutique »** — et cette fois dans le chemin
d'authentification. Il ne vole rien : la session porte
`(client_id, organisation_id)` et `portail_donnees()` filtre dessus depuis la
023. Mais il **choisissait à la place de la cliente**, sans ordre défini : elle
voyait l'épargne d'une seule de ses deux bijouteries, son dépôt y partait, et
l'autre lui était inaccessible sans que rien ne le lui dise.

Le défaut ne se déclenche que si le **même numéro porte le même code** dans
deux boutiques — avec des codes différents, `crypt()` départage tout seul.
C'est pourquoi il n'avait jamais été vu. Vérifié le 2026-11-03 : aucun numéro
n'est présent dans deux boutiques. Le trou était ouvert, personne n'est passé.

Depuis la migration 037 :

- **Plus de `limit 1`.** On ouvre une session par boutique où le code
  concorde, et la cliente choisit. **Une session reste le lien vers UNE
  boutique** — une session multi-boutiques obligerait à rouvrir le filtre
  `v_sess.organisation_id` partout, c'est-à-dire à défaire les migrations 023
  et 026.
- **L'ordre est explicite** (`order by o.nom, c.id`). Sans lui, la « première »
  boutique changeait d'un appel à l'autre.
- **Rien n'est divulgué** : seules les fiches dont le code concorde sont
  listées. Un code juste dans une boutique et faux dans l'autre ne révèle pas
  la seconde.
- **`portail_donnees()` renvoie le nom de la boutique.** Séparer deux
  boutiques sans pouvoir les nommer ne sépare rien. Le nom seulement, pas le
  logo : 200 Ko de base64 sur une connexion mobile, pour une information que
  le nom porte déjà.
- Côté navigateur, `ACCES` suit le jeton dans `sessionStorage`, et **la
  déconnexion invalide tous les jetons**, pas seulement celui affiché — sur un
  téléphone prêté, une session ouverte sur l'autre bijouterie est une session
  ouverte.
- `showPage()` a désormais une **liste** de pages. Ajouter un écran sans l'y
  inscrire le laisse visible sous le suivant ; c'est arrivé le jour même.

**Le portail affiche le nom de la bijouterie, plus celui de KAYOR.** L'en-tête
portait le logo et le mot « KAYOR » en dur. C'est la même faute que le repli
de `_logoFacture()` corrigé le 2026-10-21 : cette page est ouverte par la
cliente d'une bijouterie, elle doit y lire **sa** bijouterie. Et la fenêtre de
dépôt le répète — c'est le seul écran où elle engage de l'argent.

### La clé de service ne touche jamais le navigateur

Créer un compte ou remplacer un mot de passe exige l'API Admin de Supabase,
donc `SUPABASE_SERVICE_ROLE_KEY` — la clé qui ignore RLS et peut tout lire.

Elle vit **uniquement** dans l'Edge Function `membres-admin`, où Supabase
l'injecte automatiquement. Rien à configurer, et rien à fuiter.

Cette fonction revérifie, dans cet ordre : jeton valide, appelant membre actif,
rôle `proprietaire`, et — pour un changement de mot de passe — cible
appartenant à **sa** boutique. Sans ce dernier contrôle, une propriétaire
changerait les accès d'une autre boutique.

**Ne jamais ajouter d'autre point d'entrée à cette clé**, et ne jamais la
copier dans `js/`, un fichier de configuration ou une variable d'environnement
Vercel.

### Chaque nouvelle fonction exposée se ferme explicitement

Une fonction dans `public` est une route HTTP (`/rest/v1/rpc/<nom>`). Par défaut
elle est appelable par tout le monde. Le trio obligatoire :

```sql
revoke all on function public.ma_fonction(...) from public, anon;
grant execute on function public.ma_fonction(...) to authenticated;
```

…**plus** un contrôle de rôle dans le corps (`app.has_role(...)` ou
`app.est_operateur()`). Le `grant` dit qui peut frapper à la porte ; le
contrôle interne dit qui entre.

Toute fonction porte aussi `set search_path = public, pg_temp` — sans quoi la
résolution des noms dépend de l'appelant.

**Exception : les fonctions qui appellent `crypt()`** (`portail_login`,
`definir_pin_client`) ont besoin de `public, extensions, pg_temp` — pgcrypto
vit dans `extensions`. L'oublier ne casse rien à l'application de la
migration : la fonction se crée très bien et échoue seulement à l'appel, avec
« function crypt(text, text) does not exist ». Le portail cliente est alors
entièrement hors service. **C'est arrivé deux fois** (septembre, puis le
2026-10-21). Après toute réécriture d'une de ces deux fonctions, appeler la
route une fois avant de passer à autre chose — une migration qui « réussit »
ne prouve rien.

### Valider dans la fonction, pas seulement dans le formulaire

Le navigateur est une commodité, jamais une barrière. Format du code boutique,
normalisation du numéro, montant positif, rôle demandé : tout se revérifie côté
serveur. `creer_boutique()` et `app.normaliser_tel()` sont les modèles à suivre.

### Migrations

- Numérotées, dans `migrations/`, **jamais modifiées une fois appliquées**.
- Chaque fichier commence par ce qu'il corrige et pourquoi.
- **Un fichier écrit n'est pas une migration appliquée.** Vérifié le
  2026-10-27 : la 023 était rédigée, relue, annoncée comme passée — et
  absente de la base. La fuite qu'elle ferme (le relevé d'épargne du portail,
  qui fusionnait deux boutiques) est restée ouverte quatre jours de plus.
  Après chaque application, relire le **corps réel** de chaque fonction
  touchée :
  ```sql
  select proname, array_to_string(proconfig,' | ') as search_path,
         pg_get_functiondef(oid)
    from pg_proc where proname = 'ma_fonction';
  ```
  Le « succès » d'une migration ne prouve que l'absence d'erreur de syntaxe.
- Toujours tester la policy en **se mettant à la place d'un rôle** :
  `set local role authenticated` + `request.jwt.claims`, puis compter les lignes.
- Après toute migration, passer le linter Supabase (*Advisors → Security*) et
  traiter ou justifier chaque ligne.

### Relire la matrice, pas les migrations

Une policy `UPDATE` sans contrôle de rôle ne se voit pas en lisant le code :
ses voisines en ont un, on suppose qu'elle en a un. Deux trous sont restés
ouverts des semaines ainsi — `mouvements_arrhes` modifiable par un vendeur, et
les douze compteurs remettables à zéro par n'importe qui (migration 011).

**Interroger `pg_policy` pour obtenir le tableau complet** — table × commande ×
rôles exigés × `current_org` × `org_active` — et chercher les cases vides.
Le linter ne voit pas ces trous : les policies existent, elles sont seulement
trop larges.

**Dressée pour la première fois le 2026-10-31.** Résultat : les 46 policies
des 20 tables portent toutes `current_org`, et les données le confirment —
zéro croisement entre boutiques sur les cinq relations dépourvues de clé
étrangère (`mouvements_cc.compte_id`, `ventes.compte_client_id`,
`decaissements.origine_id`, `mouvements_arrhes.arrhes_id`,
`portail_sessions.client_id`). L'étanchéité des tenants est **acquise et
mesurée**, pas supposée.

Les deux trous qu'elle a révélés n'étaient pas des fuites entre boutiques
(migration 027) :

### Une policy RLS ne filtre pas les colonnes

C'est le piège que la matrice seule ne montre pas. `org_update` autorisait
à juste titre une `proprietaire` à modifier **sa ligne** d'`organisations` —
mais une policy dit *quelles lignes*, jamais *quelles colonnes*. Seul un
`grant update (col, col, …)` le fait, et `authenticated` les avait toutes.

Donc `plan`, `expire_le` et `actif` étaient réglables depuis la console du
navigateur : abonnement illimité gratuit, et **une boutique suspendue
pouvait annuler sa propre suspension**. Or `app.org_active()` lit exactement
`actif` et `expire_le` — la clé qui conditionne toutes les écritures était
aux mains de la personne qu'elle contraint.

**Toute colonne sensible se protège par un `grant` nommé, pas par une
policy.** Les huit colonnes ouvertes sont celles que
`enregistrerProfilBoutique()` écrit vraiment. En ajouter une à l'écran des
paramètres impose de l'ajouter au `grant` — jamais un `grant update` nu.

### `org_active()` manquait sur les `DELETE`

Les huit policies `DELETE` avaient `current_org` et le contrôle de rôle, pas
`app.org_active()` — contrairement à leurs voisines `INSERT` et `UPDATE`.
Vérifié sur la boutique réellement suspendue : l'`INSERT` d'une vente était
refusé, le `DELETE` de ses sept ventes passait.

Le § 5 promet une lecture seule. Le seul geste resté possible était donc le
**destructeur**, épargne des clientes comprise — de l'argent qui ne
appartient pas à la boutique. Une case vide dans une seule colonne de la
matrice peut inverser le sens d'une garantie.

`supprimer_boutique()` n'en souffre pas : elle est `SECURITY DEFINER`, donc
hors policies — et elle exige que la boutique soit déjà suspendue.

### Alertes du linter qui sont normales ici

Ne pas les « corriger » : ce sont des choix.

- **RLS activé sans policy** sur `operateurs`, `portail_sessions`,
  `portail_tentatives` — c'est l'intention : personne n'y accède directement,
  seules les fonctions `SECURITY DEFINER` les lisent.
- **`portail_*` exécutables par `anon`** — le portail cliente n'a pas de session
  Supabase ; l'identité se prouve par le PIN *dans* `portail_login()`.

### Ne jamais recréer un script qui désactive RLS

Un fichier `fix_tout.sql` a existé ici : il faisait `disable row level security`
sur toutes les tables et rendait la base lisible par `anon`. Supprimé le
2026-10-14. **Ne jamais en réécrire un**, même « juste pour déboguer » — c'est
exactement la faille que les migrations 001 et 002 ont fermée.

Déboguer une policy se fait en se mettant à la place d'un rôle (voir ci-dessus),
jamais en coupant RLS.

---

## 2. Écriture depuis le navigateur

### `organisation_id` dans chaque corps de requête

Les clés primaires sont composées : `(organisation_id, id)`. **PostgREST déduit
la cible d'un upsert de la clé primaire.** Un corps sans `organisation_id` ne
peut pas construire sa cible — l'écriture échoue en silence, ou pire, écrase.

L'injection est centralisée dans `_supa.upsert()`. Ne pas la contourner.

Vécu : la table `compteurs` ne s'enregistrait plus. La numérotation rejouait des
identifiants déjà pris, et les upserts écrasaient les ventes existantes.

### La numérotation vient du serveur

`prochain_id()` réserve les identifiants. Il n'existe plus de compteur local —
`nextId()` a été supprimé, ne pas le réintroduire. Deux postes qui vendent en
même temps produiraient le même `V-0042`.

**La règle avait deux survivants, trouvés le 2026-11-02** : `ajouterProduit()`
fabriquait sa référence depuis `STATE.counters.stk`, et `enregistrerMiniClient()`
son identifiant depuis `STATE.counters.cl`. Les deux passent désormais par
`prochainId()`.

Le second était le plus grave : depuis la migration 025, `client_id` **porte
l'identité**. Deux postes créant une cliente au même moment lui donnaient le
même identifiant, et épargne, commandes et accès au portail se seraient
mélangés — le défaut même que 025 et 026 ferment. C'est aussi ce qui explique
les `CL-010` à trois chiffres à côté des `CL-0023` du serveur : deux
fabricants, deux formats.

### Ne jamais jeter le corps d'une erreur PostgREST

Sept appels RPC ne gardaient que le code HTTP : « Vente refusée (500) ». Or
PostgreSQL avait écrit la cause — contrainte violée, colonne, valeur — dans
le corps de la réponse. Une panne devenait indiagnosticable sans accès à la
base, et c'est exactement ce qui est arrivé le 2026-10-23.

`_erreurRpc(r, prefixe)` dans `js/supabase.js` est le seul endroit où cela se
lit : `message` en tête (c'est l'exception volontaire de nos fonctions, écrite
pour la personne devant l'écran), `details` et `hint` derrière. **Tout nouvel
appel RPC passe par lui.**

### Un geste ne s'enregistre qu'une fois — la clé de geste

Constaté le 2026-11-02, en essais. Sur une connexion lente, **rien ne signale
qu'une requête est partie**. La personne reclique. Deux ventes, deux dépôts,
deux décaissements, et le stock déduit deux fois.

**Et la base ne pouvait pas le voir.** `prochain_id()` réserve un identifiant
**à chaque clic**, avant l'écriture : le premier prend `V-0042`, le second
`V-0043`, et les deux sont des ventes parfaitement valides. Il n'y avait
aucune contrainte à violer, donc aucun refus possible. Mesuré le même jour à
Saint-Louis : compteur `v` = 35 pour 15 ventes présentes.

Corollaire à garder en tête : les contrôles « cette vente existe déjà » de
`vente_sur_compte_epargne()` et `ouvrir_compte_epargne()` **ne servent jamais
contre un double-clic**. Ils protègent d'un rejeu à l'identique, pas d'une
répétition du geste.

Depuis les migrations 032 et 033 :

- Le navigateur tire un **UUID à l'ouverture de chaque fenêtre de saisie** et
  le renvoie tel quel à chaque tentative du même geste.
- Les cinq fonctions d'argent réservent cette clé dans la table `gestes`
  **après toutes leurs validations, juste avant la première écriture**, et y
  rangent leur résultat. Une répétition reçoit le résultat gardé sans rien
  réécrire.
- Les six tables écrites en direct par PostgREST portent `cle_geste` et un
  index unique partiel. Le doublon y est refusé par la contrainte, et
  `_supa.upsert()` traduit le 23505 en « Ce geste a déjà été enregistré ».

**La place de la réservation n'est pas un détail.** Au-dessus des validations,
un refus brûlerait la clé : la personne corrige son montant, reclique, et
s'entend répondre « geste déjà lancé » pour un geste qui n'a rien écrit — le
formulaire deviendrait à usage unique. Donc **aucun `return` de refus ne doit
se trouver sous la ligne de réservation**. Une exception, elle, est sans
danger : elle annule la transaction, et la clé redevient libre.

**Une table plutôt qu'une colonne, à cause d'`enregistrer_paiement_vente()`**
qui n'insère rien — elle fait `acompte = acompte + montant`. Aucune contrainte
d'unicité n'aurait pu l'attraper, et c'est le geste où un doublon se voit le
moins et coûte le plus : une cliente créditée deux fois de ce qu'elle a versé
une fois.

Deux fonctions restent **volontairement sans clé**, et ce n'est pas un oubli :

- `definir_pin_client()` écrit une valeur, pas une ligne. Le refaire laisse le
  même état.
- `vider_compte_epargne()` recalcule le solde depuis l'historique et refuse un
  compte déjà à zéro : un rejeu n'écrit rien. CLAUDE.md la liste parmi les
  fonctions « à ne pas rouvrir par symétrie », et une clé n'améliorerait que
  le message, pas la sûreté.

`prochain_id()` n'est pas touchée non plus : un clic refait consomme un numéro,
donc un trou dans la numérotation — jamais une double écriture.

### Le verrou du navigateur est du confort, et doit être lu comme tel

`js/verrou.js` empêche le deuxième clic. Il n'empêche ni le rechargement de
page, ni l'abandon à 15 s du portail cliente sur un dépôt déjà écrit, ni deux
postes. **Le vrai verrou est la clé de geste ci-dessus.**

Deux portes, et c'est ce qui le fait fonctionner :

| | |
|---|---|
| `Verrou.geste(nom, fn)` | un handler. Un deuxième est **refusé**, jamais mis en file — une file ferait les deux ventes, l'une après l'autre. |
| `Verrou.requete(nom, fn)` | une écriture, dans `js/supabase.js`. Transparente **à l'intérieur** d'un geste. |

**`requete` n'est pas réentrante et ne peut pas l'être** : un deuxième clic et
un appel imbriqué franchiraient la même porte, et aucun drapeau ne les
distingue. **Donc une fonction qui fait plus d'une écriture s'enveloppe dans
un `geste`.**

Le reste du dispositif, à ne pas défaire :

- **La clé survit à un échec, elle est oubliée au succès.** Une clé neuve à
  chaque tentative rendrait le réessai invisible du serveur ; une clé gardée
  après un geste abouti ferait prendre le geste **suivant** pour son rejeu.
  Un handler qui ravale son erreur dans un `.catch` local casse exactement
  cela : le verrou croit que le geste a abouti.
- **Le nom du geste porte sa cible** — `paiement:V-0042`, pas `paiement`.
  Sinon l'échec d'un versement fait passer le versement suivant, sur une
  autre vente, pour son rejeu.
- **Les lectures ne sont jamais bloquées** : `chargerDonnees()` tourne juste
  après chaque écriture.
- **Un chien de garde relâche au bout d'une minute.** Les écritures partent en
  `fetch` nu, sans délai d'abandon : sans lui, une requête qui pend laisserait
  l'application inutilisable. La requête continue peut-être — c'est la clé de
  geste qui rend le réessai sûr.
- **Le retour visuel n'est pas décoratif.** Verrouiller sans rien montrer
  remplace le double enregistrement par un bouton mort sans explication. Une
  seule règle CSS sur `body[data-occupe]` : curseur en attente, boutons de la
  modale ouverte et bouton flottant inertes, filet or en haut d'écran. Le
  sélecteur est **`.modal-backdrop.show`**, pas `.modal.show` — écrit de
  mémoire, il ne correspondait à rien et seuls les boutons restaient
  cliquables. Mesuré dans le navigateur, pas relu.

### Trois crans, et chacun ferme ce que le précédent laisse

Demandé le 2026-11-02, après avoir trouvé `S-0003` et `S-0004` à **940 ms
d'intervalle** dans les sorties de Saint-Louis — une seule sortie réelle,
enregistrée deux fois, et le stock déduit deux fois.

| | Ce qu'il arrête | Ce qu'il laisse passer |
|---|---|---|
| Le verrou | le second clic pendant que le premier est en vol | tout ce qui vient après la réponse |
| La clé de geste | le **réessai** d'un geste qui n'a pas abouti | un geste neuf, identique au précédent |
| La fenêtre de confirmation | un geste identique à un geste **abouti** récemment | ce que la personne confirme |

Le deuxième trou est celui qu'on ne voit pas : dès que le premier geste
aboutit, **sa clé est oubliée** — et il le faut, sinon le geste suivant
passerait pour son rejeu. Un second geste identique trois secondes plus tard
est donc, pour le serveur, parfaitement légitime. Si les deux clics de
`S-0003` avaient été espacés de trois secondes, la clé n'aurait rien vu.

`Verrou.confirmerRepetition(nom, empreinte)` ferme cela. Quatre règles, chacune
pour une raison :

- **Elle demande, elle ne refuse pas.** Une cliente peut vraiment déposer deux
  fois 10 000 le même jour. Seul un humain sait si c'est un second bijou ou un
  clic de trop.
- **Elle se déclenche sur le même geste ET le même contenu**, jamais sur
  « deux ventes à la suite » : une bijouterie en fait toute la journée, et une
  confirmation qui s'affiche sans raison s'apprend à cliquer sans la lire.
  Elle passerait alors aussi le jour où elle avait raison. **Ne pas
  l'élargir.**
- **L'empreinte est lue par un humain** dans la fenêtre — « bracelet · 4 g ·
  4 articles · Autre », jamais un condensé. C'est elle qui permet de
  reconnaître, ou non, ce qu'on vient de faire.
- **Elle s'appelle après les validations, juste avant la première écriture** —
  exactement là où la fonction serveur réserve sa clé. Au-dessus, on ferait
  confirmer des gestes qui vont être refusés de toute façon.

La mémoire est dans `localStorage`, et pas dans une variable, pour couvrir le
seul cas que rien d'autre ne couvre : **enregistrer, recharger la page, refaire
le même geste** en croyant que le premier n'a pas pris. Après un rechargement
le verrou est neuf et la clé oubliée ; cette mémoire reste. Elle est par
appareil : deux postes ne se préviennent pas l'un l'autre.

Un geste **échoué** n'est jamais retenu : son réessai ne doit pas faire
apparaître de fenêtre, la clé s'en charge déjà. Et un renoncement ne
ré-horodate pas, sinon la fenêtre se rallongerait pour un geste qui n'a pas eu
lieu. Treize gestes sont couverts, dont le dépôt du portail cliente.

### L'écran ne doit pas féliciter avant que la base ait répondu

C'est ce qui faisait recliquer, et c'était le vrai moteur du problème.

Deux mensonges indépendants, corrigés le 2026-11-02 :

- **Les huit `saveAndSyncX` avalaient leur erreur** dans un `console.error`.
  `await saveAndSyncVente(v)` aboutissait donc même quand la base avait refusé
  : le handler fermait sa modale et annonçait « Vente enregistrée ». Elles
  relancent désormais. Seule `saveAndSyncConnexion` garde son silence —
  journaliser ne doit jamais empêcher de travailler.
- **`enregistrerVente()` ne l'attendait même pas** : `saveAndSyncVente(venteObj)`
  sans `await`, puis `closeModal()`, puis le toast de succès.

Règle : **l'état local après la base, jamais avant.** Un `STATE.ventes.unshift()`
avant l'écriture laisse à l'écran une vente qui n'existe nulle part, et le
rechargement suivant la fait disparaître sans explication.

### Une table, trois fonctions d'écriture

`dbSaveX`, `syncX` et `saveX` coexistent dans `js/supabase.js`. **Ajouter une
colonne impose de vérifier les trois.**

Vécu deux fois : `annulee` puis `origine_type` n'atteignaient jamais la base
parce que seules deux des trois fonctions avaient été mises à jour. Le bouton
« Enregistrer » revenait indéfiniment.

---

## 3. Interface

### Échapper tout ce qui entre dans `innerHTML`

`esc()` pour le HTML, `escJs()` pour une chaîne placée dans un `onclick`
(`js/security.js`). Une cliente nommée `<img src=x onerror=…>` s'exécuterait
dans la session de l'administratrice qui ouvre la liste.

### Trois plans, jamais deux surfaces identiques côte à côte

`--bg-app` (ivoire) est le fond de page, `--bg-primary` (blanc) ce qui porte
le contenu, `--bg-muted` les bandes internes d'une carte. **Ne jamais remettre
`.main` en blanc** : `.main` et `.card` étaient tous deux en blanc pur, une
carte ne se détachait que par un filet de 0,5 px — c'est ce qui donnait à
l'application son aspect plat.

Le relief vient du contraste entre ces plans et d'une ombre teintée brun doré,
jamais d'un trait plus épais ni d'une ombre grise (qui tire au gris sale sur
l'ivoire).

Les couleurs portent un sens, elles ne décorent pas : vert = argent qui entre,
rouge = argent qui sort, ambre = en attente d'un geste, or = état de caisse,
bleu = information. C'est vrai pour la tranche gauche d'une tuile
(`.metric-card.ton-*`) comme d'une carte de liste (`ton` passé à
`carteListe()`).

**L'or est plat, lettres noires.** Pas de dégradé doré, nulle part (décidé le
2026-10-21) : `--kayor-or` en fond, `--kayor-or-fonce` au survol,
`--kayor-noir` pour le texte. Le blanc sur l'or tombait à 1,17:1 — invisible
sur un téléphone en plein jour, et c'est le bouton le plus cliqué de
l'application ; le noir de la charte tient 7,7:1.

**Le logo de la boutique est un JPEG, donc sans transparence.** Dans le
panneau latéral il passe par `mix-blend-mode: multiply`, qui efface son fond
blanc dans le sable. Ne pas lui remettre une bande blanche autour.

Toute nouvelle couleur de texte se vérifie à 4,5:1 sur son fond réel (3:1
au-delà de 18 px ou en gras ≥ 14 px).

### Toute liste a deux vues, jamais deux vérités

Un tableau de dix colonnes sur un téléphone, c'est un défilement horizontal à
l'aveugle — or c'est là que la vendeuse travaille. Chaque liste a donc une
vue en cartes, que le CSS substitue au tableau sous 768 px : la carte `.card`
porte `avec-cartes`, et contient un `<div class="liste-cartes">` à côté du
`.table-wrap`.

Les deux vues se construisent **à partir du même tableau déjà filtré et
trié**, dans la même fonction de rendu, l'une sous l'autre. Les recalculer
chacune de son côté est la garantie qu'elles divergeront.

Une carte se décrit, elle ne s'écrit pas : `carteListe()` est le seul gabarit
(titre, valeur, description, pastilles, actions) et `rendreCartes()` le seul
point de montage. `titre`, `valeur`, `desc` et les textes sont échappés par
le gabarit ; seul `onclick` est du code de l'appelant, qui doit passer ses
arguments par `escJs()`.

**Les droits ne se rejouent pas dans la carte.** Si le tableau masque une
action pour un rôle, la carte doit lire la même condition — idéalement la
même fonction (`etatSortieCaisse()`, `peutVoirCaisse()`, `isAdmin()`), jamais
une copie de la règle.

Le bouton flottant suit la même discipline : il ne connaît aucune action, il
recopie le bouton « + … » de l'en-tête de la section ouverte et lui relaie le
clic. Un bouton masqué par le rôle masque donc le bouton flottant, sans une
ligne de plus.

### La facture n'a qu'une feuille de style

`FACTURE_CSS` (dans `js/app.js`) sert **à la fois** l'aperçu à l'écran et la
fenêtre d'impression. Elles avaient divergé jusqu'à l'absurde : les classes
`.facture-*` n'existaient que dans la fenêtre d'impression, donc l'aperçu
affichait du HTML brut — on validait une facture sans mise en page avant d'en
imprimer une autre. Ne pas réintroduire de second jeu de règles.

Deux pièges, tous deux rencontrés le 2026-10-21 :

- **Aucun accent grave dans ce bloc.** C'est un littéral de gabarit ; un seul
  le referme et casse tout le fichier. `node --check js/app.js` après chaque
  retouche.
- **`.facture-table` porte `min-width:0`.** La feuille de l'application impose
  `min-width:520px` à *toute* table, pour le défilement des listes. Sans ce
  rappel, la facture héritait de 520 px dans une modale de 330 px.

La colonne du détail est **Description · Carat · Poids · Montant** (décidé le
2026-10-21). Le poids est le total : la distinction or local / or importé
reste au journal, elle regarde la gestion du stock, pas la cliente.

Le **titre en millièmes** (`750/1000`) a été retiré de la colonne Carat le
2026-10-23 : il alourdissait sans parler à la cliente. Il reste dans
`CARATS_LIST`, pour les écrans de gestion.

**La provenance aussi** (2026-11-12). La colonne Carat affichait
« 18 carats - Importé » ; elle affiche **« 18 carats »**, rien de plus. Local
ou importé décide du prix d'achat et du suivi du stock — cela ne dit rien à
une cliente qui a acheté de l'or à dix-huit carats, et la facture est le
document qu'elle emporte. Le poids total suivait déjà cette règle.

`caratFacture()` est le seul endroit où ce libellé se fabrique, et il le
**dérive du code** (`18k-importe` → `18 carats`), jamais en découpant
`c.label` : réécrire un libellé de `CARATS_LIST` ne doit pas changer ce qui
s'imprime. Les écrans de gestion gardent le libellé complet — ne pas
« harmoniser » les deux.

Le **moyen de paiement** figure dans le bloc des totaux. Il passe par
`libellePaiement()`, jamais par `PAIEMENT_LABELS` en direct : une vente
réglée pour partie sur l'épargne porte un code composé (`compte+wave`) que
la table des libellés ne connaît pas, et la facture afficherait le code brut.

**Ce qui est imprimé est lu par une cliente** : accents compris. « Especes »
et « Importe » ont traîné des mois dans `PAIEMENT_LABELS` et `CARATS_LIST`.

**Chaque information n'est écrite qu'une fois** (réorganisation du
2026-10-23). La facture tenait sur deux pages pour une seule ligne de
marchandise : l'identité de la boutique figurait en en-tête **et** dans un
bloc « VENDEUR » juste dessous, sa ligne de contact dans ce bloc **et** en
pied, le numéro de facture en en-tête **et** en pied.

Aujourd'hui : l'en-tête porte la boutique et son contact, une bande porte la
cliente, le pied porte conditions et référence. Ne pas réintroduire de bloc
« VENDEUR » — il répète l'en-tête.

### La vitrine publique et son QR

`boutique.html?b=MBSS` est la page qu'une cliente ouvre en scannant le code
imprimé sur sa facture. **C'est la seule page du projet qu'ouvrent des
inconnus**, et la première lecture sans authentification côté boutique.

- **Une seule porte : `boutique_publique(p_slug)`**, qui énumère ses champs
  à la main. Ouvrir une policy à `anon` aurait été plus court et aurait
  publié `plan`, `expire_le` et `actif` — une policy dit quelles *lignes*,
  jamais quelles *colonnes*. NINEA et RCCM n'y figurent pas non plus
  (décidé le 2026-10-31) : ils restent sur les documents.
- **Une boutique suspendue garde sa vitrine.** Y afficher « expiré »
  révélerait à ses clientes qu'elle nous doit de l'argent. Le levier reste
  l'écriture, déjà coupée par `app.org_active()`.
- **Les réseaux sont des pseudos, jamais des URL.** `esc()` échappe le HTML
  mais laisse passer `javascript:` dans un `href`. Avec un pseudo, la
  boutique ne tient jamais le schéma de l'adresse. `maps_url` est la seule
  exception et porte une contrainte `https` **en base**.
- **`boutique.js` n'écrit jamais dans `innerHTML`** ce qui vient de la base :
  tout passe par `textContent`, qu'on ne peut pas oublier d'appeler. La
  couverture va dans `style.backgroundImage`, jamais dans du balisage.
- **La couverture et le logo sont en base64 dans la table** (migrations 028
  et 030), plafonnés à 300 et 200 Ko **par le navigateur** — c'est la seule
  vraie barrière, une photo d'appareil fait 4 Mo et rendrait la vitrine
  inutilisable sur un téléphone en données mobiles. Ce n'est pas le bon
  endroit à terme : le jour où une boutique voudra une galerie, c'est
  Supabase Storage, pas une troisième colonne.
- **Sans logo, l'initiale de la boutique ; sans couverture, un dégradé.**
  Jamais la marque du logiciel, par la même règle que `_logoFacture()` : un
  repli vers notre identité est pire qu'un champ vide, parce qu'il se
  confond avec un choix de la boutique.
- **Chaque lien porte la couleur de son service** (décidé le 2026-10-31) :
  WhatsApp vert, Itinéraire bleu Maps, Instagram en dégradé, Facebook bleu,
  TikTok rose. Appeler prend l'or de la boutique ; Écrire et Site internet
  restent neutres — leur inventer une couleur ferait de la page un nuancier.

  **La palette sémantique du § 3 ne s'applique pas ici.** Dans
  l'application, vert = argent qui entre et rouge = argent qui sort ; sur la
  vitrine, vert = WhatsApp et rose = TikTok. Ce n'est pas une entorse : ce
  sont deux surfaces différentes, l'une pour la vendeuse, l'autre pour une
  inconnue qui reconnaît une marque avant de lire un mot. Ne pas « corriger ».

  **Mais la couleur d'une marque n'est pas une couleur de texte.** Du blanc
  sur le vert WhatsApp tombe à **1,98:1** — invisible sur un téléphone en
  plein jour, exactement comme le blanc sur l'or. D'où du texte presque noir
  sur le vert et sur l'or, et **15 px / 700** sur les boutons, **14 px /
  700** sur les pastilles : c'est ce qui les fait basculer dans le seuil des
  gros caractères (3:1 au lieu de 4,5:1).

  Contrastes **mesurés dans le navigateur**, pas estimés :

  | | |
  |---|---|
  | Écrire · Site internet | 13,1:1 |
  | WhatsApp | 8,3:1 |
  | Appeler (or) | 8,0:1 |
  | Itinéraire | 4,5:1 |
  | Instagram | 4,34:1 |
  | Facebook | 4,23:1 |
  | TikTok | **3,68:1** |

  TikTok est le plus juste du lot : **réduire la taille ou retirer le gras
  ferait basculer les trois pastilles sous le seuil, celle-là en premier.**
- **Aucune mention « Créé avec KAYOR » sur la vitrine** — posé en question
  le 2026-10-31, tranché non. La page est celle de la boutique, affichée à
  sa clientèle, au même titre que la facture. La croissance par signature
  en pied (le modèle Calendly, y compris la variante « retirable au plan
  payant ») a été examinée et écartée. **Ne pas la reproposer** sans
  rouvrir franchement la règle du § 3.
- **Le domaine du QR est écrit en dur** (`DOMAINE_VITRINE`), pas
  `location.origin` : une facture imprimée depuis une recette porterait
  sinon un code menant à la recette, et une facture imprimée ne se corrige
  plus. C'est le domaine du *logiciel*, pas d'une bijouterie — la règle
  ci-dessous reste intacte.
- Le QR vit **dans l'en-tête, du côté des coordonnées** : c'est là qu'on
  cherche comment joindre la boutique. **Pas de légende sous le code** — la
  place va au code lui-même, qui se scanne d'autant mieux qu'il est grand.
  70 px contre 63 px de texte à côté : sept pixels, invisibles sur la
  feuille. Sur téléphone il passe à la ligne ; `@media print` remet la
  rangée quelle que soit la machine qui imprime.

### Un encodeur QR maison, et pourquoi il est testé ainsi

`js/qr.js` encode sans dépendance — la règle 6 interdit un `qrcode.js` de
CDN dans la page où vit le jeton de session. Mode octet, correction **M**
(le code est imprimé, sur du papier qui se plie), versions 1 à 10.

**Un encodeur QR faux produit une image parfaitement plausible.** Deux
bogues l'ont prouvé le 2026-10-31, et chacun enseigne la même chose :

1. Le polynôme générateur était construit à l'envers — décalage et
   multiplication inversés, donc le polynôme réciproque. Vingt tests
   passaient : ils relisaient les données et **ignoraient la correction**.
   Trouvé en vérifiant la propriété qui *définit* Reed-Solomon — tous les
   syndromes d'un mot valide sont nuls.
2. Les quinze bits de format étaient **transposés** : la norme les désigne
   en (x, y), la matrice s'indexe `m[ligne][colonne]`. Le décodeur de test
   les relisait aux mêmes positions fausses. Aucun téléphone ne lisait rien,
   puisque le format est la première chose qu'un lecteur décode.

**Une vérification qui partage l'hypothèse de ce qu'elle vérifie ne vérifie
rien.** Les contrôles qui ont servi sont ceux adossés à une autorité
extérieure : la table des mots de format de l'ISO/IEC 18004, la nullité des
syndromes — et, seul verdict final, un vrai téléphone.

### Aucune identité de boutique en dur

Jamais « KAYOR », « Dakar », ni un logo écrit dans le code. Tout document
imprimé lit `boutiqueInfos()`, `boutiqueLigneContact()`, `_logoFacture()`,
`_slugFichier()`. En SaaS, chaque boutique imprime la sienne.

**Et surtout : pas de repli sur l'identité du logiciel.** `_logoFacture()`
retombait sur le logo KAYOR quand la boutique n'avait pas téléversé le sien —
une bijouterie imprimait donc la marque de son fournisseur de logiciel sur
les factures remises à ses clientes. Sans logo, **aucune image** : le nom
commercial est à côté et tient seul l'en-tête. Corrigé le 2026-10-21, et la
constante `KAYOR_LOGO_B64` (60 Ko de base64 chargés à chaque ouverture) a été
retirée avec elle — l'original reste dans `assets/`.

Un repli vers la marque du logiciel est pire qu'un champ vide : le champ vide
se voit et se remplit, le repli se confond avec un choix de la boutique.

### Colonnes explicites sur `clients`

`select=*` échoue : la lecture de `pin_hash` est refusée à tout le monde,
administrateurs compris. Demander les colonnes nommées, et `a_un_pin` pour
savoir si la cliente a un accès au portail.

### Messages d'erreur neutres à la connexion

Ne jamais révéler qu'une adresse ou un numéro existe. « Identifiant ou mot de
passe incorrect », rien de plus précis. L'inscription avec une adresse déjà
prise doit répondre comme un succès.

### `APP_VERSION`

Incrémenter à chaque livraison (`js/app.js`). Affiché sous l'écran de connexion.
**Devant un comportement incohérent, vérifier cette version d'abord** : c'est
presque toujours un cache navigateur ou un déploiement en retard, pas un bug.

---

## 4. Identité et sessions

- **Le serveur seul établit l'identité.** `chargerProfil()` filtre sur le `sub`
  du JWT. Jamais sur un identifiant choisi par le navigateur — l'oubli de ce
  filtre affichait le propriétaire à tout le monde.
- **Jeton court, rafraîchi automatiquement** (`programmerRefresh()` dans
  `auth.js`). Ne pas allonger la durée de vie pour éviter une reconnexion.
- **La révocation est immédiate.** `app.current_org()`, `app.has_role()` et
  `app.org_active()` relisent `membres` à **chaque requête**, avec `actif`.
  Suspendre quelqu'un le coupe à la requête suivante, sans attendre l'expiration
  de son jeton. Le JWT prouve l'identité, jamais les droits.
  **Corollaire** : ne jamais écrire un point d'entrée qui se fie au seul contenu
  du jeton (une Edge Function, par exemple) — il contournerait cette révocation.
- **Le portail cliente a deux freins, pas un** (migration 015, 2026-10-21).

  Le premier compte les échecs **par numéro** : 5 ratés bloquent 15 minutes
  (`portail_tentatives`). Il ne protège que d'une chose — s'acharner sur un
  numéro — et pendant des mois c'était le seul.

  Le second compte les **numéros distincts visés par un même appelant**
  (`portail_tentatives_ip`) : 12 en 30 minutes bloquent cette IP une heure.
  C'est lui qui ferme le bourrage de codes PIN, l'attaque que le premier
  laissait entièrement passer : essayer `1234` sur deux mille numéros ne
  produisait qu'un échec par numéro, donc aucun blocage. Et c'est le même
  défaut, retourné, qui permettait de bloquer toutes les clientes à volonté.

  **Compter les numéros distincts et non les échecs bruts n'est pas un
  détail** : les opérateurs mobiles d'ici partagent massivement leurs IP. Une
  cliente qui se trompe trois fois sur son propre numéro ne doit rien
  déclencher, alors qu'un balayage se trahit au douzième.

  **L'IP se lit avec `app.ip_appelant()`, jamais à la main.** Elle prend
  `cf-connecting-ip`, posé par le proxy et infalsifiable. Le repli sur
  `x-forwarded-for` prend le **dernier** élément de la liste, jamais le
  premier : le proxy ajoute l'IP réelle à la fin, donc lire le premier
  laisserait un bot choisir son propre compteur en envoyant son en-tête — et
  annulerait tout le dispositif. Vérifié par un test d'évasion le 2026-10-21.

  Tout blocage doit se **réarmer** à l'expiration : `echecs` remis à zéro.
  Sans ça le compteur reste au plafond et re-bloque au premier échec suivant,
  indéfiniment.

  Toute nouvelle voie d'authentification doit avoir ses deux freins.
- **La connexion de l'équipe ne peut pas avoir les siens** — et il ne faut pas
  faire semblant (tranché le 2026-10-22).

  Elle ne passe pas par notre code : `auth.js` appelle `/auth/v1/token` chez
  Supabase avec la clé publique, lisible dans `js/supabase.js`. Un frein posé
  dans une Edge Function serait donc **facultatif** : un bot lit le source et
  appelle l'endpoint en direct. Il ne ralentirait que l'interface, c'est-à-dire
  les vendeuses, et donnerait une fausse assurance — le piège que décrit déjà
  « RLS filtre, RLS ne lève pas d'erreur ».

  C'est la différence avec le portail : là, `portail_login()` **est** le seul
  chemin. Ici, Supabase Auth est le chemin, et on ne peut pas le fermer.

  Le seul mécanisme inviolable serait le **Password Verification Hook** de
  Supabase, appelé par Auth à chaque vérification. Il est réservé aux plans
  **Teams et Enterprise** — pas même Pro. À reconsidérer le jour où ce plan
  se justifie, pas avant.

  **Ce qui est fait à la place** : la limite native *Authentication → Rate
  Limits → Sign in / Sign ups*, baissée de 30 à 10 par 5 minutes et par IP.
  Elle s'applique sur le vrai chemin. **Ne pas baisser « Token refresh »** :
  `programmerRefresh()` rafraîchit le jeton en continu, et la session des
  vendeuses tomberait en pleine journée.

  **Turnstile a été écarté pour la même raison et une autre** (2026-10-22) :
  il exige de charger `challenges.cloudflare.com` dans la page de connexion —
  là où le jeton se crée — ce qui briserait la règle 6. Un défi anti-bot doit
  s'exécuter dans le navigateur ; il ne peut pas passer par une Edge Function
  comme la vérification Have I Been Pwned. Ne pas le reproposer sans rouvrir
  franchement la règle 6.
- **L'équipe reçoit ses accès de la propriétaire** (décidé le 2026-10-19, en
  remplacement de l'identification WhatsApp). Elle choisit l'identifiant et le
  mot de passe, les communique de vive voix, et peut les remplacer à tout
  moment. Aucun message n'est envoyé : ce chemin ne dépend ni du SMTP ni de
  Twilio — c'est ce qui a débloqué la mise en production.

  **Identifiant court** : `fatou@kay` à l'écran, `fatou@kay.kayor.app` en base.
  Le suffixe n'est jamais montré et n'est pas une adresse : rien n'y est envoyé
  (`email_confirm: true` à la création). `Auth.normaliserIdentifiant()` le
  complète à la connexion, `loginCourt()` le retire à l'affichage.

  **Le mot de passe n'est jamais lisible, seulement remplaçable.** Supabase le
  hache. Ne jamais le stocker, l'afficher, le journaliser, ni le renvoyer dans
  une réponse — c'est la faille d'origine de ce projet (`admin/admin123` en
  clair dans `js/data.js` et dans la table `utilisateurs`).

  **Tout mot de passe passe par `membres-admin`, et nulle part ailleurs**
  (2026-10-21). Les cinq chemins — création de boutique, réinitialisation par
  l'opérateur, création d'un compte d'équipe, réinitialisation par la
  propriétaire, et `mon_mot_de_passe` pour son propre compte — y sont, et
  chacun confronte le mot de passe aux fuites connues avant de l'accepter.

  Le changement par la personne elle-même allait auparavant en direct sur
  `/auth/v1/user` : aucune règle ne s'y appliquait côté serveur, alors que
  c'est justement là que la propriétaire choisit son mot de passe définitif à
  la première connexion. **Ne pas réintroduire d'appel direct à Auth pour
  poser un mot de passe** — ce serait un contournement de toutes ces règles.

  La vérification des fuites est faite par l'Edge Function, **jamais par le
  navigateur** : k-anonymat, seuls les cinq premiers caractères du SHA-1
  sortent, et la page livrée ne contacte toujours aucun domaine tiers
  (règle 6 intacte). Le réglage natif de Supabase ferait la même chose mais
  exige le plan Pro.

  Si Have I Been Pwned ne répond pas, **on laisse passer** : refuser tous les
  mots de passe parce qu'un service tiers est tombé bloquerait la création de
  comptes. Le minimum de caractères reste le verrou dur.

  **La connexion WhatsApp et l'invitation d'équipe ont été retirées le
  2026-10-20.** Un compte d'équipe se crée uniquement par « + Créer un compte ».
  La fenêtre « Modifier un membre » ne change plus que le nom et le rôle.

  **Plus aucune arrivée ne dépend de l'email** depuis le 2026-10-20. La
  console opérateur crée la boutique ET le compte de sa propriétaire d'un
  bloc, par l'action `creer_boutique` de `membres-admin` : identifiant et mot
  de passe posés sur place, rien n'est envoyé.

  Si la création du compte échoue, la boutique est défaite derrière elle —
  jamais de boutique sans propriétaire.

  La table `invitations` et la fonction SQL `creer_boutique()` subsistent mais
  **ne sont plus appelées**. Ne pas les réutiliser sans décider d'abord
  comment la personne invitée recevra son invitation.

---

## 4 bis. Le plan service

Il y a **un seul opérateur**, et c'est le fondateur. Son compte est
opérateur **et rien d'autre** : il n'est membre d'aucune boutique.

Jusqu'au 2026-10-22, le même compte ouvrait la console de service et tenait
une bijouterie au comptoir. C'est le compte du comptoir qui s'expose — mot
de passe lu par-dessus l'épaule, téléphone partagé, appareil perdu — et le
perdre revenait à perdre le service entier, pas une bijouterie. La
bijouterie a donc reçu sa propre propriétaire (migration 017).

**Ne pas rattacher le compte de service à une boutique**, même « juste pour
suivre la sienne ». Une boutique se suit avec un compte de boutique.

`operateurs` reste donc **plat** : pas de hiérarchie `proprietaire` / `admin`
au niveau service. Une migration la posait ; elle a été écrite puis
supprimée sans jamais être appliquée, parce qu'elle départageait des gens
qui n'existent pas. **À reprendre le jour où un deuxième opérateur
arrive**, pas avant — et ce jour-là le défaut à l'insertion doit être le
niveau le moins puissant.

**Le plan service ne lit aucune donnée métier.** Ni ventes, ni caisse, ni
clientes — RLS filtre sur `app.current_org()` et un opérateur n'est membre
d'aucune organisation *en tant qu'opérateur*. Le fondateur voit sa propre
boutique parce qu'il en est membre, pas parce qu'il est opérateur. Décision
reconduite le 2026-10-22 : **ne pas ouvrir de lecture inter-boutiques**.
Dépanner une boutique se fait au téléphone avec sa propriétaire.

**Supprimer une boutique** est l'action la plus destructrice du produit :
elle efface l'historique commercial entier d'un tenant. Les verrous vivent
dans `supprimer_boutique()` (migration 019), pas dans le navigateur :

1. opérateur du service, et personne d'autre ;
2. le **code boutique doit être retapé** et correspondre — un identifiant
   transmis par erreur ne peut pas emporter une autre boutique ;
3. la boutique doit être **déjà suspendue** : supprimer devient deux gestes
   séparés dans le temps, pas un clic dans une liste ;
4. **ni épargne de cliente, ni créance en cours** — l'argent gardé pour une
   cliente n'est pas le nôtre, et une créance est une preuve de dette.

Le bouton 🗑 n'apparaît que sur une boutique suspendue. Ce n'est pas lui qui
protège : la fonction refuse de toute façon. **Ne jamais déplacer un de ces
quatre contrôles vers `operateur.js`.**

La suppression se fait en deux temps : le SQL efface les données et renvoie
les comptes rattachés, puis l'action `supprimer_comptes` de `membres-admin`
les retire de l'authentification. Les identités et les sessions ne vivent pas
dans une table ordinaire — seule l'API Admin les nettoie.

**`supprimer_comptes` ne touche jamais un compte du plan service**, ni celui
de l'appelant. « Jamais soi-même » ne suffisait pas : le jour où un deuxième
opérateur existe, il supprimerait une boutique dont le premier est membre et
emporterait son compte de service — la console entière avec. `operateurs`
n'est jamais effacé par `supprimer_boutique()` non plus.

**Poser une propriétaire sur une boutique qui existe déjà** passe par
l'action `creer_proprietaire` de `membres-admin`, réservée à l'opérateur.
⚠ **Écrite le 2026-10-22, pas encore déployée ni testée** — vérifier qu'elle
répond avant de s'appuyer dessus, et retirer cette ligne une fois en place.
Avant elle, le seul chemin était `creer_boutique`, qui crée la propriétaire
*en même temps* que la boutique : il n'existait donc aucun moyen de réparer
une boutique restée sans membre. « Marjan Bijouterie Saint louis » est dans
ce cas — personne ne peut y entrer.

Ne jamais créer un compte en insérant dans `auth.users` à la main : le
hachage du mot de passe et la table des identités sont faits par l'API
Admin, et un compte posé en SQL ne peut pas se connecter.

## 5. Abonnement et accès payant

Le plan et la date d'expiration vivent dans `organisations` et **ne sont jamais
lus depuis le navigateur pour accorder un droit**. `app.org_active()` conditionne
toutes les écritures : une boutique expirée ou suspendue passe en lecture seule
côté base, pas côté interface.

- Seul l'opérateur du service change un plan ou une échéance
  (`creer_boutique()`, `modifier_boutique()`, `basculer_boutique()`, toutes
  derrière `app.est_operateur()`). Il n'y a qu'un opérateur — voir § 4 bis.

  **Ce n'était vrai que sur le papier jusqu'au 2026-10-31.** `authenticated`
  avait l'`UPDATE` sur toutes les colonnes d'`organisations` : une
  propriétaire s'octroyait `plan`, `expire_le` et `actif` depuis la console.
  La migration 027 limite l'`UPDATE` à huit colonnes d'identité. Voir « Une
  policy RLS ne filtre pas les colonnes » au § 1 — une restriction qui
  n'existe que dans une fonction non appelée n'existe pas.
- Le jour où un paiement en ligne existera : signature des webhooks vérifiée,
  traitement idempotent, et **déblocage uniquement sur confirmation du
  prestataire** — jamais sur un appel venu du navigateur.

### Paiement des dépôts clientes (PayTech / PayDunya)

Prévu, pas encore construit. Ces règles valent dès la première ligne de code.

**Le montant crédité vient du prestataire, jamais du navigateur.** Aujourd'hui
`portail_depot()` croit la cliente sur parole : elle déclare un montant, il
entre dans `mouvements_cc` et gonfle le solde de caisse. C'est le trou que le
paiement doit fermer — pas seulement compléter.

Le sens de circulation, à ne pas inverser :

1. le portail demande au **serveur** de créer une intention de paiement ;
2. la cliente paie chez le prestataire (Wave, Orange Money, carte) ;
3. le prestataire appelle **notre** webhook ;
4. le serveur vérifie, puis écrit le dépôt.

Le retour du navigateur après paiement n'est qu'un affichage. Il ne crédite rien.

**Ne pas se contenter de la vérification documentée par PayDunya.** Leur IPN se
valide par un SHA-512 de la clé maîtresse : un hash **statique**, qui prouve
seulement que l'appelant connaît la clé. Il ne signe ni le montant ni le statut.
Quiconque l'intercepte peut fabriquer une notification valide.

Donc, dans tous les cas : **rappeler le prestataire pour confirmer la facture**
avant de créditer, et comparer le montant et la référence à ce qui est en base.
PayTech propose un HMAC-SHA256 — le préférer, mais garder la confirmation
serveur-à-serveur.

**Idempotence obligatoire.** Une notification est rejouée. Dédupliquer sur la
référence de transaction du prestataire, stockée en colonne unique sur le
mouvement. Sans quoi un dépôt est crédité deux fois.

**Refuser une clé vide.** Un HMAC calculé sur une clé vide est valide : si le
secret n'est pas configuré, le webhook doit renvoyer une erreur, jamais accepter.

Le webhook sera une Edge Function appelable sans JWT (`verify_jwt: false`) —
c'est le seul point d'entrée du projet sans authentification Supabase. Sa
signature **est** son authentification.

---

## 6. Dépendances tierces

**Ce projet n'a ni `package.json`, ni `node_modules`, ni étape de
compilation, et aucune bibliothèque tierce. Zéro dépendance, au sens
littéral — le conserver est une règle.**

### L'unique exception : la carte de la vitrine

Depuis le 2026-11-02, **`boutique.html` charge un `iframe` Google Maps**.
C'est la seule page du projet qui contacte un autre domaine. La brèche a été
ouverte sciemment, après que l'alternative sans tiers — un plan d'accès en
image téléversée, comme le logo — a été proposée et écartée.

**Ce qui la rend acceptable ici, et nulle part ailleurs** : `boutique.html`
ne porte **aucun jeton**. Ni session Supabase, ni JWT, ni `localStorage`.
Le danger que cette règle vise — « un CDN compromis exécute son code dans la
page, avec accès au jeton de session » — n'a aucune prise sur elle. Le seul
secret qu'elle transporte est la clé publiable, déjà lisible dans le source.

**`index.html`, `operateur.html` et `client.html` portent des jetons. La
règle 6 y reste entière.** Ne jamais invoquer cette exception pour en ouvrir
une autre : c'est précisément le raisonnement qui a fait refuser Turnstile
(2026-10-22), dont le défi devait s'exécuter *dans la page de connexion*,
là où le jeton se crée.

Deux atténuations, qui ne sont pas décoratives :

- `loading="lazy"` — l'`iframe` ne part qu'une fois la carte atteinte. La
  plupart des visiteuses s'arrêtent aux horaires et ne déclenchent donc
  jamais d'appel à Google.
- `referrerpolicy="no-referrer"` — Google voit une visite, pas de quelle
  boutique elle vient.

Et **jamais d'adresse en texte dans la requête** : une adresse approximative
pose l'épingle au mauvais endroit, ce qui est pire que pas de carte. La
carte exige `lat` et `lng` (migration 031), posées ou absentes ensemble ;
sans elles, pas de carte, et le bouton « Itinéraire » reste le chemin.

Ajouter une bibliothèque est une décision, pas une commodité. Si c'est
inévitable :

- épingler une version **exacte**, jamais une plage (`@4` sert n'importe quelle
  4.x, décidée par le CDN) ;
- ajouter `integrity="sha384-…"` et `crossorigin` — sans quoi un CDN compromis
  exécute son code dans la page, avec accès au jeton de session ;
- préférer un fichier déposé dans `js/`, relu, au chargement distant.

---

## 6 bis. Sauvegardes et suppression de structure

### Ce qui était sauvegardé : le code, pas les données

Vérifié le 2026-11-02. `backup_kayor.ps1` compresse le **dossier du projet** et
l'envoie par mail. Le § 9 le soupçonnait d'échouer à cause du mot de passe
Gmail — c'est vrai, et c'est accessoire : **même en marchant parfaitement, il
n'aurait jamais sauvegardé une vente.** Les données vivent dans PostgreSQL ; ce
script ne s'y connecte pas.

Il garde pourtant son utilité : **le projet n'est pas sous git** (aucun `.git`),
donc cette archive est la seule copie du code hors du poste et de Vercel. Ne
pas le supprimer sans avoir mis le code dans un dépôt.

### Un `DROP TABLE` sur `public` est refusé, pas signalé

Migration 034. Une notification arrive **après** : quand elle s'affiche,
l'historique d'une bijouterie est déjà parti.

Et un `DROP TABLE` n'est jamais un geste du produit — `supprimer_boutique()`
efface des **lignes**. Un DROP ici est donc toujours une erreur de frappe, une
migration mal relue, ou une main qui n'aurait pas dû. Dans les trois cas on
refuse.

Le déblocage est volontaire et meurt avec la connexion :

```sql
begin;
  set local kayor.drop_autorise = 'oui';   -- `set local`, pas `set`
  drop table public.ma_table;
commit;
```

Deux choses à savoir, et ne pas les « corriger » :

- **Une tentative refusée n'est pas dans `journal_ddl`.** Le `raise exception`
  annule la transaction, donc l'insertion du journal avec elle. On ne peut pas,
  dans une seule transaction, journaliser en base *et* refuser. Elle part donc
  dans le journal PostgreSQL (*Supabase → Logs → Postgres*) par un `raise log`,
  qui survit au rollback. **La trace vaut moins que la table** : ne pas retirer
  le refus pour pouvoir tout journaliser.
- **Un `DROP TABLE` produit trois lignes** dans `journal_ddl` — la table, son
  type de ligne, son type tableau. La première est la vraie.

`journal_ddl` suit la règle du § 7 : `INSERT` et `SELECT`, jamais `UPDATE` ni
`DELETE`. Le schéma `restauration` est hors du garde-fou, exprès : ses tables
d'examen doivent pouvoir se supprimer librement.

### L'instantané quotidien vit dans la base qu'il protège

Migrations 035 et 036. `pg_cron` prend chaque nuit à 02h15 (UTC = heure de
Dakar) un instantané logique de toutes les tables métier dans
`public.sauvegardes`, et en garde quatorze.

**C'est la phrase à retenir, et elle n'est pas une formalité :**

- il couvre **l'erreur humaine** — un `DELETE` sans `WHERE`, une table
  supprimée, un solde mal recalé. C'est de loin ce qui arrive ;
- il ne couvre **pas la perte du projet**. Si la base disparaît, l'instantané
  disparaît avec elle.

Seule la sauvegarde de Supabase couvre le second cas, et elle est réservée au
**plan Pro** (§ 9). De plus, sur l'offre gratuite **un projet en veille
n'exécute aucun cron** : une semaine sans activité et il n'y a pas d'instantané
de la nuit. C'est pourquoi la console signale en rouge une sauvegarde de plus
de 48 h.

**Ne pas promettre dans les CGU ce que cela ne fait pas.** Le § 10 de
`cgu.html` ne garantit toujours aucune restauration, et il a raison tant qu'une
restauration n'a pas été rejouée sur un vrai incident.

Trois règles de conception à tenir :

- **La liste des tables est déduite du catalogue**, jamais écrite à la main :
  une liste figée aurait oublié la première table ajoutée ensuite, et personne
  ne l'aurait su avant d'en avoir besoin. `compteurs` est **inclus** — restaurer
  des ventes sans leur numérotation ferait rejouer des identifiants déjà pris.
- **`sauvegardes` est fermée à tout le monde**, comme `gestes`. Un instantané
  contient les données de **toutes** les boutiques dans un seul objet,
  `pin_hash` compris : une policy trop large ici annulerait d'un coup
  l'étanchéité des migrations 021 à 028.
- **La restauration n'écrase jamais.** `restaurer_table()` recrée les lignes
  dans le schéma `restauration`, à côté ; un humain compare puis réinjecte.
  Une restauration automatique en place serait le geste le plus destructeur du
  produit après `supprimer_boutique()` : elle remplacerait des données justes
  par celles d'hier, et personne ne s'en apercevrait avant la fin du mois.
  **Entre une restauration lente et une restauration qui se trompe, on prend la
  lente.**

`comparer_sauvegarde()` répond à la question qu'on se pose vraiment après un
incident — « qu'est-ce qui manque ? » — **sans rien écrire**, et ne rend que
des comptes, jamais des lignes. C'est ce qui se lit en premier.

### Télécharger : le compte opérateur devient la clé de tout

Demandé le 2026-11-04. Migrations 039 et 040. C'est la pesée que le § 9
exigeait, faite et assumée :

- Un instantané contient **toutes les boutiques dans un seul objet**,
  `clients.pin_hash` compris. Un jeton d'opérateur volé suffit désormais à
  l'emporter en une requête. Avant, il y fallait le tableau de bord Supabase :
  un autre mot de passe, un autre site. **L'élargissement est réel.**
- Ce qui le rend acceptable : il n'y a **qu'un** opérateur, c'est le fondateur,
  et il détient de toute façon les accès de la base. Le geste ne lui donne rien
  de nouveau ; il lui évite l'éditeur SQL. La surface qui s'ouvre est celle du
  **vol de son compte**.
- Donc deux contreparties, qui ne sont pas décoratives : chaque export est
  inscrit dans `journal_sauvegardes` — `INSERT` et `SELECT` seulement, comme
  `connexions` au § 7 — et **la MFA du § 9 cesse d'être une bonne pratique
  pour devenir la serrure de ce coffre.**
- Le fichier est en clair et vaut la base entière. Il ne vit pas dans un
  dossier de travail ordinaire.

**À noter, et non encore tranché** : un code PIN à quatre chiffres haché par
bcrypt se retrouve hors ligne en quelques minutes. Le fichier exporté expose
donc les codes des clientes, pas seulement leurs empreintes. Le remède est un
code plus long ou un hachage plus lent — une décision à part, à prendre avant
qu'un export ne circule.

**Pas de fenêtre de confirmation sur le téléchargement**, et c'est délibéré :
un avertissement qui s'affiche à chaque clic s'apprend à cliquer sans le lire
— la raison même qui interdit d'élargir `Verrou.confirmerRepetition()`. Le
texte est en permanence sous le bouton.

### Restaurer : le troisième geste, entre écraser et ne rien faire

La 035 avait raison sur le principe et s'arrêtait trop tôt sur l'usage :
`restaurer_table()` crée une table d'examen dans un schéma que l'application
ne peut pas lire. Entre « restaurer en écrasant » et « ne pas restaurer », il
existe le seul geste dont on ait besoin après un incident : **réinjecter ce
qui manque**.

`restaurer_lignes_manquantes()` (migration 039) **n'écrit que des lignes
absentes**. Ni `UPDATE` ni `DELETE` nulle part — un `where not exists` puis un
`on conflict do nothing`, deux remparts pour la même promesse. Le scénario que
la 035 refusait — remplacer des données justes par celles d'hier — reste donc
impossible.

Quatre verrous, chacun pour un accident précis :

1. opérateur du service, et personne d'autre ;
2. **essai à blanc par défaut** (`p_appliquer` = false) : on voit ce qui
   reviendrait avant que quoi que ce soit revienne ;
3. **le nom de la table se retape**, comme le code boutique de
   `supprimer_boutique()` — un clic dans une liste ne réinjecte rien ;
4. `p_org_id` facultatif : un incident touche presque toujours une boutique.

Et quatre choses à ne pas défaire :

- **La fonction rend les clés primaires réellement insérées** (`returning`,
  pas la liste des manquantes). C'est ce qui rend le geste défaisable : un
  `delete` sur ces clés exactes l'annule. L'écran les affiche, et le compte
  rendu s'écrit **après** la comparaison qui le suit — sinon elle l'effaçait.
- **Les séquences sont recalées** (`setval`, jamais à la baisse). Une table
  recréée après un `DROP` repart à 1 ; réinjecter les anciens identifiants
  laisserait la séquence derrière eux, et **le prochain mouvement d'épargne
  entrerait en collision** sur la clé primaire. Vérifié : séquence ramenée à
  1, réinjection, séquence revenue à 138.
- **Une clé étrangère qui proteste est un bon signe.** Réinjecter une vente
  dont la cliente a disparu lève une erreur et annule tout — d'où l'ordre :
  `organisations`, `clients`, puis ventes / comptes / reprises / arrhes, puis
  les mouvements. Ne pas « réparer » cela en désactivant les contraintes.
- **Un import n'écrit rien.** Le fichier redevient une ligne de
  `public.sauvegardes`, et tout ce qui existe s'y applique sans une ligne de
  plus. Un import qui écrirait aussitôt serait le geste le plus destructeur du
  produit après `supprimer_boutique()`.

**`faite_le` dit l'âge des données, jamais l'heure de l'import** (migration
040). Le défaut ne se voyait pas dans la fonction, il se voyait dans l'écran
qui la consomme : horodater l'import à `now()` plaçait un fichier vieux de
huit jours en tête de liste et **éteignait l'alerte « plus de 48 h »** — la
seule qui prévienne qu'un projet endormi n'a exécuté aucun cron. Corollaire
côté navigateur : la fraîcheur se juge sur les instantanés **pris ici**, et un
fichier importé n'y entre pas. Un fichier prouve qu'on a une copie, jamais que
le travail planifié a tourné.

Le schéma `restauration` reste fermé à `authenticated`, et doit le rester :
l'examen ligne à ligne se fait dans l'éditeur SQL de Supabase. Une restauration
n'est pas un geste de comptoir. Le premier message de `restaurer_table()`
disait « comparez avec public.ventes » à quelqu'un qui n'avait pas le droit de
lire la table — corrigé par la 036.

---

## 6 ter. Deux éditions : avec ou sans stock

Demandé le 2026-11-04, pour les boutiques d'essai : « le plus simple de
facturer sans gestion de stock derrière », tout le volet argent restant
entier.

### Ce que le modèle permettait déjà

Vérifié avant d'écrire : **`ventes` ne porte aucune colonne de stock.** Elle a
ses propres `description`, `type_bijou`, `carat`, `poids`, `local`, `importe`.
Le navigateur les recopiait depuis l'article choisi, mais rien en base
n'exigeait qu'un article existe.

Le lien au stock n'était donc qu'un **effet de bord** : `deduireStock()`,
appelé à quatre endroits. Il n'y avait pas de modèle à changer, seulement un
comportement à rendre facultatif.

### Une colonne, et surtout pas `plan = 'essai'`

`organisations.gestion_stock` (migration 038). Déduire le mode du plan serait
plus court, et c'est un piège :

- une boutique d'essai **qui paie** verrait la forme de son produit changer
  sous ses doigts, sans l'avoir demandé ;
- une boutique qui se trouve bien du mode simple n'aurait aucun moyen de le
  garder en payant ;
- et le § 5 confie au plan ce à quoi on **a droit**, jamais la forme de
  l'outil.

La console propose le mode simple par défaut quand le plan est « essai » : la
**suggestion** suit le plan, la **valeur** reste explicite.

### Qui peut le changer — la 027 répond toute seule

La colonne est **hors du `grant update` d'`authenticated`**. Une propriétaire
ne peut donc pas y toucher ; seul l'opérateur, par
`basculer_gestion_stock()`. Aucune policy à écrire — « une policy dit quelles
lignes, jamais quelles colonnes » (§ 1). Vérifié par contre-épreuve : la même
propriétaire écrit toujours son adresse, et se voit refuser `gestion_stock`.

**Ce drapeau n'est pas une autorisation.** Le forcer dans la console ferait
réapparaître des écrans qui écriraient dans le stock de **sa propre**
boutique : rien ne fuit. C'est la forme de l'outil. Ne pas lui faire porter
autre chose.

### Les trois points de bascule, et pourquoi ils sont là

- **`peutAcceder()`** : `stocks` et `sorties` renvoient `false`. Un seul point
  gouverne la navigation, et le bouton flottant recopiant le bouton de la
  section ouverte, il disparaît avec elle — sans une ligne de plus (§ 3).
- **`deduireStock()` et `restituerStock()`** portent la condition **en
  elles-mêmes**, pas chez leurs quatre appelants : recopiée, elle aurait fini
  par manquer au cinquième. `deduireStock()` rend **`true`** quand il n'y a
  rien à faire — `false` ferait avorter la vente qui vient d'être écrite.
- **`prepNouvelleVente()`** substitue au sélecteur d'article un bloc de saisie
  libre (type, carat, provenance). **Les deux blocs ne coexistent jamais** :
  sinon la vendeuse aurait deux façons de décrire la même marchandise, donc
  deux vérités.

`gereLeStock()` **défaut `true`** : une page dont la colonne n'a pas été lue
garde ses onglets. Une vendeuse ne doit pas croire que son stock s'est
volatilisé parce qu'un champ manquait.

En édition simple, la **description devient obligatoire** — elle remplace
l'article, et c'est elle qui s'imprime sur la facture remise à la cliente.

### La description ne se saisit pas pour toute une facture

Décidé le 2026-11-12, puis **dépassé le même jour** par le multi-articles
(§ 6 quater). Le champ « Description » de l'en-tête a d'abord été masqué en
édition complète, puis **retiré** : depuis la migration 041, c'est chaque
**ligne** qui porte sa description.

Le raisonnement reste, et c'est lui qui compte : en édition complète la
description **vient de l'article**, donc la saisir à côté serait une seconde
vérité sur la même marchandise — et c'est elle qui s'imprimerait.

**Elle est relue sur l'article à l'enregistrement**, pas pré-remplie à la
sélection. L'ancien `if (desc && !desc.value)` ne recopiait le nom que si le
champ était vide : **changer d'article après coup laissait l'ancien nom**,
pendant que carat, type et provenance suivaient le nouveau. La facture
nommait alors un bijou que la cliente n'avait pas acheté. Le défaut se voyait
tant que le champ était visible ; une fois masqué, plus personne ne l'aurait
vu — d'où la réécriture plutôt que le simple masquage.

Corollaire du même raisonnement : si un article **a disparu de l'inventaire**
pendant que la fenêtre était ouverte (`refreshAll()` recharge `STATE` en
continu), la vente est refusée. Elle partait auparavant avec description,
carat et type **vides**, et sans déduction de stock.

---

## 6 quater. Plusieurs articles sur une facture

Demandé le 2026-11-12. Migrations 041 et 042.

### Ce qui a décidé du modèle : où vit l'argent

Les 26 colonnes de `ventes` se séparent en deux familles — **l'argent**
(`montant`, `acompte`, `restant`, `paiement`, `compte_client_id`,
`paye_par_compte`, `annulee`, `num_facture`) et **la marchandise**
(`description`, `type_bijou`, `carat`, `poids`, `local`, `importe`).

Une facture a **un** total, **un** acompte, **un** restant. Elle a
**plusieurs** marchandises. La marchandise sort donc dans `vente_lignes` ;
l'argent reste sur `ventes`.

**La voie courte a été examinée et écartée : plusieurs lignes de `ventes`
partageant un numéro de facture.** Elle éclate l'argent. Un acompte de
200 000 F sur trois articles n'a aucune répartition naturelle,
`enregistrer_paiement_vente()` vise **une** vente,
`vente_sur_compte_epargne()` débite **une** vente, et le « restant dû » par
ligne — qui sert de preuve de créance dans `supprimer_boutique()` — devient
une fiction. C'est la voie la moins chère à écrire et la seule qui fausse les
comptes. **Ne pas y revenir.**

### Trois défauts fermés au passage

- **`ventes` ne portait aucune référence d'article.** On déduisait le stock
  et on ne savait plus, après coup, de quel article venait la vente.
  `vente_lignes.stock_ref` le trace.
- **Trois écritures que rien ne liait** : `prochain_id()`, puis
  `deduireStock()`, puis l'upsert de la vente. Une panne au milieu laissait
  du stock déduit sans vente ; avec trois articles, une facture à deux lignes
  sur trois. Tout passe par `enregistrer_vente()`, donc une transaction.
- **Un échec ne consomme plus de numéro** : `prochain_id()` est appelée dans
  la transaction, et un rollback lui rend sa valeur. Deux postes simultanés
  ne se marchent pas dessus pour autant — le `update compteurs` pose un
  verrou de ligne.

### Les règles à tenir

- **Le total est la somme des lignes, calculée par le serveur.** Celui
  qu'envoie le navigateur n'est pas lu. Le champ « Total » de l'écran est en
  lecture seule, et **formaté** (`505 000 F`) : c'est le chiffre qu'on
  annonce à la cliente. Du coup `calcRestant()` ne peut plus le relire —
  `recalcTotalVente()` calcule le restant sur le nombre, jamais sur le texte.
- **Une ligne peut être libre** (`stock_ref` à NULL) : gravure, frais de
  façon, bijou hors inventaire. Elle exige alors une description.
- **Pour une ligne d'inventaire, type, carat et provenance sont pris SUR
  L'ARTICLE**, jamais sur ce qu'envoie le navigateur. Même règle que
  `vente_sur_compte_epargne()`, qui prend le `client_id` sur le compte : une
  identité qui se propage ne se re-saisit pas.
- **La disponibilité du stock se vérifie AGRÉGÉE PAR ARTICLE.** Deux lignes
  de 6 g sur un article qui n'en a que 10 passent chacune un contrôle fait
  ligne par ligne. C'est le piège propre au multi-articles, et il est
  présent côté serveur comme à l'écran, où chaque ligne affiche « Reste …
  — autres lignes comprises ». L'écran recalcule **toutes** les lignes à
  chaque frappe : ne refresher que celle qu'on touche laissait la première
  afficher « Reste 6 g » pendant que la seconde en prenait 4.
- **La déduction du stock met la disponibilité dans le `where`** du
  `update`, pas dans un `if` au-dessus : la vérification et l'écriture sont
  alors le même geste, et rien ne peut se glisser entre les deux.

### `ventes` garde un résumé, et ce n'est pas une seconde vérité

Environ 75 lectures dans `js/` dépendent de `v.carat`, `v.poids`,
`v.description` — journal, tableau de bord, export, portail cliente. Les
basculer toutes d'un coup serait la meilleure façon de casser un écran sans
s'en apercevoir. Les colonnes de marchandise de `ventes` deviennent donc un
**résumé calculé depuis les lignes** : même statut que `restant = montant -
acompte`, déjà stocké. Jamais saisi, toujours écrit par
**`app.vente_resumer()`**, qui est le seul endroit où ce calcul existe.

**Le carat du résumé est celui de la ligne la plus lourde PARMI CELLES QUI EN
PORTENT UN** (migration 042). La règle « la plus lourde », seule, oubliait le
cas le plus banal de cette boutique : toutes les lignes n'ont pas de carat.
Mesuré sur les données réelles — `STK-0001` (« bracelet », ndiakhass) n'en a
pas, `STK-0002` (« bague ») est en 18k. Une facture de 5 g de bracelet et 3 g
de bague se résumait en `carat = NULL` et **sortait entièrement** du
graphique de répartition, alors qu'elle contient 3 g d'or 18 k.

**À faire le jour où la fenêtre « Modifier une vente » passera par une
fonction** : retirer ces colonnes du `grant update` d'`authenticated`, comme
la 027 l'a fait pour `plan` et `actif`. Les verrouiller aujourd'hui
casserait le seul écran de correction. En attendant, cette fenêtre
**refuse** une facture à plusieurs articles : y modifier le résumé le ferait
diverger de ses lignes, et la prochaine écriture serveur écraserait la
correction sans rien dire.

### Ce qui n'est PAS fait

- **La vente réglée sur l'épargne reste à un article.**
  `enregistrer_vente()` refuse `paiement = 'compte'`, et l'écran refuse
  l'épargne dès la deuxième ligne. Un refus clair vaut mieux qu'une facture
  dont deux articles sur trois auraient disparu.
- **Journal, tableau de bord, export CSV et portail cliente lisent encore le
  résumé**, pas les lignes. C'est voulu, et c'est exactement ce que le résumé
  sert à rendre possible.
- `restituerStock()` **n'a aucun appelant** — vérifié le 2026-11-12. Annuler
  une vente ne rend donc pas son or au stock, et ce n'était déjà pas le cas
  avant le multi-articles. À traiter à part.

---

## 7. Journal et détection

`connexions` n'a **que** des policies `INSERT` et `SELECT` : ni `UPDATE`, ni
`DELETE`. Personne ne peut effacer une trace, pas même le propriétaire. **Ne
jamais ajouter ces policies.** Même règle pour `portail_journal`, qui n'a
qu'un `SELECT`.

Y consigner tout geste sensible, pas seulement les connexions.

**Un échec se consigne autant qu'un succès.** `connexions` ne gardait que les
connexions réussies : une attaque en cours était donc invisible, il n'y avait
rien à détecter ni à alerter. `portail_journal` (migration 015) enregistre
chaque tentative sur le portail — succès, échec, blocage.

`connexions` ne pouvait pas servir à ça : son `organisation_id` est `NOT NULL`,
or une tentative sur un numéro inexistant n'appartient à aucune boutique — et
c'est précisément la trace d'un bourrage. D'où une table à part, dont
`organisation_id` est nullable ; ces lignes-là ne sont visibles que de
l'opérateur.

**Le numéro n'est jamais journalisé en clair** : une empreinte pour compter
les numéros distincts, et les quatre derniers chiffres pour qu'un humain
reconnaisse sa cliente. Garder en clair les numéros visés par un bourrage
reviendrait à constituer un fichier qu'on n'a aucune raison de détenir.

---

## 8. Secrets

- Rien de sensible dans le dépôt. `.vercelignore` exclut `config_backup.json`,
  `fix_tout.sql`, `migrations/`, `diagnostic.html`, `*.md`, `.claude/`.
- Ne jamais écrire une clé, un mot de passe ou un jeton dans une réponse, un
  commentaire ou un fichier de test.
- Les identifiants de test d'une application locale sont la seule exception, et
  ils vont dans les fichiers d'exemple, pas dans le code.

---

## 9. Avant la première boutique payante

- [x] ~~Activer la **protection des mots de passe compromis**~~ — fait le
      2026-10-21, **autrement**. Le réglage natif de Supabase est réservé au
      plan Pro ; `membres-admin` interroge donc lui-même Have I Been Pwned.
      Le linter continuera d'afficher l'alerte : c'est normal, il ne voit que
      le réglage natif. Voir « Mots de passe » ci-dessous.
- [ ] **Mise en ordre des comptes et des boutiques d'essai.** Tout est écrit,
      **rien n'est appliqué ni testé** (2026-10-22). Dans cet ordre :

      1. ~~Appliquer `migrations/019_supprimer_boutique.sql`~~ — fait le
         2026-10-31, et les **quatre verrous vérifiés** en se mettant à la
         place des rôles : une propriétaire est refusée, un code qui ne
         correspond pas est refusé, une boutique active est refusée, une
         boutique suspendue au code juste passe.
      5. ~~Compte de service détaché~~ — fait le 2026-10-31. `membres` = 0,
         `operateurs` = 1. **Ne pas le rerattacher.**

         Fait **avant** d'utiliser le bouton 🗑, et c'est l'ordre qui compte :
         tant que le compte opérateur était `proprietaire` de la boutique
         d'essai, `supprimer_boutique()` renvoyait son `user_id` parmi les
         comptes à effacer. Seuls les garde-fous de `membres-admin`
         l'épargnaient — or on ne peut pas **relire** une Edge Function
         déployée, seulement la déployer. Ne jamais miser la console de
         service sur un garde-fou qu'on ne peut pas vérifier : retirer
         l'appartenance d'abord.

      2. ~~Déployer `membres-admin`~~ — fait le 2026-10-31 (version 13,
         `verify_jwt: false`, vérifiée vivante : elle répond son propre
         « Non authentifié. » et non une erreur de la passerelle). Elle
         portait bien `creer_proprietaire`, `supprimer_comptes` et le
         garde-fou du plan service, qui **n'étaient pas déployés** malgré
         le souvenir d'un déploiement — la preuve est venue d'un échec réel,
         pas d'une vérification : impossible de **relire** une Edge Function,
         l'outil ne sait que la déployer.

         **Avant de redéployer celle-ci, toujours `verify_jwt: false`.**
         À `true`, le préflight CORS échoue et le comptoir lit
         « Failed to fetch ». Et relire le source avant : c'est le seul
         fichier qui détient la clé de service.
      3. Recharger la console opérateur (empreinte `2026-10-31a`).
      4. ~~`KAY` supprimée~~ le 2026-10-31 par le bouton 🗑 — 7 ventes
         effacées. **Ses deux comptes vendeurs subsistent** dans
         l'authentification (`amina@kay.kayor.app`,
         `djilybgueye+vendeuse@gmail.com`) : le second temps avait échoué,
         `membres-admin` n'étant pas encore déployée. Ils sont inertes —
         aucune ligne dans `membres`, donc `app.current_org()` ne leur rend
         rien et RLS ne leur montre rien — mais à retirer depuis
         *Authentication → Users*.

         Restent `MBD` et `BJS` à suspendre puis supprimer.
         **Garder `MBSS`** (Saint-Louis), qui porte les données réelles.
      6. `017_detacher_le_compte_de_service.sql` et
         `018_nettoyage_boutiques_de_test.sql` n'ont jamais été appliquées et
         sont devenues sans objet. À supprimer.
      6. Vider `compteurs` de la boutique gardée pour repartir à `V-0001`.
         **Supprimer les lignes, pas les mettre à zéro** : le trigger
         `compteurs_monotone` annule silencieusement tout UPDATE qui baisse
         une valeur. Vérifier avec une vente d'essai, puis la supprimer.
- [x] ~~**L'audit des fonctions `SECURITY DEFINER`**~~ — terminé le
      2026-10-27. Sept défauts de filtre, corrigés par les migrations 022,
      023 et 024, **toutes trois vérifiées présentes en base** sur le corps
      réel des fonctions. Soldes recalés : aucun n'était faux.
      Vérifiées correctes et à ne pas rouvrir « par symétrie » :
      `prochain_id`, `ouvrir_compte_epargne`, `enregistrer_paiement_vente`,
      `vider_compte_epargne`.
- [ ] **Rejouer les six gestes dans deux boutiques** (fin de
      `migrations/021_audit_filtre_organisation.sql`). Le jeu d'essai existe
      déjà : `CC-0001` est ouvert à Dakar (Djily) et à Saint-Louis (astou),
      `CL-010` et `V-0001`..`V-0006` existent dans les deux. Le code est
      corrigé, **il n'est pas testé**.
- [x] ~~**Éprouver les migrations 022 à 026 par l'usage**~~ — fait le
      2026-10-31, sur la vraie application après déploiement. Vérifiés en
      base, pas à l'écran : `client_id` renseigné à l'ouverture d'un compte ;
      la vente sur épargne hérite du `client_id` du compte sans que le
      navigateur l'envoie ; le **poids** est enfin écrit sur la vente
      (4ᵉ défaut de la 022, jamais vérifié avant) ; `definir_pin_client`
      répond, donc `crypt()` se résout ; le dépôt depuis le portail cliente
      fonctionne. Et le geste décisif : poser puis retirer un code sur la
      `CL-010` de Saint-Louis laisse la `CL-010` de **Dakar** intacte
      (`updated_at` inchangé depuis septembre) — avant la 024, il l'écrasait.

      **Leçon de méthode** : « j'ai fait le geste » ne vaut pas preuve.
      Le premier essai avait porté sur une autre fiche ; seul
      `updated_at` l'a révélé. Vérifier qu'une ligne a bougé avant de
      conclure qu'une autre n'a pas bougé.
- [ ] **Trancher `prochain_id` et `app.org_active()`.** Elle ne l'appelle
      pas : une boutique suspendue peut consommer des numéros, la vente qui
      suit étant refusée par la policy. Seul effet, un trou dans la
      numérotation — entorse au § 5, pas une fuite. Laissée hors de la 024
      parce qu'elle est la fonction la plus appelée de l'application.
- [x] ~~**Décider de l'identité d'une cliente**~~ — fait le 2026-10-27,
      migrations 025 et 026 appliquées et vérifiées. `client_id` posé sur
      les quatre tables, rempli à 100 % (29 lignes), clé étrangère composée,
      et les quatre fonctions serveur rapprochent par l'identifiant. Voir
      « Une cliente se désigne par son identifiant » au § 1.
- [ ] **Le test qui compte pour l'identité cliente** : créer deux clientes
      **homonymes** dans une boutique, une vente et un compte épargne pour
      chacune, puis ouvrir le portail de l'une. Elle ne doit voir que les
      siens. C'est le défaut que 025 et 026 ferment, et il ne se voit pas
      autrement.
- [x] ~~**Dresser la matrice `pg_policy`**~~ — fait le 2026-10-31. Les 46
      policies portent `current_org`, aucun croisement de données entre
      boutiques. Deux trous d'une autre nature trouvés et fermés par la
      migration 027, appliquée et vérifiée par cinq contre-épreuves sous
      l'identité des rôles : l'abonnement auto-attribué et le `DELETE` sur
      boutique suspendue. Voir § 1 et § 5.
- [ ] **Trancher `membres_write` et `app.org_active()`.** Seule policy
      d'écriture encore sans cette condition, laissée exprès hors de la 027 :
      la conditionner risque un verrouillage dont personne ne pourrait
      sortir. Écrire d'abord le scénario de sortie, décider ensuite.
- [ ] **Déployer la vitrine publique** — migration 028 appliquée, mais
      `boutique.html`, `js/boutique.js`, `js/qr.js`, l'écran « Vitrine
      publique » et le QR sur la facture ne sont pas encore en ligne.
      Ensuite : imprimer une facture, **scanner le code avec un téléphone**,
      et vérifier que la page ouvre bien la bonne boutique.
- [ ] **Compléter l'éditeur dans les CGU** (`cgu.html` et `CGU.md`) : raison
      sociale, NINEA ou RCCM, adresse, contact. Une CGU sans éditeur
      identifiable n'engage personne, donc ne protège personne. Et **faire
      relire le texte par un avocat sénégalais** avant de l'opposer à une
      boutique — loi n° 2008-12, déclaration CDP.

      ⚠ **`CGU.md` est interne et ne se publie pas.** Son § 12 liste les
      faiblesses du service (sauvegardes non vérifiées, pas de MFA, mot de
      passe de messagerie fuité) : utile comme registre, désastreux en
      public. `cgu.html` est la version publique, sans ce paragraphe — elle
      ne promet rien de faux sans dire pourquoi. Modifier les deux ensemble.
- [ ] Activer la **MFA** (TOTP) et l'exiger des rôles `proprietaire` et `admin`.
      **Et d'abord du compte opérateur** : depuis la migration 039, son jeton
      exporte la base entière en une requête. Ce point n'est plus une bonne
      pratique parmi d'autres, c'est la serrure du coffre — voir « Télécharger »
      au § 6 bis.
- [x] ~~Freiner le bourrage sur la connexion d'équipe~~ — fait le 2026-10-22
      par la limite native de Supabase Auth (30 → 10 / 5 min / IP). Un frein
      applicatif aurait été contournable et Turnstile aurait cassé la règle 6 :
      voir § 4.
- [x] ~~Retirer **EmailJS**~~ et ~~supprimer `public.utilisateurs_archive`~~ —
      faits le 2026-10-14. Le portail cliente ne fait plus **aucune** requête
      vers un domaine tiers.
- [x] ~~Réactiver **Confirm email**~~ — vérifié actif le 2026-10-14
      (`mailer_autoconfirm: false`). **Attention** : tant que le SMTP ne part
      pas, l'inscription par email est donc impossible — c'est WhatsApp ou rien.
- [ ] Changer le mot de passe Gmail qui a circulé en clair dans `config_backup.json`.
- [x] ~~Supprimer `fix_tout.sql` et le schéma `archive`~~ — fait le 2026-10-14.
- [ ] Passer le projet Supabase en **Pro** : l'offre gratuite met le projet en
      veille après une semaine d'inactivité, et une boutique fermée dix jours
      retrouverait son application morte.
- [x] ~~Vérifier le script de sauvegarde hebdomadaire~~ — vérifié le
      2026-11-02, et le constat est pire que le soupçon : **il ne sauvegarde
      pas la base.** Il compresse le dossier du projet. Le mot de passe Gmail
      est un problème secondaire. Voir § 6 bis.
- [ ] **Sauvegarder les données HORS de la base.** Les migrations 035/036
      posent un instantané quotidien, mais il vit dans la base qu'il protège :
      il ne survit pas à la perte du projet.

      **Un chemin existe depuis le 2026-11-04** (migrations 039/040) : la
      console télécharge un instantané complet, et sait le remettre. L'export
      HTTP du contenu complet a donc été ouvert — **la pesée que cette ligne
      exigeait est écrite au § 6 bis**, et sa conséquence est que la MFA du
      compte opérateur passe devant.

      Ce qui reste à faire tient en un mot : **c'est manuel.** Un fichier
      qu'on oublie de télécharger n'existe pas. Donc il faut encore trancher
      entre le **plan Pro** de Supabase (quotidienne, 7 jours, de leur côté)
      et un `pg_dump` planifié sur une machine toujours allumée — ce qui
      suppose un dépôt git et le mot de passe de la base dans un coffre.
      D'ici là, **prendre et ranger le fichier à date fixe**, et vérifier dans
      le journal des exports qu'on l'a bien fait.
- [ ] **Mettre le code dans un dépôt git.** Il n'y en a pas (`.git` absent).
      La seule copie hors du poste est l'archive de `backup_kayor.ps1` — si
      elle n'est pas partie, il n'y en a aucune.
- [ ] **Rejouer une restauration pour de vrai.** `restaurer_table()` a été
      éprouvée sur `ventes` le 2026-11-02 (17 lignes, sommes identiques), et
      `restaurer_lignes_manquantes()` le 2026-11-04 dans des transactions
      annulées — essai à blanc, refus sans le nom retapé, réinjection d'une
      ligne, rejeu sans effet, séquence recalée. **Jamais sur un incident
      réel.** Tant que ce n'est pas fait, le § 10 des CGU ne doit rien
      garantir.
- [ ] `README.md` décrit encore une application « sans serveur, dans le
      navigateur » — faux depuis le passage à Supabase.

---

## Documents de référence

- `OPERATIONS.md` — chaque geste sur les ventes, acomptes et comptes épargne,
  qui peut le faire et son effet sur la caisse. **À relire avant de toucher à
  un calcul de solde.**
- `ARCHITECTURE.md` — audit, modèle multi-boutiques, console opérateur, identité WhatsApp.
- `migrations/` — l'historique des décisions de sécurité, chacune commentée.
