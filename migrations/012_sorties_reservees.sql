-- ============================================================================
-- KAYOR SaaS — 012 : la lecture des sorties de stock réservée aux administrateurs
-- Appliquée le 2026-10-14.
-- ============================================================================
--
-- Même raisonnement que la migration 008 pour les décaissements : l'onglet
-- « Sorties de stock » était réservé aux administrateurs, mais l'API répondait
-- à n'importe quel membre de la boutique. Masquer un écran n'est pas une
-- protection.
--
-- Les sorties disent ce qui quitte le stock et pourquoi — casse, cadeau,
-- usage personnel. C'est une information de gestion, pas de comptoir.
--
-- La lecture rejoint donc l'écriture, déjà réservée à proprietaire + admin.
-- Le gestionnaire en est exclu, comme pour les décaissements.
--
-- ---------------------------------------------------------------------------
-- VÉRIFIÉ AVANT APPLICATION — le piège de la migration 008
-- ---------------------------------------------------------------------------
-- RLS filtre sans lever d'erreur : un écran qui déduit un état de l'ABSENCE
-- d'une ligne se met à mentir. Les quatre lectures de `STATE.sorties` ont donc
-- été relues une par une :
--
--   js/app.js:102   chargement — reçoit [] pour un vendeur, sans erreur
--   js/app.js:1612  onglet Sorties        — déjà réservé aux administrateurs
--   js/app.js:1615  onglet Sorties        — idem
--   js/app.js:3350  rapport journalier    — déjà réservé aux administrateurs
--
-- Et surtout : les quantités de `stock` sont une colonne stockée, décrémentée
-- par `deduireStock()`. Elles ne se recalculent jamais depuis `sorties`. Un
-- vendeur voit donc le bon stock, simplement sans savoir ce qui en est sorti.

drop policy if exists sorties_sel on public.sorties;

create policy sorties_sel on public.sorties
  for select to authenticated
  using (
    organisation_id = app.current_org()
    and app.has_role(variadic array['proprietaire', 'admin'])
  );

-- ============================================================================
-- VÉRIFIÉ APRÈS APPLICATION, sur une ligne témoin insérée puis annulée
-- ============================================================================
--   vue par la vendeuse     : 0
--   vue par la propriétaire : 1
-- ============================================================================
