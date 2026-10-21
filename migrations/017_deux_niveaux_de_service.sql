-- ===========================================================================
-- 017 — Deux niveaux sur le plan service
-- Écrite le 2026-10-21. NON APPLIQUÉE : voir la note en fin de fichier.
-- ===========================================================================
-- `operateurs` était plat : on y était, ou on n'y était pas. Quiconque y
-- figurait pouvait suspendre une boutique payante ou changer son plan. Tant
-- qu'il n'y avait qu'une personne, ça ne se voyait pas.
--
-- Deux niveaux désormais, décidés le 2026-10-21 :
--
--   proprietaire  — le propriétaire du service. Lui seul touche à l'argent
--                   et à la survie d'une boutique : plan, échéance,
--                   suspension, réactivation. Lui seul nomme et révoque les
--                   opérateurs.
--
--   admin         — l'admin principal. Il ouvre des boutiques, rend son
--                   accès à une propriétaire qui l'a perdu, consulte la
--                   liste et le journal des tentatives. Il ne peut ni
--                   couper une boutique, ni changer ce qu'elle paie.
--
-- CE QUE CE FICHIER NE FAIT PAS, VOLONTAIREMENT
-- Ni l'un ni l'autre ne lit la moindre donnée métier — pas une vente, pas un
-- solde, pas une cliente. RLS filtre sur `app.current_org()` et un opérateur
-- n'est membre d'aucune organisation. Cette propriété est le socle du
-- multi-boutiques : une fuite d'un compte de service n'expose alors aucun
-- chiffre d'affaires. Décidé le 2026-10-21 de la conserver telle quelle.
-- Ne pas ouvrir de lecture inter-boutiques sans rouvrir cette décision.
-- ===========================================================================


-- --- A. Le niveau ----------------------------------------------------------
-- `nommer_operateur()` plus bas fait un `on conflict (user_id)` : il lui faut
-- une contrainte d'unicité. Je n'ai pas pu vérifier si la table en a une, donc
-- on la pose si elle manque.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.operateurs'::regclass
       and c.contype in ('p', 'u')
       and c.conkey = array[(select attnum from pg_attribute
                              where attrelid = 'public.operateurs'::regclass
                                and attname = 'user_id')]
  ) then
    alter table public.operateurs add constraint operateurs_user_id_unique unique (user_id);
  end if;
end $$;

alter table public.operateurs
  add column if not exists role text not null default 'admin'
    check (role in ('proprietaire', 'admin'));

-- Le défaut est `admin` : un opérateur ajouté sans précision est le niveau le
-- moins puissant. C'est l'inverse qui serait dangereux.

-- Le fondateur passe propriétaire du service. On le désigne par son adresse
-- plutôt que par un identifiant écrit en dur : un UUID recopié à la main dans
-- une migration est une erreur qui ne se voit qu'à l'exécution.
update public.operateurs o
   set role = 'proprietaire'
  from auth.users u
 where u.id = o.user_id
   and lower(u.email) = 'djilybgueye@gmail.com';

-- Refuser d'aller plus loin si le service se retrouvait sans propriétaire :
-- plus personne ne pourrait alors changer un plan ni nommer un opérateur.
do $$
begin
  if not exists (select 1 from public.operateurs where role = 'proprietaire') then
    raise exception
      'Aucun opérateur « proprietaire » après la bascule. Le compte djilybgueye@gmail.com est-il bien dans `operateurs` ? Migration annulée.';
  end if;
end $$;


-- --- B. Les deux questions -------------------------------------------------
-- `app.est_operateur()` existe déjà et répond « est sur le plan service ».
-- On ne le touche pas : les fonctions qui s'en servent pour ouvrir une
-- boutique ou lire le journal restent ouvertes aux deux niveaux.
-- On ajoute seulement la question plus étroite.
create or replace function app.est_proprietaire_saas()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1 from public.operateurs
     where user_id = auth.uid() and role = 'proprietaire'
  );
$fn$;

revoke all on function app.est_proprietaire_saas() from public, anon, authenticated;


-- --- C. Nommer et révoquer --------------------------------------------------
-- Ces gestes se faisaient à la main, directement dans la table. Une action
-- sans fonction est une action sans contrôle et sans trace : on la pose.

create or replace function public.nommer_operateur(p_email text, p_role text default 'admin')
returns json
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_user uuid;
  v_mail text := lower(btrim(coalesce(p_email, '')));
