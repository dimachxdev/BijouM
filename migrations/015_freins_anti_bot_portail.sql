-- ===========================================================================
-- 015 — Freins anti-bot sur le portail cliente
-- Appliquée le 2026-10-21.
-- ===========================================================================
-- Ce que ça corrige, constaté en relisant portail_login :
--
--  1. Le compteur d'échecs était posé sur le NUMÉRO. Un bot qui essaie le
--     même code sur deux mille numéros n'enregistrait qu'un échec par
--     numéro : le blocage à cinq ne se déclenchait jamais. Le bourrage de
--     codes PIN était donc entièrement ouvert — et sur quatre chiffres, une
--     poignée de codes courants couvre une part notable du parc.
--
--  2. Le même défaut, retourné, permettait de bloquer TOUTES les clientes :
--     cinq codes faux par numéro, quinze minutes d'indisponibilité chacune,
--     en boucle et sans coût pour l'attaquant.
--
--  3. `echecs` n'était jamais remis à zéro à l'expiration du blocage. Un
--     numéro ayant atteint cinq restait re-bloqué au moindre échec suivant.
--
--  4. Aucun échec n'était consigné nulle part. Une attaque en cours était
--     invisible : rien à détecter, rien à alerter.
--
-- Le frein par appelant compte les NUMÉROS DISTINCTS visés, pas les échecs
-- bruts : une cliente qui se trompe trois fois sur son propre numéro ne
-- déclenche rien, un bot qui balaie une liste se trahit au douzième. C'est
-- ce qui rend le frein compatible avec le partage d'IP des opérateurs
-- mobiles, très répandu ici.
--
-- NOTE : le `search_path` ci-dessous inclut `extensions`. La migration 016
-- raconte pourquoi — crypt() y vit, et l'oublier coupe tout le portail.
-- ===========================================================================


-- --- L'IP réelle de l'appelant ---------------------------------------------
-- Vérifié en situation le 2026-10-21 : PostgREST expose bien `request.headers`
-- et le proxy de Supabase y pose `cf-connecting-ip`.
create or replace function app.ip_appelant()
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  v_h   json;
  v_xff text;
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  if v_h is null then return null; end if;

  -- `cf-connecting-ip` est posé par le proxy, pas par le client : il ne peut
  -- pas être forgé. C'est celui qu'on veut.
  if nullif(v_h ->> 'cf-connecting-ip', '') is not null then
    return v_h ->> 'cf-connecting-ip';
  end if;

  -- Repli. ATTENTION : `x-forwarded-for` est une liste à laquelle le proxy
  -- AJOUTE l'IP réelle EN DERNIER. Prendre le premier élément — l'erreur
  -- classique — laisserait un bot choisir son propre compteur en envoyant
  -- son propre en-tête, ce qui annulerait tout ce fichier.
  v_xff := nullif(v_h ->> 'x-forwarded-for', '');
  if v_xff is null then return null; end if;
  return btrim(split_part(v_xff, ',',
    coalesce(array_length(string_to_array(v_xff, ','), 1), 1)));
end $fn$;

revoke all on function app.ip_appelant() from public, anon, authenticated;


