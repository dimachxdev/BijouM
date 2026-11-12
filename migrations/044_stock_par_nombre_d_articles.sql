-- ============================================================================
-- 044 — Un stock qui se compte en pièces, pas en grammes
-- ============================================================================
-- Demande le 2026-11-12 : « une option de gerer son stock juste par nombre
-- d'articles, definie par l'operateur pour la boutique ».
--
-- Il y a desormais TROIS formes de l'outil :
--
--   complete  gestion_stock = true,  stock_par_poids = true
--             l'inventaire se suit en grammes ET en pieces. C'est l'or au
--             poids, le metier d'origine.
--   articles  gestion_stock = true,  stock_par_poids = false
--             l'inventaire ne se compte qu'en pieces. Pas de gramme nulle
--             part : ni a la saisie, ni sur la facture, ni au stock.
--   simple    gestion_stock = false
--             pas d'inventaire du tout (migration 038).
--
-- DEUX COLONNES ET NON UN ENUM, ET C'EST UN CHOIX
--
-- Un `mode_stock text` a trois valeurs aurait l'air plus propre, et il
-- interdirait la quatrieme combinaison (pas d'inventaire mais suivi du
-- poids), qui ne veut rien dire.
--
-- Mais `gestion_stock` gouverne deja QUATRE points de bascule — `peutAcceder()`,
-- `deduireStock()`, le formulaire de vente (§ 6 ter) et `enregistrer_vente()`
-- depuis la 043. En changer le type les rouvrirait tous le meme jour, pour
-- une question qui n'est pas la meme : « y a-t-il un inventaire ? » et
-- « cet inventaire pese-t-il ? » sont deux questions, pas une valeur a trois
-- etats.
--
-- Donc deux colonnes, et une regle ecrite : **`stock_par_poids` ne veut rien
-- dire quand `gestion_stock` est faux.** Elle n'est alors jamais lue. Pas de
-- contrainte CHECK pour l'interdire : elle obligerait a la remettre a `true`
-- en basculant en mode simple, donc a PERDRE le reglage d'une boutique qui
-- repasserait ensuite en mode complet.
--
-- `true` PAR DEFAUT, comme `gestion_stock`. Une boutique dont la colonne
-- n'aurait pas ete lue garde ses grammes : une bijoutiere ne doit pas croire
-- que son suivi du poids a disparu parce qu'un champ manquait.
--
-- QUI PEUT LA CHANGER — la 027 repond encore toute seule
--
-- L'`UPDATE` d'`authenticated` sur `organisations` est limite a 21 colonnes
-- NOMMEES depuis la migration 027. Une colonne neuve en est donc exclue par
-- construction : une proprietaire ne peut pas s'en emparer, et il n'y a
-- aucune policy a ecrire. « Une policy dit quelles lignes, jamais quelles
-- colonnes » (§ 1). A verifier par contre-epreuve, pas a supposer.
--
-- CE QUE LA BASCULE N'EFFACE PAS, ET CE QU'ELLE FIGE
--
-- Rien n'est efface : `stock.poids_total_g` garde ses valeurs. Mais en mode
-- « articles » plus aucune vente ne les diminue — **les poids restent donc
-- figes a leur derniere valeur.** Une boutique qui reviendrait au mode
-- complet retrouverait un inventaire dont les grammes datent du jour de la
-- bascule. C'est une consequence, pas un defaut : un stock qu'on ne suit
-- plus ne peut pas se tenir a jour tout seul.
--
-- POURQUOI LE REFUS PLUTOT QUE L'OUBLI
--
-- `enregistrer_vente()` REFUSE une ligne qui porte un poids dans une
-- boutique en mode « articles », au lieu de l'ignorer. Ignorer aurait ecrit
-- une facture ou la cliente lit « 7,5 g » pendant que l'inventaire n'en sait
-- rien — exactement le genre d'ecart qu'on ne remarque qu'a l'inventaire
-- annuel. Et c'est la meme forme que la regle de la 043, dans les deux sens.
--
-- Le reste du corps de la fonction ne bouge pas : avec un poids force a
-- zero, le controle de disponibilite (`0 > poids_total_g`) est faux et la
-- deduction (`poids_total_g - 0`) est sans effet. Une validation, aucune
-- branche de plus dans le chemin d'ecriture.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. La colonne
-- --------------------------------------------------------------------------
alter table public.organisations
  add column if not exists stock_par_poids boolean not null default true;

comment on column public.organisations.stock_par_poids is
  'L''inventaire se suit-il en grammes ? Faux = comptage en pieces seulement. '
  'N''a aucun sens quand gestion_stock est faux. Hors du grant UPDATE '
  'd''authenticated : seul l''operateur la change. Voir migration 044.';

-- --------------------------------------------------------------------------
-- 2. La porte de l'opérateur
-- --------------------------------------------------------------------------
-- La signature est ETENDUE, pas renommee : la console deployee appelle
-- encore `basculer_gestion_stock(p_org_id, p_actif)` a deux arguments, et un
-- troisieme parametre a valeur par defaut la laisse fonctionner telle quelle
-- jusqu'a son redeploiement. Renommer aurait casse le bouton « Appliquer »
-- entre maintenant et la mise en ligne.
drop function if exists public.basculer_gestion_stock(uuid, boolean);

