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

### Aucune identité de boutique en dur

Jamais « KAYOR », « Dakar », ni un logo écrit dans le code. Tout document
imprimé lit `boutiqueInfos()`, `boutiqueLigneContact()`, `_logoFacture()`,
`_slugFichier()`. En SaaS, chaque boutique imprime la sienne.

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
- **Le portail cliente compte les échecs** : 5 tentatives de PIN ratées
  bloquent 15 minutes (`portail_tentatives`). Toute nouvelle voie
  d'authentification doit avoir son propre frein.
- **L'équipe s'identifie par WhatsApp**, donc sans mot de passe à voler ni à
  réinitialiser. Ne pas réintroduire un mot de passe « pour simplifier ».

---

## 5. Abonnement et accès payant

Le plan et la date d'expiration vivent dans `organisations` et **ne sont jamais
lus depuis le navigateur pour accorder un droit**. `app.org_active()` conditionne
toutes les écritures : une boutique expirée ou suspendue passe en lecture seule
côté base, pas côté interface.

- Seul l'opérateur du service change un plan ou une échéance
  (`creer_boutique()`, `basculer_boutique()`, toutes deux derrière
  `app.est_operateur()`).
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
jamais ajouter ces policies.**

Y consigner tout geste sensible, pas seulement les connexions.

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

- [ ] Activer la **protection des mots de passe compromis** (Supabase vérifie
      HaveIBeenPwned) — désactivée aujourd'hui, c'est une case à cocher.
- [ ] Activer la **MFA** (TOTP) et l'exiger des rôles `proprietaire` et `admin`.
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
