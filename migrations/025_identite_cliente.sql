-- ===========================================================================
-- 025 — L'identité d'une cliente devient son identifiant, plus son nom
-- Écrite le 2026-10-27.
-- ===========================================================================
-- `ventes.client`, `comptes_clients.client`, `reprises.client` et
-- `bijoux_arrhes.client` portent un NOM. Deux clientes homonymes d'une même
-- boutique partagent donc épargne, commandes et reprises — et le portail
-- cliente les rapproche par ce nom (`cc.client = v_cli.nom`).
--
-- Ce n'est pas un filtre oublié comme ceux des migrations 022 à 024 : c'est
-- le modèle. Il est antérieur au multi-boutiques et aucune de ces trois
-- migrations n'y touchait.
--
-- Constaté le 2026-10-27, avant correction : quatre fiches « astou » à
-- Saint-Louis (`CL-010`, `CL-015`, `CL-017`, `CL-018`), quatre numéros de
-- téléphone différents, et chacune « voyait » les sept mêmes ventes et le
-- même compte épargne `CC-0001`. Aucune n'avait encore de code PIN : la
-- première à en recevoir un aurait ouvert au portail les commandes des
-- quatre.
--
-- Ces trois fiches en trop étaient des doublons de test, supprimées avant
-- cette migration. Le remplissage ci-dessous est donc exact sur la totalité
-- des lignes existantes.
--
-- ───────────────────────────── CE QUI CHANGE ───────────────────────────────
--
--   client_id   nouvelle colonne, clé étrangère composée vers
--               `clients (organisation_id, id)`. C'est elle qui fait foi.
--
--   client      CONSERVÉE. C'est le nom tel qu'il a été imprimé sur la
--               facture ce jour-là. Une cliente qui se marie change de nom ;
--               la facture d'hier, non. Ne pas la supprimer, ne pas la
--               resynchroniser depuis `clients`.
--
-- La colonne reste NULLABLE. Une ligne dont la cliente est inconnue ou
-- supprimée doit pouvoir exister — et le code la traite alors comme
-- n'appartenant à personne, jamais comme appartenant à tout le monde. Le
-- jour où toutes les écritures passeront par le sélecteur, un `not null`
-- pourra se poser ; pas avant, sinon les enregistrements tombent.
--
-- ────────────────────────── on delete restrict ─────────────────────────────
--
-- Supprimer une cliente qui a un historique est désormais refusé par la
-- base. C'est voulu : `deleteClient()` existe dans l'interface, et effacer
-- une fiche laissait jusqu'ici des ventes rattachées à un nom qui ne
-- désignait plus personne.
--
-- Vérifié compatible avec `supprimer_boutique()` (migration 019) : elle
-- efface `comptes_clients`, `bijoux_arrhes`, `reprises` et `ventes` AVANT
-- `clients`. L'ordre de ses `delete` devient porteur de sens — ne plus le
-- réarranger.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. La colonne, sur les quatre tables qui nomment une cliente
-- ---------------------------------------------------------------------------
alter table public.ventes          add column if not exists client_id text;
alter table public.comptes_clients add column if not exists client_id text;
alter table public.reprises        add column if not exists client_id text;
alter table public.bijoux_arrhes   add column if not exists client_id text;


-- ---------------------------------------------------------------------------
-- 2. Remplissage — uniquement là où le nom ne désigne qu'UNE cliente
-- ---------------------------------------------------------------------------
-- Le `1 = (select count(*) ...)` n'est pas une précaution de style : sans
-- lui, un nom porté par deux fiches ferait choisir arbitrairement. C'est le
-- `SELECT INTO` silencieux, au niveau des données. Une ligne ambiguë reste
-- à NULL : la base ne sait pas, elle ne devine pas.

update public.ventes v set client_id = c.id
  from public.clients c
 where c.organisation_id = v.organisation_id
   and lower(btrim(c.nom)) = lower(btrim(v.client))
   and v.client_id is null and btrim(coalesce(v.client,'')) <> ''
   and 1 = (select count(*) from public.clients c2
             where c2.organisation_id = v.organisation_id
               and lower(btrim(c2.nom)) = lower(btrim(v.client)));

update public.comptes_clients cc set client_id = c.id
  from public.clients c
 where c.organisation_id = cc.organisation_id
   and lower(btrim(c.nom)) = lower(btrim(cc.client))
   and cc.client_id is null and btrim(coalesce(cc.client,'')) <> ''
   and 1 = (select count(*) from public.clients c2
             where c2.organisation_id = cc.organisation_id
               and lower(btrim(c2.nom)) = lower(btrim(cc.client)));

