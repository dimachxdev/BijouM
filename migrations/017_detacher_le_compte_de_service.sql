-- ===========================================================================
-- 017 — Détacher le compte de service de toute boutique
-- Écrite le 2026-10-22. NON APPLIQUÉE : voir l'ordre d'exécution plus bas.
-- ===========================================================================
-- Un seul compte ouvrait la console de service (créer, modifier, suspendre
-- **toutes** les boutiques) et tenait une bijouterie au comptoir. C'est le
-- compte du comptoir qui s'expose : mot de passe lu par-dessus l'épaule,
-- téléphone partagé, appareil perdu. Le perdre, c'était perdre le service
-- entier — pas une bijouterie.
--
-- Décidé le 2026-10-22 : le compte du fondateur devient **opérateur, et rien
-- d'autre**. La bijouterie reçoit sa propre propriétaire.
--
-- CE FICHIER NE FAIT QUE LA SECONDE MOITIÉ. La première — créer la nouvelle
-- propriétaire — ne peut pas se faire en SQL : créer un compte passe par
-- l'API Admin de Supabase, qui hache le mot de passe et alimente la table
-- des identités. Insérer à la main dans `auth.users` produit un compte qui
-- ne peut pas se connecter.
--
-- ORDRE D'EXÉCUTION, à ne pas inverser :
--
--   1. Déployer `membres-admin` avec l'action `creer_proprietaire`
--      (ajoutée le 2026-10-22, pas encore déployée).
--   2. Depuis la console opérateur, créer la propriétaire de la boutique.
--      Elle devra changer son mot de passe à la première connexion.
--   3. Vérifier qu'elle se connecte et voit bien la boutique.
--   4. Alors seulement, jouer ce fichier.
--
-- Entre 2 et 4, la boutique a deux propriétaires. C'est transitoire et sans
-- danger, à un détail près : `motdepasse_proprietaire` refuse d'agir sur une
-- boutique qui en compte plusieurs. Cette fenêtre doit rester courte.
-- ===========================================================================

do $$
declare
  v_mail     constant text := 'djilybgueye@gmail.com';
  v_restant  int;
  v_retirees int;
begin
  -- Garde-fou : ne jamais laisser une boutique sans propriétaire active.
  -- C'est déjà arrivé sur ce projet — « Marjan Bijouterie Saint louis » n'a
  -- aucun membre, et personne ne peut y entrer.
  select count(*) into v_restant
    from public.membres m
    join auth.users u on u.id = m.user_id
   where lower(u.email) = v_mail
     and m.role = 'proprietaire' and m.actif
     and not exists (
       select 1 from public.membres m2
        where m2.organisation_id = m.organisation_id
          and m2.role = 'proprietaire' and m2.actif
          and m2.user_id <> m.user_id);

  if v_restant > 0 then
    raise exception
      'Détacher ce compte laisserait % boutique(s) sans propriétaire active. Créez-la d''abord (action creer_proprietaire). Migration annulée.',
      v_restant;
  end if;

  delete from public.membres m
   using auth.users u
   where u.id = m.user_id
     and lower(u.email) = v_mail;

  get diagnostics v_retirees = row_count;
  raise notice 'Compte de service détaché de % boutique(s).', v_retirees;
end $$;

-- Contrôle à lire après coup : ce compte ne doit plus apparaître nulle part
-- dans `membres`, et doit rester dans `operateurs`.
--
--   select 'membre de' as quoi, count(*) as n
--     from membres m join auth.users u on u.id = m.user_id
--    where lower(u.email) = 'djilybgueye@gmail.com'
--   union all
--   select 'operateur', count(*)
--     from operateurs o join auth.users u on u.id = o.user_id
--    where lower(u.email) = 'djilybgueye@gmail.com';
--
-- Attendu : 0 et 1.
