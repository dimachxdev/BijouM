-- ============================================================================
-- 043 — En édition complète, toute ligne vient de l'inventaire
-- ============================================================================
-- Demande le 2026-11-12, en remplacement de la decision prise le matin meme
-- (041 : « une ligne peut etre LIBRE — gravure, frais de facon, bijou hors
-- inventaire »). Vue a l'ecran, elle a ete retiree.
--
-- LA REGLE EST CELLE DU MODE DE LA BOUTIQUE, PAS CELLE DE L'ECRAN
--
-- « Plus de ligne libre » ne peut pas valoir partout : en edition SIMPLE il
-- n'y a pas d'inventaire du tout (migration 038), donc toute ligne y est
-- forcement libre — l'imposer depuis le stock rendrait la facturation
-- impossible dans ces boutiques.
--
-- D'ou la regle, qui se lit sur `organisations.gestion_stock` :
--
--   gestion_stock = true   -> chaque ligne DOIT porter un `stock_ref`
--   gestion_stock = false  -> aucune ligne ne peut en porter, et chacune
--                             exige sa description
--
-- C'est le meme drapeau qui gouverne deja `peutAcceder()`, `deduireStock()`
-- et le formulaire de vente (§ 6 ter). Un quatrieme point de bascule, pas
-- une quatrieme verite.
--
-- POURQUOI EN SQL ET PAS SEULEMENT DANS LE FORMULAIRE
--
-- Regle d'or : « Le navigateur ne decide d'aucune autorisation. PostgreSQL
-- decide. » Retirer l'option de l'ecran ne retire rien : `enregistrer_vente()`
-- est une route HTTP, et un corps de requete sans `stockRef` passait.
-- Le contrele est donc ici, et l'ecran n'en est que le confort.
--
-- CE QUE CELA COUTE, ET IL FAUT LE SAVOIR
--
-- Une gravure, des frais de facon, un bijou rapporte par la cliente : ils ne
-- peuvent plus figurer sur une facture d'edition complete sans exister comme
-- article d'inventaire. C'est une consequence directe, pas un effet de bord.
--
-- CE QUI NE CHANGE PAS
--
-- Les lignes DEJA ECRITES sans `stock_ref` restent telles quelles — les 23
-- ventes reprises par la 041 en font partie, et leur facture doit continuer
-- de s'imprimer. La contrainte est dans la fonction, pas sur la table : une
-- contrainte de colonne aurait refuse l'historique.
-- ============================================================================

begin;

