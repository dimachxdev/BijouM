-- ============================================================================
-- 039 — Telecharger une sauvegarde, et la restaurer sans rien ecraser
-- ============================================================================
-- Demande le 2026-11-04 : « pour les sauvegardes il faut pouvoir telecharger
-- et aussi restaurer ».
--
-- Les deux manquaient, et chacun manquait pour une raison differente.
--
-- 1. TELECHARGER — c'est la reponse au defaut que la 035 s'avouait a elle-meme
--
-- « ELLE VIT DANS LA BASE QU'ELLE PROTEGE. C'est la phrase a retenir. » Un
-- instantane qui ne survit pas a la perte du projet n'est pas une sauvegarde,
-- c'est un filet contre l'erreur humaine. Un fichier sur une autre machine,
-- lui, survit. C'est le seul chemin vers une sauvegarde hors base qui ne
-- demande ni le plan Pro, ni un depot git, ni un poste allume la nuit.
--
-- CE QUE CELA COUTE, ET IL FAUT L'ECRIRE AVANT DE L'OUVRIR
--
-- Le § 9 de CLAUDE.md prevenait : « Ne pas exposer d'export HTTP du contenu
-- complet sans avoir pese que le compte operateur deviendrait alors la cle de
-- tout le jeu de donnees. » Voici la pesee, faite et assumee :
--
--   — Un instantane contient TOUTES les boutiques dans un seul objet,
--     `clients.pin_hash` compris. Un jeton d'operateur vole suffit desormais a
--     emporter l'ensemble, en une requete.
--   — Avant, il y fallait le tableau de bord Supabase : un autre mot de passe,
--     un autre site. L'elargissement est reel, ce n'est pas une formalite.
--   — Ce qui le rend acceptable : il n'y a QU'UN operateur, c'est le
--     fondateur, et il detient de toute facon les acces de la base. Le geste
--     ne lui donne rien de nouveau ; il lui evite seulement de passer par
--     l'editeur SQL. La surface qui s'ouvre est celle du VOL de son compte.
--   — Donc deux contreparties, qui ne sont pas decoratives :
--       a) chaque export est inscrit dans `journal_sauvegardes`, que rien dans
--          ce fichier ne sait effacer (§ 7 : « personne ne peut effacer une
--          trace ») ;
--       b) la MFA sur le compte operateur, deja au § 9, cesse d'etre une bonne
--          pratique pour devenir la serrure de ce coffre. Elle doit passer
--          AVANT la premiere boutique payante, pas apres.
--
-- Et le fichier telecharge est en clair. Il vaut la base entiere : il ne vit
-- pas dans un dossier de travail ordinaire.
--
-- 2. RESTAURER — la 035 avait raison sur le principe et tort sur l'usage
--
-- `restaurer_table()` recree les lignes dans le schema `restauration`, a cote.
-- C'est juste, et cela reste. Mais ce schema est ferme a l'application
-- (volontairement : une table restauree contient toutes les boutiques), donc
-- l'operateur creait depuis la console une table qu'il ne pouvait lire que
-- dans l'editeur SQL. La 036 a corrige le MESSAGE ; le geste, lui, n'allait
-- toujours pas jusqu'au bout.
--
-- Entre « restaurer en ecrasant » et « ne pas restaurer », il existe un
-- troisieme geste, et c'est le seul dont on ait vraiment besoin apres un
-- incident : REINJECTER CE QUI MANQUE.
--
--   — Une ligne presente n'est jamais touchee : ni UPDATE, ni DELETE, nulle
--     part dans ce fichier. Le `on conflict do nothing` le dit, et le
--     `where not exists` le disait deja.
--   — Donc une restauration ne peut pas remplacer des donnees justes par
--     celles d'hier — le scenario que la 035 refusait, et qu'elle avait raison
--     de refuser.
--   — Ce qu'elle repare est exactement ce qui arrive : un DELETE sans WHERE,
--     une table supprimee, des lignes effacees par erreur.
--
-- QUATRE VERROUS, et chacun pour un accident precis :
--
--   1. operateur du service, et personne d'autre ;
--   2. ESSAI A BLANC PAR DEFAUT (`p_appliquer` = false). On voit ce qui
--      reviendrait avant que quoi que ce soit revienne. Personne ne restaure
--      en decouvrant ;
--   3. le NOM DE LA TABLE DOIT ETRE RETAPE, comme le code boutique de
--      `supprimer_boutique()` : un clic dans une liste ne reinjecte rien ;
--   4. `p_org_id` facultatif : un incident touche presque toujours UNE
--      boutique. Limiter la portee est moins destructeur que de tout rendre.
--
-- Et la fonction rend les cles primaires reellement inserees. C'est ce qui
-- rend le geste reversible : un `delete` sur ces cles exactes defait la
-- reinjection, sans toucher a rien d'autre.
--
-- UNE CLE ETRANGERE QUI PROTESTE EST UN BON SIGNE. Reinjecter une vente dont
-- la cliente a disparu leve une erreur, la transaction tombe, rien n'est
-- ecrit a moitie. C'est pourquoi l'ordre compte : organisations, clients,
-- puis ventes / comptes_clients / reprises / bijoux_arrhes, puis les
-- mouvements. Ne pas « reparer » cela en desactivant les contraintes.
--
-- 3. IMPORTER UN FICHIER — sinon le telechargement est une decoration
--
-- Une sauvegarde qu'on ne peut pas remettre n'est pas une sauvegarde. Le
-- fichier redevient donc une LIGNE de `public.sauvegardes`, et tout ce qui
-- existe deja s'y applique sans une ligne de plus : `comparer_sauvegarde()`,
-- `restaurer_table()`, `restaurer_lignes_manquantes()`. Un seul mecanisme,
-- pas deux.
--
-- L'import n'ecrit RIEN dans une table metier. Il depose un instantane, et
-- s'arrete la.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Le journal — il n'a ni UPDATE ni DELETE, et il ne doit jamais en avoir
-- --------------------------------------------------------------------------
-- Meme regle que `connexions` et `portail_journal` au § 7 : une trace ne
-- s'effface pas, pas meme par celui qu'elle enregistre. Aucune fonction de ce
-- fichier n'y supprime quoi que ce soit — c'est volontaire, et c'est tout le
-- contrepoids de l'export.
--
-- Ferme a tout le monde, comme `sauvegardes` et `gestes` : seules les
-- fonctions `SECURITY DEFINER` ci-dessous y touchent.
create table if not exists public.journal_sauvegardes (
  id            bigserial   primary key,
  survenu_le    timestamptz not null default now(),
  geste         text        not null,   -- export | import | reinjection
  sauvegarde_id bigint,
  table_cible   text,
  acteur        text,
  lignes        integer,
  octets        bigint,
  detail        jsonb
);

