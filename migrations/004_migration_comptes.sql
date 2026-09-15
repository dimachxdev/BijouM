-- ============================================================================
-- KAYOR SaaS — 004 : BASCULE DES COMPTES VERS SUPABASE AUTH
-- ----------------------------------------------------------------------------
-- Aujourd'hui `utilisateurs.password` contient le mot de passe en clair
-- (admin/admin123) et doLogin() le compare dans le navigateur. N'importe qui
-- ouvrant la console voit tous les mots de passe via STATE.users.
--
-- Après cette migration, l'identité vit dans auth.users : mot de passe bcrypt,
-- JWT signé, expiration et rafraîchissement gérés par Supabase.
--
-- ORDRE D'EXÉCUTION : 001 -> 004 -> (créer les comptes) -> 002 -> 003
-- 002 coupe l'accès anonyme : ne l'exécuter qu'une fois les comptes créés et
-- l'application basculée sur js/auth.js, sinon l'app se retrouve déconnectée.
-- ============================================================================

begin;

-- ============================================================================
-- 1. RATTACHEMENT AUTOMATIQUE À L'INSCRIPTION
-- ============================================================================
-- Quand un compte est créé via l'API Auth avec les métadonnées
-- { organisation_slug, nom, role }, il est automatiquement rattaché.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_slug text := new.raw_user_meta_data ->> 'organisation_slug';
  v_nom  text := coalesce(new.raw_user_meta_data ->> 'nom', split_part(new.email, '@', 1));
  v_role text := coalesce(new.raw_user_meta_data ->> 'role', 'vendeur');
begin
  if v_slug is null then
    return new;   -- inscription hors organisation : rattachement manuel
  end if;

  select id into v_org from public.organisations where slug = v_slug;
  if v_org is null then
    return new;
  end if;

  if v_role not in ('proprietaire','admin','gestionnaire','vendeur') then
    v_role := 'vendeur';
  end if;

  insert into public.membres (user_id, organisation_id, nom, role, actif)
  values (new.id, v_org, v_nom, v_role, true)
  on conflict (user_id, organisation_id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ============================================================================
-- 2. RATTACHER UN COMPTE EXISTANT (usage manuel)
-- ============================================================================
create or replace function app.rattacher_membre(
  p_email text,
  p_slug  text,
  p_nom   text,
  p_role  text default 'vendeur'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_org  uuid;
begin
  select id into v_user from auth.users      where email = lower(p_email);
  select id into v_org  from public.organisations where slug  = p_slug;

  if v_user is null then return 'Compte auth introuvable : ' || p_email; end if;
  if v_org  is null then return 'Organisation introuvable : ' || p_slug;  end if;

  insert into public.membres (user_id, organisation_id, nom, role, actif)
  values (v_user, v_org, p_nom, p_role, true)
  on conflict (user_id, organisation_id)
    do update set nom = excluded.nom, role = excluded.role, actif = true;

  return 'OK : ' || p_email || ' -> ' || p_slug || ' (' || p_role || ')';
end $$;

-- ============================================================================
-- 3. NEUTRALISER L'ANCIENNE TABLE
-- ============================================================================
-- Conservée en archive le temps de valider la bascule, mais la colonne de mot
-- de passe en clair est supprimée immédiatement : elle n'a aucune raison
-- d'exister une seconde de plus.
alter table public.utilisateurs drop column if exists password;
alter table public.utilisateurs rename to utilisateurs_archive;

commit;

-- ============================================================================
-- MODE D'EMPLOI
-- ============================================================================
--
-- ÉTAPE 1 — Créer les comptes dans Supabase
--   Dashboard > Authentication > Users > "Add user"
--   Renseigner un email réel + un mot de passe fort (12 caractères minimum).
--   Dans "User Metadata", coller :
--     { "organisation_slug": "KAY", "nom": "Administrateur", "role": "proprietaire" }
--   Le trigger ci-dessus crée la ligne `membres` automatiquement.
--
-- ÉTAPE 2 — Ou rattacher après coup un compte déjà créé :
--   select app.rattacher_membre('patron@kayor.sn', 'KAY', 'Administrateur', 'proprietaire');
--   select app.rattacher_membre('stock@kayor.sn',  'KAY', 'Gestionnaire',   'gestionnaire');
--   select app.rattacher_membre('vente@kayor.sn',  'KAY', 'Vendeur',        'vendeur');
--
-- ÉTAPE 3 — Vérifier
--   select m.nom, m.role, o.slug, u.email
--     from public.membres m
--     join public.organisations o on o.id = m.organisation_id
--     join auth.users u           on u.id = m.user_id;
--
-- ÉTAPE 4 — Basculer l'application sur js/auth.js, tester la connexion,
--           PUIS seulement exécuter 002_rls_policies.sql.
--
-- IMPORTANT : changer les mots de passe admin123 / stock123 / vendeur123.
-- Ils sont dans js/data.js, donc connus de toute personne ayant vu le code.
-- ============================================================================
