-- ============================================================================
-- 041 — Plusieurs articles sur une même facture
-- ============================================================================
-- Demande le 2026-11-12. Jusqu'ici une vente = une ligne de `ventes` = un
-- article = une facture.
--
-- CE QUI A DECIDE DU MODELE : OU VIT L'ARGENT
--
-- Les 26 colonnes de `ventes` se separent en deux familles :
--
--   l'argent       montant, acompte, restant, paiement, compte_client_id,
--                  paye_par_compte, annulee, num_facture
--   la marchandise description, type_bijou, carat, poids, local, importe
--
-- Une facture a UN total, UN acompte, UN restant, UN moyen de paiement. Elle
-- a PLUSIEURS marchandises. La marchandise sort donc de la ligne de vente ;
-- l'argent y reste.
--
-- La voie courte — plusieurs lignes de `ventes` partageant un numero de
-- facture — a ete examinee et ECARTEE. Elle eclate l'argent : un acompte de
-- 200 000 F sur trois articles n'a aucune repartition naturelle,
-- `enregistrer_paiement_vente()` vise UNE vente, `vente_sur_compte_epargne()`
-- debite UNE vente, et le « restant du » par ligne — qui sert de preuve de
-- creance dans `supprimer_boutique()` — devient une fiction. C'est la voie la
-- moins chere a ecrire et la seule qui fausse les comptes. Ne pas y revenir.
--
-- CE QUE CETTE MIGRATION CORRIGE EN PASSANT
--
-- 1. `ventes` ne portait AUCUNE reference d'article. On deduisait le stock et
--    on ne savait plus, apres coup, de quel article venait la vente.
--    `vente_lignes.stock_ref` le trace enfin.
--
-- 2. Le navigateur enchainait `prochain_id()` -> `deduireStock()` ->
--    `upsert ventes` : trois allers-retours NON ATOMIQUES. Avec trois
--    articles ce serait cinq, et une panne au milieu laissait du stock deduit
--    sans vente, ou une vente avec deux lignes sur trois. Tout passe
--    desormais par UNE fonction, donc UNE transaction.
--
-- 3. Dans le chemin especes, `deduireStock()` tournait AVANT l'ecriture de la
--    vente — l'inverse du chemin epargne. Signale le 2026-11-04, ferme ici.
--
-- 4. Un echec ne consomme plus de numero : `prochain_id()` etant appele DANS
--    la transaction, un rollback lui rend sa valeur. Deux postes simultanes
--    ne se marchent pas dessus pour autant — le `update compteurs` pose un
--    verrou de ligne, le second attend et reprend le numero seulement si le
--    premier a vraiment echoue.
--
-- DECISIONS PRISES AVEC LE DEMANDEUR, le 2026-11-12
--
--   — Le prix est PAR ARTICLE, et le total est leur somme. Le total envoye
--     par le navigateur est donc ignore : il est recalcule ici (§ « Valider
--     dans la fonction, pas seulement dans le formulaire »).
--   — Une ligne peut etre LIBRE (gravure, frais de facon, bijou hors
--     inventaire) : `stock_ref` a NULL. Elle exige alors une description.
--   — Premiere etape : la vente au comptant. La vente reglee sur l'epargne et
--     la commande avec acompte restent a un article jusqu'a nouvel ordre, et
--     `vente_sur_compte_epargne()` n'est PAS touchee ici.
--
-- CE QUI RESTE VRAI SUR `ventes`, ET POURQUOI
--
-- Les colonnes de marchandise de `ventes` ne disparaissent pas : elles
-- deviennent un RESUME CALCULE a partir des lignes — somme des poids, carat
-- de la ligne la plus lourde, description abregee. Environ 75 lectures dans
-- `js/` en dependent (journal, tableau de bord, export, portail cliente) ;
-- les basculer toutes d'un coup serait la meilleure facon de casser un ecran
-- sans s'en apercevoir.
--
-- Ce resume n'est PAS une seconde verite : il a le meme statut que
-- `restant = montant - acompte`, deja stocke. Il n'est jamais saisi, toujours
-- ecrit par cette fonction, et recalcule a partir des lignes.
--
-- A FAIRE PLUS TARD, ET C'EST VOLONTAIREMENT HORS DE CETTE MIGRATION :
-- retirer ces colonnes du `grant update` d'`authenticated`, comme la 027 l'a
-- fait pour `plan` et `actif`. Aujourd'hui la fenetre « Modifier une vente »
-- les ecrit encore en direct par PostgREST ; les verrouiller maintenant
-- casserait le seul ecran de correction. A faire le jour ou cette fenetre
-- passera elle aussi par une fonction.
--
-- UNE APPROXIMATION ASSUMEE : une vente a carats melanges est rangee sous le
-- carat de sa ligne la plus lourde dans le graphique de repartition, tant que
-- celui-ci lit `ventes.carat`. C'est la moins fausse des valeurs uniques.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. La table des lignes
-- --------------------------------------------------------------------------
-- Cle etrangere COMPOSEE : sur `vente_id` seul, une ligne pourrait pointer la
-- vente d'une autre boutique — `V-0001` existe partout (§ 1).
create table if not exists public.vente_lignes (
  organisation_id uuid     not null default app.current_org(),
  vente_id        text     not null,
  ligne           smallint not null,
  stock_ref       text,                       -- NULL = ligne libre
  description     text     not null,
  type_bijou      text,
  carat           text,
  poids           double precision not null default 0,
  local           double precision not null default 0,
  importe         double precision not null default 0,
  nb_articles     integer  not null default 0,
  montant         integer  not null default 0,
  created_at      timestamptz not null default now(),
  primary key (organisation_id, vente_id, ligne),
  foreign key (organisation_id, vente_id)
    references public.ventes (organisation_id, id) on delete cascade
);

