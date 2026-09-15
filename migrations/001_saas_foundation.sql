-- ============================================================================
-- KAYOR SaaS — 001 : FONDATION MULTI-TENANT
-- ----------------------------------------------------------------------------
-- Transforme la base mono-boutique en base multi-boutique (SaaS).
--
--   * organisations  = une boutique cliente du SaaS (le "tenant")
--   * membres        = lien auth.users <-> organisation + rôle
--   * organisation_id ajouté sur TOUTES les tables métier
--
-- L'authentification passe de `utilisateurs.password` (texte clair, comparé
-- côté navigateur) à Supabase Auth (JWT signé, mot de passe bcrypt).
--
-- À exécuter AVANT 002_rls_policies.sql.
-- Idempotent : peut être rejoué sans danger.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. SCHÉMA `app` — fonctions internes, NON exposées à l'API REST
-- ============================================================================
-- Isolé de `public` pour que PostgREST ne publie jamais ces fonctions.
create schema if not exists app;
revoke all on schema app from anon, authenticated;
grant usage on schema app to authenticated;

-- ============================================================================
-- 2. TABLE organisations (les tenants)
-- ============================================================================
create table if not exists public.organisations (
  id           uuid primary key default gen_random_uuid(),
  nom          text        not null,
  slug         text        not null unique,   -- identifiant court, sert de préfixe d'ID métier
  plan         text        not null default 'essai'
               check (plan in ('essai','standard','pro','entreprise')),
  actif        boolean     not null default true,
  devise       text        not null default 'XOF',
  fuseau       text        not null default 'Africa/Dakar',
  expire_le    date,                          -- fin d'abonnement ; null = illimité
  created_at   timestamptz not null default now()
);

comment on table  public.organisations is 'Tenant SaaS : une boutique de bijouterie.';
comment on column public.organisations.slug is 'Préfixe court (3-6 car.) utilisé dans les ID métier : V-KAY-001.';

-- ============================================================================
-- 3. TABLE membres (utilisateurs rattachés à une organisation)
-- ============================================================================
-- Remplace `public.utilisateurs`. Le mot de passe vit désormais dans
-- auth.users (bcrypt, géré par Supabase Auth) — plus jamais en clair.
create table if not exists public.membres (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  organisation_id uuid        not null references public.organisations(id) on delete cascade,
  nom             text        not null,
  role            text        not null default 'vendeur'
                  check (role in ('proprietaire','admin','gestionnaire','vendeur')),
  actif           boolean     not null default true,
  created_at      timestamptz not null default now(),
  primary key (user_id, organisation_id)
);

create index if not exists membres_org_idx  on public.membres(organisation_id);
create index if not exists membres_user_idx on public.membres(user_id) where actif;

comment on table public.membres is
  'Rattache un compte auth.users à une organisation avec un rôle. Source de vérité des permissions.';

-- ============================================================================
-- 4. FONCTIONS D'AUTORISATION
-- ============================================================================
-- SECURITY DEFINER : indispensable, sinon les policies RLS de `membres`
-- se rappelleraient elles-mêmes (récursion infinie).

-- Organisation de l'utilisateur courant (d'après son JWT).
create or replace function app.current_org()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.organisation_id
  from public.membres m
  where m.user_id = auth.uid() and m.actif
  limit 1
$$;

-- Rôle de l'utilisateur courant dans son organisation.
create or replace function app.current_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from public.membres m
  where m.user_id = auth.uid() and m.actif
  limit 1
$$;

-- Vrai si l'utilisateur courant possède l'un des rôles demandés.
create or replace function app.has_role(variadic roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.membres m
    where m.user_id = auth.uid()
      and m.actif
      and m.role = any(roles)
  )
$$;

-- Vrai si l'organisation est active et l'abonnement non expiré.
-- Un tenant suspendu perd tout accès en écriture sans qu'on touche à ses données.
create or replace function app.org_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.membres o
    join public.organisations org on org.id = o.organisation_id
    where o.user_id = auth.uid()
      and o.actif
      and org.actif
      and (org.expire_le is null or org.expire_le >= current_date)
  )
$$;

revoke all on function app.current_org(), app.current_role(),
                      app.has_role(text[]), app.org_active() from public, anon;
