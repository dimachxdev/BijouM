-- ============================================================================
-- 033 — Les cinq fonctions d'argent deviennent rejouables
-- ============================================================================
-- Seconde moitie de la 032, qui a pose la table `gestes` et les deux aides
-- `app.geste_reserver()` / `app.geste_resultat()`. A appliquer juste apres :
-- la 032 seule laisse un registre que personne n'utilise (inoffensif), la 033
-- seule ne s'applique pas.
--
-- Chaque fonction gagne un dernier parametre `p_cle uuid default null` et
-- deux lignes :
--
--   v_rejeu := app.geste_reserver(v_org, p_cle, '<nom>');
--   if v_rejeu is not null then return v_rejeu; end if;
--
-- ... puis, juste avant de rendre la main :
--
--   perform app.geste_resultat(v_org, p_cle, v_out);
--
-- OU SE PLACE LA RESERVATION, ET POURQUOI CELA COMPTE
--
-- APRES toutes les validations, juste AVANT la premiere ecriture.
--
-- Avant les validations, un refus brulerait la cle : la personne corrige son
-- montant, reclique — et se fait repondre « geste deja lance » pour un geste
-- qui n'a rien ecrit. Le formulaire deviendrait a usage unique.
--
-- Apres la premiere ecriture, une rafale passerait entre les deux.
--
-- Corollaire a tenir : AUCUN `return` de refus ne doit se trouver sous la
-- ligne de reservation. Une exception, elle, est sans danger — elle annule la
-- transaction, donc la reservation avec, et la cle redevient libre.
--
-- CE QUI N'EST PAS TOUCHE
--
-- Les filtres `and organisation_id = v_org` de l'audit des migrations 022 a
-- 024 sont recopies a l'identique, de meme que les `select ... into strict`
-- de `portail_depot` : une fonction SECURITY DEFINER contourne RLS et filtre
-- elle-meme (§ 1). Les corps ci-dessous ont ete relus depuis
-- `pg_get_functiondef()`, pas depuis les fichiers de migration.
--
-- Les anciennes signatures sont SUPPRIMEES. Avec un parametre a valeur par
-- defaut, les deux versions coexisteraient et tout appel nomme deviendrait
-- ambigu (« function is not unique ») : le comptoir tomberait entier.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. depot_compte_epargne — un depot au comptoir
-- --------------------------------------------------------------------------
create or replace function public.depot_compte_epargne(
  p_compte_id text, p_montant integer,
  p_date text default null, p_note text default null,
  p_cle uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org   uuid := app.current_org();
  v_solde int;
  v_rejeu json;
  v_out   json;
begin
  if v_org is null or not app.has_role('proprietaire','admin','gestionnaire','vendeur') then
    return json_build_object('ok', false, 'erreur', 'Non autorisé.');
  end if;
  if not app.org_active() then
    return json_build_object('ok', false, 'erreur', 'Boutique suspendue.');
  end if;
  if p_montant is null or p_montant <= 0 or p_montant > 50000000 then
    return json_build_object('ok', false, 'erreur', 'Montant invalide.');
  end if;
  if not exists (select 1 from public.comptes_clients
                  where id = p_compte_id and organisation_id = v_org and actif) then
    return json_build_object('ok', false, 'erreur', 'Compte introuvable ou clôturé.');
  end if;

  -- Plus aucun refus sous cette ligne.
  v_rejeu := app.geste_reserver(v_org, p_cle, 'depot_compte_epargne');
  if v_rejeu is not null then return v_rejeu; end if;

  insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
  values (p_compte_id, coalesce(p_date, to_char(now(),'YYYY-MM-DD')), 'depot', p_montant,
          coalesce(nullif(p_note,''), 'Dépôt'), v_org);

  -- Corrigé (022) : la somme ne portait pas la boutique, elle additionnait les
  -- mouvements de toutes celles ayant ce numéro de compte.
  select coalesce(sum(case when type='retrait' then -montant else montant end),0)
    into v_solde
    from public.mouvements_cc
   where compte_id = p_compte_id
     and organisation_id = v_org;

  -- Corrigé (022) : sans ce filtre, le total ci-dessus était écrit sur le
  -- compte homonyme de CHAQUE boutique.
  update public.comptes_clients
     set solde = v_solde
   where id = p_compte_id
     and organisation_id = v_org;

  v_out := json_build_object('ok', true, 'nouveau_solde', v_solde);
  perform app.geste_resultat(v_org, p_cle, v_out);
  return v_out;
end $function$;

drop function if exists public.depot_compte_epargne(text, integer, text, text);

revoke all on function public.depot_compte_epargne(text, integer, text, text, uuid)
  from public, anon;
grant execute on function public.depot_compte_epargne(text, integer, text, text, uuid)
  to authenticated;

-- --------------------------------------------------------------------------
-- 2. enregistrer_paiement_vente — encaisser un versement
-- --------------------------------------------------------------------------
-- C'EST LE GESTE QUI JUSTIFIE LA TABLE `gestes`. Il n'insere rien : il fait
-- `acompte = acompte + p_montant`. Un doublon ne laisse aucune ligne en trop,
-- seulement un acompte faux — et une cliente creditee deux fois de ce qu'elle
-- n'a verse qu'une fois. Aucune contrainte d'unicite n'aurait pu l'attraper.
create or replace function public.enregistrer_paiement_vente(
  p_vente_id text, p_montant integer,
  p_date text default null, p_paiement text default null,
  p_cle uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org   uuid := app.current_org();
  v_vente record;
  v_rejeu json;
  v_out   json;
begin
  -- Ouvert à tout membre actif : encaisser est le quotidien du comptoir.
  if v_org is null or not app.has_role('proprietaire','admin','gestionnaire','vendeur') then
    return json_build_object('ok', false, 'erreur', 'Non autorisé.');
  end if;
  if not app.org_active() then
    return json_build_object('ok', false, 'erreur', 'Boutique suspendue.');
  end if;

  select * into v_vente from public.ventes
   where id = p_vente_id and organisation_id = v_org;
  if not found then
    return json_build_object('ok', false, 'erreur', 'Vente introuvable.');
  end if;
  if coalesce(v_vente.annulee,false) then
    return json_build_object('ok', false, 'erreur', 'Cette vente est annulée.');
  end if;

  if p_montant is null or p_montant <= 0 then
    return json_build_object('ok', false, 'erreur', 'Montant invalide.');
  end if;
  if p_montant > coalesce(v_vente.restant,0) then
    return json_build_object('ok', false, 'erreur',
      'Montant supérieur au restant dû (' || coalesce(v_vente.restant,0) || ').');
  end if;

  -- Plus aucun refus sous cette ligne.
  v_rejeu := app.geste_reserver(v_org, p_cle, 'enregistrer_paiement_vente');
  if v_rejeu is not null then return v_rejeu; end if;

  -- Seules ces colonnes bougent : ni le montant total, ni la cliente,
  -- ni la description ne peuvent être touchés par ce chemin.
  update public.ventes
     set acompte  = coalesce(acompte,0) + p_montant,
         restant  = greatest(0, coalesce(restant,0) - p_montant),
         paiement = coalesce(nullif(p_paiement,''), paiement)
   where id = p_vente_id and organisation_id = v_org;

  select * into v_vente from public.ventes where id = p_vente_id and organisation_id = v_org;

  v_out := json_build_object('ok', true,
    'acompte', v_vente.acompte, 'restant', v_vente.restant,
    'solde', (v_vente.restant = 0));
  perform app.geste_resultat(v_org, p_cle, v_out);
  return v_out;
end $function$;

drop function if exists public.enregistrer_paiement_vente(text, integer, text, text);

revoke all on function public.enregistrer_paiement_vente(text, integer, text, text, uuid)
  from public, anon;
grant execute on function public.enregistrer_paiement_vente(text, integer, text, text, uuid)
  to authenticated;

-- --------------------------------------------------------------------------
-- 3. ouvrir_compte_epargne — ouvrir un compte et son depot d'ouverture
-- --------------------------------------------------------------------------
create or replace function public.ouvrir_compte_epargne(
  p_compte_id text, p_client text, p_date text, p_depot_initial integer,
  p_client_id text default null,
  p_cle uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org   uuid := app.current_org();
  v_nom   text;
  v_rejeu json;
  v_out   json;
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

  -- Plus aucun refus sous cette ligne.
  v_rejeu := app.geste_reserver(v_org, p_cle, 'ouvrir_compte_epargne');
  if v_rejeu is not null then return v_rejeu; end if;

  insert into public.comptes_clients
    (id, client, client_id, solde, actif, date_ouverture, organisation_id)
  values (p_compte_id, v_nom, p_client_id, p_depot_initial, true, p_date, v_org);

  insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
  values (p_compte_id, p_date, 'depot', p_depot_initial, 'Ouverture compte', v_org);

  v_out := json_build_object('ok', true, 'compte_id', p_compte_id,
                             'client', v_nom, 'solde', p_depot_initial);
  perform app.geste_resultat(v_org, p_cle, v_out);
  return v_out;
end $function$;

drop function if exists public.ouvrir_compte_epargne(text, text, text, integer, text);

revoke all on function public.ouvrir_compte_epargne(text, text, text, integer, text, uuid)
  from public, anon;
grant execute on function public.ouvrir_compte_epargne(text, text, text, integer, text, uuid)
  to authenticated;

-- --------------------------------------------------------------------------
-- 4. vente_sur_compte_epargne — vente reglee sur l'epargne
-- --------------------------------------------------------------------------
create or replace function public.vente_sur_compte_epargne(
  p_vente_id text, p_compte_id text, p_date text, p_description text,
  p_montant integer, p_montant_compte integer,
  p_paiement text default 'compte', p_carat text default null,
  p_type_bijou text default null, p_num_facture text default null,
  p_note_complement text default null, p_espece integer default 0,
  p_poids numeric default 0, p_local numeric default 0, p_importe numeric default 0,
  p_cle uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := app.current_org();
  v_compte record; v_solde int; v_espece int := coalesce(p_espece, 0);
  v_acompte int; v_restant int;
  v_rejeu json;
  v_out   json;
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

  -- Plus aucun refus sous cette ligne.
  v_rejeu := app.geste_reserver(v_org, p_cle, 'vente_sur_compte_epargne');
  if v_rejeu is not null then return v_rejeu; end if;

  -- `client_id` vient du compte : la vente appartient à celle à qui
  -- appartient l'épargne qui la paie.
  insert into public.ventes (
    id, date, client, client_id, description, carat, type_bijou,
    montant, acompte, restant, paye_par_compte,
    paiement, compte_client_id, num_facture, note_complement,
    poids, "local", importe, organisation_id, cle_geste
  ) values (
    p_vente_id, p_date, v_compte.client, v_compte.client_id, p_description,
    p_carat, p_type_bijou,
    p_montant, v_acompte, v_restant, p_montant_compte,
    p_paiement, p_compte_id, p_num_facture, p_note_complement,
    coalesce(p_poids, 0), coalesce(p_local, 0), coalesce(p_importe, 0), v_org, p_cle
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

  v_out := json_build_object('ok', true,
    'vente_id', p_vente_id,
    'paye_par_compte', p_montant_compte,
    'entre_en_caisse', v_espece,
    'acompte', v_acompte,
    'restant', v_restant,
    'nouveau_solde_compte',
      (select solde from public.comptes_clients
        where id = p_compte_id and organisation_id = v_org));
  perform app.geste_resultat(v_org, p_cle, v_out);
  return v_out;
end $function$;

drop function if exists public.vente_sur_compte_epargne(
  text, text, text, text, integer, integer, text, text, text, text, text,
  integer, numeric, numeric, numeric);

revoke all on function public.vente_sur_compte_epargne(
  text, text, text, text, integer, integer, text, text, text, text, text,
  integer, numeric, numeric, numeric, uuid) from public, anon;
grant execute on function public.vente_sur_compte_epargne(
  text, text, text, text, integer, integer, text, text, text, text, text,
  integer, numeric, numeric, numeric, uuid) to authenticated;

-- --------------------------------------------------------------------------
-- 5. portail_depot — un depot depuis le portail cliente
-- --------------------------------------------------------------------------
-- C'est ici que le rejeu est le plus probable de tout le produit : `rpc()`
-- dans js/client.js ABANDONNE a 15 secondes. Le serveur, lui, finit son
-- travail. La cliente voit « le serveur met trop de temps a repondre », son
-- depot est pourtant enregistre — et elle recommence.
--
-- `v_org` vient de la SESSION, jamais d'un parametre : le registre des gestes
-- doit etre range sous la boutique a qui appartient le compte.
create or replace function public.portail_depot(
  p_token uuid, p_compte text, p_montant integer,
  p_note text default null,
  p_cle uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sess   record;
  v_compte record;
  v_solde  integer;
  v_rejeu  json;
  v_out    json;
begin
  select * into v_sess from public.portail_sessions
   where token = p_token and expire_le > now();
  if not found then
    return json_build_object('ok', false, 'erreur', 'Session expirée.');
  end if;

  if p_montant is null or p_montant <= 0 or p_montant > 50000000 then
    return json_build_object('ok', false, 'erreur', 'Montant invalide.');
  end if;

  -- `client = v_nom` est remplacé par `client_id` : une homonyme ne peut
  -- plus déposer sur le compte d'une autre.
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

  -- Plus aucun refus sous cette ligne.
  v_rejeu := app.geste_reserver(v_sess.organisation_id, p_cle, 'portail_depot');
  if v_rejeu is not null then return v_rejeu; end if;

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

  v_out := json_build_object('ok', true, 'nouveau_solde', v_solde);
  perform app.geste_resultat(v_sess.organisation_id, p_cle, v_out);
  return v_out;
end $function$;

drop function if exists public.portail_depot(uuid, text, integer, text);

-- Le portail n'a pas de session Supabase : `anon` est volontaire, l'identite
-- se prouve par le jeton de session DANS la fonction (voir § 1, alertes du
-- linter qui sont normales ici).
revoke all on function public.portail_depot(uuid, text, integer, text, uuid) from public;
grant execute on function public.portail_depot(uuid, text, integer, text, uuid)
  to anon, authenticated;

commit;

-- ============================================================================
-- A VERIFIER APRES APPLICATION — le « succes » ne prouve que la syntaxe
-- ============================================================================
-- 1. Une seule signature par fonction, et le bon search_path :
--
--    select proname, pg_get_function_identity_arguments(oid) as args,
--           array_to_string(proconfig,' | ') as cfg
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname='public'
--       and proname in ('depot_compte_epargne','enregistrer_paiement_vente',
--                       'ouvrir_compte_epargne','vente_sur_compte_epargne',
--                       'portail_depot')
--     order by 1;
--
--    Deux lignes pour un meme nom = l'ancienne signature a survecu, et tout
--    appel nomme echouera sur « function is not unique ».
--
-- 2. Le rejeu rend le MEME resultat et n'ecrit pas deux fois. A rejouer dans
--    une transaction annulee, en comptant avant et apres :
--
--    begin;
--      select count(*) from mouvements_cc where compte_id = 'CC-0001';
--      select depot_compte_epargne('CC-0001', 1000, null, 'essai',
--                                  '11111111-1111-1111-1111-111111111111');
--      select depot_compte_epargne('CC-0001', 1000, null, 'essai',
--                                  '11111111-1111-1111-1111-111111111111');
--      select count(*) from mouvements_cc where compte_id = 'CC-0001';
--    rollback;
--
--    Attendu : les deux appels rendent le meme `nouveau_solde`, et le compte
--    des mouvements n'a monte que de 1.
--
-- 3. Une cle differente ecrit bien, elle : refaire le 2 avec deux cles
--    distinctes doit donner +2 mouvements. Sans ce contre-essai, une fonction
--    qui refuserait TOUT passerait pour idempotente.
--
-- 4. Appeler `definir_pin_client` une fois depuis l'application reste du
--    ressort du § 9 — non touchee ici.
-- ============================================================================
