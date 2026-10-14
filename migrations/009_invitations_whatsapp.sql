-- ============================================================================
-- KAYOR SaaS — 009 : INVITATIONS PAR NUMÉRO (WhatsApp)
-- ----------------------------------------------------------------------------
-- Pourquoi : l'équipe s'inscrivait par email, et l'email ne part pas. Au
-- Sénégal, une vendeuse a WhatsApp ; elle n'a pas forcément d'adresse qu'elle
-- consulte. On invite désormais par numéro, et Supabase Auth valide ce numéro
-- par un code à six chiffres envoyé sur WhatsApp.
--
-- Effet de bord recherché : un compte ouvert par numéro n'a PAS de mot de
-- passe. Donc pas de « mot de passe oublié », donc plus aucune dépendance à
-- l'email pour l'équipe. Les clientes gardent leur code PIN (migration 003) —
-- un OTP facturé à chaque consultation de solde n'aurait aucun sens.
--
-- Rétrocompatible : les invitations par email continuent de fonctionner, et
-- les comptes existants conservent leur mot de passe. Une invitation porte un
-- numéro, une adresse, ou les deux.
--
-- PRÉREQUIS : 001, 004, 005.
-- ============================================================================

begin;

-- ============================================================================
-- 1. NORMALISATION DES NUMÉROS
-- ============================================================================
-- Supabase stocke `auth.users.phone` en chiffres, sans le « + » : 221771234567.
-- On range tout le monde dans ce format, sinon la comparaison invitation ↔
-- compte échouerait sur un espace ou un indicatif écrit autrement.
create or replace function app.normaliser_tel(p_tel text)
returns text
language plpgsql
immutable
as $$
declare v text;
begin
  if p_tel is null then return null; end if;

  v := regexp_replace(p_tel, '[^0-9]', '', 'g');
  if v = '' then return null; end if;

  -- 00221… → 221…
  if left(v, 2) = '00' then v := substr(v, 3); end if;

  -- Numéro sénégalais écrit localement : 77 123 45 67 → 221771234567.
  -- Les mobiles sénégalais commencent par 7 et font 9 chiffres.
  if length(v) = 9 and left(v, 1) = '7' then v := '221' || v; end if;

  return v;
end $$;

comment on function app.normaliser_tel(text) is
  'Numéro en chiffres seuls, au format de auth.users.phone. Indicatif 221 ajouté aux mobiles sénégalais à 9 chiffres.';

-- ============================================================================
-- 2. COLONNES TÉLÉPHONE
-- ============================================================================
alter table public.invitations add column if not exists telephone text;
alter table public.membres     add column if not exists telephone text;

-- L'email n'est plus obligatoire : on invite par numéro OU par adresse.
alter table public.invitations alter column email drop not null;

alter table public.invitations drop constraint if exists invitations_contact_present;
alter table public.invitations add  constraint invitations_contact_present
  check (email is not null or telephone is not null);

