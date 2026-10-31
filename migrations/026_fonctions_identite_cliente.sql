-- ===========================================================================
-- 026 — Les fonctions passent du nom à l'identifiant
-- Écrite le 2026-10-27. Suite immédiate de la 025, qui a posé `client_id`.
-- ===========================================================================
-- La 025 a rempli la colonne. Celle-ci fait en sorte que le serveur s'en
-- serve. Tant que les deux ne sont pas appliquées ensemble, le portail
-- rapproche toujours par le nom.
--
-- Quatre fonctions sont concernées, pour trois raisons différentes :
--
--   portail_donnees    LISAIT par le nom. Deux homonymes d'une même boutique
--   portail_depot      voyaient l'épargne et les commandes l'une de l'autre.
--                      C'était le dernier endroit où le nom faisait autorité.
--
--   ouvrir_compte_     ÉCRIVAIT un nom sans identifiant. Tout compte ouvert
--   epargne            après la 025 serait reparti sans `client_id`.
--
--   vente_sur_compte_  ÉCRIVAIT un nom recopié du compte. Elle n'a besoin
--   epargne            d'aucun paramètre nouveau : le compte porte désormais
--                      `client_id`, la vente en hérite. C'est la bonne
--                      propagation — l'identité suit le compte, elle n'est
--                      pas re-saisie.
--
-- ─────────────────────── Ce que « ne rien trouver » veut dire ──────────────
--
-- Une ligne dont `client_id` est NULL devient invisible au portail. C'est
-- voulu : on ne sait pas à qui elle appartient, donc on ne la montre à
-- personne. L'ancien comportement la montrait à toutes les homonymes.
-- Elle reste évidemment visible en gestion, où un humain tranche.
--
-- ────────────────────────── Le paramètre p_client ──────────────────────────
--
-- `ouvrir_compte_epargne` garde `p_client` dans sa signature alors que le
-- nom est désormais lu dans `clients`. Ce n'est pas un oubli : sans lui, une
-- page restée en cache appellerait une signature qui n'existe plus et
-- recevrait un 404 illisible. Avec lui, elle atteint la fonction et reçoit
-- un message qui dit quoi faire. Le nom qu'elle envoie est ignoré — c'est le
-- serveur qui décide, sinon les deux colonnes divergent au premier mariage.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A. ouvrir_compte_epargne — exige l'identifiant, dérive le nom
-- ---------------------------------------------------------------------------
create or replace function public.ouvrir_compte_epargne(
  p_compte_id text, p_client text, p_date text, p_depot_initial integer,
  p_client_id text default null)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := app.current_org();
  v_nom text;
begin
  if v_org is null or not app.has_role('proprietaire','admin','gestionnaire','vendeur') then
    return json_build_object('ok', false, 'erreur', 'Non autorisé.');
  end if;
  if not app.org_active() then
    return json_build_object('ok', false, 'erreur', 'Boutique suspendue.');
  end if;
  if p_depot_initial is null or p_depot_initial <= 0 then
    return json_build_object('ok', false, 'erreur', 'Dépôt initial obligatoire.');
  end if;

  -- Une page en cache arrive ici sans identifiant. On le dit, plutôt que de
  -- créer un compte rattaché à personne.
  if p_client_id is null or btrim(p_client_id) = '' then
    return json_build_object('ok', false, 'erreur',
      'Cliente non identifiée. Rechargez la page (Ctrl+Maj+R) et recommencez.');
  end if;

  -- Le nom vient de la fiche, jamais du navigateur : sinon `client` et
  -- `client_id` désignent deux personnes dès la première correction de nom.
  select nom into v_nom from public.clients
   where id = p_client_id and organisation_id = v_org;
  if not found then
    return json_build_object('ok', false, 'erreur', 'Cliente introuvable dans cette boutique.');
  end if;

  if exists (select 1 from public.comptes_clients
              where id = p_compte_id and organisation_id = v_org) then
    return json_build_object('ok', false, 'erreur', 'Ce compte existe déjà.');
  end if;

  insert into public.comptes_clients
    (id, client, client_id, solde, actif, date_ouverture, organisation_id)
  values (p_compte_id, v_nom, p_client_id, p_depot_initial, true, p_date, v_org);

  insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
  values (p_compte_id, p_date, 'depot', p_depot_initial, 'Ouverture compte', v_org);

  return json_build_object('ok', true, 'compte_id', p_compte_id,
                           'client', v_nom, 'solde', p_depot_initial);
