# KAYOR — Étude de passage en SaaS

Audit de l'existant et feuille de route pour transformer l'application
mono-boutique en service multi-boutiques.

---

## 1. Ce qui existe aujourd'hui

| Élément | État |
|---|---|
| Front | SPA sans framework — `index.html` (74 Ko) + `client.html` |
| Logique | `js/app.js` **332 Ko, ~2 500 lignes, un seul fichier** |
| Données | `js/supabase.js` — appels REST bruts vers PostgREST |
| Base | Supabase PostgreSQL + Realtime WebSocket |
| Cache | `localStorage` utilisé comme source de vérité parallèle |
| Auth | Comparaison de mot de passe **en clair, dans le navigateur** |
| Tenancy | **Aucune** — une seule boutique câblée en dur |

---

## 2. Failles critiques

### F1 — La base est entièrement ouverte au public 🔴

`fix_tout.sql` désactive RLS sur les 13 tables et accorde `grant all` au rôle
`anon`. La clé publiable étant dans le JavaScript livré au navigateur, elle est
publique par nature. Conséquence directe, sans aucun compte :

```bash
curl "https://yflvtquowzvghwxyvuah.supabase.co/rest/v1/utilisateurs?select=*" \
     -H "apikey: sb_publishable_..."
```

→ tous les utilisateurs et leurs mots de passe. Le même appel en `DELETE` vide
n'importe quelle table. Supabase classe lui-même ce point en **critique**.

En SaaS, ce défaut signifie que la boutique A lit et efface les données de B.

### F2 — Mots de passe en clair 🔴

`js/data.js` : `admin/admin123`, `stock/stock123`, `vendeur/vendeur123`.
Stockés en clair dans la table `utilisateurs` et dans `localStorage`, comparés
par `app.js:215`. Ouvrir la console et taper `STATE.users` les affiche tous.

### F3 — Les permissions ne protègent rien 🔴

Les 25 gardes `isAdmin()` lisent un objet JavaScript local :

```js
STATE.currentUser.role = 'admin';   // dans la console → admin complet
```

Aucune vérification serveur. Ces contrôles sont de simples éléments d'interface.

### F4 — Le code PIN client est lisible et forçable 🔴

`clients.pin` en clair, comparé dans `client.js:145` après téléchargement de la
fiche. 4 chiffres = 10 000 combinaisons, testables via l'API sans limite.

### F5 — Injection HTML (XSS) 🟠

39 écritures `innerHTML` interpolent des données non échappées. Un client
nommé `<img src=x onerror="...">` exécute du code dans la session de
l'administrateur qui ouvre la liste.

### F6 — Secret versionné 🟠

`config_backup.json` contient un mot de passe d'application Gmail en clair.

### F7 — Identifiants séquentiels 🟠

`V-001`, `C-004`… générés par un compteur global. Deux boutiques produiraient
les mêmes identifiants → collision de clé primaire.

---

## 3. Limites structurelles

- **`app.js` de 332 Ko** — rendu, logique métier et accès données mélangés dans
  un fichier unique. Ingérable à plusieurs développeurs.
- **Double source de vérité** — `localStorage` et Supabase se synchronisent à la
  main ; toute divergence se règle en écrasant l'un par l'autre.
- **Aucun test, aucun build, aucun typage.**
- **Realtime sans RLS** — le canal WebSocket diffuse aujourd'hui toutes les
  modifications à tous les abonnés.

---

## 4. Cible

```
                    ┌──────────────────────────────┐
   Navigateur       │  JWT signé (Supabase Auth)   │
   (clé publique)   │  claims : sub                │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │  PostgREST + RLS             │
                    │  app.current_org()  ← membres│
                    │  app.has_role(...)           │
                    └──────────────┬───────────────┘
                                   │
   ┌───────────────────────────────▼──────────────────────────────┐
   │  organisations (tenants)                                      │
   │    └─ membres (auth.users × organisation × rôle)              │
   │         └─ clients, ventes, stock, … + organisation_id        │
   └───────────────────────────────────────────────────────────────┘
```

Principe : **le navigateur ne décide plus rien.** Il présente un JWT ;
PostgreSQL détermine l'organisation, applique le rôle et filtre chaque ligne.
Un utilisateur qui modifie son rôle dans la console voit ses requêtes rejetées.

### Modèle de rôles

| Rôle | Portée |
|---|---|
| `proprietaire` | Tout + réglages boutique + facturation |
| `admin` | Tout l'opérationnel + membres + sorties + décaissements |
| `gestionnaire` | Journal, stock, clients, comptes, arrhes |
| `vendeur` | Journal, clients, comptes, arrhes (lecture stock) |