-- Une seule invitation en attente par numéro et par boutique.
-- (L'index équivalent sur l'email existe depuis 005 ; NULL n'y entre pas.)
create unique index if not exists invitations_tel_org_uniq
  on public.invitations(telephone, organisation_id)
  where utilisee_le is null and telephone is not null;

create index if not exists invitations_tel_idx on public.invitations(telephone);
create index if not exists membres_tel_idx     on public.membres(telephone);

-- ============================================================================
-- 3. NORMALISATION À L'ÉCRITURE
-- ============================================================================
-- Faite côté serveur, pas côté navigateur : le formulaire n'est qu'un confort,
-- et une invitation peut aussi être créée par `creer_boutique()`.
create or replace function app.normaliser_invitation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.telephone := app.normaliser_tel(new.telephone);
  new.email     := nullif(lower(trim(coalesce(new.email, ''))), '');
  return new;
end $$;

drop trigger if exists invitations_normaliser on public.invitations;
create trigger invitations_normaliser
  before insert or update on public.invitations
  for each row execute function app.normaliser_invitation();

-- ============================================================================
-- 4. LE RATTACHEMENT ACCEPTE LE NUMÉRO
-- ============================================================================
-- Remplace la version de 005. Un compte créé par OTP WhatsApp arrive avec
-- `phone` renseigné et `email` vide ; un compte créé par mot de passe arrive
-- avec l'inverse. On cherche l'invitation sur l'un ou sur l'autre.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv record;
  v_tel text := app.normaliser_tel(new.phone);
begin
  select * into v_inv
    from public.invitations
   where utilisee_le is null
     and expire_le > now()
     and (
           (v_tel is not null and telephone = v_tel)
        or (new.email is not null and email = lower(new.email))
     )
   order by created_at desc
   limit 1;

  if not found then
    -- Compte sans invitation : il existe dans auth.users mais n'appartient à
    -- aucune boutique. app.current_org() renvoie NULL, RLS lui refuse tout.
    return new;
  end if;

  insert into public.membres (user_id, organisation_id, nom, role, actif, email, telephone)
  values (new.id, v_inv.organisation_id, v_inv.nom, v_inv.role, true,
          nullif(lower(coalesce(new.email, '')), ''), v_tel)
  on conflict (user_id, organisation_id) do nothing;

  update public.invitations set utilisee_le = now() where id = v_inv.id;

  return new;
end $$;

-- ============================================================================
-- 5. CRÉATION D'UNE BOUTIQUE : NUMÉRO DE LA PROPRIÉTAIRE
-- ============================================================================
-- La console opérateur n'avait que l'email. Le numéro devient le canal
-- principal ; l'email reste accepté pour les boutiques qui en ont un.
create or replace function public.creer_boutique(
  p_nom                text,
  p_slug               text,
  p_email_proprietaire text,
  p_nom_proprietaire   text,
  p_plan               text default 'essai',
  p_jours_essai        integer default 30,
  p_tel_proprietaire   text default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_tel   text := app.normaliser_tel(p_tel_proprietaire);
  v_email text := nullif(lower(trim(coalesce(p_email_proprietaire, ''))), '');
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Réservé à l''opérateur du service.');
  end if;
  if p_slug !~ '^[A-Z0-9]{2,6}$' then
    return json_build_object('ok', false, 'erreur', 'Le code boutique doit faire 2 à 6 lettres majuscules ou chiffres.');
  end if;
  if exists (select 1 from public.organisations where slug = p_slug) then
    return json_build_object('ok', false, 'erreur', 'Ce code boutique est déjà pris.');
  end if;
  if v_tel is null and v_email is null then
    return json_build_object('ok', false, 'erreur', 'Indiquez au moins un numéro WhatsApp ou une adresse email pour la propriétaire.');
  end if;

  insert into public.organisations (nom, slug, plan, actif, expire_le)
  values (p_nom, p_slug, p_plan, true,
          case when p_jours_essai > 0 then current_date + p_jours_essai else null end)
  returning id into v_org;

  insert into public.invitations (organisation_id, email, telephone, nom, role, expire_le)
  values (v_org, v_email, v_tel, p_nom_proprietaire, 'proprietaire', now() + interval '30 days');

  return json_build_object('ok', true, 'organisation_id', v_org, 'slug', p_slug,
                           'invitation_email', v_email,
                           'invitation_telephone', v_tel);
end $$;

revoke all on function public.creer_boutique(text, text, text, text, text, integer, text) from public, anon;
grant execute on function public.creer_boutique(text, text, text, text, text, integer, text) to authenticated;

-- L'ancienne signature à 6 arguments n'a plus lieu d'être : la console
-- opérateur envoie désormais les sept.
drop function if exists public.creer_boutique(text, text, text, text, text, integer);

commit;

-- ============================================================================
-- RÉGLAGES À FAIRE DANS LE TABLEAU DE BORD SUPABASE
-- ============================================================================
-- Authentication > Providers > Phone :
--   * Activer "Enable Phone provider"
--   * SMS provider  -> Twilio Verify (ou Twilio)
--   * Message channel -> WhatsApp
--   * Renseigner Account SID, Auth Token et le Service SID / expéditeur
--
-- Prérequis côté Twilio : un expéditeur WhatsApp approuvé, ce qui suppose un
-- compte Meta Business vérifié. Comptez quelques jours.
--
-- Tant que ce n'est pas fait, l'écran WhatsApp répondra « Envoi impossible » :
-- la connexion par email et mot de passe reste disponible et inchangée.
-- ============================================================================