end $function$;

-- L'ancienne signature à quatre arguments doit partir : deux surcharges du
-- même nom rendent l'appel PostgREST ambigu. Même raison qu'en migration 022.
drop function if exists public.ouvrir_compte_epargne(text, text, text, integer);


-- ---------------------------------------------------------------------------
-- B. vente_sur_compte_epargne — la vente hérite de l'identité du compte
-- ---------------------------------------------------------------------------
-- Signature inchangée, donc rien à modifier côté navigateur. Seul l'`insert`
-- gagne `client_id`, pris sur le compte qui vient d'être lu et vérifié.
create or replace function public.vente_sur_compte_epargne(
  p_vente_id text, p_compte_id text, p_date text, p_description text,
  p_montant integer, p_montant_compte integer,
  p_paiement text default 'compte'::text, p_carat text default null::text,
  p_type_bijou text default null::text, p_num_facture text default null::text,
  p_note_complement text default null::text, p_espece integer default 0,
  p_poids numeric default 0, p_local numeric default 0, p_importe numeric default 0)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := app.current_org();
  v_compte record; v_solde int; v_espece int := coalesce(p_espece, 0);
  v_acompte int; v_restant int;
begin
  if v_org is null or not app.has_role('proprietaire','admin','gestionnaire','vendeur') then
    return json_build_object('ok', false, 'erreur', 'Non autorisé.');
  end if;
  if not app.org_active() then
    return json_build_object('ok', false, 'erreur', 'Boutique suspendue.');
  end if;

  select * into v_compte from public.comptes_clients
   where id = p_compte_id and organisation_id = v_org and actif;
  if not found then
    return json_build_object('ok', false, 'erreur', 'Compte épargne introuvable ou clôturé.');
  end if;

  if p_montant is null or p_montant <= 0 then
    return json_build_object('ok', false, 'erreur', 'Montant de vente invalide.');
  end if;
  if p_montant_compte is null or p_montant_compte < 0 or p_montant_compte > p_montant then
    return json_build_object('ok', false, 'erreur', 'Part réglée sur le compte invalide.');
  end if;
  if v_espece < 0 then
    return json_build_object('ok', false, 'erreur', 'Complément invalide.');
  end if;

  v_acompte := p_montant_compte + v_espece;
  if v_acompte > p_montant then
    return json_build_object('ok', false, 'erreur',
      'Le total versé dépasse le prix du bijou.');
  end if;
  v_restant := p_montant - v_acompte;

  -- Le solde est recalculé depuis l'historique, jamais lu dans la colonne
  -- (migration 022, défaut 2).
  select coalesce(sum(case when type='retrait' then -montant else montant end),0)
    into v_solde from public.mouvements_cc
   where compte_id = p_compte_id and organisation_id = v_org;

  if p_montant_compte > v_solde then
    return json_build_object('ok', false, 'erreur',
      'Solde insuffisant : ' || v_solde || ' disponible, ' || p_montant_compte || ' demandé.');
  end if;

  if exists (select 1 from public.ventes where id = p_vente_id and organisation_id = v_org) then
    return json_build_object('ok', false, 'erreur', 'Cette vente existe déjà.');
  end if;

  -- `client_id` vient du compte, pas du navigateur : la vente appartient à
  -- celle à qui appartient l'épargne qui la paie. `local` est un mot clé SQL,
  -- d'où les guillemets.
  insert into public.ventes (
    id, date, client, client_id, description, carat, type_bijou,
    montant, acompte, restant, paye_par_compte,
    paiement, compte_client_id, num_facture, note_complement,
    poids, "local", importe, organisation_id
  ) values (
    p_vente_id, p_date, v_compte.client, v_compte.client_id, p_description,
    p_carat, p_type_bijou,
    p_montant, v_acompte, v_restant, p_montant_compte,
    p_paiement, p_compte_id, p_num_facture, p_note_complement,
    coalesce(p_poids, 0), coalesce(p_local, 0), coalesce(p_importe, 0), v_org
  );

  if p_montant_compte > 0 then
    insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
    values (p_compte_id, p_date, 'retrait', p_montant_compte,
            'Vente ' || p_vente_id || ' — ' || coalesce(p_description,''), v_org);
  end if;

  update public.comptes_clients
     set solde = coalesce((select sum(case when type='retrait' then -montant else montant end)
                           from public.mouvements_cc
                          where compte_id = p_compte_id and organisation_id = v_org),0)
   where id = p_compte_id and organisation_id = v_org;

  return json_build_object('ok', true,
    'vente_id', p_vente_id,
    'paye_par_compte', p_montant_compte,
    'entre_en_caisse', v_espece,
    'acompte', v_acompte,
    'restant', v_restant,
    'nouveau_solde_compte',
      (select solde from public.comptes_clients
        where id = p_compte_id and organisation_id = v_org));
