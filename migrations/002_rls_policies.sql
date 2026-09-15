-- ============================================================================
-- KAYOR SaaS — 002 : ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Ferme la faille critique : aujourd'hui RLS est désactivé et le rôle `anon`
-- possède `grant all`. La clé publiable étant dans le JavaScript (donc
-- publique par nature), n'importe quel visiteur peut aujourd'hui exécuter :
--
--   curl "https://<projet>.supabase.co/rest/v1/utilisateurs?select=*" \
--        -H "apikey: sb_publishable_..."
--
-- ... et lire tous les mots de passe, ou faire un DELETE sur toutes les tables.
--
-- Après cette migration :
--   * anon ne peut plus RIEN lire ni écrire ;
--   * un membre authentifié ne voit QUE les lignes de son organisation ;
--   * les écritures sensibles sont réservées aux rôles habilités, côté serveur.
--
-- PRÉREQUIS : 001_saas_foundation.sql exécuté, et les comptes recréés dans
-- Supabase Auth (voir 004_migration_comptes.sql). Exécuter cette migration
-- AVANT d'avoir migré les comptes déconnecterait l'application.
-- ============================================================================

begin;

-- ============================================================================
-- 1. RÉVOQUER LES ACCÈS ANONYMES (annule fix_tout.sql)
-- ============================================================================
revoke all privileges on all tables    in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke all privileges on all functions in schema public from anon;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- `authenticated` conserve l'accès SQL ; c'est RLS qui filtre ligne à ligne.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ============================================================================
-- 2. ACTIVER RLS PARTOUT
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'organisations','membres','clients','ventes','stock','sorties',
    'decaissements','comptes_clients','mouvements_cc','reprises',
    'bijoux_arrhes','mouvements_arrhes','connexions','compteurs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- Volontairement SANS `force row level security` : les fonctions
    -- SECURITY DEFINER du portail client (003) s'exécutent en tant que
    -- propriétaire des tables. FORCE leur appliquerait les policies, or
    -- app.current_org() vaut NULL hors JWT — elles ne verraient plus rien.
    -- ENABLE suffit : `anon` et `authenticated` ne sont jamais propriétaires,
    -- donc l'API REST reste filtrée ligne à ligne.
    execute format('alter table public.%I no force row level security', t);
  end loop;
end $$;

-- ============================================================================
-- 3. ORGANISATIONS — on ne voit que la sienne
-- ============================================================================
drop policy if exists org_select on public.organisations;
create policy org_select on public.organisations
  for select to authenticated
  using (id = app.current_org());

-- Seul le propriétaire modifie les réglages de la boutique.
drop policy if exists org_update on public.organisations;
create policy org_update on public.organisations
  for update to authenticated
  using      (id = app.current_org() and app.has_role('proprietaire'))
  with check (id = app.current_org() and app.has_role('proprietaire'));

-- ============================================================================
-- 4. MEMBRES — visibles dans l'organisation, gérés par admin/propriétaire
-- ============================================================================
drop policy if exists membres_select on public.membres;
create policy membres_select on public.membres
  for select to authenticated
  using (organisation_id = app.current_org());

drop policy if exists membres_write on public.membres;
create policy membres_write on public.membres
  for all to authenticated
  using      (organisation_id = app.current_org() and app.has_role('proprietaire','admin'))
  with check (organisation_id = app.current_org() and app.has_role('proprietaire','admin'));

-- ============================================================================
-- 5. TABLES MÉTIER — isolation par tenant
-- ============================================================================
-- Modèle appliqué à chaque table :
--   SELECT  : tout membre actif de l'organisation
--   WRITE   : membres habilités, et uniquement si l'abonnement est actif
--
-- `app.org_active()` sur les écritures : une organisation suspendue ou expirée
-- passe automatiquement en lecture seule, sans suppression de données.