create or replace function public.enregistrer_vente(
  p_vente  json,
  p_lignes json,
  p_cle    uuid default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org     uuid := app.current_org();
  v_rejeu   json;
  v_out     json;
  v_cli     text    := nullif(trim(p_vente ->> 'clientId'), '');
  v_nom     text;
  v_date    text    := coalesce(nullif(p_vente ->> 'date', ''),
                                to_char(now(), 'YYYY-MM-DD'));
  v_paie    text    := coalesce(nullif(p_vente ->> 'paiement', ''), 'especes');
  v_acompte integer := coalesce((p_vente ->> 'acompte')::integer, 0);
  v_note    text    := nullif(p_vente ->> 'noteComplement', '');
  v_total   integer := 0;
  v_nb      integer;
  v_id      text;
  v_fac     text;
  v_gere    boolean;
  e         record;
  s         record;
  v_prov    text;
  v_desc    text;
begin
  if v_org is null
     or not app.has_role('proprietaire','admin','gestionnaire','vendeur') then
    return json_build_object('ok', false, 'erreur', 'Non autorisé.');
  end if;
  if not app.org_active() then
    return json_build_object('ok', false, 'erreur',
      'Abonnement expiré ou boutique suspendue : la saisie est fermée.');
  end if;

  -- Le mode de la boutique décide de ce qu'une ligne a le droit d'être.
  -- `true` par défaut, comme `gereLeStock()` côté navigateur : une colonne
  -- qu'on n'aurait pas lue ne doit pas ouvrir la saisie libre en silence.
  select coalesce(o.gestion_stock, true) into v_gere
    from public.organisations o where o.id = v_org;
  v_gere := coalesce(v_gere, true);

  if v_cli is null then
    return json_build_object('ok', false, 'erreur', 'Choisissez la cliente.');
  end if;
  select c.nom into v_nom
    from public.clients c
   where c.organisation_id = v_org and c.id = v_cli;
  if v_nom is null then
    return json_build_object('ok', false, 'erreur',
      'Cliente introuvable dans cette boutique : ' || v_cli);
  end if;

  if v_paie = 'compte' then
    return json_build_object('ok', false, 'erreur',
      'Une vente réglée sur l''épargne passe par vente_sur_compte_epargne().');
  end if;

  if p_lignes is null or json_typeof(p_lignes) <> 'array'
     or json_array_length(p_lignes) = 0 then
    return json_build_object('ok', false, 'erreur',
      'Une facture porte au moins un article.');
  end if;
  if json_array_length(p_lignes) > 50 then
    return json_build_object('ok', false, 'erreur',
      'Cinquante articles au maximum sur une facture.');
  end if;

  for e in
    select (x.value ->> 'description')                            as description,
           nullif(x.value ->> 'stockRef', '')                     as stock_ref,
           coalesce((x.value ->> 'poids')::double precision, 0)   as poids,
           coalesce((x.value ->> 'nbArticles')::integer, 0)       as nb_articles,
           coalesce((x.value ->> 'montant')::integer, 0)          as montant,
           x.ord                                                  as ligne
      from json_array_elements(p_lignes) with ordinality x(value, ord)
  loop
    -- LA REGLE DE LA 043, dans les deux sens.
    if v_gere and e.stock_ref is null then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : choisissez un article de l''inventaire.');
    end if;
    if not v_gere and e.stock_ref is not null then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : cette boutique ne gère pas de stock.');
    end if;

    if e.montant < 0 then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : le montant ne peut pas être négatif.');
    end if;
    if e.poids < 0 or e.nb_articles < 0 then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : poids et nombre d''articles ne peuvent pas être négatifs.');
    end if;
    -- Ne concerne plus que l'édition simple, où la description REMPLACE
    -- l'article et s'imprime seule sur la facture.
    if e.stock_ref is null and coalesce(trim(e.description), '') = '' then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : décrivez l''article — c''est ce qui s''imprime sur la facture.');
    end if;
    v_total := v_total + e.montant;
  end loop;

  if v_total <= 0 then
    return json_build_object('ok', false, 'erreur',
      'Le total de la facture doit être supérieur à zéro.');
  end if;
  if v_acompte < 0 or v_acompte > v_total then
    return json_build_object('ok', false, 'erreur',
      'L''acompte ne peut pas dépasser le total.');
  end if;

  -- Disponibilité du stock, AGRÉGÉE PAR ARTICLE : deux lignes qui, prises
  -- ensemble, dépassent le stock passaient si on vérifiait ligne par ligne.
  for e in
    select nullif(x.value ->> 'stockRef', '')                        as ref,
           sum(coalesce((x.value ->> 'poids')::double precision, 0)) as poids,
           sum(coalesce((x.value ->> 'nbArticles')::integer, 0))     as nb
      from json_array_elements(p_lignes) x
     where nullif(x.value ->> 'stockRef', '') is not null
     group by 1
  loop
    select st.nom, st.poids_total_g, st.qty into s
      from public.stock st
     where st.organisation_id = v_org and st.ref = e.ref;
    if not found then
      return json_build_object('ok', false, 'erreur',
        'Article introuvable dans l''inventaire : ' || e.ref);
    end if;
    if e.poids > coalesce(s.poids_total_g, 0) then
      return json_build_object('ok', false, 'erreur',
        'Poids insuffisant pour ' || coalesce(s.nom, e.ref) || ' (disponible : '
        || round(coalesce(s.poids_total_g,0)::numeric, 2) || ' g).');
    end if;
    if e.nb > coalesce(s.qty, 0) then
      return json_build_object('ok', false, 'erreur',
        'Articles insuffisants pour ' || coalesce(s.nom, e.ref) || ' (disponible : '
        || coalesce(s.qty, 0) || ').');
    end if;
  end loop;

  -- Plus aucun refus sous cette ligne.
  v_rejeu := app.geste_reserver(v_org, p_cle, 'enregistrer_vente');
  if v_rejeu is not null then return v_rejeu; end if;

  v_id  := public.prochain_id('v',   'V',   4);
  v_fac := public.prochain_id('fac', 'FAC', 4);

  insert into public.ventes
    (id, date, client, client_id, description, paiement, montant, acompte,
     restant, num_facture, note_complement, organisation_id, cle_geste,
     poids, local, importe)
  values
    (v_id, v_date, v_nom, v_cli, '(lignes)', v_paie, v_total, v_acompte,
     v_total - v_acompte, v_fac, v_note, v_org, p_cle, 0, 0, 0);

  for e in
    select (x.value ->> 'description')                            as description,
           nullif(x.value ->> 'stockRef', '')                     as stock_ref,
           nullif(x.value ->> 'typeBijou', '')                    as type_bijou,
           nullif(x.value ->> 'carat', '')                        as carat,
           nullif(x.value ->> 'provenance', '')                   as provenance,
           coalesce((x.value ->> 'poids')::double precision, 0)   as poids,
           coalesce((x.value ->> 'nbArticles')::integer, 0)       as nb_articles,
           coalesce((x.value ->> 'montant')::integer, 0)          as montant,
           x.ord                                                  as ligne
      from json_array_elements(p_lignes) with ordinality x(value, ord)
  loop
    if e.stock_ref is not null then
      select st.nom, st.type_bijou, st.carat, st.provenance into s
        from public.stock st
       where st.organisation_id = v_org and st.ref = e.stock_ref;
      v_desc := coalesce(nullif(trim(e.description), ''), s.nom, e.stock_ref);
      v_prov := s.provenance;
      insert into public.vente_lignes
        (organisation_id, vente_id, ligne, stock_ref, description,
         type_bijou, carat, poids, local, importe, nb_articles, montant)
      values
        (v_org, v_id, e.ligne, e.stock_ref, v_desc,
         s.type_bijou, s.carat, e.poids,
         case when v_prov = 'local'   then e.poids else 0 end,
         case when v_prov = 'importe' then e.poids else 0 end,
         e.nb_articles, e.montant);
    else
      insert into public.vente_lignes
        (organisation_id, vente_id, ligne, stock_ref, description,
         type_bijou, carat, poids, local, importe, nb_articles, montant)
      values
        (v_org, v_id, e.ligne, null, trim(e.description),
         e.type_bijou, e.carat, e.poids,
         case when e.provenance = 'local'   then e.poids else 0 end,
         case when e.provenance = 'importe' then e.poids else 0 end,
         e.nb_articles, e.montant);
    end if;
  end loop;

  select count(*) into v_nb
    from public.vente_lignes
   where organisation_id = v_org and vente_id = v_id;

  perform app.vente_resumer(v_org, v_id);

  for e in
    select l.stock_ref as ref, sum(l.poids) as poids, sum(l.nb_articles) as nb
      from public.vente_lignes l
     where l.organisation_id = v_org and l.vente_id = v_id
       and l.stock_ref is not null
     group by l.stock_ref
  loop
    update public.stock st
       set poids_total_g = coalesce(st.poids_total_g, 0) - e.poids,
           qty           = coalesce(st.qty, 0) - e.nb,
           updated_at    = now()
     where st.organisation_id = v_org and st.ref = e.ref
       and coalesce(st.poids_total_g, 0) >= e.poids
       and coalesce(st.qty, 0)           >= e.nb;
    if not found then
      raise exception
        'Stock devenu insuffisant pour % pendant l''enregistrement. Rien n''a été écrit.',
        e.ref;
    end if;
  end loop;

  v_out := json_build_object('ok', true, 'id', v_id, 'numFacture', v_fac,
                             'montant', v_total, 'acompte', v_acompte,
                             'restant', v_total - v_acompte, 'lignes', v_nb);
  perform app.geste_resultat(v_org, p_cle, v_out);
  return v_out;
end $fn$;

revoke all on function public.enregistrer_vente(json, json, uuid) from public, anon;
grant execute on function public.enregistrer_vente(json, json, uuid) to authenticated;

commit;

-- ============================================================================
-- A VERIFIER APRES APPLICATION
-- ============================================================================
-- Sous l'identite d'une vendeuse, dans une transaction annulee :
--
--   1. BOUTIQUE EN EDITION COMPLETE — une ligne sans article doit etre
--      refusee, meme avec une description :
--        select public.enregistrer_vente(
--          '{"clientId":"CL-0023","paiement":"especes"}'::json,
--          '[{"description":"Gravure","montant":5000}]'::json, gen_random_uuid());
--      -> « Ligne 1 : choisissez un article de l'inventaire. »
--
--   2. Et une ligne AVEC article doit toujours passer.
--
--   3. BOUTIQUE EN EDITION SIMPLE (basculer_gestion_stock(org, false)) —
--      l'inverse : une ligne libre passe, une ligne avec `stockRef` est
--      refusee. C'est l'essai qui compte : sans lui, la regle serait
--      « plus de vente du tout » dans ces boutiques.
--
--   4. Les factures ANCIENNES, dont les 23 lignes reprises par la 041 sans
--      `stock_ref`, doivent continuer de s'imprimer : la contrainte est dans
--      la fonction, pas sur la table.
-- ============================================================================
