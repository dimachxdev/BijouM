-- ============================================================================
-- 008 — L'encaisse du magasin réservée aux administrateurs
-- Appliquée le 2026-09-18.
-- ============================================================================
--
-- Décision : le vendeur ne doit pas voir le solde de caisse de la boutique.
--
-- Masquer l'affichage ne suffisait pas. Le solde net se calcule à partir des
-- décaissements, et leur lecture était ouverte à tous les membres — seul
-- l'onglet était caché. L'API REST, elle, répondait : n'importe quel membre
-- pouvait lire les charges et reconstituer l'encaisse.
--
-- On aligne donc la lecture sur l'écriture, déjà réservée à proprietaire+admin.
--
-- Effet pour un vendeur ou un gestionnaire : la table renvoie une liste vide.
-- RLS filtre les lignes, il ne lève pas d'erreur — `chargerDonnees()` continue
-- de fonctionner, et les écrans qui affichaient le solde sont masqués côté
-- interface (voir `peutVoirCaisse()` dans js/app.js).

drop policy if exists decaissements_sel on public.decaissements;

create policy decaissements_sel on public.decaissements
  for select
  using (
    organisation_id = app.current_org()
    and app.has_role(variadic array['proprietaire', 'admin'])
  );
