-- ============================================================================
-- 035 — Une sauvegarde logique par jour, et de quoi s'en servir
-- ============================================================================
-- Demande le 2026-11-02 : « des backups base de donnee journaliers ».
--
-- CE QUI EXISTAIT, ET QUI N'ETAIT PAS CE QU'ON CROYAIT
--
-- `backup_kayor.ps1` compresse le DOSSIER DU PROJET et l'envoie par mail.
-- C'est une sauvegarde du CODE. Elle ne contient pas une vente, pas une
-- cliente, pas un franc d'epargne — la base n'y figure a aucun titre.
--
-- Le § 9 soupconnait ce script d'echouer en silence a cause du mot de passe
-- Gmail. C'est vrai, et c'est secondaire : meme en marchant parfaitement, il
-- n'aurait jamais sauvegarde une seule donnee metier. Verifie le 2026-11-02.
--
-- CE QUE CETTE MIGRATION EST — ET CE QU'ELLE N'EST PAS
--
-- Elle prend chaque nuit un instantane logique de toutes les tables metier et
-- le range dans `public.sauvegardes`.
--
-- ELLE VIT DANS LA BASE QU'ELLE PROTEGE. C'est la phrase a retenir.
--
--   — Elle couvre l'erreur humaine : un DELETE sans WHERE, une table
--     supprimee, une fonction qui a mal recale un solde. C'est de loin ce qui
--     arrive le plus souvent, et c'est exactement ce qui vient d'arriver avec
--     S-0003/S-0004.
--   — Elle ne couvre PAS la perte du projet : suppression du projet Supabase,
--     incident chez l'hebergeur, compte perdu. Si la base disparait,
--     l'instantane disparait avec elle.
--
-- La seule sauvegarde qui couvre le second cas est celle de Supabase, reservee
-- au plan Pro (quotidienne, 7 jours de retention, restauration par leurs
-- soins). Tant que le projet est sur l'offre gratuite, ce fichier est un
-- filet, pas un coffre. Et sur l'offre gratuite le projet se met en veille
-- apres une semaine sans activite : un projet endormi n'execute aucun cron,
-- donc les nuits de veille ne produisent aucune sauvegarde. Le § 9 le disait
-- deja pour l'application ; c'est vrai pour ceci aussi.
--
-- NE PAS PROMETTRE DANS LES CGU ce que ce fichier ne fait pas. Le § 10 de
-- `cgu.html` ne garantit toujours aucune restauration, et il a raison tant
-- qu'une restauration n'a pas ete rejouee pour de vrai.
--
-- POURQUOI UNE RESTAURATION QUI N'ECRASE RIEN
--
-- `restaurer_table()` ne touche jamais la table vivante : elle recree les
-- lignes dans le schema `restauration`, a cote. Un humain compare, puis
-- decide ligne par ligne.
--
-- Une restauration automatique en place serait le geste le plus destructeur du
-- produit apres `supprimer_boutique()` : elle remplacerait des donnees justes
-- par des donnees d'hier, et personne ne s'en apercevrait avant la fin du
-- mois. Entre une restauration lente et une restauration qui se trompe, on
-- prend la lente.
--
-- Le schema `restauration` est aussi la raison pour laquelle le garde-fou de
-- la 034 ne protege que `public` : les tables d'examen doivent pouvoir se
-- supprimer librement une fois le tri fait.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Ou vivent les instantanes
-- --------------------------------------------------------------------------
create table if not exists public.sauvegardes (
  id         bigserial   primary key,
  faite_le   timestamptz not null default now(),
  declencheur text       not null default 'cron',   -- cron | operateur
  tables     text[]      not null,
  nb_lignes  integer     not null,
  octets     bigint      not null,
  contenu    jsonb       not null
);

comment on table public.sauvegardes is
  'Instantane logique quotidien des tables metier. Vit DANS la base qu''il '
  'protege : couvre l''erreur humaine, pas la perte du projet. Voir 035.';

-- Comme `gestes` et `portail_sessions` : personne n'y accede directement.
-- Et ici ce n'est pas un detail de style — un instantane contient les donnees
-- de TOUTES les boutiques dans un seul objet, `clients.pin_hash` compris.
-- Une seule policy trop large ici annulerait d'un coup l'etancheite que les
-- migrations 021 a 028 ont etablie.
alter table public.sauvegardes enable row level security;
revoke all on table public.sauvegardes from public, anon, authenticated;
revoke all on sequence public.sauvegardes_id_seq from public, anon, authenticated;

