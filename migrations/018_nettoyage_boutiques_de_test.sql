-- ===========================================================================
-- 018 — Nettoyage des boutiques d'essai
-- Écrite le 2026-10-22. À jouer AVANT la migration 017.
-- ===========================================================================
-- Rien n'est en production : tout ce qui existe aujourd'hui est de l'essai,
-- confirmé le 2026-10-22. Ce fichier supprime une boutique et tout ce qui
-- lui appartient.
--
-- ⚠ À N'UTILISER QUE SUR DES DONNÉES D'ESSAI. Il n'y a aucune sauvegarde sur
-- le plan gratuit : une fois joué, rien ne revient. Après la première
-- boutique payante, ce fichier ne doit plus jamais être rejoué tel quel.
--
-- ORDRE : ce nettoyage passe AVANT 017. La migration 017 refuse de détacher
-- le compte de service s'il reste la seule propriétaire d'une boutique — or
-- c'est le cas de l'ancienne. La supprimer d'abord lève l'obstacle.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- ÉTAPE 1 — INVENTAIRE. Ne supprime rien. À lire avant de choisir.
-- ---------------------------------------------------------------------------
select o.slug,
       o.nom,
       (select count(*) from membres          m where m.organisation_id = o.id) as membres,
       (select count(*) from ventes           v where v.organisation_id = o.id) as ventes,
       (select count(*) from clients          c where c.organisation_id = o.id) as clients,
       (select count(*) from comptes_clients  k where k.organisation_id = o.id) as comptes_epargne,
       (select coalesce(sum(k.solde),0) from comptes_clients k
         where k.organisation_id = o.id)                                        as argent_des_clientes,
       (select count(*) from stock            s where s.organisation_id = o.id) as stock,
       o.actif, o.plan, o.expire_le
  from organisations o
 order by o.nom;

-- `argent_des_clientes` doit être à zéro. S'il ne l'est pas, ce n'est pas une
-- boutique d'essai : arrêtez-vous et vérifiez.


-- ---------------------------------------------------------------------------
-- ÉTAPE 2 — SUPPRESSION. Remplacer le code boutique sur la ligne `v_slug`.
-- ---------------------------------------------------------------------------
do $$
declare
  v_slug constant text := 'À_REMPLACER';   -- ex. 'MB'
  v_org  uuid;
  v_n    int;
  v_users uuid[];
begin
  select id into v_org from public.organisations where slug = v_slug;
  if v_org is null then
    raise exception 'Aucune boutique avec le code « % ». Rien supprimé.', v_slug;
  end if;

  -- Les comptes à retirer ensuite de l'authentification (voir étape 3).
  select array_agg(user_id) into v_users
    from public.membres where organisation_id = v_org;

  -- On supprime explicitement plutôt que de compter sur un ON DELETE CASCADE
  -- qui n'est peut-être pas posé partout. L'ordre suit les dépendances.
  delete from public.mouvements_cc     where organisation_id = v_org;
  delete from public.comptes_clients   where organisation_id = v_org;
  delete from public.mouvements_arrhes where organisation_id = v_org;
  delete from public.bijoux_arrhes     where organisation_id = v_org;
  delete from public.reprises          where organisation_id = v_org;
  delete from public.decaissements     where organisation_id = v_org;
  delete from public.sorties           where organisation_id = v_org;
  delete from public.ventes            where organisation_id = v_org;
  delete from public.stock             where organisation_id = v_org;
  delete from public.clients           where organisation_id = v_org;

  -- `connexions` n'a volontairement pas de policy DELETE : personne ne peut
  -- effacer une trace depuis l'application. Ici on passe en `postgres`, qui
  -- ignore RLS. C'est admissible parce qu'il s'agit d'essais — ne jamais en
  -- faire une habitude ni un script réutilisable (voir § 7).
  delete from public.connexions        where organisation_id = v_org;

  delete from public.portail_journal   where organisation_id = v_org;
  delete from public.portail_sessions  where organisation_id = v_org;
  delete from public.compteurs         where organisation_id = v_org;
  delete from public.invitations       where organisation_id = v_org;
  delete from public.membres           where organisation_id = v_org;

  delete from public.organisations     where id = v_org;
  get diagnostics v_n = row_count;

  raise notice 'Boutique « % » supprimée (% ligne). Comptes à retirer de l''authentification : %',
    v_slug, v_n, coalesce(array_to_string(v_users, ', '), 'aucun');
end $$;


-- ---------------------------------------------------------------------------
-- ÉTAPE 3 — Les comptes de connexion
-- ---------------------------------------------------------------------------
-- Le bloc ci-dessus a détaché les membres, mais leurs comptes existent encore
-- dans l'authentification. Les retirer depuis *Authentication → Users* du
-- tableau de bord, en se servant des identifiants affichés par le `notice`.
--
-- Ne pas supprimer dans `auth.users` en SQL : l'API Admin nettoie aussi les
-- identités et les sessions liées.
--
-- ⚠ NE PAS SUPPRIMER le compte de service (djilybgueye@gmail.com). Il n'est
-- membre d'aucune boutique une fois 017 jouée, mais c'est lui qui ouvre la
-- console opérateur.


-- ---------------------------------------------------------------------------
-- ÉTAPE 4 — La numérotation
-- ---------------------------------------------------------------------------
-- Les `compteurs` de la boutique supprimée sont partis avec elle. Pour la
-- boutique qu'on garde, si l'on veut que la première vraie vente porte le
-- numéro V-0001 :
--
--   delete from compteurs where organisation_id = '<id de la boutique gardée>';
--
-- **Supprimer, pas remettre à zéro.** Le trigger `compteurs_monotone`
-- (migration 011) intercepte tout UPDATE qui ferait baisser une valeur et la
-- restaure en silence : `update compteurs set valeur = 0` ne renvoie aucune
-- erreur et ne change rien. Le trigger ne couvre que UPDATE, pas DELETE.
--
-- Puis enregistrer une vente d'essai pour vérifier que `prochain_id()` repart
-- bien à 1 sur une ligne absente — et la supprimer ensuite.