Les tables `sorties` et `decaissements` sont réservées à `admin`/`proprietaire`
**par policy SQL**, pas par bouton masqué.

### Suspension d'abonnement

`app.org_active()` conditionne toutes les écritures. Une boutique expirée passe
en lecture seule automatiquement — aucune donnée n'est supprimée.

### Journal d'audit inviolable

`connexions` n'a ni policy `UPDATE` ni policy `DELETE` : personne ne peut
effacer une trace, pas même le propriétaire.

---

## 5. Migrations livrées

| Fichier | Rôle |
|---|---|
| `migrations/001_saas_foundation.sql` | `organisations`, `membres`, `organisation_id` partout, fonctions d'autorisation, horodatage |
| `migrations/004_migration_comptes.sql` | Bascule vers Supabase Auth, suppression de la colonne `password` |
| `migrations/005_invitations.sql` | Invitations : un compte ne rejoint une boutique que sur invitation d'un admin |
| `migrations/002_rls_policies.sql` | RLS sur 14 tables, révocation d'`anon`, Realtime filtré |
| `migrations/003_portail_client.sql` | PIN en bcrypt, RPC de connexion, blocage après 5 échecs |

### Ordre d'exécution

L'ordre des numéros n'est **pas** l'ordre d'exécution :

```
001  →  004  →  005  →  créer le 1er compte  →  tester  →  002  →  003
```

`002` coupe l'accès anonyme. L'exécuter avant que l'application sache présenter
un JWT déconnecterait tout le monde.

`005` doit précéder toute ouverture à des utilisateurs réels : sans elle, le
trigger de 004 fait confiance aux métadonnées envoyées par le navigateur, et
n'importe qui pourrait s'inscrire comme `proprietaire` d'une boutique existante.

---

## 6. Feuille de route

### Phase 1 — Colmater (fait)

- [x] `js/security.js` : `esc()`, `escJs()`, `html\`\``, `safeInt()`
- [x] Chargé dans `index.html` et `client.html`
- [x] `js/auth.js` : session JWT, refresh automatique, profil/rôle
- [x] `.gitignore` + `config_backup.example.json`
- [x] Les 4 migrations SQL

### Phase 2 — Basculer l'authentification (fait)

- [x] `doLogin()` → `Auth.connexion(email, mdp)` ; connexion par **email**
- [x] `H` devient une fonction : porte le JWT de session, retombe sur la clé
      publiable tant que `002` n'est pas appliquée (l'app continue de marcher)
- [x] Realtime transporte le JWT (`access_token` au `phx_join` + au renouvellement)
- [x] Reprise de session au chargement (`Auth.restaurer()`) — plus de ressaisie au F5
- [x] Rôle `proprietaire` ajouté à `ROLES` et `PERM_MAP`
- [x] Gestion des comptes réécrite sur `membres` + `invitations` : plus aucun
      mot de passe saisi ni transmis par l'application
- [x] `INITIAL_USERS` (admin123…) et `STATE.users` supprimés
- [x] Section `gestion_comptes` en doublon supprimée (deux `id="users-body"`
      coexistaient, `getElementById` n'en voyait qu'un)
- [x] Premier compte propriétaire créé et connecté (`last_sign_in_at` renseigné)
- [x] Page d'inscription sur invitation (`panel-signup`) — referme le trou des
      invitations : une personne invitée peut enfin créer son compte
- [x] Mot de passe oublié (`panel-forgot`) + choix du nouveau mot de passe au
      retour du lien (`panel-reset`), jeton lu dans le fragment d'URL puis
      effacé de la barre d'adresse
- [ ] Configurer le SMTP Supabase (sans quoi aucun de ces deux liens ne part)
- [ ] **Puis** exécuter `002` et `003`

Testé en local : erreur de connexion générique (ne révèle pas si l'email
existe), validation des champs vides, reprise de session sans crash,
`chargerDonnees()` toujours fonctionnel via le repli anonyme.

### Phase 3 — Nettoyer les injections

- [ ] Passer les 39 `innerHTML` par `html\`\`` ou `esc()`
- [ ] Commencer par les vues affichant des données clients :
      `renderClients`, `renderJournal`, `renderBijouxArr`

### Phase 4 — Découper `app.js`

```
js/
├─ core/      config, state, bus d'événements
├─ data/      un module par table (ventes, stock, clients…)
├─ ui/        rendu, composants, modales
└─ modules/   journal, stocks, arrhes, comptes…
```

