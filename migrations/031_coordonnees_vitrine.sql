-- ===========================================================================
-- 031 — Les coordonnées de la boutique, pour la carte intégrée
-- Écrite le 2026-11-02.
-- ===========================================================================
-- La vitrine affiche désormais une carte Google en bas de page. Elle a
-- besoin d'un point, pas d'une adresse : nourrir l'iframe avec le texte
-- saisi (« Marché Ndar en face fleuve ») ferait atterrir Google
-- approximativement dans la ville. Pour une bijouterie, une épingle au
-- mauvais endroit est pire que pas de carte du tout.
--
-- D'où deux colonnes numériques, posées ou absentes ensemble. Sans elles, la
-- carte ne s'affiche pas et le bouton « Itinéraire » reste le seul chemin —
-- ce qui est un repli correct, pas une panne.
--
-- ───────────────────── Ce que cette migration acte ────────────────────────
--
-- La carte intégrée est une BRÈCHE DÉLIBÉRÉE dans la règle 6, décidée le
-- 2026-11-02 après que l'alternative sans tiers (un plan d'accès en image
-- téléversée) a été proposée et écartée. À inscrire noir sur blanc, parce
-- que Turnstile et EmailJS avaient été refusés pour exactement ce motif :
--
--   — `boutique.html` ne porte AUCUN jeton. Ni session Supabase, ni JWT, ni
--     localStorage. Le danger que la règle 6 vise — « un CDN compromis
--     exécute son code dans la page, avec accès au jeton de session » — n'a
--     pas de prise ici. C'est ce qui rend la brèche acceptable, et c'est
--     aussi sa limite : **elle ne s'étend à aucune autre page.**
--
--   — Ce qui est accepté en échange : Google voit chaque visiteuse de chaque
--     vitrine. Atténué par `loading="lazy"` — l'iframe ne se charge qu'une
--     fois la carte atteinte, et la plupart des visiteuses s'arrêtent aux
--     horaires — et par `referrerpolicy="no-referrer"`, qui lui cache de
--     quelle boutique on vient.
--
-- Ne jamais invoquer cette brèche pour en ouvrir une autre : `index.html`,
-- `operateur.html` et `client.html` portent des jetons, et la règle 6 y
-- reste entière.
-- ===========================================================================

alter table public.organisations add column if not exists lat numeric(9,6);
alter table public.organisations add column if not exists lng numeric(9,6);

comment on column public.organisations.lat is
  'Latitude de la boutique, pour la carte de la vitrine. Avec `lng`, ou ni l''une ni l''autre.';

-- Un point hors du monde ne vient pas d'une saisie legitime.
alter table public.organisations drop constraint if exists organisations_coord_check;
alter table public.organisations add  constraint organisations_coord_check
  check (
    (lat is null and lng is null)
    or (lat between -90 and 90 and lng between -180 and 180)
  );

-- Les deux ensemble, jamais l'une seule : une latitude orpheline placerait
-- l'epingle sur le meridien de Greenwich, c'est-a-dire n'importe ou.
alter table public.organisations drop constraint if exists organisations_coord_paire;
alter table public.organisations add  constraint organisations_coord_paire
  check ((lat is null) = (lng is null));

grant update (
  nom, slogan, adresse, telephone, ninea, rccm, pied_facture, logo,
  whatsapp, email, maps_url, repere, horaires, presentation,
  instagram, facebook, tiktok, site_web, couverture, lat, lng
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
    'lat',          v_org.lat,
    'lng',          v_org.lng,
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
