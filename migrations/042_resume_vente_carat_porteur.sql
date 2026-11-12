-- ============================================================================
-- 042 — Le résumé d'une vente prend le carat de la ligne qui EN A un
-- ============================================================================
-- Defaut trouve le 2026-11-12 en eprouvant la 041, avant tout usage reel.
--
-- CE QUI N'ALLAIT PAS
--
-- La 041 resume une vente a plusieurs lignes en prenant le carat et le type
-- de la ligne LA PLUS LOURDE — « la moins fausse des valeurs uniques pour un
-- graphique pondere par le poids ». Le raisonnement tient, sauf qu'il
-- oubliait le cas le plus banal de cette boutique : **toutes les lignes ne
-- portent pas un carat.**
--
-- Mesure sur les donnees reelles de Saint-Louis : `STK-0001` (« bracelet »,
-- ndiakhass) n'a ni carat ni provenance ; `STK-0002` (« bague ») est en
-- 18k importe. Une facture de 5 g de bracelet et 3 g de bague se resumait
-- donc en `carat = NULL` — et la vente **sortait entierement** du graphique
-- de repartition par carat, alors qu'elle contient bien 3 g d'or 18 k.
--
-- La ligne la plus lourde decidait pour toute la facture, y compris quand
-- elle n'avait rien a en dire.
--
-- LA REGLE CORRIGEE : la ligne la plus lourde **parmi celles qui portent un
-- carat**. Si aucune n'en porte, le resume reste a NULL — c'est alors exact.
-- Meme regle pour `type_bijou`.
--
-- POURQUOI UNE FONCTION A PART
--
-- Le resume etait calcule en ligne dans `enregistrer_vente()`. Il devra
-- l'etre aussi le jour ou une facture se modifie, ou qu'une ligne se
-- supprime. Recopie, ce calcul aurait fini par diverger — c'est exactement
-- « une table, trois fonctions d'ecriture » du § 2, vecu deux fois sur
-- `annulee` puis `origine_type`.
--
-- `app.vente_resumer()` est donc desormais LE seul endroit ou le resume de
-- `ventes` se fabrique. Elle est dans le schema `app` et revoquee de tout le
-- monde : elle ne verifie aucun role, parce qu'elle n'est appelable que
-- depuis une fonction qui l'a deja fait.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Le résumé, au même endroit pour toujours
-- --------------------------------------------------------------------------
create or replace function app.vente_resumer(p_org uuid, p_vente_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.ventes v
     set poids   = agg.poids,
         "local" = agg.local,
         importe = agg.importe,
         carat       = agg.carat,
         type_bijou  = agg.type_bijou,
         description = agg.description
    from (
      select sum(l.poids)   as poids,
             sum(l.local)   as local,
             sum(l.importe) as importe,
             -- `(l.carat is null)` d'abord : false trie avant true, donc une
             -- ligne QUI PORTE un carat passe devant une ligne qui n'en a
             -- pas, quel que soit le poids. Puis la plus lourde d'entre
             -- elles. Sans ce premier critere, une ligne sans carat mais
             -- plus lourde faisait sortir la vente entiere du graphique.
             (array_agg(l.carat
                order by (l.carat is null), l.poids desc nulls last, l.ligne))[1] as carat,
             (array_agg(l.type_bijou
                order by (l.type_bijou is null), l.poids desc nulls last, l.ligne))[1] as type_bijou,
             case when count(*) = 1
                  then (array_agg(l.description order by l.ligne))[1]
                  else (array_agg(l.description order by l.ligne))[1]
                       || ' + ' || (count(*) - 1) || ' autre'
                       || case when count(*) > 2 then 's' else '' end || ' article'
                       || case when count(*) > 2 then 's' else '' end
             end as description
        from public.vente_lignes l
       where l.organisation_id = p_org and l.vente_id = p_vente_id
    ) agg
   where v.organisation_id = p_org and v.id = p_vente_id;
end $fn$;

revoke all on function app.vente_resumer(uuid, text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. `enregistrer_vente()` délègue son résumé
-- --------------------------------------------------------------------------
-- Seul le bloc de résumé change ; tout le reste est celui de la 041.
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
  if v_acompte < 0 or v_acompte > v_total then
    return json_build_object('ok', false, 'erreur',
      'L''acompte ne peut pas dépasser le total.');
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

  -- LE RÉSUMÉ — un seul endroit, désormais.
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

-- --------------------------------------------------------------------------
-- 3. Recaler les ventes déjà reprises par la 041
-- --------------------------------------------------------------------------
-- Elles n'ont qu'une ligne, donc leur résumé est déjà juste. On le rejoue
-- quand même : c'est gratuit, et cela prouve que la fonction tourne sur les
-- données réelles au lieu de n'être vérifiée que sur un essai.
do $recaler$
declare r record;
begin
  for r in select organisation_id, id from public.ventes loop
    perform app.vente_resumer(r.organisation_id, r.id);
  end loop;
end $recaler$;

commit;

-- ============================================================================
-- A VERIFIER APRES APPLICATION
-- ============================================================================
-- Dans une transaction annulee, sous l'identite d'une vendeuse :
--
--   une facture de 5 g SANS carat + 3 g en 18k-importe
--     -> `ventes.carat` doit valoir '18k-importe', et non NULL.
--
--   une facture dont AUCUNE ligne ne porte de carat
--     -> `ventes.carat` doit rester NULL. C'est exact, pas un defaut.
--
-- Et sur les donnees reelles, apres le recalage du § 3 : aucune vente ne doit
-- avoir change de montant, et le nombre de ventes par carat doit etre le meme
-- qu'avant la 041 — les 23 ventes reprises n'ont qu'une ligne chacune.
-- ============================================================================
