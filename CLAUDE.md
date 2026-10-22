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

**Ce projet n'a ni `package.json`, ni `node_modules`, ni étape de compilation,
et plus aucun script tiers depuis le 2026-10-14. Zéro dépendance, au sens
littéral : aucune page ne charge quoi que ce soit en dehors de son propre
domaine. C'est un atout de sécurité rare — le conserver est une règle.**

Ajouter une bibliothèque est une décision, pas une commodité. Si c'est
inévitable :

- épingler une version **exacte**, jamais une plage (`@4` sert n'importe quelle
  4.x, décidée par le CDN) ;
- ajouter `integrity="sha384-…"` et `crossorigin` — sans quoi un CDN compromis
  exécute son code dans la page, avec accès au jeton de session ;
- préférer un fichier déposé dans `js/`, relu, au chargement distant.

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
- [ ] **Nettoyer les boutiques d'essai, puis détacher le compte de service.**
      Écrit le 2026-10-22, rien d'appliqué. Dans cet ordre :
      `migrations/018_nettoyage_boutiques_de_test.sql` (inventaire d'abord,
      suppression ensuite), **puis**
      `migrations/017_detacher_le_compte_de_service.sql`. L'inverse échoue :
      017 refuse de laisser une boutique sans propriétaire, or le compte de
      service est la seule propriétaire de l'ancienne.
      ⚠ 018 supprime définitivement et il n'y a **aucune sauvegarde** : il ne
      vaut que tant que tout est de l'essai. Après la première boutique
      payante, ne plus jamais le rejouer tel quel.
- [ ] Activer la **MFA** (TOTP) et l'exiger des rôles `proprietaire` et `admin`.
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
- [ ] Vérifier le script de sauvegarde hebdomadaire (son mot de passe
      d'application n'est pas au format Google, il échoue probablement en silence).
- [ ] `README.md` décrit encore une application « sans serveur, dans le
      navigateur » — faux depuis le passage à Supabase.

---

## Documents de référence

- `OPERATIONS.md` — chaque geste sur les ventes, acomptes et comptes épargne,
  qui peut le faire et son effet sur la caisse. **À relire avant de toucher à
  un calcul de solde.**
- `ARCHITECTURE.md` — audit, modèle multi-boutiques, console opérateur, identité WhatsApp.
- `migrations/` — l'historique des décisions de sécurité, chacune commentée.