create schema if not exists restauration;
revoke all on schema restauration from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. Prendre l'instantane
-- --------------------------------------------------------------------------
-- La liste des tables est DEDUITE du catalogue, pas ecrite a la main : une
-- liste figee aurait oublie la premiere table ajoutee apres cette migration,
-- et personne ne l'aurait su avant d'en avoir besoin. C'est le meme piege que
-- « une table, trois fonctions d'ecriture ».
--
-- Ce qui est exclu, et pourquoi :
--   sauvegardes            — sinon chaque nuit contient toutes les nuits
--   gestes                 — cles d'idempotence, sans valeur le lendemain
--   portail_sessions       — jetons de session, ephemeres
--   portail_tentatives*    — compteurs anti-bourrage, ephemeres
--
-- `compteurs` est INCLUS, et c'est important : restaurer des ventes sans leur
-- numerotation ferait rejouer des identifiants deja pris, et l'upsert
-- ecraserait les lignes existantes (§ 2).
create or replace function app.sauvegarder_base(p_declencheur text default 'cron')
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t          record;
  v_contenu  jsonb := '{}'::jsonb;
  v_tables   text[] := '{}';
  v_lignes   integer := 0;
  v_bloc     jsonb;
  v_octets   bigint;
  v_id       bigint;
begin
  for t in
    select c.relname as nom
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not in ('sauvegardes', 'gestes', 'portail_sessions',
                             'portail_tentatives', 'portail_tentatives_ip')
     order by c.relname
  loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x',
      t.nom)
      into v_bloc;

    v_contenu := v_contenu || jsonb_build_object(t.nom, v_bloc);
    v_tables  := v_tables || t.nom;
    v_lignes  := v_lignes + jsonb_array_length(v_bloc);
  end loop;

  v_octets := octet_length(v_contenu::text);

  -- Un garde-fou de taille : mieux vaut une sauvegarde qui refuse bruyamment
  -- qu'une base qui se remplit en silence jusqu'a la saturation du disque.
  -- 64 Mo : loin devant les quelques centaines de kilo-octets d'aujourd'hui,
  -- et bien en deca de ce qui generait le projet. Le jour ou ce plafond est
  -- atteint, la bonne reponse n'est pas de le lever : c'est de passer a une
  -- vraie sauvegarde hors base.
  if v_octets > 64 * 1024 * 1024 then
    raise exception
      'Sauvegarde abandonnee : % octets depassent le plafond de 64 Mo. '
      'La base a grossi au-dela de ce qu''un instantane interne peut porter — '
      'il faut une sauvegarde hors base (plan Pro, ou pg_dump planifie).',
      v_octets;
  end if;

  insert into public.sauvegardes (declencheur, tables, nb_lignes, octets, contenu)
  values (coalesce(p_declencheur, 'cron'), v_tables, v_lignes, v_octets, v_contenu)
  returning id into v_id;

  -- On garde quatorze nuits. Au-dela, une erreur non reperee en deux semaines
  -- ne se repere plus par comparaison : elle fait partie du paysage.
  delete from public.sauvegardes
   where id in (select id from public.sauvegardes
                 order by id desc offset 14);

  return json_build_object('ok', true, 'id', v_id, 'tables', array_length(v_tables,1),
                           'lignes', v_lignes, 'octets', v_octets);
end $$;

