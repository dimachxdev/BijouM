-- ===========================================================================
-- 021 — Audit multi-boutiques des fonctions SECURITY DEFINER
-- Écrite le 2026-10-23. À LIRE ET JOUER AVANT TOUTE CORRECTION.
-- ===========================================================================
-- CE QUI A DÉCLENCHÉ L'AUDIT
--
-- Toute vente réglée sur l'épargne échoue depuis le 2026-10-22 :
--   « more than one row returned by a subquery used as an expression »
--
-- Cause : les clés primaires sont composées `(organisation_id, id)`, donc
-- `CC-0001` existe dans CHAQUE boutique. Une seconde boutique a été créée,
-- et `vente_sur_compte_epargne()` cherchait un compte par son seul `id`.
--
-- POURQUOI RLS N'A RIEN VU
--
-- Ces fonctions sont `SECURITY DEFINER` : elles s'exécutent avec les droits
-- de leur propriétaire, donc **les policies ne s'y appliquent pas**. Le
-- filtre `organisation_id` doit être écrit à la main, dans chaque requête du
-- corps. `vider_compte_epargne()` (migration 013) le fait partout : modèle.
--
-- TOUT A ÉTÉ TESTÉ SUR UNE SEULE BOUTIQUE
--
-- C'est la racine. Avec un seul tenant, aucun identifiant ne se recoupe et
-- l'absence de filtre ne se voit jamais. Le défaut était présent depuis le
-- premier jour du multi-boutiques ; il attendait le deuxième locataire.
--
-- ⚠ UNE ERREUR EST LE BON SCÉNARIO. Une sous-requête scalaire proteste quand
-- elle ramène deux lignes. Mais `SELECT ... INTO` en PL/pgSQL prend la
-- PREMIÈRE ligne EN SILENCE. Les fonctions qui ne crient pas sont donc plus
-- dangereuses que celle qui a crié.
-- ===========================================================================


-- ===========================================================================
-- A. CE QUI EST DÉJÀ CONFIRMÉ, par lecture des fichiers — sans la base
-- ===========================================================================
--
-- A1. FUITE ACTIVE — `portail_donnees()`, historique des mouvements
--     migrations/003_portail_client.sql, ~ligne 180
--
--       from public.mouvements_cc m
--       where m.compte_id = cc.id          -- aucun filtre de boutique
--
--     `compte_id` vaut `CC-0001`, qui existe dans les deux boutiques. Le
--     relevé affiché à une cliente dans le portail **fusionne donc les
--     dépôts des deux boutiques**. Aucune collision de nom n'est nécessaire :
--     il suffit que deux boutiques aient chacune un CC-0001. C'est le cas
--     depuis le 2026-10-22.
--
-- A2. IDENTITÉ LUE SANS FILTRE — `portail_donnees()` et `portail_depot()`
--     003_portail_client.sql, lignes ~168 et ~236
--
--       select nom into v_nom from public.clients where id = v_sess.client_id;
--
--     `clients.id` vaut `CL-0001`, présent dans les deux boutiques, et
--     `SELECT INTO` prend la première ligne sans rien dire. `v_nom` sert
--     ensuite de clé d'identité :
--
--       where cc.organisation_id = v_sess.organisation_id and cc.client = v_nom
--
--     Conséquences : la cliente ne voit rien (nom inexistant chez elle), ou
--     voit l'épargne et les commandes d'une HOMONYME de sa propre boutique.
--     Dans `portail_depot`, le même `v_nom` conditionne le compte crédité :
--     un dépôt peut être refusé, ou atterrir sur le compte d'une homonyme.
--
-- A3. L'IDENTITÉ DE LA CLIENTE EST SON NOM, pas son identifiant.
--     Deux clientes homonymes dans une même boutique partagent épargne et
--     commandes. Défaut de conception antérieur au multi-boutiques, révélé
--     par A2. À trancher : passer `cc.client` et `v.client` à un
--     rattachement par `client_id`.
--
-- A4. `portail_login()` cherche par téléphone, sans boutique, avec `limit 1`
--     (003, puis réécrite en 015). C'est inévitable — le portail n'a aucun
--     contexte de boutique avant la connexion. Mais si une même cliente est
--     inscrite dans deux boutiques avec le même numéro ET le même code, elle
--     entre dans l'une des deux, arbitrairement. À décider : refuser la
--     connexion ambiguë, ou lui faire choisir sa boutique.