begin
  if not app.est_proprietaire_saas() then
    raise exception 'Réservé au propriétaire du service.' using errcode = '42501';
  end if;
  if p_role not in ('proprietaire', 'admin') then
    raise exception 'Rôle invalide : attendu « proprietaire » ou « admin ».';
  end if;

  select id into v_user from auth.users where lower(email) = v_mail;
  if v_user is null then
    raise exception 'Aucun compte avec cette adresse.';
  end if;

  insert into public.operateurs (user_id, role) values (v_user, p_role)
  on conflict (user_id) do update set role = excluded.role;

  return json_build_object('ok', true, 'user_id', v_user, 'role', p_role);
end $fn$;

create or replace function public.revoquer_operateur(p_user_id uuid)
returns json
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_role text;
begin
  if not app.est_proprietaire_saas() then
    raise exception 'Réservé au propriétaire du service.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'On ne se révoque pas soi-même.';
  end if;

  select role into v_role from public.operateurs where user_id = p_user_id;
  if v_role is null then
    raise exception 'Ce compte n''est pas opérateur.';
  end if;

  -- Garde-fou : le service ne doit jamais se retrouver sans propriétaire.
  if v_role = 'proprietaire'
     and (select count(*) from public.operateurs where role = 'proprietaire') <= 1 then
    raise exception 'C''est le dernier propriétaire du service : nommez-en un autre d''abord.';
  end if;

  delete from public.operateurs where user_id = p_user_id;
  return json_build_object('ok', true);
end $fn$;

-- Le `grant` dit qui peut frapper à la porte ; le contrôle dans le corps dit
-- qui entre. Les deux sont nécessaires.
revoke all on function public.nommer_operateur(text, text)   from public, anon;
revoke all on function public.revoquer_operateur(uuid)       from public, anon;
grant execute on function public.nommer_operateur(text, text) to authenticated;
grant execute on function public.revoquer_operateur(uuid)     to authenticated;


-- --- D. Détacher le compte du fondateur de toute boutique -------------------
-- Décidé le 2026-10-21 : djilybgueye@gmail.com est propriétaire du SERVICE,
-- et rien d'autre. Ses gestes de service et ses gestes de commerçant ne
-- doivent plus partager la même session.
--
-- Le détachement refuse de s'exécuter s'il laissait une boutique sans
-- propriétaire active — une boutique orpheline, personne ne peut plus y
-- entrer, et c'est déjà arrivé sur ce projet.
do $$
declare v_orphelines int;
begin
  select count(*) into v_orphelines
    from public.membres m
    join auth.users u on u.id = m.user_id
   where lower(u.email) = 'djilybgueye@gmail.com'
     and m.role = 'proprietaire' and m.actif
     and not exists (
       select 1 from public.membres m2
        where m2.organisation_id = m.organisation_id
          and m2.role = 'proprietaire' and m2.actif
          and m2.user_id <> m.user_id);

  if v_orphelines > 0 then
    raise exception
      'Détacher ce compte laisserait % boutique(s) sans propriétaire active. Nommer une propriétaire d''abord, puis rejouer. Migration annulée.',
      v_orphelines;
  end if;

  delete from public.membres m
   using auth.users u
   where u.id = m.user_id
     and lower(u.email) = 'djilybgueye@gmail.com';
end $$;


-- ===========================================================================
-- CE QUI RESTE À FAIRE — partie B, dans une migration 018
-- ===========================================================================
-- `modifier_boutique()` et `basculer_boutique()` doivent refuser à un `admin`
-- de changer un plan, une échéance, ou de suspendre une boutique. Ces deux
-- fonctions ont été appliquées directement en base, sans fichier ici : je ne
-- dispose pas de leur corps actuel et je refuse de les réécrire de mémoire —
-- un `create or replace` à l'aveugle perdrait du comportement.
--
-- Première chose à faire une fois la base joignable :
--   select pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('modifier_boutique', 'basculer_boutique');
--
-- Puis réintroduire leur corps à l'identique, avec en tête :
--   if not app.est_proprietaire_saas() then
--     raise exception 'Le plan et l''échéance relèvent du propriétaire du service.'
--       using errcode = '42501';
--   end if;
--
-- Tant que la partie B n'est pas posée, un `admin` conserve ces pouvoirs :
-- le modèle est en place, la restriction ne l'est pas encore.
-- ===========================================================================