revoke all on function app.sauvegarder_base(text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. La porte de l'operateur
-- --------------------------------------------------------------------------
-- Aucune de ces trois fonctions ne rend le CONTENU d'un instantane : elles
-- n'en rendent que les mesures. Le contenu ne sort que table par table, et
-- dans le schema `restauration`.

-- Sauvegarder a la main — par exemple avant une operation delicate, ce que la
-- 034 conseille justement de verifier avant de debloquer un DROP.
create or replace function public.sauvegarder_maintenant()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Reserve au service.');
  end if;
  return app.sauvegarder_base('operateur');
end $$;

revoke all on function public.sauvegarder_maintenant() from public, anon;
grant execute on function public.sauvegarder_maintenant() to authenticated;

-- Ce qui existe, et depuis quand. La question a poser en premier le jour ou
-- quelque chose a disparu : « de quand date la derniere sauvegarde ? »
create or replace function public.sauvegardes_recentes()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_res json;
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Reserve au service.');
  end if;

  select coalesce(json_agg(s order by s.id desc), '[]'::json) into v_res
    from (select id, faite_le, declencheur, nb_lignes, octets,
                 array_length(tables,1) as nb_tables
            from public.sauvegardes order by id desc) s;

  return json_build_object('ok', true, 'sauvegardes', v_res);
end $$;

revoke all on function public.sauvegardes_recentes() from public, anon;
grant execute on function public.sauvegardes_recentes() to authenticated;

-- --------------------------------------------------------------------------
-- 4. Restaurer — A COTE, jamais par-dessus
-- --------------------------------------------------------------------------
-- Rend le nom de la table d'examen creee. Rien de la table vivante n'est
-- touche, lu ou verrouille.
create or replace function public.restaurer_table(p_sauvegarde bigint, p_table text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bloc   jsonb;
  v_cible  text;
  v_n      integer;
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Reserve au service.');
  end if;

  -- `p_table` vient du navigateur et part dans un `format(%I)`. On le
  -- confronte d'abord au catalogue : un nom qui ne designe pas une vraie
  -- table de `public` n'ira pas plus loin. %I echapperait de toute facon,
  -- mais on ne fait pas reposer une injection evitee sur un seul rempart.
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relkind='r' and c.relname = p_table) then
    return json_build_object('ok', false, 'erreur',
      'Table inconnue dans public : ' || coalesce(p_table,'(vide)'));
  end if;

  select contenu -> p_table into v_bloc
    from public.sauvegardes where id = p_sauvegarde;

  if v_bloc is null then
    return json_build_object('ok', false, 'erreur',
      'Cette sauvegarde ne contient pas la table ' || p_table || '.');
  end if;

  v_cible := p_table || '__' || p_sauvegarde;

  execute format('drop table if exists restauration.%I', v_cible);
  execute format(
    'create table restauration.%I as select * from jsonb_populate_recordset(null::public.%I, $1)',
    v_cible, p_table) using v_bloc;

  execute format('select count(*) from restauration.%I', v_cible) into v_n;

  return json_build_object('ok', true,
    'table', 'restauration.' || v_cible,
    'lignes', v_n,
    'avis', 'Rien n''a ete ecrase. Comparez avec public.' || p_table
         || ', puis reinjectez a la main ce qui doit l''etre.');
end $$;

revoke all on function public.restaurer_table(bigint, text) from public, anon;
grant execute on function public.restaurer_table(bigint, text) to authenticated;

commit;

-- ============================================================================
-- LE CRON — hors transaction, car `create extension` peut l'exiger
-- ============================================================================
-- A executer apres le bloc ci-dessus :
--
--   create extension if not exists pg_cron;
--
--   select cron.schedule('kayor-sauvegarde-quotidienne', '15 2 * * *',
--                        $$ select app.sauvegarder_base('cron'); $$);
--
-- 02h15 UTC = 02h15 a Dakar (le Senegal est a UTC+0 toute l'annee, sans heure
-- d'ete) : la boutique est fermee, personne ne saisit.
--
-- A VERIFIER APRES APPLICATION — le « succes » ne prouve que la syntaxe
-- ----------------------------------------------------------------------------
-- 1. Le travail est inscrit et actif :
--      select jobid, jobname, schedule, active, command from cron.job;
--
-- 2. UNE SAUVEGARDE PREND VRAIMENT :
--      select app.sauvegarder_base('essai');
--      select id, faite_le, nb_lignes, octets, array_length(tables,1)
--        from public.sauvegardes order by id desc limit 1;
--    Comparer `nb_lignes` au total reel des tables : une sauvegarde qui dit
--    « ok » avec zero ligne est une sauvegarde vide, et elle passerait pour
--    bonne jusqu'au jour ou on en aurait besoin.
--
-- 3. LE SEUL ESSAI QUI COMPTE — une restauration rejouee pour de vrai :
--      select public.restaurer_table(<id>, 'ventes');
--      select count(*) from restauration.ventes__<id>;
--    Le compte doit egaler celui de `public.ventes` au moment de la
--    sauvegarde. Tant que ce geste n'a pas ete fait une fois, on a des
--    fichiers de sauvegarde, pas une sauvegarde.
--
-- 4. Le lendemain : verifier qu'une ligne est apparue sans intervention.
--      select id, faite_le, declencheur from public.sauvegardes order by id desc;
--    Si rien n'apparait, le projet dormait (offre gratuite) ou le cron a
--    echoue : select * from cron.job_run_details order by start_time desc;
-- ============================================================================
