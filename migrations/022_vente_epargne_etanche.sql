-- ===========================================================================
-- 022 — `vente_sur_compte_epargne()` : étanchéité entre boutiques + poids
-- Écrite le 2026-10-23, à partir du corps réellement en base.
-- ===========================================================================
-- QUATRE DÉFAUTS DANS UNE SEULE FONCTION, tous invisibles avec une boutique.
--
-- 1. LE PLANTAGE (celui qu'on voit)
--      (select solde from comptes_clients where id = p_compte_id)
--    Sous-requête scalaire sans filtre. Deux `CC-0001` → « more than one row
--    returned by a subquery used as an expression ». Depuis le 2026-10-22,
--    plus aucune vente sur épargne ne passe.
--
-- 2. LE CONTRÔLE DE SOLDE FAUX (silencieux)
--      select sum(...) into v_solde from mouvements_cc
--       where compte_id = p_compte_id;
--    Un agrégat ne proteste pas : il additionnait les mouvements des DEUX
--    boutiques. Une boutique pouvait donc dépenser l'épargne de l'autre,
--    puisque le contrôle `p_montant_compte > v_solde` portait sur un solde
--    cumulé qui n'existe nulle part.
--
-- 3. UNE ÉCRITURE CHEZ LA VOISINE (silencieuse, la plus grave)
--      update comptes_clients
--         set solde = (select sum(...) from mouvements_cc
--                       where compte_id = p_compte_id)
--       where id = p_compte_id;
--    Ni la sous-requête ni le `where` ne filtrent. Chaque vente sur épargne
--    ÉCRASAIT donc le solde du compte homonyme de l'autre boutique, avec le
--    total des deux. Corruption de données inter-locataires.
--
-- 4. LE POIDS JAMAIS ENREGISTRÉ
--    L'`insert into ventes` ne portait ni `poids`, ni `local`, ni `importe`.
--    Le stock était déduit juste après par le navigateur : l'or sortait sans
--    laisser de trace dans les ventes. Journal, facture et totaux or
--    sous-estimaient d'autant.
--
-- CE QUI ÉTAIT DÉJÀ CORRECT, et qui n'a pas bougé : la lecture du compte, le
-- contrôle d'unicité de la vente, le rôle, `org_active()`, et le calcul
-- `acompte = montant_compte + espece` de la migration 014.
--
-- SIGNATURE : trois paramètres ajoutés EN FIN, avec valeur par défaut. Les
-- appels existants restent valides. L'ancienne signature à 12 paramètres est
-- supprimée en fin de fichier — sans quoi PostgREST verrait deux surcharges
-- et ne saurait laquelle appeler.
-- ===========================================================================

create or replace function public.vente_sur_compte_epargne(
  p_vente_id text, p_compte_id text, p_date text, p_description text,
  p_montant integer, p_montant_compte integer,
  p_paiement text default 'compte'::text,
  p_carat text default null::text,
  p_type_bijou text default null::text,
  p_num_facture text default null::text,
  p_note_complement text default null::text,
  p_espece integer default 0,
  p_poids numeric default 0,
  p_local numeric default 0,
  p_importe numeric default 0
)
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

  -- Le solde est recalculé depuis l'historique, jamais lu dans la colonne.
  -- DÉFAUT 2 CORRIGÉ : sans `organisation_id`, cette somme additionnait les
  -- mouvements du compte homonyme de l'autre boutique.
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

  -- DÉFAUT 4 CORRIGÉ : le poids accompagne enfin la vente. `local` est un mot
  -- clé SQL, d'où les guillemets.
  insert into public.ventes (
    id, date, client, description, carat, type_bijou,
    montant, acompte, restant, paye_par_compte,
    paiement, compte_client_id, num_facture, note_complement,
    poids, "local", importe, organisation_id
  ) values (
    p_vente_id, p_date, v_compte.client, p_description, p_carat, p_type_bijou,
    p_montant, v_acompte, v_restant, p_montant_compte,
    p_paiement, p_compte_id, p_num_facture, p_note_complement,
    coalesce(p_poids, 0), coalesce(p_local, 0), coalesce(p_importe, 0), v_org
  );

  if p_montant_compte > 0 then
    insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
    values (p_compte_id, p_date, 'retrait', p_montant_compte,
            'Vente ' || p_vente_id || ' — ' || coalesce(p_description,''), v_org);
  end if;

  -- DÉFAUT 3 CORRIGÉ : ni la somme ni le `where` ne filtraient. Chaque vente
  -- écrasait le solde du compte homonyme de l'autre boutique.
  update public.comptes_clients
     set solde = coalesce((select sum(case when type='retrait' then -montant else montant end)
                           from public.mouvements_cc
                          where compte_id = p_compte_id and organisation_id = v_org),0)
   where id = p_compte_id and organisation_id = v_org;

  -- DÉFAUT 1 CORRIGÉ : c'est cette sous-requête qui levait l'erreur.
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

-- L'ancienne signature doit disparaître : deux surcharges rendraient l'appel
-- ambigu pour PostgREST.
drop function if exists public.vente_sur_compte_epargne(
  text, text, text, text, integer, integer, text, text, text, text, text, integer);

revoke all on function public.vente_sur_compte_epargne(
  text, text, text, text, integer, integer, text, text, text, text, text,
  integer, numeric, numeric, numeric) from public, anon;
grant execute on function public.vente_sur_compte_epargne(
  text, text, text, text, integer, integer, text, text, text, text, text,
  integer, numeric, numeric, numeric) to authenticated;


-- ===========================================================================
-- APRÈS APPLICATION — réparer les soldes faussés
-- ===========================================================================
-- Le défaut 3 a pu écraser des soldes dans les deux boutiques. Les
-- recalculer depuis l'historique, qui lui est resté juste :
--
--   update comptes_clients cc
--      set solde = coalesce((
--            select sum(case when m.type='retrait' then -m.montant else m.montant end)
--              from mouvements_cc m
--             where m.compte_id = cc.id
--               and m.organisation_id = cc.organisation_id), 0);
--
--   select id, organisation_id, client, solde from comptes_clients order by id;
--
-- Puis vérifier qu'une vente sur épargne réussit DANS CHAQUE BOUTIQUE, sur
-- son propre CC-0001, sans que le solde de l'autre ne bouge.
-- ===========================================================================
