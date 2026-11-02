-- ============================================================================
-- 034 — Une table de `public` ne se supprime pas par accident
-- ============================================================================
-- Demande le 2026-11-02 : « une notification de suppression de table, et
-- aviser pour restaurer la sauvegarde ».
--
-- POURQUOI CE N'EST PAS UNE NOTIFICATION QUI EST ECRITE ICI
--
-- Une notification arrive APRES. Quand elle s'affiche, l'historique
-- commercial d'une bijouterie est deja parti, et il faut une sauvegarde
-- fraiche, verifiee, et savoir s'en servir. Rien de tout cela n'existe
-- aujourd'hui (voir 035, et le § 9 : aucune restauration n'a jamais ete
-- testee).
--
-- Un DROP TABLE n'est jamais un geste du produit. `supprimer_boutique()`
-- efface des LIGNES ; aucune fonction, aucun ecran, aucune policy ne supprime
-- une table. Un DROP ici est donc toujours : une erreur de frappe dans
-- l'editeur SQL, une migration mal relue, ou quelqu'un qui n'aurait pas du
-- avoir la main. Dans les trois cas la bonne reponse est de REFUSER, pas de
-- prevenir.
--
-- D'ou : on bloque, et on previent quand meme.
--
-- CE QUE CE GARDE-FOU N'EST PAS
--
-- Ce n'est pas un controle d'acces : qui peut executer un DROP reste decide
-- par les privileges PostgreSQL. C'est un cran d'arret contre la main qui
-- glisse — le meme role que la demande de retaper le code boutique dans
-- `supprimer_boutique()` (§ 4 bis). Il se leve volontairement, en deux
-- gestes separes, jamais d'un clic.
--
-- LA LIMITE A CONNAITRE, ET ELLE EST IMPORTANTE
--
-- Un `raise exception` annule TOUTE la transaction — donc aussi la ligne
-- qu'on vient d'ecrire dans `journal_ddl` pour tracer la tentative. On ne
-- peut pas, dans une seule transaction, journaliser en base ET refuser.
--
-- Donc : une tentative REFUSEE part dans le journal PostgreSQL (`raise log`,
-- qui survit au rollback, visible dans Supabase > Logs > Postgres), et seules
-- les suppressions REELLEMENT EFFECTUEES — fonctions, index, colonnes, et les
-- tables lors d'un deblocage volontaire — atterrissent dans `journal_ddl`.
--
-- Ne pas « corriger » cette asymetrie en retirant le refus pour pouvoir tout
-- journaliser : la trace vaut moins que la table.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Le journal des suppressions de structure
-- --------------------------------------------------------------------------
-- Memes regles que `connexions` et `portail_journal` (§ 7) : on y ajoute, on
-- y lit, on n'y touche jamais. Pas de policy UPDATE ni DELETE — et ne jamais
-- en ajouter.
--
-- `organisation_id` n'a pas de sens ici : une table n'appartient a aucune
-- boutique. Ce journal est donc du ressort de l'operateur seul.
create table if not exists public.journal_ddl (
  id          bigserial primary key,
  survenu_le  timestamptz not null default now(),
  commande    text        not null,          -- DROP TABLE, DROP FUNCTION...
  objet_type  text        not null,          -- table, function, index...
  objet       text        not null,          -- public.ventes
  schema_nom  text,
  acteur      text        not null,          -- role PostgreSQL
  deblocage   boolean     not null default false
);

comment on table public.journal_ddl is
  'Suppressions de structure REELLEMENT effectuees. Une tentative refusee par '
  'app.garde_fou_drop() n''y figure pas : le rollback l''emporterait. Elle est '
  'dans le journal PostgreSQL (Supabase > Logs > Postgres).';

alter table public.journal_ddl enable row level security;
revoke all on table public.journal_ddl from public, anon, authenticated;
revoke all on sequence public.journal_ddl_id_seq from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. Le garde-fou
-- --------------------------------------------------------------------------
-- Le deblocage passe par un parametre de SESSION, pas par une colonne ni un
-- reglage global : il meurt avec la connexion. Oublier de le remettre ne
-- laisse donc pas la porte ouverte pour les suivants.
--
--   set local kayor.drop_autorise = 'oui';     -- dans la transaction, seulement
--   drop table public.ma_table;
--
-- `set local` et non `set` : annule a la fin de la transaction, meme si elle
-- echoue.
create or replace function app.garde_fou_drop()
returns event_trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o         record;
  v_debloque boolean;