update public.reprises r set client_id = c.id
  from public.clients c
 where c.organisation_id = r.organisation_id
   and lower(btrim(c.nom)) = lower(btrim(r.client))
   and r.client_id is null and btrim(coalesce(r.client,'')) <> ''
   and 1 = (select count(*) from public.clients c2
             where c2.organisation_id = r.organisation_id
               and lower(btrim(c2.nom)) = lower(btrim(r.client)));

update public.bijoux_arrhes ba set client_id = c.id
  from public.clients c
 where c.organisation_id = ba.organisation_id
   and lower(btrim(c.nom)) = lower(btrim(ba.client))
   and ba.client_id is null and btrim(coalesce(ba.client,'')) <> ''
   and 1 = (select count(*) from public.clients c2
             where c2.organisation_id = ba.organisation_id
               and lower(btrim(c2.nom)) = lower(btrim(ba.client)));


-- ---------------------------------------------------------------------------
-- 3. La clé étrangère — composée, parce que la clé primaire l'est
-- ---------------------------------------------------------------------------
-- `(organisation_id, client_id)` et non `client_id` seul : `CL-0001` existe
-- dans chaque boutique. Une clé étrangère sur la seule colonne `client_id`
-- laisserait une vente pointer la cliente d'une autre boutique. C'est la
-- même règle que partout ailleurs dans ce projet, ici imposée par la base.

alter table public.ventes          drop constraint if exists ventes_client_fk;
alter table public.ventes          add  constraint ventes_client_fk
  foreign key (organisation_id, client_id)
  references public.clients (organisation_id, id)
  on update cascade on delete restrict;

alter table public.comptes_clients drop constraint if exists comptes_clients_client_fk;
alter table public.comptes_clients add  constraint comptes_clients_client_fk
  foreign key (organisation_id, client_id)
  references public.clients (organisation_id, id)
  on update cascade on delete restrict;

alter table public.reprises        drop constraint if exists reprises_client_fk;
alter table public.reprises        add  constraint reprises_client_fk
  foreign key (organisation_id, client_id)
  references public.clients (organisation_id, id)
  on update cascade on delete restrict;

alter table public.bijoux_arrhes   drop constraint if exists bijoux_arrhes_client_fk;
alter table public.bijoux_arrhes   add  constraint bijoux_arrhes_client_fk
  foreign key (organisation_id, client_id)
  references public.clients (organisation_id, id)
  on update cascade on delete restrict;


-- ---------------------------------------------------------------------------
-- 4. Index — une clé étrangère sans index côté enfant rend chaque
--    suppression de cliente séquentielle sur toute la table.
-- ---------------------------------------------------------------------------
create index if not exists ventes_client_idx
  on public.ventes (organisation_id, client_id);
create index if not exists comptes_clients_client_idx
  on public.comptes_clients (organisation_id, client_id);
create index if not exists reprises_client_idx
  on public.reprises (organisation_id, client_id);
create index if not exists bijoux_arrhes_client_idx
  on public.bijoux_arrhes (organisation_id, client_id);


-- ===========================================================================
-- APRÈS APPLICATION
-- ===========================================================================
-- 1. Compter ce qui est resté sans cliente. Attendu : 0 partout, les
--    doublons « astou » ayant été nettoyés avant.
--
--      select 'ventes' t, count(*) from public.ventes
--        where client_id is null and btrim(coalesce(client,'')) <> ''
--      union all select 'comptes_clients', count(*) from public.comptes_clients
--        where client_id is null and btrim(coalesce(client,'')) <> ''
--      union all select 'reprises', count(*) from public.reprises
--        where client_id is null and btrim(coalesce(client,'')) <> ''
--      union all select 'bijoux_arrhes', count(*) from public.bijoux_arrhes
--        where client_id is null and btrim(coalesce(client,'')) <> '';
--
-- 2. Le portail lit encore par le NOM à ce stade. `portail_donnees()` et
--    `portail_depot()` passent à `client_id` dans la migration suivante —
--    cette migration-ci ne fait que poser la colonne et la remplir, pour
--    qu'elle soit vraie avant que quoi que ce soit s'y appuie.
--
-- 3. Côté navigateur, le champ caché de `initClientPicker()` porte encore
--    le nom. Tant qu'il n'est pas passé à l'identifiant, les écritures
--    nouvelles laissent `client_id` à NULL. Les deux vont ensemble.
-- ===========================================================================
