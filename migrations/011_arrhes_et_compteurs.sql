-- ============================================================================
-- KAYOR SaaS — 011 : deux policies qui laissaient passer le vendeur
-- Appliquée le 2026-10-14.
-- ============================================================================
--
-- Trouvées en rejouant la matrice complète des droits — table par table,
-- commande par commande — puis vérifiées en se mettant à la place de la
-- vendeuse de test. Les deux contredisaient la règle arrêtée le 2026-09-18 :
-- « le vendeur saisit, mais ne modifie ni n'efface ».
--
-- Leçon : une policy UPDATE sans contrôle de rôle ne se voit pas à la lecture
-- du code — ses voisines en ont un, on suppose qu'elle en a un. Il faut lire
-- la matrice, pas les migrations.

-- ---------------------------------------------------------------------------
-- 1. mouvements_arrhes : l'UPDATE n'avait aucun contrôle de rôle
-- ---------------------------------------------------------------------------
-- Un vendeur pouvait réécrire le montant déjà versé par une cliente sur sa
-- commande — donc modifier ce qu'elle doit encore. Les policies voisines
-- (insert, delete) avaient bien leur contrôle ; celle-ci avait été oubliée.
-- On l'aligne sur `mouvements_cc`.

drop policy if exists mouvements_arrhes_upd on public.mouvements_arrhes;

create policy mouvements_arrhes_upd on public.mouvements_arrhes
  for update to authenticated
  using (
    organisation_id = app.current_org()
    and app.org_active()
    and app.has_role(variadic array['proprietaire', 'admin', 'gestionnaire'])
  )
  with check (
    organisation_id = app.current_org()
    and app.has_role(variadic array['proprietaire', 'admin', 'gestionnaire'])
  );

-- ---------------------------------------------------------------------------
-- 2. compteurs : un compteur ne peut plus reculer
-- ---------------------------------------------------------------------------
-- `prochain_id()` est seul maître de la numérotation depuis la migration des
-- identifiants. Mais le navigateur continue d'envoyer ses compteurs locaux
-- (`dbSaveCounters` dans js/supabase.js). Si la valeur locale est en retard,
-- le compteur recule et `prochain_id()` redistribue un identifiant déjà pris :
-- c'est exactement la panne qui écrasait des ventes.
--
-- N'importe quel membre pouvait aussi remettre les douze compteurs à zéro —
-- vérifié, un vendeur y parvenait.
--
-- Couper l'écriture casserait la vente côté vendeur (la numérotation passe par
-- une vingtaine d'appels dans supabase.js). On rend donc la régression
-- impossible plutôt que l'écriture interdite : une valeur plus basse est
-- ignorée, une valeur plus haute passe.
--
-- À FAIRE PLUS TARD : retirer `dbSaveCounters` / `saveCompteurs` du navigateur.
-- Ces écritures sont devenues inutiles — `prochain_id()` fait tout. Ce garde-fou
-- pourra alors être remplacé par une simple interdiction d'écrire.

create or replace function app.compteur_jamais_reculer()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.valeur < old.valeur then
    new.valeur := old.valeur;
  end if;
  return new;
end $$;

drop trigger if exists compteurs_monotone on public.compteurs;
create trigger compteurs_monotone
  before update on public.compteurs
  for each row execute function app.compteur_jamais_reculer();

-- La policy unique n'exigeait pas non plus `org_active()` : une boutique
-- suspendue pouvait encore écrire ses compteurs. On sépare lecture et écriture.
drop policy if exists compteurs_all on public.compteurs;

create policy compteurs_sel on public.compteurs
  for select to authenticated
  using (organisation_id = app.current_org());

create policy compteurs_ecriture on public.compteurs
  for all to authenticated
  using (organisation_id = app.current_org() and app.org_active())
  with check (organisation_id = app.current_org() and app.org_active());

-- ============================================================================
-- VÉRIFIÉ APRÈS APPLICATION, sous l'identité de la vendeuse
-- ============================================================================
--   reculer un compteur à 0      → ignoré, reste à 5
--   modifier un mouvement arrhes → refusé
--   prochain_id('v','V',4)       → V-0006, compteur à 6
--   faire monter un compteur     → accepté
--   enregistrer une vente        → accepté
-- ============================================================================