Modules ES natifs (`<script type="module">`), sans outillage : la taille
descend, le périmètre de chaque fichier devient lisible. Un build (Vite) ne
s'impose qu'au moment d'introduire TypeScript.

### Décision — authentification des clientes du portail

Objectif retenu : passer à l'OTP par SMS, mais **pas à chaque connexion**.

| Action | Authentification | Coût |
|---|---|---|
| Consulter solde épargne, suivi des arrhes | Code PIN (`003`, bcrypt + blocage 5 échecs) | nul |
| Déposer de l'argent sur un compte | OTP par SMS | 1 SMS |

Un OTP systématique coûterait un SMS par consultation de solde, pour une
cliente qui veut juste regarder un chiffre. En le réservant aux mouvements
d'argent, la faiblesse intrinsèque d'un PIN à 4 chiffres cesse d'être un
problème : il ne protège plus que de la lecture.

**Attention au choix du fournisseur SMS** : Supabase Auth ne pilote nativement
que Twilio, Twilio Verify, MessageBird, Vonage et TextLocal. **Brevo n'en fait
pas partie** — l'utiliser pour le SMS impose d'écrire le flux OTP soi-même
(génération, stockage haché, envoi via l'API, vérification) dans une Edge
Function. Arbitrage : Twilio = zéro code mais deux prestataires ; Brevo = un
seul prestataire mais une fonction à écrire.

Décision email indépendante et non structurante : Brevo ou Resend, au choix.

### Phase 5 — Mécanique SaaS

- [ ] Page d'inscription boutique (crée `organisations` + `membres` propriétaire)
- [ ] Préfixer les identifiants par le slug : `V-KAY-001` (corrige F7)
- [ ] Compteurs par organisation (déjà en base)
- [ ] Facturation, quotas par plan
- [ ] Supprimer `localStorage` comme source de vérité — cache en lecture seule

---

## 6 bis. Mise en service — état réel

### Déjà appliqué en base (vérifié)

`001`, `004`, `005` et `006` sont **appliquées** sur le projet Supabase :

| Contrôle | Résultat |
|---|---|
| Organisation « Bijouterie KAYOR » (slug `KAY`) | créée |
| Tables portant `organisation_id` | 14 |
| `utilisateurs.password` (mots de passe en clair) | **supprimée** |
| `utilisateurs` → `utilisateurs_archive` | renommée, données conservées |
| Trigger `on_auth_user_created` | actif |
| Fonctions du schéma `app` | 7 |
| Ventes / clients conservés | 14 / 4 |
| Requêtes REST `membres`, `invitations`, `organisations` | 200 |

`006` a corrigé un défaut de conception : `chargerMembres()` embarquait
`user_id(email)` depuis `auth.users`, or PostgREST n'expose que le schéma
`public` — la requête renvoyait 400. L'email est désormais recopié sur
`membres`, verrouillé en écriture par un trigger pour qu'un membre ne puisse
pas usurper l'affichage d'un autre.

### ⚠ L'écriture est bloquée jusqu'à la création du premier compte

`organisation_id` a pour valeur par défaut `app.current_org()`, que seul le rôle
`authenticated` peut exécuter. Conséquence mesurée :

- **lecture** en anonyme : fonctionne encore (14 ventes chargées) ;
- **écriture** en anonyme : `42501 permission denied for function current_org`.

C'est le comportement voulu à l'arrivée, mais cela rend la création du premier
compte **bloquante** et non optionnelle.

### Étape restante — à faire par vous

Je ne crée pas de compte ni de mot de passe : vous devez être seul à le connaître.

1. Supabase > **Authentication > Users > Add user**
   Email réel, mot de passe d'au moins 12 caractères, « Auto Confirm User » coché.
2. SQL Editor — rattacher ce compte comme propriétaire :
   ```sql
   select app.rattacher_membre('VOTRE@EMAIL.COM', 'KAY', 'Votre Nom', 'proprietaire');
   ```
   Doit renvoyer `OK : ... -> KAY (proprietaire)`.
3. Se connecter dans l'application avec cet email. Les membres suivants
   s'ajoutent depuis *Membres de la boutique > Inviter un membre* — sans SQL.

### Panne SMTP constatée le 2026-09-16

Les logs d'authentification donnaient :

```
535 "5.7.8 Username and Password not accepted — BadCredentials — gsmtp"
error_code: unexpected_failure   status: 500   path: /recover
```

Gmail refuse les identifiants SMTP. C'est la réponse type lorsqu'on fournit le
mot de passe habituel du compte : Gmail exige un **mot de passe d'application**
de 16 caractères, créé sur un compte ayant la validation en deux étapes activée.

**Effet en cascade** : quand l'email de confirmation ne part pas, `/signup`
échoue en 500 et Supabase **annule l'inscription** — aucun compte n'est créé.
C'est ce qui a fait échouer les connexions avec `marjanbijouterie@gmail.com` :
ce compte n'a jamais existé.

Deux corrections apportées côté application : une panne serveur (5xx) et un
dépassement de quota (429) s'affichent maintenant tels quels. Seul le cas
« adresse inconnue » reste muet, puisque c'est lui qui permettrait de découvrir
qui possède un compte.

**Recommandation** : ne pas utiliser Gmail pour les emails transactionnels —
quota d'environ 500 envois/jour, mauvaise délivrabilité pour ce type de message,
et c'est le compte qui sert déjà aux sauvegardes. Brevo ou Resend offrent
~300 envois/jour gratuits avec une configuration SMTP dédiée.

### Le script de sauvegarde souffre probablement du même défaut

`config_backup.json` contient `"appPassword": "Djimahcx23#@!!1"`. Ce n'est pas
le format d'un mot de passe d'application Google — ceux-ci font 16 lettres
minuscules sans aucun symbole. C'est donc un mot de passe de compte, que Gmail
rejette en SMTP avec la même erreur 535.

**À vérifier** : la sauvegarde hebdomadaire échoue vraisemblablement en silence
depuis sa mise en place. Ce mot de passe ayant circulé en clair dans le dossier
du projet, il doit être changé quoi qu'il arrive.

### Envoi des emails — à configurer

L'application sait maintenant inscrire un membre invité et réinitialiser un mot
de passe, mais **ces deux flux passent par email**. Le SMTP intégré de Supabase
est limité à quelques envois par heure et n'est pas prévu pour la production.

À faire dans le tableau de bord Supabase :

1. **Project Settings > Authentication > SMTP Settings** — brancher un
   fournisseur (Brevo et Resend ont une offre gratuite d'environ 300 mails/jour).
   Sans cela, les liens de confirmation et de réinitialisation ne partent pas.
2. **Authentication > URL Configuration > Redirect URLs** — y ajouter **les deux**
   URL, l'application étant déployée sur Vercel :
   - `https://bijou-m-dimachxdevs-projects.vercel.app/**` (production)
   - `http://localhost:5173/**` (tests locaux)

   Le lien de réinitialisation renvoie vers `location.origin + location.pathname` ;
   une URL absente de cette liste blanche est refusée et le lien ne ramène pas
   sur l'écran de choix du mot de passe.
3. **Authentication > Policies** — longueur minimale du mot de passe à 12,
   pour que le serveur applique la même règle que l'interface.

### Comportement à connaître : l'inscription ne dit jamais « ce compte existe »

Quand l'adresse possède déjà un compte, Supabase répond `200` avec un
utilisateur **factice** (`identities: []`, identifiant inventé) au lieu de
signaler le doublon — c'est délibéré, cela empêche de découvrir qui est inscrit.
Vérifié : aucun compte n'est créé, aucun doublon, l'état en base est inchangé.

Le message affiché est donc volontairement neutre (« si cette adresse peut
ouvrir un compte, un lien vient d'être envoyé »). Le remplacer par « ce compte
existe déjà » rouvrirait la fuite que Supabase ferme.

### Ensuite

4. **Vérifier** journal, stocks, dashboard, et une écriture (créer une vente).
5. **Appliquer `002`** — l'accès anonyme est coupé, RLS prend le relais.
6. **Appliquer `003`** et migrer le portail vers les RPC — `client.js` compare
   encore le PIN côté navigateur et cessera de fonctionner à ce moment-là.

En cas de blocage après l'étape 5 :
```sql
grant all privileges on all tables in schema public to anon;
```

## 7. À faire dès maintenant

1. **Changer le mot de passe Gmail** présent dans `config_backup.json` : il a
   circulé en clair dans le dossier du projet.
2. **Considérer les données actuelles comme exposées.** La base est ouverte
   depuis la mise en ligne de `fix_tout.sql` ; 4 ventes et 8 connexions
   seulement, donc l'impact réel est faible — mais changer les mots de passe.
3. **Ne pas déployer en production** avant la fin de la phase 2.
4. **Supprimer `fix_tout.sql`** une fois `002` appliqué, pour que personne ne le
   rejoue par réflexe : il rouvrirait tout.
