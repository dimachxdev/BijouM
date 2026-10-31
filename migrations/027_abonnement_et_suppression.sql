-- ===========================================================================
-- 027 — Deux trous trouvés en dressant la matrice des policies
-- Écrite le 2026-10-31.
-- ===========================================================================
-- Contexte : premier relevé complet de `pg_policy`, celui que le § 1 de
-- CLAUDE.md réclame (« relire la matrice, pas les migrations ») et qui
-- n'avait jamais été fait.
--
-- Bonne nouvelle d'abord : **les 46 policies portent `current_org`**, sans
-- exception, et les données le confirment — zéro croisement entre boutiques
-- sur les cinq relations qui n'ont aucune clé étrangère
-- (`mouvements_cc.compte_id`, `ventes.compte_client_id`,
-- `mouvements_arrhes.arrhes_id`, `portail_sessions.client_id`,
-- `decaissements.origine_id`), et les 281 `organisation_id` du schéma
-- pointent tous une boutique existante.
--
-- L'étanchéité entre boutiques est donc acquise. Ce que la matrice a révélé
-- est ailleurs : deux cases vides qui ne sont pas des fuites de tenant, mais
-- contredisent des règles écrites. Le linter ne les voit pas — les policies
-- existent, elles sont seulement trop larges. C'est exactement le motif
-- décrit par la règle.
--
-- ══════════════════════════════════════════════════════════════════════════
-- A. Une propriétaire pouvait s'offrir son propre abonnement
-- ══════════════════════════════════════════════════════════════════════════
-- `org_update` autorise une `proprietaire` à modifier la ligne de SA boutique.
-- C'est voulu : elle doit pouvoir changer le nom, le logo, le pied de facture.
--
-- Mais **une policy RLS ne filtre pas les colonnes.** Seul un `grant` par
-- colonne le fait, et `authenticated` les avait toutes — dont `plan`,
-- `expire_le`, `actif`, `slug` et `id`.
--
-- Or `app.org_active()` lit précisément `org.actif` et `org.expire_le`. La
-- clé qui conditionne toutes les écritures était donc réglable par la
-- personne qu'elle est censée contraindre.
--
-- Vérifié le 2026-10-31 sous l'identité réelle des propriétaires, en
-- transactions annulées :
--
--   plan='pro', expire_le='2099-12-31' sur sa boutique      → PASSÉ
--   actif=true sur sa boutique SUSPENDUE par l'opérateur    → PASSÉ
--
-- Le second est le plus grave : la suspension est le seul levier commercial
-- du service, et la suspendue pouvait l'annuler elle-même. Depuis la console
-- du navigateur, avec la clé publique.
--
-- Ce que ça ne permettait pas, pour être juste : ni voir, ni toucher une
-- autre boutique (`id = app.current_org()` tient), ni supprimer la sienne
-- (réservé à l'opérateur), ni changer `id` (quinze clés étrangères en
-- `NO ACTION` le bloquent).
--
-- Correction : `authenticated` ne reçoit l'`UPDATE` que sur les huit colonnes
-- que l'écran « Profil boutique » écrit réellement
-- (`enregistrerProfilBoutique()` dans `js/app.js`). Tout le reste passe par
-- `modifier_boutique()` et `basculer_boutique()`, réservées à l'opérateur —
-- et toutes deux `SECURITY DEFINER`, donc indifférentes aux droits de
-- colonne. Aucun chemin légitime ne casse.
--
-- `devise` et `fuseau` restent fermées : l'interface ne les expose pas
-- aujourd'hui. Le jour où un écran de préférences les propose, les ouvrir
-- ici — une colonne à la fois, jamais `grant update` nu.
--
-- ══════════════════════════════════════════════════════════════════════════
-- B. Une boutique suspendue ne pouvait plus écrire, mais pouvait détruire
-- ══════════════════════════════════════════════════════════════════════════
-- Les huit policies `DELETE` portent `current_org` et un contrôle de rôle,
-- mais **pas `app.org_active()`** — à la différence de leurs voisines
-- `INSERT` et `UPDATE`, qui l'ont toutes.
--
-- Vérifié le 2026-10-31, même méthode, sur la boutique réellement suspendue :
--
--   INSERT d'une vente   → refusé par RLS
--   DELETE de ses ventes → 7 lignes effacées
--
-- Le § 5 promet qu'une boutique expirée ou suspendue « passe en lecture
-- seule côté base ». Ce n'était pas seulement faux : le seul geste qui
-- restait possible était le destructeur. Une boutique en retard de paiement
-- pouvait effacer son historique commercial — y compris les mouvements
-- d'épargne de ses clientes, qui sont une dette envers elles.
--
-- La suppression légitime d'une boutique suspendue n'est pas affectée :
-- `supprimer_boutique()` (migration 019) est `SECURITY DEFINER` et ne passe
-- pas par les policies. C'est d'ailleurs sa raison d'être — elle EXIGE que
-- la boutique soit déjà suspendue.
--
-- ─────────────────────────── Laissé en l'état, exprès ──────────────────────
--
-- `membres_write` n'a pas `app.org_active()` non plus. Ce n'est pas corrigé
-- ici : conditionner la gestion des comptes à l'activité de la boutique
-- risquerait un verrouillage — plus personne pour rouvrir quoi que ce soit.
-- `membres` relève du contrôle d'accès, pas des données métier. À trancher
-- séparément, en écrivant d'abord le scénario de sortie.
--
-- `compteurs_ecriture` n'a pas de contrôle de rôle : c'est la décision
-- documentée de la migration 011 (fermer l'écriture casserait la vente côté
-- vendeuse ; le trigger `compteurs_monotone` rend la régression impossible).
-- Ne pas la « corriger ».
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A. organisations : l'UPDATE colonne par colonne
-- ---------------------------------------------------------------------------
revoke update on public.organisations from authenticated;