create or replace function public.basculer_gestion_stock(
  p_org_id    uuid,
  p_actif     boolean,
  p_par_poids boolean default true)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_nom   text;
  v_stock int;
  v_poids boolean;
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Reserve au service.');
  end if;
  if p_actif is null then
    return json_build_object('ok', false, 'erreur', 'Valeur manquante.');
  end if;

  select nom into v_nom from public.organisations where id = p_org_id;
  if v_nom is null then
    return json_build_object('ok', false, 'erreur', 'Boutique introuvable.');
  end if;

  -- En mode simple, `stock_par_poids` ne veut rien dire : on la laisse telle
  -- quelle plutot que de la remettre a `true`, pour qu'une boutique qui
  -- repasse en mode complet retrouve le reglage qu'elle avait.
  v_poids := coalesce(p_par_poids, true);

  update public.organisations
     set gestion_stock   = p_actif,
         stock_par_poids = case when p_actif then v_poids else stock_par_poids end
   where id = p_org_id;

  select stock_par_poids into v_poids
    from public.organisations where id = p_org_id;

  select count(*) into v_stock
    from public.stock where organisation_id = p_org_id;

  return json_build_object('ok', true, 'boutique', v_nom,
    'gestion_stock', p_actif,
    'stock_par_poids', v_poids,
    'articles_conserves', v_stock,
    'avis', case
      when not p_actif then
        'Mode simple : ' || v_stock || ' article(s) restent en base, simplement masques. Rien n''est efface.'
      when v_poids then
        'Inventaire suivi en grammes et en pieces.'
      else
        'Inventaire compte en PIECES seulement. Les poids deja enregistres '
        || 'restent en base mais ne bougeront plus : aucune vente ne les '
        || 'diminue dans ce mode.'
    end);
end $fn$;

revoke all on function public.basculer_gestion_stock(uuid, boolean, boolean) from public, anon;
grant execute on function public.basculer_gestion_stock(uuid, boolean, boolean) to authenticated;

-- --------------------------------------------------------------------------
-- 3. La console doit voir le mode pour l'afficher
-- --------------------------------------------------------------------------
create or replace function public.boutiques_du_service()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v json;
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Réservé à l''opérateur du service.');
  end if;

  select json_agg(b order by b.nom) into v from (
    select o.id, o.nom, o.slug, o.plan, o.actif, o.expire_le, o.created_at,
           o.gestion_stock, o.stock_par_poids,
           (select count(*) from public.membres m
             where m.organisation_id = o.id and m.actif)                      as nb_membres,
           (select count(*) from public.ventes x where x.organisation_id = o.id) as nb_ventes,
           (select max(x.created_at) from public.ventes x
             where x.organisation_id = o.id)                                  as derniere_vente,
           (select p.nom from public.membres p
             where p.organisation_id = o.id and p.role = 'proprietaire' and p.actif
             order by p.created_at limit 1)                                   as proprietaire_nom,
           (select case
                     when p.email like '%.kayor.app'
                       then left(p.email, length(p.email) - length('.kayor.app'))
                     else p.email
                   end
              from public.membres p
             where p.organisation_id = o.id and p.role = 'proprietaire' and p.actif
             order by p.created_at limit 1)                                   as proprietaire_login
    from public.organisations o
  ) b;

  return json_build_object('ok', true, 'boutiques', coalesce(v, '[]'::json));
end $fn$;

revoke all on function public.boutiques_du_service() from public, anon;
grant execute on function public.boutiques_du_service() to authenticated;

-- --------------------------------------------------------------------------
-- 4. La règle, là où elle compte : dans la fonction d'écriture
-- --------------------------------------------------------------------------
-- Une seule validation ajoutée au corps de la 043. Le reste est identique —
-- avec un poids forcé à zéro, la vérification de disponibilité et la
-- déduction du stock sont déjà sans effet.
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

  -- La forme de la boutique décide de ce qu'une ligne a le droit d'être.
  -- `true` par défaut pour les deux, comme côté navigateur : une colonne
  -- qu'on n'aurait pas lue ne doit rien ouvrir en silence.
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
    -- La règle de la 043, dans les deux sens.
    if v_gere and e.stock_ref is null then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : choisissez un article de l''inventaire.');
    end if;
    if not v_gere and e.stock_ref is not null then
      return json_build_object('ok', false, 'erreur',
        'Ligne ' || e.ligne || ' : cette boutique ne gère pas de stock.');
    end if;

    -- LA REGLE DE LA 044. On refuse plutôt qu'on n'ignore : un poids ignoré
    -- s'imprimerait sur la facture sans que l'inventaire en sache rien.
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
-- 1. LA CONTRE-EPREUVE DE DROIT, et c'est elle qui compte : une proprietaire
--    ne doit pas pouvoir s'octroyer le mode, mais doit toujours ecrire son
--    adresse. Sans ce second essai, le premier ne prouve rien — il pourrait
--    echouer pour une autre raison.
--
--      begin;
--        set local role authenticated;
--        set local request.jwt.claims = '{"sub":"<uuid proprietaire>"}';
--        update public.organisations set stock_par_poids = false
--         where id = '<son org>';        -- doit etre REFUSE
--        update public.organisations set adresse = 'essai'
--         where id = '<son org>';        -- doit PASSER
--      rollback;
--
-- 2. Le refus du poids en mode « articles », dans une transaction annulee :
--
--      begin;
--        update public.organisations set stock_par_poids = false where id = '<org>';
--        set local request.jwt.claims = '{"sub":"<uuid vendeuse>"}';
--        select public.enregistrer_vente(
--          '{"clientId":"CL-0023","paiement":"especes"}'::json,
--          '[{"stockRef":"STK-0001","poids":2,"nbArticles":1,"montant":50000}]'::json,
--          gen_random_uuid());
--      rollback;
--    -> « Ligne 1 : cette boutique compte son stock en pieces. »
--
-- 3. ... et la meme vente SANS poids doit passer, en ne diminuant que `qty` :
--    relever `poids_total_g` avant et apres, il ne doit pas bouger d'un
--    centieme.
--
-- 4. La bascule ne perd pas le reglage : passer en mode simple puis revenir
--    en mode complet doit rendre `stock_par_poids` tel qu'il etait.
-- ============================================================================
