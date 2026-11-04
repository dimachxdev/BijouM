-- ============================================================================
-- 038 — Une edition simple : facturer sans tenir de stock
-- ============================================================================
-- Demande le 2026-11-04 : pour les boutiques d'essai, « le plus simple de
-- facturer sans gestion de stock derriere » — tout le reste (facturation,
-- comptes epargne, depots, decaissements, arrhes) reste entier et lie.
--
-- CE QUE LE MODELE PERMETTAIT DEJA, ET QUI REND CECI PEU COUTEUX
--
-- Verifie avant d'ecrire : `ventes` ne porte AUCUNE colonne de stock. Elle a
-- ses propres `description`, `type_bijou`, `carat`, `poids`, `local` et
-- `importe`. Aujourd'hui le navigateur les recopie depuis l'article choisi,
-- mais rien en base n'exige qu'un article existe.
--
-- Le lien au stock n'est donc qu'un EFFET DE BORD du navigateur :
-- `deduireStock()`, appele a quatre endroits. Une facture sans article est
-- deja representable — il n'y a pas de modele a changer, seulement un
-- comportement a rendre facultatif.
--
-- POURQUOI UNE COLONNE, ET NON `plan = 'essai'`
--
-- Il serait plus court de deduire le mode du plan. C'est un piege :
--
--   — une boutique d'essai qui PAIE verrait la forme de son produit changer
--     sous ses doigts, du jour au lendemain, sans l'avoir demande ;
--   — une boutique qui paie et se trouve bien du mode simple n'aurait aucun
--     moyen de le garder ;
--   — et le § 5 confie au plan ce a quoi on a DROIT, jamais la forme de
--     l'outil. Melanger les deux, c'est rendre la facturation dependante de
--     la comptabilite.
--
-- La console proposera le mode simple par defaut quand le plan est « essai ».
-- La SUGGESTION suit le plan ; la VALEUR reste explicite.
--
-- QUI PEUT LA CHANGER — et c'est la migration 027 qui repond toute seule
--
-- `authenticated` n'a l'`UPDATE` que sur les colonnes nommees du `grant`
-- (les 21 champs d'identite que l'ecran des parametres ecrit). En
-- n'ajoutant PAS `gestion_stock` a ce grant, une proprietaire ne peut pas y
-- toucher : seul l'operateur, par la fonction ci-dessous. Aucune policy a
-- ecrire — « une policy dit quelles lignes, jamais quelles colonnes » (§ 1).
--
-- CE QUE CE DRAPEAU N'EST PAS
--
-- Ce n'est pas une autorisation. Une boutique en mode simple dont le
-- navigateur mentirait ecrirait dans SON propre stock, dans SA boutique —
-- rien ne fuit, rien ne s'ouvre. C'est la forme de l'outil, pas une barriere,
-- et il ne faut pas lui faire porter autre chose.
-- ============================================================================

begin;

alter table public.organisations
  add column if not exists gestion_stock boolean not null default true;

comment on column public.organisations.gestion_stock is
  'false = edition simple : facturation libre, sans article ni deduction de '
  'stock. Les onglets Stock et Sorties disparaissent. Tout le volet argent '
  'reste entier. Reserve a l''operateur (hors du grant update de authenticated).';

-- Volontairement ABSENTE du `grant update (...)` d'`authenticated` : voir
-- l'en-tete. Si un jour l'ecran des parametres doit l'ecrire, il faudra
-- l'ajouter au grant EXPLICITEMENT, en sachant que la boutique pourra alors
-- changer seule la forme de son produit.

-- --------------------------------------------------------------------------
-- La seule porte : l'operateur
-- --------------------------------------------------------------------------
-- Une fonction dediee plutot qu'un parametre de plus a `modifier_boutique()` :
-- « ajouter une fonction, pas une permission » (§ 1). Elle ne sait faire
-- qu'une chose, et sa reecriture ne met pas en jeu le plan ni l'echeance.
create or replace function public.basculer_gestion_stock(
  p_org_id uuid, p_actif boolean)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nom   text;
  v_stock int;
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

  update public.organisations
     set gestion_stock = p_actif
   where id = p_org_id;

  -- Rien n'est efface en passant au mode simple : les articles restent en
  -- base, simplement invisibles. Repasser au mode complet les retrouve tels
  -- quels. On le DIT, parce qu'un operateur qui croit effacer en basculant
  -- prendrait la decision inverse.
  select count(*) into v_stock
    from public.stock where organisation_id = p_org_id;

  return json_build_object('ok', true, 'boutique', v_nom,
    'gestion_stock', p_actif,
    'articles_conserves', v_stock,
    'avis', case when p_actif
      then 'Les onglets Stock et Sorties reviennent.'
      else 'Mode simple : ' || v_stock || ' article(s) restent en base, '
           || 'simplement masques. Rien n''est efface.' end);
end $$;

revoke all on function public.basculer_gestion_stock(uuid, boolean) from public, anon;
grant execute on function public.basculer_gestion_stock(uuid, boolean) to authenticated;

commit;

-- ============================================================================
-- A VERIFIER APRES APPLICATION
-- ============================================================================
-- 1. Une proprietaire ne peut PAS se l'octroyer — c'est tout l'interet du
--    choix de la colonne hors grant. Dans une transaction annulee :
--
--      begin;
--        set local role authenticated;
--        set local request.jwt.claims = '{"sub":"<proprietaire>","role":"authenticated"}';
--        update public.organisations set gestion_stock = false
--         where id = '<sa boutique>';      -- doit ECHOUER (privilege refuse)
--      rollback;
--
--    Et le contre-essai, sans lequel le premier ne prouve rien : le meme role
--    doit toujours pouvoir ecrire `nom` ou `adresse`.
--
-- 2. L'operateur, lui, passe :
--      select public.basculer_gestion_stock('<org>', false);
--
-- 3. La colonne est LISIBLE par la boutique : `org_select` ne filtre pas les
--    colonnes, donc `auth.js` la recoit avec le reste. Verifier qu'elle est
--    bien dans la liste du `select` — sans quoi le navigateur la croira
--    toujours vraie.
-- ============================================================================