-- --- Compteur par appelant --------------------------------------------------
create table if not exists public.portail_tentatives_ip (
  ip           text primary key,
  echecs       integer     not null default 0,
  derniere     timestamptz not null default now(),
  bloque_jusqu timestamptz
);
alter table public.portail_tentatives_ip enable row level security;
-- Aucune policy, comme portail_sessions et portail_tentatives : seules les
-- fonctions SECURITY DEFINER y touchent. (Le linter le signale, c'est voulu.)


-- --- Journal des tentatives -------------------------------------------------
-- `connexions` ne peut pas servir : son `organisation_id` est NOT NULL, or une
-- tentative sur un numéro inexistant n'appartient à aucune boutique — et c'est
-- exactement la trace d'un bourrage qu'on veut garder.
--
-- Le numéro n'est jamais stocké en clair : une empreinte pour compter les
-- numéros distincts, et les quatre derniers chiffres pour qu'un humain
-- reconnaisse sa cliente. Journaliser en clair les numéros visés par un
-- bourrage reviendrait à constituer un fichier qu'on n'a aucune raison de
-- détenir.
create table if not exists public.portail_journal (
  id              bigserial primary key,
  ip              text,
  tel_hash        text,
  tel_masque      text,
  organisation_id uuid,
  resultat        text not null check (resultat in ('succes','echec','bloque')),
  created_at      timestamptz not null default now()
);
create index if not exists portail_journal_ip_date  on public.portail_journal (ip, created_at desc);
create index if not exists portail_journal_org_date on public.portail_journal (organisation_id, created_at desc);

alter table public.portail_journal enable row level security;

-- Lecture seule, et seulement sur sa propre boutique. Ni UPDATE ni DELETE :
-- même règle que `connexions`, personne n'efface une trace — pas même la
-- propriétaire. Les lignes sans boutique (numéro inconnu) ne sont visibles
-- que de l'opérateur du service.
drop policy if exists portail_journal_sel on public.portail_journal;
create policy portail_journal_sel on public.portail_journal
  for select to authenticated
  using (
    (organisation_id is not null and organisation_id = app.current_org())
    or app.est_operateur()
  );


-- --- portail_login, avec ses deux freins -----------------------------------
create or replace function public.portail_login(p_tel text, p_pin text)
returns json
language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  v_client    record;
  v_tent      record;
  v_ip_tent   record;
  v_token     uuid;
  v_distincts int;
  v_tel       text := regexp_replace(coalesce(p_tel,''), '\D', '', 'g');
  v_ip        text := app.ip_appelant();
  v_hash      text;
  v_masque    text;
  v_org       uuid;

  c_max         constant int      := 5;                    -- par numéro
  c_blocage     constant interval := interval '15 minutes';
  c_max_numeros constant int      := 12;                   -- numéros distincts par IP
  c_fenetre_ip  constant interval := interval '30 minutes';
  c_blocage_ip  constant interval := interval '60 minutes';
begin
  v_hash   := md5(v_tel);
  v_masque := case when length(v_tel) >= 4 then '…' || right(v_tel, 4) else '…' end;

  -- Ménage, à l'occasion d'une connexion plutôt qu'avec une tâche planifiée.
  delete from public.portail_sessions      where expire_le < now();
  delete from public.portail_tentatives_ip where derniere < now() - interval '7 days';
  delete from public.portail_journal       where created_at < now() - interval '90 days';

  -- ---- 1. L'appelant est-il déjà bloqué ? ---------------------------------
  if v_ip is not null then
    select * into v_ip_tent from public.portail_tentatives_ip where ip = v_ip;
    if found and v_ip_tent.bloque_jusqu is not null then
      if v_ip_tent.bloque_jusqu > now() then
        insert into public.portail_journal (ip, tel_hash, tel_masque, resultat)
        values (v_ip, v_hash, v_masque, 'bloque');
        return json_build_object('ok', false, 'erreur',
          'Trop de tentatives depuis cet appareil. Réessayez dans '
          || ceil(extract(epoch from (v_ip_tent.bloque_jusqu - now()))/60)::int
          || ' minutes.');
      else
        -- Le blocage a expiré : on repart de zéro, sinon l'appelant resterait
        -- bloqué au premier échec suivant.
        update public.portail_tentatives_ip
           set echecs = 0, bloque_jusqu = null where ip = v_ip;
      end if;
    end if;
  end if;

  -- ---- 2. Forme des identifiants ------------------------------------------
  -- Une saisie malformée coûte aussi une tentative : sinon un bot dispose
  -- d'un canal gratuit pour sonder.
  if v_tel = '' or p_pin is null or length(p_pin) <> 4 or p_pin !~ '^\d{4}$' then
    if v_ip is not null then
      insert into public.portail_tentatives_ip (ip, echecs, derniere)
      values (v_ip, 1, now())
      on conflict (ip) do update
        set echecs = public.portail_tentatives_ip.echecs + 1, derniere = now();
    end if;
    insert into public.portail_journal (ip, tel_hash, tel_masque, resultat)
    values (v_ip, v_hash, v_masque, 'echec');
    return json_build_object('ok', false, 'erreur', 'Téléphone ou code PIN incorrect.');
  end if;

  -- ---- 3. Ce numéro est-il bloqué ? ---------------------------------------
  select * into v_tent from public.portail_tentatives where tel = v_tel;
  if found and v_tent.bloque_jusqu is not null then
    if v_tent.bloque_jusqu > now() then
      insert into public.portail_journal (ip, tel_hash, tel_masque, resultat)
      values (v_ip, v_hash, v_masque, 'bloque');
      return json_build_object('ok', false, 'erreur',
        'Trop de tentatives. Réessayez dans '
        || ceil(extract(epoch from (v_tent.bloque_jusqu - now()))/60)::int || ' minutes.');
    else
      update public.portail_tentatives
         set echecs = 0, bloque_jusqu = null where tel = v_tel;
      v_tent.echecs := 0;
    end if;
  end if;

  -- ---- 4. Vérification du code -------------------------------------------
  select c.id, c.nom, c.tel, c.email, c.organisation_id into v_client
    from public.clients c
   where regexp_replace(coalesce(c.tel,''), '\D', '', 'g') = v_tel
     and c.pin_hash is not null
     and c.pin_hash = crypt(p_pin, c.pin_hash)
   limit 1;

  if not found then
    -- Compteur du numéro, comme avant.
    insert into public.portail_tentatives (tel, echecs, derniere)
    values (v_tel, 1, now())
    on conflict (tel) do update
      set echecs = public.portail_tentatives.echecs + 1,
          derniere = now(),
          bloque_jusqu = case when public.portail_tentatives.echecs + 1 >= c_max
                              then now() + c_blocage else null end;

    -- La boutique visée, si le numéro existe — pour que la propriétaire voie
    -- les tentatives qui la concernent.
    select c.organisation_id into v_org from public.clients c
     where regexp_replace(coalesce(c.tel,''), '\D', '', 'g') = v_tel limit 1;

    insert into public.portail_journal (ip, tel_hash, tel_masque, organisation_id, resultat)
    values (v_ip, v_hash, v_masque, v_org, 'echec');

    -- Compteur de l'appelant. On ne compte pas les échecs bruts mais les
    -- NUMÉROS DISTINCTS visés : une cliente qui se trompe trois fois sur son
    -- propre numéro ne doit rien déclencher, alors qu'un bot qui balaie une
    -- liste se trahit dès le douzième. C'est ce qui rend le frein compatible
    -- avec le partage d'IP des opérateurs mobiles.
    if v_ip is not null then
      select count(distinct tel_hash) into v_distincts
        from public.portail_journal
       where ip = v_ip and resultat = 'echec'
         and created_at > now() - c_fenetre_ip;

      insert into public.portail_tentatives_ip (ip, echecs, derniere)
      values (v_ip, 1, now())
      on conflict (ip) do update
        set echecs   = public.portail_tentatives_ip.echecs + 1,
            derniere = now();

      if v_distincts >= c_max_numeros then
        update public.portail_tentatives_ip
           set bloque_jusqu = now() + c_blocage_ip where ip = v_ip;
      end if;
    end if;

    return json_build_object('ok', false, 'erreur', 'Téléphone ou code PIN incorrect.');
  end if;

  -- ---- 5. Succès -----------------------------------------------------------
  delete from public.portail_tentatives where tel = v_tel;
  if v_ip is not null then
    delete from public.portail_tentatives_ip where ip = v_ip;
  end if;

  insert into public.portail_journal (ip, tel_hash, tel_masque, organisation_id, resultat)
  values (v_ip, v_hash, v_masque, v_client.organisation_id, 'succes');

  insert into public.portail_sessions (client_id, organisation_id)
  values (v_client.id, v_client.organisation_id)
  returning token into v_token;

  return json_build_object('ok', true, 'token', v_token,
    'client', json_build_object('id', v_client.id, 'nom', v_client.nom,
                                'tel', v_client.tel, 'email', v_client.email));
end $fn$;

revoke all on function public.portail_login(text, text) from public;
grant execute on function public.portail_login(text, text) to anon, authenticated;