comment on table public.vente_lignes is
  'La marchandise d''une facture, une ligne par article. L''argent reste sur '
  '`ventes`. Ecrite uniquement par enregistrer_vente(). Voir migration 041.';

create index if not exists vente_lignes_vente_idx
  on public.vente_lignes (organisation_id, vente_id);
create index if not exists vente_lignes_stock_idx
  on public.vente_lignes (organisation_id, stock_ref)
  where stock_ref is not null;

alter table public.vente_lignes enable row level security;

-- LECTURE SEULE pour l'application. L'ecriture passe par la fonction, pas par
-- une permission — « Besoin d'une ecriture pour un role qui ne l'a pas ?
-- Ajouter une fonction, pas une permission » (§ 1).
--
-- La suppression en cascade depuis `ventes` fonctionne malgre tout : les
-- declencheurs d'integrite referentielle s'executent avec les droits du
-- proprietaire de la table et ne sont pas soumis aux policies.
drop policy if exists vente_lignes_sel on public.vente_lignes;
create policy vente_lignes_sel on public.vente_lignes
  for select using (organisation_id = app.current_org());

revoke all on table public.vente_lignes from public, anon, authenticated;
grant select on table public.vente_lignes to authenticated;

-- --------------------------------------------------------------------------
-- 2. Reprise de l'existant — chaque vente devient sa ligne n° 1
-- --------------------------------------------------------------------------
-- Sans elle, les ecrans qui liront les lignes trouveraient les ventes d'avant
-- le 2026-11-12 vides de marchandise. `on conflict do nothing` rend la
-- migration rejouable.
insert into public.vente_lignes
  (organisation_id, vente_id, ligne, stock_ref, description,
   type_bijou, carat, poids, local, importe, nb_articles, montant)
select v.organisation_id, v.id, 1, null,
       coalesce(nullif(trim(v.description), ''), 'Article'),
       v.type_bijou, v.carat,
       coalesce(v.poids, 0), coalesce(v.local, 0), coalesce(v.importe, 0),
       0, coalesce(v.montant, 0)
  from public.ventes v
on conflict (organisation_id, vente_id, ligne) do nothing;

