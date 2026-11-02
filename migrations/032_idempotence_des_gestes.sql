-- ============================================================================
-- 032 — Un geste ne s'enregistre qu'une fois, meme repete
-- ============================================================================
-- Constate le 2026-11-02, en essais : sur une connexion lente, rien ne signale
-- qu'une requete est partie. La personne reclique. Deux ventes, deux depots,
-- deux decaissements — et le stock deduit deux fois.
--
-- POURQUOI LA BASE NE LE VOIT PAS AUJOURD'HUI
--
-- `prochain_id()` reserve un identifiant A CHAQUE CLIC, avant l'ecriture. Les
-- deux clics ne se rencontrent donc jamais : le premier prend V-0042, le
-- second V-0043, et les deux sont des ventes parfaitement valides. Il n'existe
-- aucune contrainte a violer, donc aucun refus possible.
--
-- Mesure le 2026-11-02 a Saint-Louis (MBSS) : compteur `v` = 35 pour 15
-- ventes presentes. Les numeros se consomment au clic, pas a la vente.
--
-- `vente_sur_compte_epargne()` et `ouvrir_compte_epargne()` refusent bien un
-- identifiant deja pris (« Cette vente existe deja ») — ce controle ne sert
-- donc JAMAIS contre un double-clic. Il protege d'un rejeu a l'identique, pas
-- d'une repetition du geste.
--
-- CE QUE LE NAVIGATEUR NE PEUT PAS FERMER
--
-- Un bouton grise est du confort d'affichage (regle d'or). Il arrete le
-- deuxieme clic d'une rafale ; il n'arrete pas :
--   — le rechargement de page puis le geste refait ;
--   — l'abandon a 15 s du portail cliente (`rpc()` dans js/client.js), sur un
--     depot que le serveur avait pourtant ecrit ;
--   — deux postes qui saisissent la meme chose.
-- Le § 5 posait deja la regle pour le webhook de paiement : « Idempotence
-- obligatoire. Une notification est rejouee. » C'est la meme regle, appliquee
-- plus tot et au comptoir.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- 1. Une table `gestes` : (organisation_id, cle) et le RESULTAT du geste.
--    Le navigateur tire une cle a l'ouverture de chaque fenetre de saisie et
--    la renvoie telle quelle a chaque tentative. La fonction reserve la cle
--    avant d'ecrire ; si elle est deja prise, elle rend le resultat garde au
--    lieu d'ecrire une seconde fois.
--
--    POURQUOI UNE TABLE ET NON UNE COLONNE : `enregistrer_paiement_vente()`
--    n'insere aucune ligne — elle fait `acompte = acompte + montant` sur la
--    vente. Il n'y a nulle part ou accrocher une cle unique. C'est justement
--    le geste ou un doublon se voit le moins et coute le plus : l'acompte
--    d'une cliente credite deux fois.
--
-- 2. Une colonne `cle_geste` + index unique partiel sur les six tables
--    ecrites en direct par PostgREST, hors fonction. La contrainte refuse
--    le doublon ; le navigateur lit ce refus comme « deja enregistre ».
--
-- CE QU'ELLE NE FAIT PAS
--
-- Elle ne touche pas `prochain_id()`. Un clic refait consomme toujours un
-- numero — un trou dans la numerotation, pas une double ecriture. Fermer cela
-- demanderait de reserver le numero DANS la fonction d'ecriture, ce qui est
-- une autre migration et un autre risque (c'est la fonction la plus appelee
-- de l'application).
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Le registre des gestes
-- --------------------------------------------------------------------------
-- Cle primaire composee, comme partout ici : `cle` est un UUID tire par le
-- navigateur, mais l'organisation reste dans la cle — aucune fonction ne doit
-- pouvoir retrouver le geste d'une autre boutique.
create table if not exists public.gestes (
  organisation_id uuid        not null references public.organisations(id) on delete cascade,
  cle             uuid        not null,
  nom             text        not null,
  resultat        json,
  cree_le         timestamptz not null default now(),
  primary key (organisation_id, cle)
);

comment on table public.gestes is
  'Un geste d''argent par ligne, identifie par une cle tiree au navigateur. '
  'Sert a rendre le meme resultat a une repetition au lieu de reecrire. '
  'Croissance : une ligne par vente, depot, versement ou ouverture de compte.';

-- Personne n'y accede directement : seules les fonctions SECURITY DEFINER la
-- lisent et l'ecrivent. Meme intention que `portail_sessions` — RLS active
-- sans policy, et le linter le signalera : c'est normal (voir § 1).
alter table public.gestes enable row level security;
revoke all on table public.gestes from public, anon, authenticated;

-- Reserver la cle. Rend NULL quand le geste est a nous (donc : executer), et
-- le resultat garde quand la cle etait deja prise (donc : ne rien reecrire).
--
-- Le cas concurrent est couvert sans effort : la seconde transaction bloque
-- sur l'entree d'index non encore validee de la premiere, puis lit son
-- resultat une fois celle-ci commise. Deux clics simultanes rendent donc la
-- meme reponse, pas une erreur.
create or replace function app.geste_reserver(p_org uuid, p_cle uuid, p_nom text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res json;
begin
  -- Pas de cle : une page en cache, anterieure a cette migration. On laisse
  -- passer plutot que de bloquer un comptoir — le verrou d'interface et le
  -- refus d'identifiant deja pris restent en place.
  if p_cle is null then
    return null;
  end if;

  insert into public.gestes (organisation_id, cle, nom)
  values (p_org, p_cle, p_nom)
  on conflict (organisation_id, cle) do nothing;

  if found then
    return null;                       -- la cle est a nous : executer
  end if;

  select resultat into v_res
    from public.gestes
   where organisation_id = p_org and cle = p_cle;

  -- `resultat` nul = le premier passage a ete interrompu avant d'aboutir
  -- (processus tue, connexion coupee apres le commit du reserve). On ne
  -- rejoue pas : on le dit, et c'est un humain qui tranche.
  return coalesce(v_res, json_build_object('ok', false, 'erreur',
    'Ce geste a deja ete lance et son resultat est inconnu. '
    || 'Rechargez la page et verifiez avant de refaire.'));
end $$;

-- Garder le resultat, pour qu'une repetition rende la meme reponse.
create or replace function app.geste_resultat(p_org uuid, p_cle uuid, p_res json)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_cle is null then return; end if;
  update public.gestes set resultat = p_res
   where organisation_id = p_org and cle = p_cle;
end $$;

revoke all on function app.geste_reserver(uuid, uuid, text) from public, anon, authenticated;
revoke all on function app.geste_resultat(uuid, uuid, json) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. Les tables ecrites en direct depuis le navigateur
-- --------------------------------------------------------------------------
-- Ces six-la ne passent par aucune fonction : PostgREST les ecrit en upsert.
-- La cle y devient une contrainte, pas un registre. Index PARTIEL : les
-- lignes anterieures a cette migration restent a NULL et ne se genent pas.
alter table public.ventes         add column if not exists cle_geste uuid;
alter table public.decaissements  add column if not exists cle_geste uuid;
alter table public.sorties        add column if not exists cle_geste uuid;
alter table public.reprises       add column if not exists cle_geste uuid;
alter table public.clients        add column if not exists cle_geste uuid;
alter table public.bijoux_arrhes  add column if not exists cle_geste uuid;

create unique index if not exists ventes_cle_geste_uniq
  on public.ventes (organisation_id, cle_geste) where cle_geste is not null;
create unique index if not exists decaissements_cle_geste_uniq
  on public.decaissements (organisation_id, cle_geste) where cle_geste is not null;
create unique index if not exists sorties_cle_geste_uniq
  on public.sorties (organisation_id, cle_geste) where cle_geste is not null;
create unique index if not exists reprises_cle_geste_uniq
  on public.reprises (organisation_id, cle_geste) where cle_geste is not null;
create unique index if not exists clients_cle_geste_uniq
  on public.clients (organisation_id, cle_geste) where cle_geste is not null;
create unique index if not exists bijoux_arrhes_cle_geste_uniq
  on public.bijoux_arrhes (organisation_id, cle_geste) where cle_geste is not null;

-- Les grants de ces tables sont au niveau TABLE (verifie le 2026-11-02 :
-- INSERT et UPDATE sur toutes les colonnes), donc la colonne neuve est
-- couverte. `organisations` est la seule a porter des grants par colonne —
-- y ajouter un champ imposerait de l'ajouter au grant (§ 5, migration 027).

commit;
