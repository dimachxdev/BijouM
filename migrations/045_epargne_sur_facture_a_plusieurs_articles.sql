-- ============================================================================
-- 045 — Régler une facture entière sur l'épargne, pas un seul article
-- ============================================================================
-- Demande le 2026-11-13 : « pour l'achat avec compte client on peut tout
-- deduire apres le montant Total au lieu de le limiter sur un article ».
--
-- C'est l'etape 4 annoncee le 2026-11-12 et volontairement remise : la 041
-- avait ferme `paiement = 'compte'` dans `enregistrer_vente()`, et l'ecran
-- refusait l'epargne des la deuxieme ligne. Un refus clair valait mieux
-- qu'une facture dont deux articles sur trois auraient disparu.
--
-- POURQUOI `enregistrer_vente()` ET NON `vente_sur_compte_epargne()`
--
-- Les deux chemins etaient possibles, et le mauvais etait tentant :
--
--   a) apprendre les LIGNES a `vente_sur_compte_epargne()` — il aurait fallu
--      y recopier la validation des lignes, le mode de la boutique, la
--      disponibilite agregee par article et la deduction du stock. Soit
--      DEUX endroits qui ecrivent `vente_lignes` et deduisent le stock :
--      exactement « une table, trois fonctions d'ecriture » (§ 2), le piege
--      qui a deja coute `annulee` puis `origine_type` a ce projet.
--
--   b) apprendre l'EPARGNE a `enregistrer_vente()`. Le risque miroir serait
--      deux endroits qui debitent un compte de cliente — pire encore,
--      puisque c'est de l'argent qui ne nous appartient pas.
--
-- D'ou le choix : (b), mais avec le debit EXTRAIT dans `app.debiter_epargne()`.
-- Il n'y a donc toujours qu'un seul endroit qui ecrit une ligne de vente, et
-- desormais un seul endroit qui retire de l'argent d'un compte.
--
-- `vente_sur_compte_epargne()` N'EST PAS TOUCHEE. Elle est listee au § 9
-- parmi les fonctions « verifiees correctes et a ne pas rouvrir par
-- symetrie », et la reecrire pour qu'elle utilise le nouvel assistant serait
-- precisement cela.
--
-- ET ELLE GARDE DEUX APPELANTS — verifie, pas suppose. J'avais d'abord ecrit
-- qu'elle deviendrait sans emploi ; un `grep` dit le contraire :
--
--   `cloturerCompteClient()`  — convertit un solde en vente
--   `_validerAjustCC()`       — un retrait enregistre comme vente
--
-- Ces deux-la ne vendent AUCUNE marchandise : ce sont des gestes comptables
-- qui s'ecrivent dans `ventes`. Les faire passer par `enregistrer_vente()`
-- obligerait a y rouvrir la regle « toute ligne vient de l'inventaire »
-- (migration 043) pour deux cas qui n'ont pas d'article du tout. Elle reste
-- donc en service, et pour ces deux chemins seulement.
--
-- CE QUE LE SERVEUR CALCULE, ET NE CROIT PLUS
--
-- Sur ce chemin l'acompte n'est plus celui qu'envoie le navigateur : il vaut
-- `part sur le compte + complement verse aujourd'hui`. Le laisser au
-- navigateur aurait permis d'annoncer une vente soldee en ne prelevant rien.
-- Meme raison que le total, calcule depuis les lignes depuis la 041.
--
-- ET L'IDENTITE NE SE RE-SAISIT PAS
--
-- La cliente de la vente doit etre celle du compte. On ne prend pas
-- silencieusement l'une ou l'autre : **on refuse si elles different.** Prendre
-- celle du compte masquerait une vendeuse qui s'est trompee de compte ;
-- prendre celle de la vente debiterait l'epargne de quelqu'un d'autre.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Le solde, lu au seul endroit qui fasse foi : l'historique
-- --------------------------------------------------------------------------
-- `comptes_clients.solde` est une valeur rangee ; les mouvements sont la
-- verite. Les fonctions d'epargne recalculent toutes depuis l'historique —
-- cet assistant ne fait que nommer ce calcul.
create or replace function app.solde_epargne(p_org uuid, p_compte_id text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(sum(case when type = 'retrait' then -montant else montant end), 0)::integer
    from public.mouvements_cc
   where compte_id = p_compte_id and organisation_id = p_org;
$fn$;

revoke all on function app.solde_epargne(uuid, text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. Le débit — le SEUL endroit qui retire de l'argent d'un compte
-- --------------------------------------------------------------------------
-- Aucun contrôle de rôle ici : il n'est appelable que depuis une fonction
-- `SECURITY DEFINER` qui les a déjà faits, et il est révoqué de tout le monde.
-- Aucun contrôle de solde non plus : le refus doit se produire AU-DESSUS de
-- la réservation de clé de geste, donc chez l'appelant (§ 2).
create or replace function app.debiter_epargne(
  p_org       uuid,
  p_compte_id text,
  p_montant   integer,
  p_date      text,
  p_note      text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if coalesce(p_montant, 0) > 0 then
    insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
    values (p_compte_id, p_date, 'retrait', p_montant, p_note, p_org);
  end if;

  -- Le solde rangé se recale depuis l'historique, jamais par soustraction :
  -- une soustraction sur une valeur déjà fausse la garde fausse.
  update public.comptes_clients
     set solde = app.solde_epargne(p_org, p_compte_id)
   where id = p_compte_id and organisation_id = p_org;

  return app.solde_epargne(p_org, p_compte_id);
end $fn$;

revoke all on function app.debiter_epargne(uuid, text, integer, text, text)
  from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. `enregistrer_vente()` accepte l'épargne
-- --------------------------------------------------------------------------
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
  -- L'épargne (migration 045)
  v_cc      text    := nullif(trim(p_vente ->> 'compteId'), '');
  v_mc      integer := coalesce((p_vente ->> 'montantCompte')::integer, 0);
  v_esp     integer := coalesce((p_vente ->> 'espece')::integer, 0);
  v_solde   integer;
  v_compte  record;
  v_total   integer := 0;
  v_nb      integer;
  v_id      text;
  v_fac     text;
  v_gere    boolean;
  v_poids   boolean;
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

  select coalesce(o.gestion_stock, true), coalesce(o.stock_par_poids, true)
    into v_gere, v_poids
    from public.organisations o where o.id = v_org;
  v_gere  := coalesce(v_gere, true);
  v_poids := coalesce(v_poids, true);

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

  -- L'ÉPARGNE. Les deux sens sont vérifiés : un code `compte…` sans compte
  -- écrirait une vente payée avec de l'argent jamais prélevé ; un compte sans
  -- code `compte…` prélèverait sans que la facture le dise.
  if v_cc is null and v_paie like 'compte%' then
    return json_build_object('ok', false, 'erreur',
      'Paiement sur épargne demandé sans compte.');
  end if;
  if v_cc is not null then
    if v_paie not like 'compte%' then
      return json_build_object('ok', false, 'erreur',
        'Un compte épargne est fourni mais le moyen de paiement ne le dit pas.');
    end if;

    select * into v_compte from public.comptes_clients
     where id = v_cc and organisation_id = v_org and actif;
    if not found then
      return json_build_object('ok', false, 'erreur',
        'Compte épargne introuvable ou clôturé.');
    end if;

    -- Une identité qui se propage ne se re-saisit pas — et quand les deux
    -- sources divergent, on REFUSE plutôt que d'en choisir une (§ 1).
    if coalesce(v_compte.client_id, '') <> v_cli then
      return json_build_object('ok', false, 'erreur',
        'Ce compte épargne n''appartient pas à la cliente choisie.');
    end if;

    if v_mc < 0 or v_esp < 0 then
      return json_build_object('ok', false, 'erreur',
        'Les montants versés ne peuvent pas être négatifs.');
    end if;

    v_solde := app.solde_epargne(v_org, v_cc);
    if v_mc > v_solde then
      return json_build_object('ok', false, 'erreur',
        'Solde insuffisant : ' || v_solde || ' disponible, ' || v_mc || ' demandé.');
    end if;
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
    if v_gere and e.stock_ref is null then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : choisissez un article de l''inventaire.');
    end if;
    if not v_gere and e.stock_ref is not null then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : cette boutique ne gère pas de stock.');
    end if;
    if v_gere and not v_poids and e.poids > 0 then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : cette boutique compte son stock en pièces, '
        || 'pas en grammes.');
    end if;
    if e.montant < 0 then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : le montant ne peut pas être négatif.');
    end if;
    if e.poids < 0 or e.nb_articles < 0 then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : poids et nombre d''articles ne peuvent pas être négatifs.');
    end if;
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

  -- L'ACOMPTE SE CALCULE sur le chemin épargne : la part prise sur le compte
  -- plus ce que la cliente verse aujourd'hui. Le croire sur parole aurait
  -- permis d'annoncer une vente soldée sans rien prélever.
  if v_cc is not null then
    v_acompte := v_mc + v_esp;
  end if;
  if v_acompte < 0 or v_acompte > v_total then
    return json_build_object('ok', false, 'erreur',
      'Le total versé dépasse le prix de la facture.');
  end if;

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
     poids, local, importe, compte_client_id, paye_par_compte)
  values
    (v_id, v_date, v_nom, v_cli, '(lignes)', v_paie, v_total, v_acompte,
     v_total - v_acompte, v_fac, v_note, v_org, p_cle, 0, 0, 0,
     v_cc, case when v_cc is null then 0 else v_mc end);

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

  -- LE DÉBIT, par le seul endroit qui retire de l'argent d'un compte. Le
  -- solde a été vérifié au-dessus de la réservation ; ici on écrit.
  if v_cc is not null and v_mc > 0 then
    v_solde := app.debiter_epargne(v_org, v_cc, v_mc, v_date,
                 'Vente ' || v_id || ' — '
                 || (select description from public.ventes
                      where organisation_id = v_org and id = v_id));
  end if;

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
                             'restant', v_total - v_acompte, 'lignes', v_nb,
                             'paye_par_compte', case when v_cc is null then 0 else v_mc end,
                             'entre_en_caisse', case when v_cc is null then null else v_esp end,
                             'nouveau_solde_compte', v_solde);
  perform app.geste_resultat(v_org, p_cle, v_out);
  return v_out;