-- --------------------------------------------------------------------------
-- 3. Enregistrer une vente — une transaction, une clef de geste
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

  -- La cliente : par son IDENTIFIANT, et dans CETTE boutique. `CL-0001`
  -- existe dans chaque boutique (§ 1).
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

  -- Ce chemin ne touche pas l'épargne. La vente réglée sur un compte passe
  -- par `vente_sur_compte_epargne()`, qui débite le compte dans la même
  -- transaction — l'autoriser ici écrirait une vente payée avec de l'argent
  -- qui n'aurait jamais quitté le compte.
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

  -- Validation ligne à ligne, et LE TOTAL EST CALCULÉ ICI. Celui qu'envoie
  -- le navigateur n'est pas lu : le total d'une facture est la somme de ses
  -- lignes, et c'est au serveur de le dire.
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

  -- Disponibilité du stock, AGRÉGÉE PAR ARTICLE. Vérifier ligne par ligne
  -- laisserait passer deux lignes qui, prises ensemble, dépassent le stock —
  -- et c'est le cas le plus probable d'une facture à plusieurs articles.
  for e in
    select nullif(x.value ->> 'stockRef', '')                     as ref,
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

  -- Plus aucun refus sous cette ligne. Une exception, elle, reste sans
  -- danger : elle annule la transaction et la clef redevient libre.
  v_rejeu := app.geste_reserver(v_org, p_cle, 'enregistrer_vente');
  if v_rejeu is not null then return v_rejeu; end if;

  -- Les numéros sont pris DANS la transaction : un échec ne laisse plus de
  -- trou dans la numérotation.
  v_id  := public.prochain_id('v',   'V',   4);
  v_fac := public.prochain_id('fac', 'FAC', 4);

  insert into public.ventes
    (id, date, client, client_id, description, paiement, montant, acompte,
     restant, num_facture, note_complement, organisation_id, cle_geste,
     poids, local, importe)
  values
    (v_id, v_date, v_nom, v_cli, '(lignes)', v_paie, v_total, v_acompte,
     v_total - v_acompte, v_fac, v_note, v_org, p_cle, 0, 0, 0);

  -- Les lignes. Pour une ligne d'inventaire, type, carat et provenance sont
  -- pris SUR L'ARTICLE, jamais sur ce qu'envoie le navigateur : une identité
  -- qui se propage ne se re-saisit pas (§ 1, `vente_sur_compte_epargne`).
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

  -- LE RÉSUMÉ, recalculé depuis les lignes — jamais depuis le navigateur.
  -- Le carat et le type viennent de la ligne la PLUS LOURDE : c'est la moins
  -- fausse des valeurs uniques pour un graphique pondéré par le poids.
  select count(*) into v_nb
    from public.vente_lignes
   where organisation_id = v_org and vente_id = v_id;

  update public.ventes v
     set poids   = agg.poids,
         "local" = agg.local,          -- entre guillemets : `local` est aussi
         importe = agg.importe,        -- un mot-clef, et `set local` existe
         carat      = agg.carat,
         type_bijou = agg.type_bijou,
         description = agg.description
    from (
      select sum(l.poids) as poids, sum(l.local) as local, sum(l.importe) as importe,
             (array_agg(l.carat      order by l.poids desc nulls last, l.ligne))[1] as carat,
             (array_agg(l.type_bijou order by l.poids desc nulls last, l.ligne))[1] as type_bijou,
             case when count(*) = 1
                  then (array_agg(l.description order by l.ligne))[1]
                  else (array_agg(l.description order by l.ligne))[1]
                       || ' + ' || (count(*) - 1) || ' autre'
                       || case when count(*) > 2 then 's' else '' end || ' article'
                       || case when count(*) > 2 then 's' else '' end
             end as description
        from public.vente_lignes l
       where l.organisation_id = v_org and l.vente_id = v_id
    ) agg
   where v.organisation_id = v_org and v.id = v_id;

  -- LE STOCK, agrégé par article et déduit sous garde. La disponibilité est
  -- dans le `where` : la vérification et l'écriture sont alors le même geste,
  -- donc rien ne peut se glisser entre les deux.
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
-- A VERIFIER APRES APPLICATION — le « succes » ne prouve que la syntaxe
-- ============================================================================
-- Sous l'identite d'une vendeuse, dans une transaction ANNULEE :
--
--   begin;
--     set local request.jwt.claims = '{"sub":"<uuid d une vendeuse>"}';
--
--     -- 1. deux articles du stock + une ligne libre
--     select public.enregistrer_vente(
--       '{"clientId":"CL-0001","date":"2026-11-12","paiement":"especes","acompte":0}'::json,
--       '[{"stockRef":"STK-0001","poids":5,"nbArticles":1,"montant":300000},
--         {"stockRef":"STK-0002","poids":3,"nbArticles":1,"montant":200000},
--         {"description":"Gravure prénom","montant":5000}]'::json,
--       gen_random_uuid());
--     -- total attendu : 505 000, et TROIS lignes.
--
--     select * from public.vente_lignes where vente_id = '<id rendu>' order by ligne;
--     select description, montant, poids, carat from public.ventes where id = '<id rendu>';
--   rollback;
--
-- 2. LE PIEGE DU MEME ARTICLE SUR DEUX LIGNES — l'essai qui compte. Deux
--    lignes de 6 g sur un article qui n'en a que 10 doivent etre REFUSEES.
--    Verifiees ligne par ligne, elles passaient toutes les deux.
--
-- 3. Le total envoye par le navigateur est ignore : ajouter "montant":1 a
--    l'objet vente ne doit rien changer au total rendu.
--
-- 4. Une cliente d'une AUTRE boutique doit etre refusee, et un `stockRef`
--    d'une autre boutique aussi.
--
-- 5. La cascade : supprimer une vente doit emporter ses lignes.
--      begin;
--        delete from public.ventes where id = '<id>';
--        select count(*) from public.vente_lignes where vente_id = '<id>';  -- 0
--      rollback;
-- ============================================================================
