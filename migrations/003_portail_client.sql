-- ============================================================================
-- KAYOR SaaS — 003 : SÉCURISATION DU PORTAIL CLIENT
-- ----------------------------------------------------------------------------
-- Problème actuel : le code PIN est stocké en clair dans `clients.pin`, et
-- client.js le compare côté navigateur après avoir téléchargé la fiche client.
-- Conséquences :
--   * la clé publiable suffit à lire tous les PIN de tous les clients ;
--   * un PIN à 4 chiffres = 10 000 combinaisons, testables en quelques
--     secondes via l'API REST, sans aucune limite de tentatives.
--
-- Solution : le PIN ne quitte jamais le serveur.
--   * stocké en bcrypt (pgcrypto), jamais lisible ;
--   * vérifié par une fonction SECURITY DEFINER ;
--   * blocage après 5 échecs pendant 15 minutes ;
--   * le portail reçoit un jeton de session à durée de vie courte, et
--     n'accède JAMAIS aux tables directement.
--
-- PRÉREQUIS : 001 et 002 exécutés.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. PIN HACHÉ
-- ============================================================================
alter table public.clients add column if not exists pin_hash text;

-- Reprise des PIN existants en clair -> bcrypt, puis effacement du clair.
update public.clients
   set pin_hash = crypt(pin, gen_salt('bf', 10))
 where pin is not null and pin <> '' and pin_hash is null;

alter table public.clients drop column if exists pin;

comment on column public.clients.pin_hash is
  'Empreinte bcrypt du code PIN. Jamais exposée : les policies RLS n''autorisent pas la lecture de cette colonne par le portail.';

-- ============================================================================
-- 2. ANTI-FORCE BRUTE
-- ============================================================================
create table if not exists public.portail_tentatives (
  tel          text        not null,
  echecs       int         not null default 0,
  bloque_jusqu timestamptz,
  derniere     timestamptz not null default now(),
  primary key (tel)
);

alter table public.portail_tentatives enable row level security;
-- Aucune policy, et aucun grant pour anon/authenticated : cette table n'est
-- atteignable que par les fonctions SECURITY DEFINER ci-dessous.
revoke all on public.portail_tentatives from anon, authenticated;

-- ============================================================================
-- 3. SESSIONS DU PORTAIL
-- ============================================================================
create table if not exists public.portail_sessions (
  token           uuid        primary key default gen_random_uuid(),
  client_id       text        not null,
  organisation_id uuid        not null references public.organisations(id) on delete cascade,
  cree_le         timestamptz not null default now(),
  expire_le       timestamptz not null default now() + interval '2 hours'
);

create index if not exists portail_sessions_expire_idx on public.portail_sessions(expire_le);

alter table public.portail_sessions enable row level security;
-- Idem : un jeton de session volé dans cette table donnerait accès à un compte
-- client, elle reste donc invisible depuis l'API.
revoke all on public.portail_sessions from anon, authenticated;

