-- ============================================================================
-- KAYOR SaaS — 006 : EMAIL RECOPIÉ SUR `membres`
-- ----------------------------------------------------------------------------
-- Défaut corrigé : la liste des membres interrogeait
--   /rest/v1/membres?select=...,utilisateur:user_id(email)
-- en espérant embarquer auth.users. Or PostgREST n'expose que le schéma
-- `public` — la requête répondait 400 et l'écran « Membres » restait vide.
--
-- On recopie donc l'email sur `membres`, alimenté par le trigger d'inscription
-- et par app.rattacher_membre(). Comme c'est une copie, elle est verrouillée en
-- écriture : sans cela, un membre pourrait changer l'email affiché en face de
-- son nom et se faire passer pour quelqu'un d'autre dans la liste.
--
-- ÉTAT : appliquée sur le projet Supabase.
-- ============================================================================

begin;

alter table public.membres add column if not exists email text;

update public.membres m
   set email = u.email
  from auth.users u
 where u.id = m.user_id and m.email is null;

-- Le trigger d'inscription renseigne l'email au rattachement.
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv record;
begin
  select * into v_inv from public.invitations
   where lower(email) = lower(new.email) and utilisee_le is null and expire_le > now()
   order by created_at desc limit 1;

  if not found then return new; end if;

  insert into public.membres (user_id, organisation_id, nom, role, actif, email)
  values (new.id, v_inv.organisation_id, v_inv.nom, v_inv.role, true, new.email)
  on conflict (user_id, organisation_id) do nothing;

  update public.invitations set utilisee_le = now() where id = v_inv.id;
  return new;
end $$;

create or replace function app.rattacher_membre(
  p_email text, p_slug text, p_nom text, p_role text default 'vendeur'
)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
  v_org  uuid;
begin
  select id into v_user from auth.users           where email = lower(p_email);
  select id into v_org  from public.organisations where slug  = p_slug;

  if v_user is null then return 'Compte auth introuvable : ' || p_email; end if;
  if v_org  is null then return 'Organisation introuvable : ' || p_slug;  end if;

  insert into public.membres (user_id, organisation_id, nom, role, actif, email)
  values (v_user, v_org, p_nom, p_role, true, lower(p_email))
  on conflict (user_id, organisation_id)
    do update set nom = excluded.nom, role = excluded.role, actif = true, email = excluded.email;

  return 'OK : ' || p_email || ' -> ' || p_slug || ' (' || p_role || ')';
end $$;

-- L'email est une recopie : il ne doit jamais être modifiable via l'API.
create or replace function app.membres_email_readonly()
returns trigger language plpgsql as $$
begin
  new.email := old.email;
  return new;
end $$;

drop trigger if exists membres_email_lock on public.membres;
create trigger membres_email_lock
  before update on public.membres
  for each row execute function app.membres_email_readonly();

commit;

-- ============================================================================
-- CONSÉQUENCE À CONNAÎTRE
-- ============================================================================
-- Depuis 001, `organisation_id` a pour défaut app.current_org(), exécutable
-- par `authenticated` seulement. Les écritures anonymes échouent donc avec
--   42501 permission denied for function current_org
-- C'est voulu, mais cela signifie que l'application ne peut plus rien écrire
-- tant qu'aucun compte Auth n'existe. Créer le premier propriétaire :
--
--   1. Dashboard > Authentication > Users > Add user (mot de passe >= 12 car.)
--   2. select app.rattacher_membre('votre@email.com','KAY','Votre Nom','proprietaire');
-- ============================================================================