grant execute on function app.current_org(), app.current_role(),
                          app.has_role(text[]), app.org_active() to authenticated;

-- ============================================================================
-- 5. ORGANISATION DE DÉPART + REPRISE DES DONNÉES EXISTANTES
-- ============================================================================
insert into public.organisations (nom, slug, plan, actif)
values ('Bijouterie KAYOR', 'KAY', 'pro', true)
on conflict (slug) do nothing;

-- ============================================================================
-- 6. AJOUT DE organisation_id SUR TOUTES LES TABLES MÉTIER
-- ============================================================================
do $$
declare
  t          text;
  org_defaut uuid;
  tables_metier text[] := array[
    'clients','ventes','stock','sorties','decaissements',
    'comptes_clients','mouvements_cc','reprises',
    'bijoux_arrhes','mouvements_arrhes','connexions','compteurs'
  ];
begin
  select id into org_defaut from public.organisations where slug = 'KAY';

  foreach t in array tables_metier loop
    -- 6a. colonne
    execute format(
      'alter table public.%I add column if not exists organisation_id uuid references public.organisations(id) on delete cascade',
      t
    );
    -- 6b. rattacher les lignes existantes à l'organisation de départ
    execute format(
      'update public.%I set organisation_id = %L where organisation_id is null',
      t, org_defaut
    );
    -- 6c. rendre la colonne obligatoire (plus aucune ligne orpheline possible)
    execute format(
      'alter table public.%I alter column organisation_id set not null',
      t
    );
    -- 6d. valeur par défaut = organisation du JWT, pour que l'app n'ait pas
    --     à l'envoyer sur chaque INSERT
    execute format(
      'alter table public.%I alter column organisation_id set default app.current_org()',
      t
    );
    -- 6e. index : toute requête est filtrée par tenant
    execute format(
      'create index if not exists %I on public.%I(organisation_id)',
      t || '_org_idx', t
    );
  end loop;
end $$;

-- ============================================================================
-- 7. COMPTEURS PAR ORGANISATION
-- ============================================================================
-- Avant : PK (cle) — deux boutiques se seraient écrasées mutuellement.
-- Après : PK (organisation_id, cle).
alter table public.compteurs drop constraint if exists compteurs_pkey;
alter table public.compteurs add  constraint compteurs_pkey
  primary key (organisation_id, cle);

-- ============================================================================
-- 8. UNICITÉ DES ID MÉTIER PAR ORGANISATION
-- ============================================================================
-- Les ID restent en `text` (V-001, C-003…) mais sont préfixés par le slug de
-- l'organisation côté application (V-KAY-001) : plus aucune collision possible
-- entre deux boutiques. On garantit ici l'unicité couple (org, id).
do $$
declare
  t text;
  pk text;
  tables_id text[] := array[
    'clients','ventes','sorties','decaissements','comptes_clients',
    'reprises','bijoux_arrhes','connexions'
  ];
begin
  foreach t in array tables_id loop
    execute format(
      'create unique index if not exists %I on public.%I(organisation_id, id)',
      t || '_org_id_uniq', t
    );
  end loop;

  -- `stock` a `ref` comme clé primaire
  create unique index if not exists stock_org_ref_uniq
    on public.stock(organisation_id, ref);
end $$;

-- ============================================================================
-- 9. TRAÇABILITÉ — qui a écrit quoi
-- ============================================================================
do $$
declare
  t text;
  tables_audit text[] := array[
    'ventes','stock','sorties','decaissements','reprises','bijoux_arrhes','clients'
  ];
begin
  foreach t in array tables_audit loop
    execute format('alter table public.%I add column if not exists created_by uuid references auth.users(id)', t);
    execute format('alter table public.%I add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('alter table public.%I alter column created_by set default auth.uid()', t);
  end loop;
end $$;

create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['ventes','stock','sorties','decaissements','reprises','bijoux_arrhes','clients'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function app.touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end $$;

commit;

-- ============================================================================
-- VÉRIFICATION
-- ============================================================================
select
  c.table_name,
  count(*) filter (where c.column_name = 'organisation_id') as a_org_id
from information_schema.columns c
where c.table_schema = 'public'
group by c.table_name
order by c.table_name;
