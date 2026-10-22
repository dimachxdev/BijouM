-- ===========================================================================
-- 019 — Supprimer une boutique depuis la console opérateur
-- Écrite le 2026-10-22. NON APPLIQUÉE.
-- ===========================================================================
-- Il n'existait aucun moyen de supprimer une boutique : `basculer_boutique()`
-- suspend, c'est tout. Le nettoyage se faisait donc en SQL collé à la main —
-- un script qui supprime quinze tables, rejoué sans garde-fou.
--
-- C'est l'action la plus destructrice du produit : elle efface l'historique
-- commercial entier d'une boutique. Les verrous sont donc **ici**, dans la
-- fonction, et pas dans le navigateur. Une `confirm()` ne protège de rien.
--
-- QUATRE VERROUS, dans cet ordre :
--
--   1. Opérateur du service, et personne d'autre.
--   2. Le code boutique doit être retapé et correspondre. Un identifiant
--      transmis par erreur ne peut donc pas emporter une autre boutique que
--      celle qu'on a sous les yeux.
--   3. La boutique doit être **déjà suspendue**. Supprimer devient deux
--      gestes séparés dans le temps, au lieu d'un clic dans une liste.
--   4. Ni épargne de cliente, ni créance en cours. L'argent gardé pour une
--      cliente n'est pas le nôtre, et une créance est une preuve de dette.
--
-- La fonction ne touche pas aux comptes de connexion : les supprimer passe
-- par l'API Admin, qui nettoie aussi identités et sessions. Elle renvoie
-- leurs identifiants, et `membres-admin` s'en charge ensuite.
-- ===========================================================================

create or replace function public.supprimer_boutique(p_org_id uuid, p_slug text)
returns json
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_org      record;
  v_argent   bigint;
  v_creances bigint;
  v_users    uuid[];
  v_ventes   int;
begin
  -- Verrou 1
  if not app.est_operateur() then
    raise exception 'Réservé à l''opérateur du service.' using errcode = '42501';
  end if;

  select id, nom, slug, actif into v_org
    from public.organisations where id = p_org_id;
  if not found then
    raise exception 'Boutique introuvable.';
  end if;

  -- Verrou 2
  if upper(btrim(coalesce(p_slug, ''))) <> upper(v_org.slug) then
    raise exception 'Le code saisi ne correspond pas à cette boutique.';
  end if;

  -- Verrou 3
  if v_org.actif then
    raise exception 'Suspendez la boutique avant de la supprimer.';
  end if;

  -- Verrou 4a — l'épargne des clientes
  select coalesce(sum(solde), 0) into v_argent
    from public.comptes_clients where organisation_id = p_org_id;
  if v_argent > 0 then
    raise exception
      'Cette boutique garde % F d''épargne appartenant à ses clientes. Soldez les comptes avant de supprimer.',
      v_argent;
  end if;

  -- Verrou 4b — les créances
  select coalesce(sum(restant), 0) into v_creances
    from public.ventes
   where organisation_id = p_org_id and coalesce(annulee, false) = false;
  if v_creances > 0 then
    raise exception
      'Cette boutique a % F de restants dus. Soldez ou annulez ces ventes avant de supprimer.',
      v_creances;
  end if;

  select count(*) into v_ventes from public.ventes where organisation_id = p_org_id;
  select array_agg(user_id) into v_users from public.membres where organisation_id = p_org_id;

  -- Suppression explicite plutôt qu'un ON DELETE CASCADE qui n'est pas posé
  -- partout. L'ordre suit les dépendances.
  delete from public.mouvements_cc     where organisation_id = p_org_id;
  delete from public.comptes_clients   where organisation_id = p_org_id;
  delete from public.mouvements_arrhes where organisation_id = p_org_id;
  delete from public.bijoux_arrhes     where organisation_id = p_org_id;
  delete from public.reprises          where organisation_id = p_org_id;
  delete from public.decaissements     where organisation_id = p_org_id;
  delete from public.sorties           where organisation_id = p_org_id;
  delete from public.ventes            where organisation_id = p_org_id;
  delete from public.stock             where organisation_id = p_org_id;
  delete from public.clients           where organisation_id = p_org_id;
  delete from public.connexions        where organisation_id = p_org_id;
  delete from public.portail_journal   where organisation_id = p_org_id;
  delete from public.portail_sessions  where organisation_id = p_org_id;
  delete from public.compteurs         where organisation_id = p_org_id;
  delete from public.invitations       where organisation_id = p_org_id;
  delete from public.membres           where organisation_id = p_org_id;
  delete from public.organisations     where id = p_org_id;

  return json_build_object(
    'ok', true,
    'nom', v_org.nom,
    'slug', v_org.slug,
    'ventes_supprimees', v_ventes,
    'comptes', coalesce(v_users, array[]::uuid[])
  );
end $fn$;

-- Le `grant` dit qui peut frapper à la porte ; `app.est_operateur()` dans le
-- corps dit qui entre.
revoke all on function public.supprimer_boutique(uuid, text) from public, anon;
grant execute on function public.supprimer_boutique(uuid, text) to authenticated;