end $function$;


-- ---------------------------------------------------------------------------
-- C. portail_donnees — la cliente est rapprochée par son identifiant
-- ---------------------------------------------------------------------------
create or replace function public.portail_donnees(p_token uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sess record;
  v_cli  record;
  v_out  json;
begin
  select * into v_sess from public.portail_sessions
   where token = p_token and expire_le > now();
  if not found then
    return json_build_object('ok', false, 'erreur', 'Session expirée.');
  end if;

  begin
    select nom, email into strict v_cli
      from public.clients
     where id = v_sess.client_id
       and organisation_id = v_sess.organisation_id;
  exception
    when no_data_found then
      return json_build_object('ok', false, 'erreur', 'Compte introuvable.');
    when too_many_rows then
      raise exception
        'Plusieurs clientes portent l''identifiant % dans la boutique % : filtre manquant.',
        v_sess.client_id, v_sess.organisation_id;
  end;

  -- Le nom ne sert plus qu'à l'affichage. Le rapprochement se fait sur
  -- `client_id` : deux « astou » d'une même boutique ne se voient plus.
  select json_build_object(
    'ok', true,
    'client', json_build_object('id', v_sess.client_id, 'nom', v_cli.nom, 'email', v_cli.email),
    'comptes', coalesce((
      select json_agg(json_build_object(
        'id', cc.id, 'solde', cc.solde, 'actif', cc.actif,
        'date_ouverture', cc.date_ouverture,
        'mouvements', coalesce((
          select json_agg(json_build_object('date', m.date, 'type', m.type,
                                            'montant', m.montant, 'note', m.note)
                          order by m.date desc, m.id desc)
          from public.mouvements_cc m
         where m.compte_id = cc.id
           and m.organisation_id = cc.organisation_id), '[]'::json)))
      from public.comptes_clients cc
      where cc.organisation_id = v_sess.organisation_id
        and cc.client_id = v_sess.client_id), '[]'::json),
    'commandes', coalesce((
      select json_agg(json_build_object(
        'id', v.id, 'date', v.date, 'description', v.description,
        'montant', v.montant, 'acompte', v.acompte, 'restant', v.restant,
        'num_facture', v.num_facture) order by v.date desc)
      from public.ventes v
      where v.organisation_id = v_sess.organisation_id
        and v.client_id = v_sess.client_id
        and coalesce(v.restant,0) > 0
        and coalesce(v.annulee,false) = false), '[]'::json)
  ) into v_out;

  return v_out;
end $function$;


-- ---------------------------------------------------------------------------
-- D. portail_depot — le compte doit être le sien, par identifiant
-- ---------------------------------------------------------------------------
create or replace function public.portail_depot(
  p_token uuid, p_compte text, p_montant integer, p_note text default null::text)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sess   record;
  v_compte record;
  v_solde  integer;
begin
  select * into v_sess from public.portail_sessions
   where token = p_token and expire_le > now();
  if not found then
    return json_build_object('ok', false, 'erreur', 'Session expirée.');
  end if;

  if p_montant is null or p_montant <= 0 or p_montant > 50000000 then
    return json_build_object('ok', false, 'erreur', 'Montant invalide.');
  end if;

  -- `client = v_nom` est remplacé par `client_id = v_sess.client_id` : une
  -- homonyme ne peut plus déposer sur le compte d'une autre. La lecture du
  -- nom n'est donc même plus nécessaire ici.
  begin
    select * into strict v_compte from public.comptes_clients
     where id = p_compte
       and client_id = v_sess.client_id
       and organisation_id = v_sess.organisation_id
       and actif;
  exception
    when no_data_found then
      return json_build_object('ok', false, 'erreur', 'Compte introuvable.');
    when too_many_rows then
      raise exception
        'Plusieurs comptes % dans la boutique % : filtre manquant.',
        p_compte, v_sess.organisation_id;
  end;

  insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
  values (p_compte, to_char(now(),'YYYY-MM-DD'), 'depot', p_montant,
          coalesce(p_note,'Dépôt portail client'), v_sess.organisation_id);

  select coalesce(sum(case when m.type='retrait' then -m.montant else m.montant end), 0)
    into v_solde
    from public.mouvements_cc m
   where m.compte_id = p_compte
     and m.organisation_id = v_sess.organisation_id;

  update public.comptes_clients
     set solde = v_solde
   where id = p_compte
     and organisation_id = v_sess.organisation_id;

  return json_build_object('ok', true, 'nouveau_solde', v_solde);
end $function$;


-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
revoke all on function public.ouvrir_compte_epargne(text, text, text, integer, text)
  from public, anon;
grant execute on function public.ouvrir_compte_epargne(text, text, text, integer, text)
  to authenticated;

revoke all on function public.vente_sur_compte_epargne(
  text, text, text, text, integer, integer, text, text, text, text, text,
  integer, numeric, numeric, numeric) from public, anon;
grant execute on function public.vente_sur_compte_epargne(
  text, text, text, text, integer, integer, text, text, text, text, text,
  integer, numeric, numeric, numeric) to authenticated;

-- Le portail cliente n'a pas de session Supabase : l'identité se prouve par
-- le PIN dans portail_login().
revoke all on function public.portail_donnees(uuid) from public;
grant execute on function public.portail_donnees(uuid) to anon, authenticated;

revoke all on function public.portail_depot(uuid, text, integer, text) from public;
grant execute on function public.portail_depot(uuid, text, integer, text) to anon, authenticated;


-- ===========================================================================
-- APRÈS APPLICATION
-- ===========================================================================
-- 1. Vérifier qu'il ne reste qu'UNE `ouvrir_compte_epargne` :
--
--      select pg_get_function_identity_arguments(oid)
--        from pg_proc where proname = 'ouvrir_compte_epargne';
--
--    Deux lignes = appel PostgREST ambigu, la création de compte tombe.
--
-- 2. Incrémenter `APP_VERSION` et recharger en vidant le cache. Le champ
--    caché du sélecteur porte maintenant un identifiant : une page ancienne
--    enverrait un nom là où le serveur attend `CL-0012`.
--
-- 3. Les quatre gestes, dans les DEUX boutiques :
--      a. ouvrir un compte épargne  → `client_id` renseigné en base ;
--      b. vendre sur ce compte      → la vente porte le même `client_id` ;
--      c. enregistrer une reprise   → idem ;
--      d. ouvrir le portail cliente → elle ne voit QUE ses comptes et
--                                      commandes, et le dépôt fonctionne.
--
-- 4. Le test qui compte : créer deux clientes HOMONYMES dans une boutique,
--    une vente et un compte pour chacune, puis ouvrir le portail de l'une.
--    Elle ne doit voir que les siens. C'est le défaut que cette paire de
--    migrations ferme, et il ne se voit pas autrement.
-- ===========================================================================
