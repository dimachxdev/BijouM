-- ============================================================================
-- 036 — « Qu'est-ce qui a disparu ? », avant de restaurer quoi que ce soit
-- ============================================================================
-- Corrige deux defauts de la 035, trouves en l'eprouvant le jour meme.
--
-- 1. UN AVIS QUI MENTAIT
--
-- `restaurer_table()` repondait « Comparez avec public.ventes ». Or le schema
-- `restauration` est ferme a `authenticated` — volontairement : une table
-- restauree contient les donnees de TOUTES les boutiques, et l'ouvrir a
-- `authenticated` l'ouvrirait a chaque vendeuse.
--
-- L'operateur creait donc une table qu'il ne pouvait pas lire, en suivant un
-- conseil impossible a suivre. L'examen ligne a ligne se fait dans l'editeur
-- SQL de Supabase, qui se connecte en `postgres` — et c'est tres bien ainsi :
-- une restauration n'est pas un geste de comptoir.
--
-- Ne pas « reparer » cela en ouvrant le schema. C'est le message qui etait
-- faux, pas la fermeture.
--
-- 2. LA QUESTION QU'ON SE POSE D'ABORD N'AVAIT PAS DE REPONSE
--
-- Apres un incident, personne ne demande « restaure ventes ». On demande
-- « qu'est-ce qui manque ? ». La 035 obligeait a restaurer table par table
-- pour le decouvrir — donc a ecrire avant de savoir.
--
-- `comparer_sauvegarde()` repond sans rien ecrire : pour chaque table, ce que
-- la sauvegarde contient, ce que la base contient, et l'ecart. C'est ce qui
-- se lit en premier, et depuis la console.
--
-- Elle ne rend que des COMPTES, jamais des lignes : aucune donnee metier n'en
-- sort, donc aucune question d'etancheite entre boutiques.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. L'etat des lieux, sans rien ecrire
-- --------------------------------------------------------------------------
create or replace function public.comparer_sauvegarde(p_sauvegarde bigint default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      bigint;
  v_faite   timestamptz;
  v_tables  text[];
  t         text;
  v_sauv    integer;
  v_vivant  integer;
  v_res     jsonb := '[]'::jsonb;
  v_manque  integer := 0;
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Reserve au service.');
  end if;

  -- Sans argument : la derniere. C'est la question la plus frequente, elle ne
  -- doit pas exiger de connaitre un numero.
  select id, faite_le, tables into v_id, v_faite, v_tables
    from public.sauvegardes
   where p_sauvegarde is null or id = p_sauvegarde
   order by id desc limit 1;

  if v_id is null then
    return json_build_object('ok', false, 'erreur',
      'Aucune sauvegarde' || case when p_sauvegarde is null then '.'
                                  else ' portant le numero ' || p_sauvegarde || '.' end);
  end if;

  foreach t in array v_tables loop
    select jsonb_array_length(contenu -> t) into v_sauv
      from public.sauvegardes where id = v_id;

    -- La table peut avoir disparu depuis : c'est precisement le cas qu'on
    -- cherche, et il ne doit pas faire echouer la comparaison.
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relkind='r' and c.relname=t) then
      execute format('select count(*) from public.%I', t) into v_vivant;
    else
      v_vivant := null;                      -- null = la table n'existe plus
    end if;

    if v_vivant is null or v_vivant < v_sauv then
      v_manque := v_manque + 1;
    end if;

    v_res := v_res || jsonb_build_object(
      'table',          t,
      'dans_sauvegarde', v_sauv,
      'dans_la_base',    v_vivant,
      'ecart',           case when v_vivant is null then null
                              else v_vivant - v_sauv end,
      'etat',            case when v_vivant is null then 'TABLE DISPARUE'
                              when v_vivant < v_sauv then 'des lignes manquent'
                              when v_vivant > v_sauv then 'lignes ajoutees depuis'
                              else 'identique' end);
  end loop;

  return json_build_object(
    'ok', true,
    'sauvegarde', v_id,
    'faite_le', v_faite,
    'tables_a_examiner', v_manque,
    'avis', case when v_manque = 0
                 then 'Rien ne manque par rapport a cette sauvegarde.'
                 else v_manque || ' table(s) ont moins de lignes qu''a la '
                   || 'sauvegarde, ou ont disparu. Examinez-les avant de '
                   || 'restaurer : des lignes peuvent avoir ete supprimees '
                   || 'volontairement.' end,
    'tables', v_res);
end $$;

revoke all on function public.comparer_sauvegarde(bigint) from public, anon;
grant execute on function public.comparer_sauvegarde(bigint) to authenticated;

-- --------------------------------------------------------------------------
-- 2. Le meme avis, mais vrai
-- --------------------------------------------------------------------------
-- Seul le texte rendu change, et le nombre de lignes vivantes est ajoute :
-- l'operateur voit l'ecart sans avoir a aller lire ailleurs.
create or replace function public.restaurer_table(p_sauvegarde bigint, p_table text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bloc    jsonb;
  v_cible   text;
  v_n       integer;
  v_vivant  integer;
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Reserve au service.');
  end if;

  -- `p_table` vient du navigateur et part dans un `format(%I)`. On le
  -- confronte d'abord au catalogue : %I echapperait de toute facon, mais on ne
  -- fait pas reposer une injection evitee sur un seul rempart.
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
  execute format('select count(*) from public.%I', p_table) into v_vivant;

  return json_build_object('ok', true,
    'table', 'restauration.' || v_cible,
    'lignes_restaurees', v_n,
    'lignes_dans_la_base', v_vivant,
    'avis', 'Rien n''a ete ecrase. La table d''examen n''est lisible que '
         || 'depuis l''editeur SQL de Supabase (le schema `restauration` est '
         || 'ferme a l''application, et doit le rester) : '
         || 'select * from restauration.' || v_cible || ';');
end $$;

revoke all on function public.restaurer_table(bigint, text) from public, anon;
grant execute on function public.restaurer_table(bigint, text) to authenticated;

commit;

-- ============================================================================
-- A VERIFIER APRES APPLICATION
-- ============================================================================
-- 1. La comparaison repond, et dit « identique » partout sur une base saine :
--      select public.comparer_sauvegarde();
--
-- 2. ELLE VOIT UNE DISPARITION — l'essai qui compte, dans une transaction
--    annulee :
--
--      begin;
--        delete from public.sorties where id = 'S-0004';
--        select public.comparer_sauvegarde();   -- `sorties` doit passer a
--                                               -- « des lignes manquent »
--      rollback;
--
--    Si elle dit encore « identique », elle ne sert a rien : elle compare
--    alors la sauvegarde avec elle-meme.
-- ============================================================================