grant update (nom, slogan, adresse, telephone, ninea, rccm, pied_facture, logo)
  on public.organisations to authenticated;

-- `anon` n'a jamais eu à écrire ici ; on le réaffirme.
revoke all on public.organisations from anon;
grant select on public.organisations to anon;


-- ---------------------------------------------------------------------------
-- B. Les huit policies DELETE reçoivent app.org_active()
-- ---------------------------------------------------------------------------
-- Les huit avaient exactement la même forme. On ne change que l'ajout.

drop policy if exists ventes_del on public.ventes;
create policy ventes_del on public.ventes
  for delete to authenticated
  using (organisation_id = app.current_org()
         and app.has_role('proprietaire','admin')
         and app.org_active());

drop policy if exists reprises_del on public.reprises;
create policy reprises_del on public.reprises
  for delete to authenticated
  using (organisation_id = app.current_org()
         and app.has_role('proprietaire','admin')
         and app.org_active());

drop policy if exists clients_del on public.clients;
create policy clients_del on public.clients
  for delete to authenticated
  using (organisation_id = app.current_org()
         and app.has_role('proprietaire','admin')
         and app.org_active());

drop policy if exists comptes_clients_del on public.comptes_clients;
create policy comptes_clients_del on public.comptes_clients
  for delete to authenticated
  using (organisation_id = app.current_org()
         and app.has_role('proprietaire','admin')
         and app.org_active());

drop policy if exists mouvements_cc_del on public.mouvements_cc;
create policy mouvements_cc_del on public.mouvements_cc
  for delete to authenticated
  using (organisation_id = app.current_org()
         and app.has_role('proprietaire','admin')
         and app.org_active());

drop policy if exists bijoux_arrhes_del on public.bijoux_arrhes;
create policy bijoux_arrhes_del on public.bijoux_arrhes
  for delete to authenticated
  using (organisation_id = app.current_org()
         and app.has_role('proprietaire','admin')
         and app.org_active());

drop policy if exists mouvements_arrhes_del on public.mouvements_arrhes;
create policy mouvements_arrhes_del on public.mouvements_arrhes
  for delete to authenticated
  using (organisation_id = app.current_org()
         and app.has_role('proprietaire','admin')
         and app.org_active());

drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations
  for delete to authenticated
  using (organisation_id = app.current_org()
         and app.has_role('proprietaire','admin')
         and app.org_active());


-- ===========================================================================
-- APRÈS APPLICATION — les quatre contre-épreuves
-- ===========================================================================
-- Chacune dans une transaction annulée, en se mettant à la place du rôle,
-- comme le prescrit le § 1. Attendu après correction :
--
--   1. Propriétaire, sur SA boutique :
--        update organisations set expire_le='2099-12-31' …   → REFUSÉ
--        (« permission denied for table organisations »)
--
--   2. Propriétaire d'une boutique suspendue :
--        update organisations set actif=true …               → REFUSÉ
--
--   3. Propriétaire, sur SA boutique :
--        update organisations set nom='…', logo='…' …        → ACCEPTÉ
--        C'est l'écran « Profil boutique ». S'il casse, la correction est
--        trop large.
--
--   4. Propriétaire d'une boutique suspendue :
--        delete from ventes where organisation_id = <la sienne>  → 0 ligne
--        Sur une boutique ACTIVE, le même delete doit continuer de marcher.
--
-- Puis passer le linter Supabase (Advisors → Security) : les alertes
-- normales de ce projet sont listées au § 1 de CLAUDE.md.
-- ===========================================================================