-- ===========================================================================
-- B. LES SUSPECTS RESTANTS — à exécuter, la base joignable
-- ===========================================================================
select p.proname                                   as fonction,
       (p.prosrc ~* 'organisation_id|current_org') as mentionne_le_filtre,
       pg_get_function_identity_arguments(p.oid)   as signature
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosecdef
   and p.prosrc ~* '\m(ventes|clients|stock|comptes_clients|mouvements_cc|reprises|bijoux_arrhes|mouvements_arrhes|decaissements|sorties|compteurs)\M'
 order by mentionne_le_filtre, p.proname;

-- `false` : à corriger, sans discussion.
-- `true` : NE CONCLUT RIEN. `portail_donnees` mentionne le filtre et l'oublie
-- à deux endroits. Il faut relire chaque corps, requête par requête.

-- À relire en priorité, car toutes reçoivent un identifiant métier du
-- navigateur ou du portail :
--
--   vente_sur_compte_epargne   ← casse déjà, et porte aussi le poids manquant (020)
--   portail_donnees            ← A1 + A2 confirmés
--   portail_depot              ← A2 confirmé
--   enregistrer_paiement_vente
--   depot_compte_epargne
--   ouvrir_compte_epargne
--   definir_pin_client
--   prochain_id                ← compteurs, clé (organisation_id, cle)
--   vider_compte_epargne       ← VÉRIFIÉ CORRECT (013), sert de modèle


-- ===========================================================================
-- C. SORTIR UN CORPS AVANT DE LE CORRIGER
-- ===========================================================================
--   select pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = '<nom>';
--
-- Ne jamais réécrire de mémoire ni depuis un vieux fichier : `003` a été
-- amendée depuis par `portail_ajustements` et `portail_search_path_extensions`.
-- Reposer le corps À L'IDENTIQUE, en ajoutant seulement :
--
--   declare v_org uuid := app.current_org();   -- ou v_sess.organisation_id
--   ...
--   where id = p_x and organisation_id = v_org
--
-- sur CHAQUE lecture et CHAQUE écriture, y compris les sous-requêtes
-- imbriquées — c'est précisément une sous-requête imbriquée qui fuit en A1.


-- ===========================================================================
-- D. LE TEST QUI MANQUAIT — deux boutiques aux identifiants qui se recoupent
-- ===========================================================================
-- Aucun de ces défauts n'est détectable avec une seule boutique. Le jeu
-- d'essai doit donc en comporter deux, portant les MÊMES identifiants.
--
-- Vérifier d'abord que le recouvrement existe :
--
--   select id, organisation_id, client, solde from comptes_clients order by id;
--   select id, organisation_id, nom            from clients        order by id;
--   select cle, organisation_id, valeur        from compteurs      order by cle;
--
-- Puis, dans CHAQUE boutique, et en vérifiant à chaque fois que l'autre
-- boutique n'a pas bougé :
--
--   1. vente réglée sur l'épargne         → son propre CC-0001
--   2. dépôt depuis le portail cliente    → son propre compte
--   3. relevé du portail                  → ses seuls mouvements
--   4. versement sur une commande         → sa seule vente
--   5. pose d'un code PIN                 → sa seule cliente
--   6. numérotation                       → V-0001 chez les deux, sans collision
--
-- Tant que ces six gestes n'ont pas été faits dans les deux boutiques, le
-- multi-boutiques n'est pas testé — il est seulement supposé.
-- ===========================================================================