comment on table public.journal_sauvegardes is
  'Trace des exports, imports et reinjections de sauvegarde. Sans UPDATE ni '
  'DELETE, par la regle du § 7. Voir migration 039.';

alter table public.journal_sauvegardes enable row level security;
revoke all on table    public.journal_sauvegardes          from public, anon, authenticated;
revoke all on sequence public.journal_sauvegardes_id_seq   from public, anon, authenticated;

create or replace function app.journaliser_sauvegarde(
  p_geste    text,
  p_sauv     bigint  default null,
  p_table    text    default null,
  p_lignes   integer default null,
  p_octets   bigint  default null,
  p_detail   jsonb   default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.journal_sauvegardes
    (geste, sauvegarde_id, table_cible, acteur, lignes, octets, detail)
  values (p_geste, p_sauv, p_table,
          coalesce(nullif(auth.jwt() ->> 'email', ''),
                   auth.uid()::text, '(inconnu)'),
          p_lignes, p_octets, p_detail);
end $$;

revoke all on function app.journaliser_sauvegarde(text, bigint, text, integer, bigint, jsonb)
  from public, anon, authenticated;

-- Le journal se lit depuis la console : une trace que personne ne regarde ne
-- previent de rien.
create or replace function public.journal_sauvegardes_recent(p_limite integer default 30)
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

  select coalesce(json_agg(l order by l.id desc), '[]'::json) into v_res
    from (select id, survenu_le, geste, sauvegarde_id, table_cible,
                 acteur, lignes, octets, detail
            from public.journal_sauvegardes
           order by id desc
           limit least(greatest(coalesce(p_limite, 30), 1), 200)) l;

  return json_build_object('ok', true, 'lignes', v_res);
end $$;

revoke all on function public.journal_sauvegardes_recent(integer) from public, anon;
grant execute on function public.journal_sauvegardes_recent(integer) to authenticated;

-- --------------------------------------------------------------------------
-- 2. Un fichier importe ne doit pas etre emporte par la purge de la nuit
-- --------------------------------------------------------------------------
-- La 035 gardait les quatorze dernieres lignes, toutes origines confondues.
-- Un fichier remonte apres un incident aurait donc pu disparaitre a 02h15,
-- la nuit suivante — c'est-a-dire precisement pendant qu'on s'en sert.
--
-- Les deux series sont desormais purgees separement : quatorze instantanes
-- internes, trois fichiers importes. Le reste de la fonction est inchange.
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
  -- La liste reste DEDUITE du catalogue : une liste figee aurait oublie la
  -- premiere table ajoutee ensuite, et personne ne l'aurait su avant d'en
  -- avoir besoin. `journal_sauvegardes` y entre donc d'elle-meme, et c'est
  -- voulu : la trace d'un export voyage avec la sauvegarde.
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

  -- Quatorze nuits d'instantanes internes. Au-dela, une erreur non reperee en
  -- deux semaines ne se repere plus par comparaison : elle fait partie du
  -- paysage.
  delete from public.sauvegardes
   where declencheur <> 'fichier'
     and id in (select id from public.sauvegardes
                 where declencheur <> 'fichier'
                 order by id desc offset 14);

  -- Et trois fichiers importes, purges a part. L'operateur garde l'original
  -- sur son disque : c'est tout l'interet du telechargement.
  delete from public.sauvegardes
   where declencheur = 'fichier'
     and id in (select id from public.sauvegardes
                 where declencheur = 'fichier'
                 order by id desc offset 3);

  return json_build_object('ok', true, 'id', v_id, 'tables', array_length(v_tables,1),
                           'lignes', v_lignes, 'octets', v_octets);
end $$;

revoke all on function app.sauvegarder_base(text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. TELECHARGER
-- --------------------------------------------------------------------------
create or replace function public.sauvegarde_exporter(p_id bigint default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record;
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Reserve au service.');
  end if;

  -- `select ... into` avec `limit 1` : ici c'est voulu, et sans danger.
  -- L'ordre est EXPLICITE (le § 1 de CLAUDE.md ne reproche pas le `limit 1`,
  -- il reproche le `limit 1` sans ordre et sans filtre de boutique), et
  -- `sauvegardes` n'a aucune dimension boutique a filtrer : un instantane est
  -- celui du service entier.
  select * into r
    from public.sauvegardes
   where p_id is null or id = p_id
   order by id desc
   limit 1;

  if r.id is null then
    return json_build_object('ok', false, 'erreur',
      case when p_id is null then 'Aucune sauvegarde a exporter.'
           else 'Aucune sauvegarde portant le numero ' || p_id || '.' end);
  end if;

  -- La trace AVANT de rendre le contenu. Un export qui echouerait apres
  -- l'inscription laisse une ligne de trop ; un export inscrit apres coup
  -- pourrait n'etre jamais inscrit.
  perform app.journaliser_sauvegarde('export', r.id, null, r.nb_lignes, r.octets, null);

  return json_build_object(
    'ok',            true,
    'format',        'kayor-sauvegarde-1',
    'id',            r.id,
    'faite_le',      r.faite_le,
    'declencheur',   r.declencheur,
    'tables',        to_jsonb(r.tables),
    'nb_lignes',     r.nb_lignes,
    'octets',        r.octets,
    'exporte_le',    now(),
    'avertissement',
      'Ce fichier contient les donnees de TOUTES les boutiques, y compris les '
      || 'empreintes de code PIN des clientes. Il vaut la base entiere : ne pas '
      || 'le laisser dans un dossier de travail ordinaire, ni le transmettre par '
      || 'messagerie.',
    'contenu',       r.contenu);
end $$;

revoke all on function public.sauvegarde_exporter(bigint) from public, anon;
grant execute on function public.sauvegarde_exporter(bigint) to authenticated;

-- --------------------------------------------------------------------------
-- 4. IMPORTER un fichier — il devient un instantane, rien de plus
-- --------------------------------------------------------------------------
create or replace function public.sauvegarde_importer(
  p_contenu jsonb,
  p_origine text default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bloc      jsonb;
  v_cle       text;
  v_tables    text[] := '{}';
  v_inconnues text[] := '{}';
  v_lignes    integer := 0;
  v_octets    bigint;
  v_id        bigint;
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
  -- fichier tel qu'il l'a recu, sans avoir a l'ouvrir pour en extraire une
  -- branche.
  if p_contenu ? 'contenu' and jsonb_typeof(p_contenu -> 'contenu') = 'object' then
    v_bloc := p_contenu -> 'contenu';
  else
    v_bloc := p_contenu;
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
      -- perd) mais on ne la liste pas comme restaurable : il faudra d'abord
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

  insert into public.sauvegardes (declencheur, tables, nb_lignes, octets, contenu)
  values ('fichier', v_tables, v_lignes, v_octets, v_bloc)
  returning id into v_id;

  -- Trois fichiers conserves, purges a part des quatorze nuits.
  delete from public.sauvegardes
   where declencheur = 'fichier'
     and id in (select id from public.sauvegardes
                 where declencheur = 'fichier'
                 order by id desc offset 3);

  perform app.journaliser_sauvegarde('import', v_id, null, v_lignes, v_octets,
    jsonb_build_object('origine', p_origine,
                       'tables_inconnues', to_jsonb(v_inconnues)));

  return json_build_object(
    'ok', true,
    'id', v_id,
    'tables', array_length(v_tables, 1),
    'lignes', v_lignes,
    'octets', v_octets,
    'tables_inconnues', to_jsonb(v_inconnues),
    'avis', 'Le fichier est devenu la sauvegarde n' || chr(176) || ' ' || v_id
         || '. RIEN n''a ete ecrit dans les tables metier : comparez d''abord, '
         || 'puis restaurez table par table.');
end $$;

revoke all on function public.sauvegarde_importer(jsonb, text) from public, anon;
grant execute on function public.sauvegarde_importer(jsonb, text) to authenticated;

-- --------------------------------------------------------------------------
-- 5. RESTAURER CE QUI MANQUE — jamais par-dessus ce qui est la
-- --------------------------------------------------------------------------
create or replace function public.restaurer_lignes_manquantes(
  p_sauvegarde   bigint,
  p_table        text,
  p_appliquer    boolean default false,
  p_confirmation text    default null,
  p_org_id       uuid    default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bloc     jsonb;
  v_pk       text[];
  v_cond     text;
  v_cles_j   text;
  v_cles_nu  text;
  v_org      text := '';
  v_n_manq   integer;
  v_exemples jsonb;
  v_ins      integer := 0;
  v_faites   jsonb := '[]'::jsonb;
  s          record;
  v_max      bigint;
  v_cur      bigint;
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Reserve au service.');
  end if;

  -- `p_table` vient du navigateur et part dans un `format(%I)`. On le
  -- confronte d'abord au catalogue : %I echapperait de toute facon, mais on ne
  -- fait pas reposer une injection evitee sur un seul rempart.
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind = 'r' and c.relname = p_table) then
    return json_build_object('ok', false, 'erreur',
      'Table inconnue dans public : ' || coalesce(p_table, '(vide)')
      || '. Si elle a ete supprimee, il faut la recreer avant de restaurer ses lignes.');
  end if;

  -- Sans cle primaire, « la ligne manque-t-elle ? » n'a pas de reponse : on
  -- refuse plutot que de deviner. Les cles de ce projet sont composees
  -- (organisation_id, id) — `id` seul n'est pas unique (§ 1).
  select array_agg(a.attname order by k.ord) into v_pk
    from pg_index i
    join pg_class c     on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(i.indkey) with ordinality k(attnum, ord) on true
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where n.nspname = 'public' and c.relname = p_table and i.indisprimary;

  if v_pk is null then
    return json_build_object('ok', false, 'erreur',
      'La table ' || p_table || ' n''a pas de cle primaire : impossible de '
      || 'determiner quelles lignes manquent sans risquer un doublon.');
  end if;

  select contenu -> p_table into v_bloc
    from public.sauvegardes where id = p_sauvegarde;

  if v_bloc is null or jsonb_typeof(v_bloc) <> 'array' then
    return json_build_object('ok', false, 'erreur',
      'La sauvegarde ' || coalesce(p_sauvegarde::text, '(aucune)')
      || ' ne contient pas la table ' || p_table || '.');
  end if;

  select string_agg(format('t.%1$I = j.%1$I', c), ' and ' order by o),
         string_agg(format('j.%I', c), ', '           order by o),
         string_agg(format('%I',   c), ', '           order by o)
    into v_cond, v_cles_j, v_cles_nu
    from unnest(v_pk) with ordinality u(c, o);

  -- Limiter la portee a une boutique. Un incident touche presque toujours
  -- une seule : rendre moins est moins destructeur que rendre tout.
  if p_org_id is not null then
    if not exists (select 1 from pg_attribute a
                     join pg_class c     on c.oid = a.attrelid
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = p_table
                      and a.attname = 'organisation_id'
                      and a.attnum > 0 and not a.attisdropped) then
      return json_build_object('ok', false, 'erreur',
        'La table ' || p_table || ' ne porte pas organisation_id : la '
        || 'restauration ne peut pas y etre limitee a une boutique.');
    end if;
    v_org := format(' and j.organisation_id = %L', p_org_id);
  end if;

  -- CE QUI MANQUE — aucune ecriture, aucun verrou sur la table vivante.
  execute format($f$
    select count(*),
           coalesce(jsonb_agg(k) filter (where rn <= 50), '[]'::jsonb)
      from (select jsonb_build_array(%2$s) as k, row_number() over () as rn
              from jsonb_populate_recordset(null::public.%1$I, $1) j
             where not exists (select 1 from public.%1$I t where %3$s) %4$s) q
  $f$, p_table, v_cles_j, v_cond, v_org)
    into v_n_manq, v_exemples using v_bloc;

  if v_n_manq = 0 then
    return json_build_object('ok', true, 'applique', false,
      'table', p_table, 'sauvegarde', p_sauvegarde, 'lignes_manquantes', 0,
      'avis', 'Rien ne manque dans public.' || p_table || ' par rapport a cette '
           || 'sauvegarde. Aucune ecriture n''a lieu.');
  end if;

  -- L'ESSAI A BLANC EST LE DEFAUT, et il doit le rester : personne ne
  -- restaure en decouvrant ce qu'il restaure.
  if not coalesce(p_appliquer, false) then
    return json_build_object('ok', true, 'applique', false,
      'table', p_table, 'sauvegarde', p_sauvegarde,
      'lignes_manquantes', v_n_manq,
      'cle_primaire', to_jsonb(v_pk),
      'exemples', v_exemples,
      'avis', v_n_manq || ' ligne(s) de la sauvegarde n''existent plus dans public.'
           || p_table || '. Rien n''a ete ecrit. Des lignes ont peut-etre ete '
           || 'supprimees volontairement : examinez-les avant de les faire revenir.');
  end if;

  -- Le nom retape, comme le code boutique de `supprimer_boutique()`.
  if p_confirmation is distinct from p_table then
    return json_build_object('ok', false, 'erreur',
      'Pour reinjecter dans ' || p_table || ', retapez son nom exactement.');
  end if;

  -- L'ECRITURE. `where not exists` puis `on conflict do nothing` : deux
  -- remparts pour la meme promesse — aucune ligne existante n'est touchee.
  -- `returning` rend les cles VRAIMENT inserees, pas celles qu'on croyait
  -- manquantes : c'est ce qui rend le geste defaisable.
  execute format($f$
    with ins as (
      insert into public.%1$I
      select j.* from jsonb_populate_recordset(null::public.%1$I, $1) j
       where not exists (select 1 from public.%1$I t where %2$s) %3$s
      on conflict do nothing
      returning %4$s
    )
    select count(*), coalesce(jsonb_agg(k) filter (where rn <= 50), '[]'::jsonb)
      from (select jsonb_build_array(%4$s) as k, row_number() over () as rn
              from ins) q
  $f$, p_table, v_cond, v_org, v_cles_nu)
    into v_ins, v_faites using v_bloc;

  -- LES SEQUENCES. Une table recreee apres un DROP repart a 1. Reinjecter des
  -- lignes portant les anciens identifiants laisserait la sequence DERRIERE
  -- elles, et la prochaine ecriture entrerait en collision sur la cle
  -- primaire. `mouvements_cc` — le grand livre de l'epargne — est en premiere
  -- ligne. On ne fait jamais BAISSER une sequence.
  for s in
    select q.col, q.seq from (
      select a.attname as col,
             pg_get_serial_sequence('public.' || p_table, a.attname) as seq
        from pg_attribute a
        join pg_class c     on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = p_table
         and a.attnum > 0 and not a.attisdropped) q
     where q.seq is not null
  loop
    execute format('select max(%I) from public.%I', s.col, p_table) into v_max;
    select last_value into v_cur
      from pg_sequences
     where schemaname = split_part(s.seq, '.', 1)
       and sequencename = split_part(s.seq, '.', 2);
    if v_max is not null and (v_cur is null or v_max > v_cur) then
      perform setval(s.seq, v_max);
    end if;
  end loop;

  perform app.journaliser_sauvegarde('reinjection', p_sauvegarde, p_table, v_ins, null,
    jsonb_build_object('cle_primaire', to_jsonb(v_pk),
                       'organisation_id', p_org_id,
                       'cles_inserees', v_faites));

  return json_build_object('ok', true, 'applique', true,
    'table', p_table, 'sauvegarde', p_sauvegarde,
    'lignes_manquantes', v_n_manq,
    'lignes_reinjectees', v_ins,
    'cle_primaire', to_jsonb(v_pk),
    'exemples', v_faites,
    'avis', v_ins || ' ligne(s) reinjectee(s) dans public.' || p_table
         || '. Aucune ligne existante n''a ete modifiee ni supprimee. Pour '
         || 'defaire : supprimer exactement les cles rendues ci-dessus.');
end $$;

revoke all on function public.restaurer_lignes_manquantes(bigint, text, boolean, text, uuid)
  from public, anon;
grant execute on function public.restaurer_lignes_manquantes(bigint, text, boolean, text, uuid)
  to authenticated;

commit;

-- ============================================================================
-- A VERIFIER APRES APPLICATION — le « succes » ne prouve que la syntaxe
-- ============================================================================
-- 1. L'export rend bien le contenu, et laisse une trace :
--      select json_typeof((public.sauvegarde_exporter() -> 'contenu'));  -- object
--      select geste, acteur, lignes from public.journal_sauvegardes order by id desc limit 1;
--
-- 2. L'import refuse ce qui n'est pas une sauvegarde :
--      select public.sauvegarde_importer('{"pas_une_table":[]}'::jsonb);
--    -> « Aucune table connue dans ce fichier. »
--
-- 3. L'import accepte l'enveloppe telle quelle (c'est le fichier telecharge) :
--      select public.sauvegarde_importer(public.sauvegarde_exporter()::jsonb);
--    -> une nouvelle ligne `declencheur = 'fichier'`, et AUCUNE ecriture
--       metier. A verifier : select count(*) from public.ventes; inchange.
--
-- 4. LE SEUL ESSAI QUI COMPTE — une reinjection reelle, dans une transaction
--    annulee :
--
--      begin;
--        select count(*) from public.sorties;             -- avant
--        delete from public.sorties where id = 'S-0006';
--
--        -- essai a blanc : doit annoncer 1 ligne manquante, sans ecrire
--        select public.restaurer_lignes_manquantes(<id>, 'sorties');
--        select count(*) from public.sorties;             -- toujours -1
--
--        -- sans le nom retape : doit refuser
--        select public.restaurer_lignes_manquantes(<id>, 'sorties', true);
--
--        -- avec : doit rendre la ligne, et une seule
--        select public.restaurer_lignes_manquantes(<id>, 'sorties', true, 'sorties');
--        select count(*) from public.sorties;             -- revenu au compte initial
--
--        -- rejouer : doit annoncer « rien ne manque »
--        select public.restaurer_lignes_manquantes(<id>, 'sorties', true, 'sorties');
--      rollback;
--
--    Si l'essai a blanc ecrit, ou si la reinjection rejouee ecrit une seconde
--    fois, la fonction est dangereuse : ne pas s'en servir.
--
-- 5. La contre-epreuve d'etancheite — une proprietaire doit etre refusee
--    partout :
--      set local role authenticated;
--      set local request.jwt.claims = '{"sub":"<uuid d une proprietaire>"}';
--      select public.sauvegarde_exporter();            -- « Reserve au service. »
--      select public.restaurer_lignes_manquantes(1, 'ventes');  -- idem
-- ============================================================================