end $fn$;

revoke all on function public.enregistrer_vente(json, json, uuid) from public, anon;
grant execute on function public.enregistrer_vente(json, json, uuid) to authenticated;

commit;

-- ============================================================================
-- A VERIFIER APRES APPLICATION — sous l'identite d'une vendeuse, transaction
-- annulee a chaque fois.
-- ============================================================================
-- 1. TROIS ARTICLES ENTIEREMENT SUR L'EPARGNE — la demande elle-meme.
--    Relever le solde avant, enregistrer, relever apres : la baisse doit
--    egaler le TOTAL de la facture, pas le prix d'un article.
--
-- 2. Solde insuffisant : refus avec le solde disponible dans le message, et
--    AUCUNE ecriture — ni vente, ni ligne, ni mouvement.
--
-- 3. COMPLEMENT : 3 articles, part sur le compte + part en especes, le reste
--    du. `acompte` doit valoir part + complement, `paye_par_compte` la part
--    seule, et `restant` la difference. Le serveur IGNORE l'acompte envoye.
--
-- 4. Le compte d'une AUTRE cliente est refuse — c'est le controle qui evite
--    de debiter l'epargne de quelqu'un d'autre.
--
-- 5. Un code `compte` sans compteId est refuse, et un compteId avec un code
--    qui ne dit pas `compte` aussi : les deux sens.
--
-- 6. Le stock est deduit comme sur le chemin especes, et un stock
--    insuffisant annule TOUT, mouvement d'epargne compris.
--
-- 7. Rejeu de la meme clef : meme resultat, et le solde n'a baisse QU'UNE
--    FOIS. C'est l'essai le plus important de cette migration.
-- ============================================================================