-- ============================================================================
-- 4. CONNEXION AU PORTAIL
-- ============================================================================
-- Seule fonction exposée à `anon`. Renvoie un jeton, jamais la fiche client
-- ni le hash. Le message d'erreur est identique que le téléphone soit inconnu
-- ou le PIN faux, pour ne pas révéler quels numéros sont clients.
create or replace function public.portail_login(p_tel text, p_pin text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client   record;
  v_tent     record;
  v_token    uuid;
  c_max_essais constant int      := 5;
  c_blocage    constant interval := interval '15 minutes';
begin
  if p_tel is null or p_pin is null or length(p_pin) <> 4 then
    return json_build_object('ok', false, 'erreur', 'Identifiants invalides.');
  end if;

  -- 4a. Compte bloqué ?
  select * into v_tent from public.portail_tentatives where tel = p_tel;
  if found and v_tent.bloque_jusqu is not null and v_tent.bloque_jusqu > now() then
    return json_build_object(
      'ok', false,
      'erreur', 'Trop de tentatives. Réessayez dans '
                || ceil(extract(epoch from (v_tent.bloque_jusqu - now())) / 60)::int
                || ' minutes.'
    );
  end if;

  -- 4b. Vérification du PIN (comparaison bcrypt, à temps constant)
  select c.id, c.nom, c.tel, c.organisation_id
    into v_client
    from public.clients c
   where c.tel = p_tel
     and c.pin_hash is not null
     and c.pin_hash = crypt(p_pin, c.pin_hash)
   limit 1;

  if not found then
    insert into public.portail_tentatives (tel, echecs, derniere)
    values (p_tel, 1, now())
    on conflict (tel) do update
      set echecs       = public.portail_tentatives.echecs + 1,
          derniere     = now(),
          bloque_jusqu = case
                           when public.portail_tentatives.echecs + 1 >= c_max_essais
                           then now() + c_blocage
                           else null
                         end;
    return json_build_object('ok', false, 'erreur', 'Téléphone ou code PIN incorrect.');
  end if;

  -- 4c. Succès : on remet le compteur à zéro et on ouvre une session
  delete from public.portail_tentatives where tel = p_tel;
  delete from public.portail_sessions   where expire_le < now();

  insert into public.portail_sessions (client_id, organisation_id)
  values (v_client.id, v_client.organisation_id)
  returning token into v_token;

  return json_build_object(
    'ok',     true,
    'token',  v_token,
    'client', json_build_object('id', v_client.id, 'nom', v_client.nom, 'tel', v_client.tel)
  );
end $$;

-- ============================================================================
-- 5. LECTURE DES DONNÉES DU CLIENT CONNECTÉ
-- ============================================================================
create or replace function public.portail_donnees(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sess   record;
  v_nom    text;
  v_result json;
begin
  select * into v_sess
    from public.portail_sessions
   where token = p_token and expire_le > now();

  if not found then
    return json_build_object('ok', false, 'erreur', 'Session expirée.');
  end if;

  select nom into v_nom from public.clients where id = v_sess.client_id;

  select json_build_object(
    'ok', true,
    'comptes', coalesce((
      select json_agg(json_build_object(
        'id', cc.id, 'solde', cc.solde, 'actif', cc.actif,
        'date_ouverture', cc.date_ouverture,
        'mouvements', coalesce((
          select json_agg(json_build_object(
            'date', m.date, 'type', m.type, 'montant', m.montant, 'note', m.note
          ) order by m.date desc)
          from public.mouvements_cc m
          where m.compte_id = cc.id
        ), '[]'::json)
      ))
      from public.comptes_clients cc
      where cc.organisation_id = v_sess.organisation_id
        and cc.client = v_nom
    ), '[]'::json),
    'commandes', coalesce((
      select json_agg(json_build_object(
        'id', v.id, 'date', v.date, 'description', v.description,
        'montant', v.montant, 'acompte', v.acompte, 'restant', v.restant,
        'num_facture', v.num_facture
      ) order by v.date desc)
      from public.ventes v
      where v.organisation_id = v_sess.organisation_id
        and v.client = v_nom
        and coalesce(v.restant, 0) > 0
    ), '[]'::json)
  ) into v_result;

  return v_result;
end $$;

-- ============================================================================
-- 6. DÉPÔT SUR COMPTE ÉPARGNE
-- ============================================================================
-- Le montant est validé côté serveur : le client ne peut ni déposer une somme
-- négative, ni viser un compte qui ne lui appartient pas.
create or replace function public.portail_depot(
  p_token   uuid,
  p_compte  text,
  p_montant int,
  p_note    text default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sess   record;
  v_nom    text;
  v_compte record;
begin
  select * into v_sess
    from public.portail_sessions
   where token = p_token and expire_le > now();
  if not found then
    return json_build_object('ok', false, 'erreur', 'Session expirée.');
  end if;

  if p_montant is null or p_montant <= 0 or p_montant > 50000000 then
    return json_build_object('ok', false, 'erreur', 'Montant invalide.');
  end if;

  select nom into v_nom from public.clients where id = v_sess.client_id;

  -- Le compte doit appartenir au client ET à son organisation.
  select * into v_compte
    from public.comptes_clients
   where id = p_compte
     and client = v_nom
     and organisation_id = v_sess.organisation_id
     and actif;

  if not found then
    return json_build_object('ok', false, 'erreur', 'Compte introuvable.');
  end if;

  insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
  values (p_compte, to_char(now(), 'YYYY-MM-DD'), 'depot', p_montant,
          coalesce(p_note, 'Dépôt portail client'), v_sess.organisation_id);

  update public.comptes_clients
     set solde = coalesce(solde, 0) + p_montant
   where id = p_compte;

  return json_build_object('ok', true, 'nouveau_solde', coalesce(v_compte.solde, 0) + p_montant);
end $$;

-- ============================================================================
-- 7. DÉCONNEXION
-- ============================================================================
create or replace function public.portail_logout(p_token uuid)
returns json
language sql
security definer
set search_path = public, pg_temp
as $$
  with suppr as (delete from public.portail_sessions where token = p_token returning 1)
  select json_build_object('ok', true);
$$;

-- ============================================================================
-- 8. PRIVILÈGES — anon n'obtient QUE ces quatre fonctions
-- ============================================================================
revoke all on function public.portail_login(text, text)                 from public;
revoke all on function public.portail_donnees(uuid)                     from public;
revoke all on function public.portail_depot(uuid, text, int, text)      from public;
revoke all on function public.portail_logout(uuid)                      from public;

grant execute on function public.portail_login(text, text)            to anon;
grant execute on function public.portail_donnees(uuid)                to anon;
grant execute on function public.portail_depot(uuid, text, int, text) to anon;
grant execute on function public.portail_logout(uuid)                 to anon;

commit;

-- ============================================================================
-- NOTE — robustesse du PIN
-- ============================================================================
-- Un PIN à 4 chiffres reste faible par construction (10 000 combinaisons).
-- Le blocage après 5 échecs le rend acceptable pour un portail de consultation.
-- Pour un usage plus sensible (virements, montants élevés), passer à une
-- authentification par OTP SMS via Supabase Auth (signInWithOtp).
