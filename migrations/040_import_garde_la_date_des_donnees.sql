-- ============================================================================
-- 040 — Un fichier importe garde la date de ses donnees, pas celle de l'import
-- ============================================================================
-- Defaut trouve le 2026-11-04 en ecrivant l'affichage de la 039, avant tout
-- usage reel. Il ne se voit pas en lisant la fonction : il se voit en lisant
-- l'ecran qui la consomme.
--
-- `sauvegarde_importer()` laissait `faite_le` prendre son defaut, `now()`. Un
-- fichier vieux de huit jours entrait donc dans la liste horodate a la minute,
-- et devenait la ligne la plus recente.
--
-- CE QUE CELA CASSAIT, ET CE N'EST PAS UN DETAIL D'AFFICHAGE
--
-- La console signale en rouge une sauvegarde de plus de 48 h — c'est la seule
-- alerte qui previenne qu'un projet endormi n'a execute aucun cron (§ 6 bis).
-- Importer une archive de la semaine derniere eteignait donc cette alerte,
-- exactement au moment ou elle sert : apres un incident. Le remede faisait
-- disparaitre le symptome qui avertissait de la panne.
--
-- Deux corrections, et elles vont par paire :
--
--   1. ICI : `faite_le` reprend la date portee par l'enveloppe telechargee.
--      `faite_le` veut dire « age des donnees », et doit vouloir dire cela
--      partout — c'est ce que lit la personne devant la liste.
--   2. DANS LA CONSOLE : la fraicheur se juge sur les instantanes PRIS ICI,
--      jamais sur un fichier importe. Un fichier prouve qu'on a une copie,
--      jamais que le travail planifie a tourne cette nuit.
--
-- Une date illisible ou future vient d'un fichier malforme : on retombe alors
-- sur l'heure de l'import, plutot que de mentir dans l'autre sens.
--
-- Rien d'autre ne change dans la fonction.
-- ============================================================================

begin;

create or replace function public.sauvegarde_importer(
  p_contenu jsonb,
  p_origine text default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_bloc      jsonb;
  v_cle       text;
  v_tables    text[] := '{}';
  v_inconnues text[] := '{}';
  v_lignes    integer := 0;
  v_octets    bigint;
  v_id        bigint;
  v_faite     timestamptz;
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Reserve au service.');
  end if;

  if p_contenu is null or jsonb_typeof(p_contenu) <> 'object' then
    return json_build_object('ok', false, 'erreur',
      'Fichier illisible : un objet JSON est attendu.');
  end if;

  -- Le fichier telecharge est une enveloppe (metadonnees + `contenu`). On
  -- accepte l'enveloppe entiere comme le contenu nu : l'operateur depose le
  -- fichier tel qu'il l'a recu, sans avoir a l'ouvrir.
  if p_contenu ? 'contenu' and jsonb_typeof(p_contenu -> 'contenu') = 'object' then
    v_bloc := p_contenu -> 'contenu';
  else
    v_bloc := p_contenu;
  end if;

  -- LA CORRECTION DE CETTE MIGRATION. `faite_le` dit l'age des DONNEES, jamais
  -- l'heure de l'import : sans quoi remettre un fichier ancien eteint l'alerte
  -- « plus de 48 h » au moment ou elle sert.
  if p_contenu ? 'faite_le' then
    begin
      v_faite := (p_contenu ->> 'faite_le')::timestamptz;
      if v_faite > now() then v_faite := null; end if;
    exception when others then
      v_faite := null;
    end;
  end if;

  for v_cle in select k from jsonb_object_keys(v_bloc) k loop
    if jsonb_typeof(v_bloc -> v_cle) <> 'array' then
      return json_build_object('ok', false, 'erreur',
        'Fichier malforme : « ' || v_cle || ' » ne porte pas un tableau de lignes.');
    end if;

    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r' and c.relname = v_cle) then
      v_tables := v_tables || v_cle;
      v_lignes := v_lignes + jsonb_array_length(v_bloc -> v_cle);
    else
      -- Une table du fichier qui n'existe plus : c'est souvent EXACTEMENT ce
      -- qu'on vient chercher. On la garde dans le contenu stocke (rien ne se
      -- perd) mais on ne la liste pas comme restaurable : il faut d'abord
      -- recreer la table.
      v_inconnues := v_inconnues || v_cle;
    end if;
  end loop;

  if array_length(v_tables, 1) is null then
    return json_build_object('ok', false, 'erreur',
      'Aucune table connue dans ce fichier. Vient-il bien de KAYOR ?');
  end if;

  v_octets := octet_length(v_bloc::text);
  if v_octets > 64 * 1024 * 1024 then
    return json_build_object('ok', false, 'erreur',
      'Fichier trop volumineux (' || v_octets || ' octets, plafond 64 Mo).');
  end if;

  insert into public.sauvegardes (faite_le, declencheur, tables, nb_lignes, octets, contenu)
  values (coalesce(v_faite, now()), 'fichier', v_tables, v_lignes, v_octets, v_bloc)
  returning id into v_id;

  delete from public.sauvegardes
   where declencheur = 'fichier'
     and id in (select id from public.sauvegardes
                 where declencheur = 'fichier'
                 order by id desc offset 3);

  perform app.journaliser_sauvegarde('import', v_id, null, v_lignes, v_octets,
    jsonb_build_object('origine', p_origine,
                       'tables_inconnues', to_jsonb(v_inconnues),
                       'faite_le_fichier', v_faite));

  return json_build_object(
    'ok', true,
    'id', v_id,
    'tables', array_length(v_tables, 1),
    'lignes', v_lignes,
    'octets', v_octets,
    'faite_le', coalesce(v_faite, now()),
    'tables_inconnues', to_jsonb(v_inconnues),
    'avis', 'Le fichier est devenu la sauvegarde n' || chr(176) || ' ' || v_id
         || '. RIEN n''a ete ecrit dans les tables metier : comparez d''abord, '
         || 'puis restaurez table par table.');
end $fn$;

revoke all on function public.sauvegarde_importer(jsonb, text) from public, anon;
grant execute on function public.sauvegarde_importer(jsonb, text) to authenticated;

commit;

-- ============================================================================
-- A VERIFIER APRES APPLICATION
-- ============================================================================
-- Dans une transaction annulee, sous l'identite de l'operateur :
--
--   begin;
--     set local request.jwt.claims = '{"sub":"<uuid operateur>"}';
--     select public.sauvegarde_importer(
--              jsonb_build_object('faite_le', '2020-01-01T00:00:00Z',
--                                 'contenu', jsonb_build_object('ventes','[]'::jsonb)));
--     select id, faite_le, declencheur from public.sauvegardes order by id desc limit 1;
--   rollback;
--
-- `faite_le` doit valoir 2020, pas aujourd'hui. S'il vaut aujourd'hui, la
-- correction n'est pas en base — et l'alerte de 48 h reste eteignable.
-- ============================================================================