begin
  v_debloque := coalesce(current_setting('kayor.drop_autorise', true), '') = 'oui';

  for o in select * from pg_event_trigger_dropped_objects() loop

    -- On ne se mele que des tables de `public`. Les fonctions, index,
    -- contraintes et colonnes se suppriment librement : c'est le quotidien
    -- d'une migration — la 033 supprime cinq signatures de fonction.
    if o.object_type = 'table' and o.schema_name = 'public' and not v_debloque then

      -- Dans le journal PostgreSQL : il survit au rollback qui suit.
      raise log 'KAYOR garde-fou : DROP TABLE refuse sur % par le role %',
        o.object_identity, current_user;

      raise exception using
        errcode = 'raise_exception',
        message = 'Suppression de la table ' || o.object_identity || ' refusee.',
        detail  = 'Aucune fonction du produit ne supprime une table : '
               || 'supprimer_boutique() efface des lignes. Ce DROP est donc une '
               || 'erreur, ou il n''aurait pas du etre possible.',
        hint    = 'Si la suppression est VOULUE : verifiez d''abord qu''une '
               || 'sauvegarde recente existe (select * from public.sauvegardes '
               || 'order by id desc limit 1), puis, dans une transaction : '
               || 'set local kayor.drop_autorise = ''oui'';';
    end if;

    -- On arrive ici : la suppression a lieu. On la garde.
    insert into public.journal_ddl
      (commande, objet_type, objet, schema_nom, acteur, deblocage)
    values (tg_tag, o.object_type,
            coalesce(o.object_identity, o.object_name), o.schema_name,
            current_user,
            o.object_type = 'table' and o.schema_name = 'public');
  end loop;
end $$;

revoke all on function app.garde_fou_drop() from public, anon, authenticated;

drop event trigger if exists kayor_garde_fou_drop;
create event trigger kayor_garde_fou_drop
  on sql_drop
  execute function app.garde_fou_drop();

-- --------------------------------------------------------------------------
-- 3. Lecture par l'operateur
-- --------------------------------------------------------------------------
-- La table est fermee a tout le monde ; cette fonction est la seule porte.
-- Elle n'expose aucune donnee metier — seulement des noms d'objets.
create or replace function public.journal_structure(p_limite integer default 50)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res json;
begin
  if not app.est_operateur() then
    return json_build_object('ok', false, 'erreur', 'Reserve au service.');
  end if;

  select coalesce(json_agg(l order by l.id desc), '[]'::json) into v_res
    from (select id, survenu_le, commande, objet_type, objet, acteur, deblocage
            from public.journal_ddl
           order by id desc
           limit least(greatest(coalesce(p_limite, 50), 1), 500)) l;

  return json_build_object('ok', true, 'lignes', v_res);
end $$;

revoke all on function public.journal_structure(integer) from public, anon;
grant execute on function public.journal_structure(integer) to authenticated;

commit;

-- ============================================================================
-- A VERIFIER APRES APPLICATION — le « succes » ne prouve que la syntaxe
-- ============================================================================
-- 1. Le declencheur existe et il est actif :
--
--    select evtname, evtevent, evtenabled from pg_event_trigger;
--    -- evtenabled = 'O' (origine). 'D' = desactive : il ne protege rien.
--
-- 2. LE SEUL ESSAI QUI COMPTE — refuser pour de vrai, dans une transaction
--    annulee pour ne rien casser :
--
--    begin;
--      create table public.zz_essai(x int);
--      drop table public.zz_essai;          -- doit ECHOUER
--    rollback;
--
--    S'il passe, le declencheur n'est pas en place et rien n'est protege.
--
-- 3. Le deblocage fonctionne, sinon une migration legitime serait bloquee :
--
--    begin;
--      create table public.zz_essai(x int);
--      set local kayor.drop_autorise = 'oui';
--      drop table public.zz_essai;          -- doit PASSER
--    rollback;
--
-- 4. Une suppression de fonction n'est PAS genee (c'est le quotidien d'une
--    migration) :
--
--    begin;
--      create function public.zz_essai_fn() returns int language sql as 'select 1';
--      drop function public.zz_essai_fn(); -- doit PASSER et etre journalise
--      select commande, objet from public.journal_ddl order by id desc limit 1;
--    rollback;
-- ============================================================================
