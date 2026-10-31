-- ===========================================================================
-- 029 — Le site internet de la boutique
-- Écrite le 2026-10-31. Complète la 028.
-- ===========================================================================
-- Oubli de la vitrine : une bijouterie qui a son propre site doit pouvoir y
-- renvoyer. Trois endroits à toucher ensemble, sinon la colonne existe et
-- ne sert à rien — c'est le travers que ce projet a déjà payé :
--
--   1. la colonne ;
--   2. le `grant update` nommé de la migration 027 — sans quoi l'écran
--      « Profil boutique » reçoit un « permission denied » incompréhensible ;
--   3. `boutique_publique()`, qui énumère ses champs à la main et ne
--      renverra donc jamais une colonne qu'on ne lui a pas nommée.
--
-- Et côté navigateur, la liste `select` d'`auth.js` : sans elle le champ
-- s'enregistre en base et n'apparaît jamais à l'écran.
--
-- ─────────────────────────── Pourquoi une URL ici ─────────────────────────
--
-- Contrairement aux réseaux sociaux, stockés en pseudos parce qu'une URL
-- saisie finirait dans un `href` ou `javascript:` passerait, un site web ne
-- se reconstruit pas : il n'a pas de forme prévisible. On accepte donc
-- l'URL complète, et on la contraint **en base** à commencer par https —
-- exactement comme `maps_url`. Le navigateur est une commodité, jamais une
-- barrière.
-- ===========================================================================

alter table public.organisations add column if not exists site_web text;

comment on column public.organisations.site_web is
  'URL complete du site de la boutique. https obligatoire (contrainte) : une
   URL saisie atterrit dans un href, et esc() ne protege pas de javascript:.';

alter table public.organisations drop constraint if exists organisations_site_web_check;
alter table public.organisations add  constraint organisations_site_web_check
  check (site_web is null or site_web ~ '^https://[^\s<>"]+$');

-- La liste nommee de la 027, plus `site_web`. `plan`, `expire_le`, `actif`,
-- `slug`, `id`, `created_at`, `devise` et `fuseau` restent dehors.
grant update (
  nom, slogan, adresse, telephone, ninea, rccm, pied_facture, logo,
  whatsapp, email, maps_url, repere, horaires, presentation,
  instagram, facebook, tiktok, site_web
) on public.organisations to authenticated;


-- ---------------------------------------------------------------------------
-- La vitrine renvoie le champ en plus. Corps identique a la 028 par ailleurs.
-- ---------------------------------------------------------------------------
create or replace function public.boutique_publique(p_slug text)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org record;
begin
  if p_slug is null or btrim(p_slug) = '' then
    return json_build_object('ok', false, 'erreur', 'Boutique introuvable.');
  end if;

  begin
    select * into strict v_org from public.organisations
     where upper(slug) = upper(btrim(p_slug));
  exception
    when no_data_found then
      return json_build_object('ok', false, 'erreur', 'Boutique introuvable.');
    when too_many_rows then
      raise exception 'Plusieurs boutiques portent le code % : unicite rompue.', p_slug;
  end;

  -- Liste ecrite a la main : ce qui n'est pas nomme ici ne peut pas sortir,
  -- y compris une colonne sensible ajoutee a la table plus tard.
  return json_build_object(
    'ok', true,
    'slug',         v_org.slug,
    'nom',          v_org.nom,
    'slogan',       v_org.slogan,
    'presentation', v_org.presentation,
    'logo',         v_org.logo,
    'adresse',      v_org.adresse,
    'repere',       v_org.repere,
    'maps_url',     v_org.maps_url,
    'horaires',     v_org.horaires,
    'telephone',    v_org.telephone,
    'whatsapp',     app.normaliser_tel(v_org.whatsapp),
    'email',        v_org.email,
    'site_web',     v_org.site_web,
    'instagram',    ltrim(coalesce(v_org.instagram, ''), '@'),
    'facebook',     ltrim(coalesce(v_org.facebook,  ''), '@'),
    'tiktok',       ltrim(coalesce(v_org.tiktok,    ''), '@')
  );
end $function$;

revoke all on function public.boutique_publique(text) from public;
grant execute on function public.boutique_publique(text) to anon, authenticated;


-- ===========================================================================
-- APRES APPLICATION
-- ===========================================================================
-- 1.   select public.boutique_publique('MBSS');
--      Doit contenir `site_web`, et toujours NI plan, NI expire_le, NI actif,
--      NI ninea, NI rccm.
--
-- 2.   Sous l'identite d'une proprietaire :
--        update organisations set site_web='https://exemple.sn' ...  → OK
--        update organisations set site_web='javascript:alert(1)' ... → REFUSE
-- ===========================================================================