-- --- 5a. Tables ouvertes à tous les rôles opérationnels -----------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clients','ventes','comptes_clients','mouvements_cc',
    'bijoux_arrhes','mouvements_arrhes','reprises'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format($p$
      create policy %I on public.%I
        for select to authenticated
        using (organisation_id = app.current_org())
    $p$, t || '_sel', t);

    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format($p$
      create policy %I on public.%I
        for insert to authenticated
        with check (
          organisation_id = app.current_org()
          and app.org_active()
          and app.has_role('proprietaire','admin','gestionnaire','vendeur')
        )
    $p$, t || '_ins', t);

    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format($p$
      create policy %I on public.%I
        for update to authenticated
        using      (organisation_id = app.current_org() and app.org_active())
        with check (organisation_id = app.current_org())
    $p$, t || '_upd', t);

    -- Suppression : admin et propriétaire uniquement.
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format($p$
      create policy %I on public.%I
        for delete to authenticated
        using (
          organisation_id = app.current_org()
          and app.has_role('proprietaire','admin')
        )
    $p$, t || '_del', t);
  end loop;
end $$;

-- --- 5b. Stock : écriture réservée admin + gestionnaire ----------------------
drop policy if exists stock_sel on public.stock;
create policy stock_sel on public.stock
  for select to authenticated
  using (organisation_id = app.current_org());

drop policy if exists stock_write on public.stock;
create policy stock_write on public.stock
  for all to authenticated
  using (
    organisation_id = app.current_org()
    and app.org_active()
    and app.has_role('proprietaire','admin','gestionnaire')
  )
  with check (
    organisation_id = app.current_org()
    and app.has_role('proprietaire','admin','gestionnaire')
  );

-- --- 5c. Sorties & décaissements : admin uniquement --------------------------
-- Correspond aux garde-fous `isAdmin()` de l'application, désormais appliqués
-- côté serveur — un utilisateur qui force son rôle dans la console du
-- navigateur se fait refuser la requête par PostgreSQL.
do $$
declare t text;
begin
  foreach t in array array['sorties','decaissements'] loop
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format($p$
      create policy %I on public.%I
        for select to authenticated
        using (organisation_id = app.current_org())
    $p$, t || '_sel', t);

    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$
      create policy %I on public.%I
        for all to authenticated
        using (
          organisation_id = app.current_org()
          and app.org_active()
          and app.has_role('proprietaire','admin')
        )
        with check (
          organisation_id = app.current_org()
          and app.has_role('proprietaire','admin')
        )
    $p$, t || '_write', t);
  end loop;
end $$;

-- --- 5d. Compteurs ----------------------------------------------------------
drop policy if exists compteurs_all on public.compteurs;
create policy compteurs_all on public.compteurs
  for all to authenticated
  using      (organisation_id = app.current_org())
  with check (organisation_id = app.current_org());

-- --- 5e. Journal de connexions : append-only ---------------------------------
-- Personne ne peut modifier ni effacer une trace d'audit, pas même un admin.
drop policy if exists connexions_sel on public.connexions;
create policy connexions_sel on public.connexions
  for select to authenticated
  using (
    organisation_id = app.current_org()
    and app.has_role('proprietaire','admin')
  );

drop policy if exists connexions_ins on public.connexions;
create policy connexions_ins on public.connexions
  for insert to authenticated
  with check (organisation_id = app.current_org());
-- Volontairement : aucune policy UPDATE ni DELETE.

-- ============================================================================
-- 6. REALTIME — ne republier que les tables métier
-- ============================================================================
-- Realtime respecte RLS dès lors que le client se connecte avec son JWT.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    drop publication supabase_realtime;
  end if;
end $$;

create publication supabase_realtime for table
  public.clients, public.ventes, public.stock, public.sorties,
  public.decaissements, public.comptes_clients, public.mouvements_cc,
  public.reprises, public.bijoux_arrhes, public.mouvements_arrhes,
  public.compteurs;

commit;

-- ============================================================================
-- VÉRIFICATION — toutes les tables doivent afficher rowsecurity = true
-- ============================================================================
select tablename, rowsecurity,
       (select count(*) from pg_policies p where p.tablename = t.tablename) as nb_policies
from pg_tables t
where schemaname = 'public'
order by rowsecurity, tablename;

-- Doit renvoyer 0 ligne : plus aucun privilège pour anon.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';
