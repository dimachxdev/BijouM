-- ===========================================================================
-- 028 — La vitrine publique de la boutique
-- Écrite le 2026-10-31.
-- ===========================================================================
-- Jusqu'ici, tout ce qu'une boutique renseigne sert la FACTURE : nom, adresse,
-- téléphone, NINEA, RCCM, pied de page. Rien ne s'adresse à une cliente qui
-- découvre la bijouterie.
--
-- Cette migration pose les champs d'une page publique, et la seule porte par
-- laquelle on la lit. Le QR code imprimé sur la facture mènera à cette page.
--
-- ─────────────────── Pourquoi une fonction, pas une policy ─────────────────
--
-- Il aurait été plus court d'ouvrir `organisations` en lecture à `anon`. Ce
-- serait la faute de la migration 027, retournée : **une policy RLS dit
-- quelles lignes, jamais quelles colonnes.** Or `anon` a déjà le `SELECT` sur
-- toutes les colonnes de cette table — `plan`, `expire_le` et `actif`
-- compris. Une policy permissive publierait donc l'état commercial de chaque
-- boutique à qui sait écrire une URL.
--
-- `boutique_publique()` énumère ses champs à la main. Ce qui n'y figure pas
-- ne peut pas sortir, et l'ajout d'une colonne sensible à la table ne change
-- rien à ce que la fonction renvoie.
--
-- ───────────────────────── Ce qui N'EST PAS publié ─────────────────────────
--
--   plan, expire_le, actif   l'abonnement ne regarde que l'opérateur et la
--                            propriétaire.
--   ninea, rccm              décidé le 2026-10-31. Ils restent sur la
--                            facture, où ils ont une raison d'être légale.
--                            Une page publique n'est pas un extrait Kbis.
--   id, created_at           sans intérêt pour une cliente.
--
-- ────────────────── Une boutique suspendue garde sa vitrine ────────────────
--
-- La fonction ne filtre pas sur `actif`. C'est délibéré : afficher « boutique
-- suspendue » exposerait aux clientes de la bijoutière le fait qu'elle est en
-- retard de paiement envers NOUS. Sa vitrine n'est pas notre levier
-- commercial — le levier, c'est l'écriture en base, déjà coupée par
-- `app.org_active()`.
--
-- ─────────── Les réseaux sont des PSEUDOS, pas des adresses ────────────────
--
-- `instagram`, `facebook`, `tiktok` stockent « marjanbijouterie », pas une
-- URL complète. La page construit le lien.
--
-- Ce n'est pas cosmétique. Une URL saisie par la boutique finit dans un
-- `href` ; `esc()` échappe le HTML mais laisse passer `javascript:...`, qui
-- s'exécuterait chez la visiteuse. Avec un pseudo, le schéma de l'adresse
-- n'est jamais entre les mains de celle qui saisit.
--
-- `maps_url` est la seule vraie URL, parce qu'un lien de carte ne se
-- reconstruit pas. Elle porte donc une contrainte : https, et rien d'autre.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Les colonnes
-- ---------------------------------------------------------------------------
alter table public.organisations add column if not exists whatsapp     text;
alter table public.organisations add column if not exists email        text;
alter table public.organisations add column if not exists maps_url     text;
alter table public.organisations add column if not exists repere       text;
alter table public.organisations add column if not exists horaires     text;
alter table public.organisations add column if not exists presentation text;
alter table public.organisations add column if not exists instagram    text;
alter table public.organisations add column if not exists facebook     text;
alter table public.organisations add column if not exists tiktok       text;

comment on column public.organisations.repere   is
  'Point de repere : « en face de la pharmacie ». Ici une adresse se dit souvent ainsi.';
comment on column public.organisations.horaires is
  'Texte libre, une ligne par jour. La page les affiche en liste.';
comment on column public.organisations.instagram is
  'PSEUDO seul (« marjanbijouterie »), jamais une URL : voir l''en-tete de la migration 028.';


-- ---------------------------------------------------------------------------
-- 2. Valider dans la base, pas seulement dans le formulaire
-- ---------------------------------------------------------------------------
-- Le navigateur est une commodite, jamais une barriere.

alter table public.organisations drop constraint if exists organisations_maps_url_check;
alter table public.organisations add  constraint organisations_maps_url_check
  check (maps_url is null or maps_url ~ '^https://[^\s<>"]+$');

alter table public.organisations drop constraint if exists organisations_email_check;
alter table public.organisations add  constraint organisations_email_check
  check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Un pseudo de reseau social : lettres, chiffres, point, tiret bas, tiret.
