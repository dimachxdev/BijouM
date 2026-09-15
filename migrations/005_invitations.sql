-- ============================================================================
-- KAYOR SaaS — 005 : INVITATIONS
-- ----------------------------------------------------------------------------
-- Problème que cette migration ferme :
-- le trigger `app.handle_new_user` (004) rattache tout nouveau compte à
-- l'organisation indiquée dans ses métadonnées. Or /auth/v1/signup est public.
-- N'importe qui pourrait donc s'inscrire avec
--   { "organisation_slug": "KAY", "role": "proprietaire" }
-- et entrer dans une boutique qui n'est pas la sienne.
--
-- Après cette migration, le rattachement n'a lieu que si un administrateur de
-- la boutique a préalablement invité cette adresse email. Le rôle appliqué est
-- celui de l'invitation, jamais celui envoyé par le client.
--
-- PRÉREQUIS : 001 et 004. À exécuter avant d'ouvrir l'application à des
-- utilisateurs réels.
-- ============================================================================

begin;

-- ============================================================================
-- 1. TABLE DES INVITATIONS
-- ============================================================================
create table if not exists public.invitations (
  id              uuid        primary key default gen_random_uuid(),
  organisation_id uuid        not null references public.organisations(id) on delete cascade,
  email           text        not null,
  nom             text        not null,
  role            text        not null default 'vendeur'
                  check (role in ('proprietaire','admin','gestionnaire','vendeur')),
  invite_par      uuid        references auth.users(id),
  utilisee_le     timestamptz,
  expire_le       timestamptz not null default now() + interval '7 days',
  created_at      timestamptz not null default now()
);

-- Une seule invitation en attente par email et par organisation.
create unique index if not exists invitations_email_org_uniq
  on public.invitations(lower(email), organisation_id)
  where utilisee_le is null;

create index if not exists invitations_email_idx on public.invitations(lower(email));

alter table public.invitations enable row level security;

-- Visible et gérable uniquement par les admins de l'organisation concernée.
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select to authenticated
  using (
    organisation_id = app.current_org()
    and app.has_role('proprietaire','admin')
  );

drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (
    organisation_id = app.current_org()
    and app.has_role('proprietaire','admin')
    -- Un admin ne peut pas fabriquer un propriétaire ; seul un propriétaire le peut.
    and (role <> 'proprietaire' or app.has_role('proprietaire'))
  );

drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations
  for delete to authenticated
  using (
    organisation_id = app.current_org()
    and app.has_role('proprietaire','admin')
  );

-- ============================================================================
-- 2. LE TRIGGER D'INSCRIPTION S'APPUIE DÉSORMAIS SUR L'INVITATION
-- ============================================================================
-- Remplace la version de 004 : les métadonnées envoyées par le navigateur ne
-- sont plus jamais prises pour argent comptant.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv record;
begin
  select * into v_inv
    from public.invitations
   where lower(email) = lower(new.email)
     and utilisee_le is null
     and expire_le > now()
   order by created_at desc
   limit 1;

  if not found then
    -- Compte créé sans invitation : il existe dans auth.users mais n'est
    -- rattaché à aucune organisation. app.current_org() renverra NULL et RLS
    -- lui refusera toute ligne. Inoffensif.
    return new;
  end if;

  insert into public.membres (user_id, organisation_id, nom, role, actif)
  values (new.id, v_inv.organisation_id, v_inv.nom, v_inv.role, true)
  on conflict (user_id, organisation_id) do nothing;

  update public.invitations set utilisee_le = now() where id = v_inv.id;

  return new;
end $$;

-- ============================================================================
-- 3. RETRAIT D'UN MEMBRE
-- ============================================================================
-- Supprimer la ligne `membres` coupe l'accès immédiatement (plus d'organisation
-- résolue). Le compte auth.users subsiste : l'historique reste attribuable et
-- la personne peut être réinvitée sans recréer d'identité.
-- Dans `public` (et non `app`) car elle doit être appelable via PostgREST :
-- POST /rest/v1/rpc/retirer_membre
create or replace function public.retirer_membre(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid := app.current_org();
  v_role text;
begin
  if not app.has_role('proprietaire','admin') then
    return json_build_object('ok', false, 'erreur', 'Action réservée aux administrateurs.');
  end if;

  if p_user_id = auth.uid() then
    return json_build_object('ok', false, 'erreur', 'Vous ne pouvez pas vous retirer vous-même.');
  end if;

  select role into v_role
    from public.membres
   where user_id = p_user_id and organisation_id = v_org;

  if v_role is null then
    return json_build_object('ok', false, 'erreur', 'Membre introuvable.');
  end if;

  -- Un admin ne peut pas retirer un propriétaire.
  if v_role = 'proprietaire' and not app.has_role('proprietaire') then
    return json_build_object('ok', false, 'erreur', 'Seul un propriétaire peut retirer un propriétaire.');
  end if;

  -- Ne jamais laisser une organisation sans propriétaire actif.
  if v_role = 'proprietaire' and (
       select count(*) from public.membres
        where organisation_id = v_org and role = 'proprietaire' and actif
     ) <= 1 then
    return json_build_object('ok', false, 'erreur', 'La boutique doit conserver au moins un propriétaire.');
  end if;

  delete from public.membres where user_id = p_user_id and organisation_id = v_org;
  return json_build_object('ok', true);
end $$;

revoke all on function public.retirer_membre(uuid) from public, anon;
grant execute on function public.retirer_membre(uuid) to authenticated;

commit;

-- ============================================================================
-- RÉGLAGE À FAIRE DANS LE TABLEAU DE BORD SUPABASE
-- ============================================================================
-- Authentication > Providers > Email :
--   * "Confirm email"  -> activé  (empêche l'inscription avec l'email d'autrui)
--   * "Secure email change" -> activé
--
-- Authentication > Policies :
--   * Longueur minimale du mot de passe -> 12
--
-- L'inscription publique peut rester ouverte : sans invitation valide, un
-- compte créé n'obtient aucune organisation et ne voit aucune donnée.
-- ============================================================================
