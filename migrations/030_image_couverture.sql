-- ===========================================================================
-- 030 — L'image de couverture de la vitrine
-- Écrite le 2026-10-31.
-- ===========================================================================
-- La vitrine n'avait que le logo. Une bijouterie se montre : la devanture,
-- une vitrine, une pièce. La couverture occupe le haut de la page et le logo
-- vient se poser en rond par-dessus, centré.
--
-- Quatre endroits, comme pour `site_web` (migration 029) : la colonne, le
-- `grant update` nommé de la 027, `boutique_publique()`, et la liste
-- `select` d'`auth.js` côté navigateur.
--
-- ───────────────────────────── Sur le poids ───────────────────────────────
--
-- Stockée en base64 dans la colonne, comme le logo. Ce n'est pas le bon
-- endroit à terme : le JSON de la vitrine transporte déjà le logo, et la
-- page est faite pour s'ouvrir sur un téléphone en données mobiles. Le
-- projet a déjà retiré une constante de 60 Ko de base64 pour cette raison
-- exacte (`KAYOR_LOGO_B64`, le 2026-10-21).
--
-- On accepte ici parce que Supabase Storage demanderait un bucket, une
-- politique d'accès publique et une logique d'upload séparée — trois fois
-- le travail pour une image par boutique. **Le navigateur plafonne à
-- 300 Ko** et c'est la vraie barrière : sans elle une photo d'appareil de
-- 4 Mo rendrait la vitrine inutilisable.
--
-- À reprendre le jour où une boutique voudra une galerie. Ce jour-là, c'est
-- Storage, pas une deuxième colonne.
-- ===========================================================================

alter table public.organisations add column if not exists couverture text;

comment on column public.organisations.couverture is
  'Image de couverture de la vitrine, en data URI base64. Plafonnee a 300 Ko
   par le navigateur. A migrer vers Supabase Storage si une galerie arrive.';

grant update (
  nom, slogan, adresse, telephone, ninea, rccm, pied_facture, logo,
  whatsapp, email, maps_url, repere, horaires, presentation,
  instagram, facebook, tiktok, site_web, couverture
) on public.organisations to authenticated;


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
    'couverture',   v_org.couverture,
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
