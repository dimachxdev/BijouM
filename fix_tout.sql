-- ============================================================
-- KAYOR — FIX COMPLET : RLS + colonnes manquantes
-- Exécuter EN ENTIER dans Supabase SQL Editor
-- ============================================================

-- ============================================
-- 1. AJOUTER LES COLONNES MANQUANTES
-- ============================================

-- ventes
alter table ventes add column if not exists importe          float   default 0;
alter table ventes add column if not exists local            float   default 0;
alter table ventes add column if not exists poids            float   default 0;
alter table ventes add column if not exists num_facture      text;
alter table ventes add column if not exists compte_client_id text;
alter table ventes add column if not exists note_complement  text;

-- stock
alter table stock add column if not exists prix            bigint  default 0;
alter table stock add column if not exists poids_total_g   float   default 0;
alter table stock add column if not exists provenance      text;
alter table stock add column if not exists type            text;
alter table stock add column if not exists qty             int     default 0;
alter table stock add column if not exists seuil           float   default 50;

-- sorties
alter table sorties add column if not exists valide_par    text;
alter table sorties add column if not exists nb_articles   int     default 0;
alter table sorties add column if not exists commentaire   text;
alter table sorties add column if not exists carat         text;
alter table sorties add column if not exists type_bijou    text;
alter table sorties add column if not exists poids         float   default 0;

-- decaissements
alter table decaissements add column if not exists description text;
alter table decaissements add column if not exists saisi_par   text;
alter table decaissements add column if not exists categorie   text;

-- comptes_clients
alter table comptes_clients add column if not exists date_ouverture text;
alter table comptes_clients add column if not exists actif          boolean default true;
alter table comptes_clients add column if not exists solde          bigint  default 0;

-- mouvements_cc
alter table mouvements_cc add column if not exists note text;

-- reprises
alter table reprises add column if not exists photo     text;
alter table reprises add column if not exists local     float default 0;
alter table reprises add column if not exists importe   float default 0;
alter table reprises add column if not exists provenance text;
alter table reprises add column if not exists poids     float default 0;
alter table reprises add column if not exists carat     text;
alter table reprises add column if not exists type_bijou text;
alter table reprises add column if not exists note      text;

-- bijoux_arrhes
alter table bijoux_arrhes add column if not exists arrhes_verse  bigint default 0;
alter table bijoux_arrhes add column if not exists restant_du    bigint default 0;
alter table bijoux_arrhes add column if not exists prix_total    bigint default 0;
alter table bijoux_arrhes add column if not exists date_echeance text;
alter table bijoux_arrhes add column if not exists statut        text   default 'en_cours';
alter table bijoux_arrhes add column if not exists article       text;
alter table bijoux_arrhes add column if not exists description   text;

-- connexions
alter table connexions add column if not exists user_id text;
alter table connexions add column if not exists heure   text;
alter table connexions add column if not exists action  text;
alter table connexions add column if not exists role    text;
alter table connexions add column if not exists nom     text;

-- utilisateurs
alter table utilisateurs add column if not exists actif   boolean default true;
alter table utilisateurs add column if not exists role    text    default 'vendeur';

-- ============================================
-- 2. DÉSACTIVER RLS SUR TOUTES LES TABLES
-- ============================================
alter table utilisateurs      disable row level security;
alter table clients           disable row level security;
alter table ventes            disable row level security;
alter table stock             disable row level security;
alter table sorties           disable row level security;
alter table decaissements     disable row level security;
alter table comptes_clients   disable row level security;
alter table mouvements_cc     disable row level security;
alter table reprises          disable row level security;
alter table bijoux_arrhes     disable row level security;
alter table mouvements_arrhes disable row level security;
alter table connexions        disable row level security;
alter table compteurs         disable row level security;

-- ============================================
-- 3. DONNER ACCÈS COMPLET AU RÔLE ANON
-- ============================================
grant all privileges on all tables    in schema public to anon;
grant all privileges on all sequences in schema public to anon;
grant all privileges on all functions in schema public to anon;

-- ============================================
-- 4. RECHARGER LE CACHE POSTGREST
-- ============================================
notify pgrst, 'reload schema';

-- ============================================
-- 5. VÉRIFICATION FINALE
-- ============================================
select 
  t.tablename,
  t.rowsecurity,
  count(c.column_name) as nb_colonnes
from pg_tables t
left join information_schema.columns c 
  on c.table_name = t.tablename and c.table_schema = 'public'
where t.schemaname = 'public'
group by t.tablename, t.rowsecurity
order by t.tablename;

-- ============================================================
-- ACTIVER REALTIME sur toutes les tables
-- (obligatoire pour la synchronisation temps réel)
-- ============================================================
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime for table
    utilisateurs, clients, ventes, stock, sorties,
    decaissements, comptes_clients, mouvements_cc,
    reprises, bijoux_arrhes, mouvements_arrhes,
    connexions, compteurs;
commit;

-- ============================================================
-- GRANT DELETE explicite sur toutes les tables
-- ============================================================
grant delete on utilisateurs      to anon;
grant delete on clients           to anon;
grant delete on ventes            to anon;
grant delete on stock             to anon;
grant delete on sorties           to anon;
grant delete on decaissements     to anon;
grant delete on comptes_clients   to anon;
grant delete on mouvements_cc     to anon;
grant delete on reprises          to anon;
grant delete on bijoux_arrhes     to anon;
grant delete on mouvements_arrhes to anon;
grant delete on connexions        to anon;
grant delete on compteurs         to anon;

-- Vérifier
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and privilege_type = 'DELETE'
order by table_name;