-- L'arobase de tete est toleree a la saisie, la fonction la retire.
alter table public.organisations drop constraint if exists organisations_reseaux_check;
alter table public.organisations add  constraint organisations_reseaux_check
  check ((instagram is null or instagram ~ '^@?[A-Za-z0-9._-]{1,40}$')
     and (facebook  is null or facebook  ~ '^@?[A-Za-z0-9._-]{1,60}$')
     and (tiktok    is null or tiktok    ~ '^@?[A-Za-z0-9._-]{1,40}$'));

-- Le slug devient un identifiant PUBLIC : il entre dans l'URL de la vitrine,
-- donc on le cherchera sans tenir compte de la casse. Or `unique (slug)`
-- porte sur la valeur STOCKEE : rien n'empeche aujourd'hui « MBSS » et
-- « mbss » de coexister, et une recherche insensible a la casse tomberait
-- alors sur deux lignes — qu'un `select into` prendrait en silence.
-- On impose donc la majuscule, ce que `creer_boutique()` fait deja de fait.
alter table public.organisations drop constraint if exists organisations_slug_majuscule;
alter table public.organisations add  constraint organisations_slug_majuscule
  check (slug is null or slug = upper(slug));


-- ---------------------------------------------------------------------------
-- 3. Le droit d'ecriture, colonne par colonne
-- ---------------------------------------------------------------------------
-- La migration 027 a remplace l'UPDATE global par une liste nommee, parce
-- qu'une proprietaire pouvait sinon s'octroyer `plan` et `expire_le`. Toute
-- colonne nouvelle doit donc etre ajoutee ICI, sinon l'ecran « Profil
-- boutique » recevra un « permission denied » incomprehensible.
--
-- `plan`, `expire_le`, `actif`, `slug`, `id`, `created_at`, `devise` et
-- `fuseau` restent hors de cette liste : operateur seul.
grant update (
  nom, slogan, adresse, telephone, ninea, rccm, pied_facture, logo,
  whatsapp, email, maps_url, repere, horaires, presentation,
  instagram, facebook, tiktok
) on public.organisations to authenticated;


-- ---------------------------------------------------------------------------
-- 4. La seule porte vers la vitrine
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

  -- `unique (slug)` plus la contrainte de majuscule posee ci-dessus rendent
  -- l'ambiguite impossible. `into strict` est la ceinture : si elle devenait
  -- possible un jour, la fonction crierait au lieu de servir au hasard la
  -- vitrine d'une autre boutique.
  begin
    select * into strict v_org from public.organisations
     where upper(slug) = upper(btrim(p_slug));
  exception
    when no_data_found then
      -- Message neutre : on ne dit pas si le code existe mais est ferme.
      return json_build_object('ok', false, 'erreur', 'Boutique introuvable.');
    when too_many_rows then
      raise exception 'Plusieurs boutiques portent le code % : unicite rompue.', p_slug;
  end;

  -- Liste ecrite a la main. Ce qui n'est pas nomme ici ne peut pas sortir —
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
    -- Normalise ici, jamais a la saisie : la boutique ecrit « 77 655 69 77 »,
    -- le lien wa.me exige « 221776556977 ».
    'whatsapp',     app.normaliser_tel(v_org.whatsapp),
    'email',        v_org.email,
    -- L'arobase de tete est retiree : la page construit l'adresse.
    'instagram',    ltrim(coalesce(v_org.instagram, ''), '@'),
    'facebook',     ltrim(coalesce(v_org.facebook,  ''), '@'),
    'tiktok',       ltrim(coalesce(v_org.tiktok,    ''), '@')
  );
end $function$;

-- Une vitrine se lit sans compte. C'est le seul point du projet, avec le
-- portail cliente, ouvert a `anon` — et comme lui, il ne lit que ce que sa
-- fonction veut bien renvoyer.
revoke all on function public.boutique_publique(text) from public;
grant execute on function public.boutique_publique(text) to anon, authenticated;


-- ===========================================================================
-- APRES APPLICATION
-- ===========================================================================
-- 1. Verifier que la fonction ne laisse rien filtrer :
--
--      select public.boutique_publique('MBSS');
--
--    Le JSON ne doit contenir NI `plan`, NI `expire_le`, NI `actif`,
--    NI `ninea`, NI `rccm`. Un slug inconnu renvoie « Boutique introuvable. »
--
-- 2. Verifier le droit d'ecriture, sous l'identite d'une proprietaire :
--
--      update organisations set horaires = 'Lun-Sam 9h-20h' where id = ...  → OK
--      update organisations set plan = 'pro' where id = ...                 → REFUSE
--
-- 3. Les etapes suivantes, dans l'ordre : l'ecran « Profil boutique »
--    (ne pas oublier la liste `select` d'`auth.js`), l'encodeur QR dans
--    `js/`, la page `boutique.html`, puis le QR sur la facture.
-- ===========================================================================
