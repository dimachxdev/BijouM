-- ===========================================================================
-- 024 — Dépôt au comptoir et code PIN : étanchéité entre boutiques
-- Écrite le 2026-10-27, à partir des corps lus en base.
-- ===========================================================================
-- Fin de l'audit ouvert par la migration 021. Les cinq fonctions
-- `SECURITY DEFINER` qui n'étaient jamais passées par une migration ont été
-- relues une par une. Trois sont correctes, deux ne le sont pas.
--
-- ───────────────────────── VÉRIFIÉES CORRECTES ─────────────────────────────
--
--   prochain_id                 `on conflict (organisation_id, cle)` et
--                               `where cle = p_cle and organisation_id = v_org`
--                               sur l'UPDATE. La numérotation est étanche.
--   ouvrir_compte_epargne       contrôle de doublon filtré, les deux `insert`
--                               portent `v_org`.
--   enregistrer_paiement_vente  lecture, UPDATE et relecture portent tous
--                               `and organisation_id = v_org`.
--
-- Ne pas les rouvrir « par symétrie » : elles sont justes.
--
-- Réserve notée, volontairement HORS de cette migration : `prochain_id`
-- n'appelle pas `app.org_active()`. Une boutique suspendue peut donc encore
-- consommer des numéros — la vente qui suit est refusée par la policy, donc
-- le seul effet est un trou dans la numérotation. C'est une entorse au § 5
-- de CLAUDE.md, pas une fuite. Elle touche la fonction la plus appelée de
-- l'application : à décider à part, pas dans une migration de sécurité.
--
-- ─────────────────────── A. depot_compte_epargne ───────────────────────────
--
-- Le défaut jumeau de celui que la 022 a corrigé dans
-- `vente_sur_compte_epargne` et la 023 dans `portail_depot` — ici sur le
-- chemin le plus emprunté des trois, la saisie au comptoir.
--
-- Tous les contrôles d'entrée sont bons : rôle, `org_active`, montant, et
-- l'existence du compte est bien filtrée sur `v_org`. C'est précisément ce
-- qui rend la suite invisible à la relecture. Les deux dernières lignes :
--
--   select ... into v_solde from mouvements_cc where compte_id = p_compte_id;
--   update comptes_clients set solde = v_solde where id = p_compte_id;
--
-- Ni l'une ni l'autre ne porte la boutique. La somme additionne les
-- mouvements de TOUTES les boutiques ayant ce numéro de compte, et l'UPDATE
-- écrit ce total sur le compte homonyme de CHACUNE.
--
-- Rien ne proteste : un agrégat ne lève pas d'erreur sur plusieurs lignes,
-- un UPDATE sans filtre non plus. Contrairement à la 022 — qui est tombée
-- franchement — celle-ci aurait corrompu en silence, chaque jour, à chaque
-- dépôt.
--
-- Constaté au 2026-10-27 : `CC-0001` existe dans les deux boutiques, mais
-- les deux sont à zéro. Le défaut était armé, pas encore déclenché.
--
-- ───────────────────────── B. definir_pin_client ───────────────────────────
--
-- Le même défaut deux fois, et une seule des deux occurrences casse.
--
--  B1. `update clients set pin_hash = null where id = p_client_id`
--      Chemin du RETRAIT de code, et il sort de la fonction juste après.
--      Sans filtre : retirer le code de sa cliente efface aussi celui de la
--      cliente homonyme de chaque autre boutique. L'écran répond « ok ».
--      Écriture inter-boutiques ACTIVE et silencieuse.
--
--  B2. `update clients set pin_hash = crypt(...) where id = p_client_id`
--      Chemin de la POSE. Sans filtre, il écrirait le même code PIN sur la
--      cliente homonyme de chaque boutique — un code d'accès, pas un solde.
--
--  B3. `delete from portail_tentatives where tel = (select ... from clients
--       where id = p_client_id)`
--      Sous-requête scalaire sans filtre : avec deux `CL-0001` elle lève
--      « more than one row returned by a subquery ». L'appel étant une
--      transaction, B2 est annulé avec elle.
--
--      DONC CE `delete` EST LE DISJONCTEUR DE B2. « Réparer » le plantage
--      avec un `limit 1` aurait transformé une fonction en panne en écriture
--      de code d'accès entre boutiques. Les trois se corrigent ensemble.
--
--  B4. `app.org_active()` manquait : une boutique suspendue pouvait encore
--      poser et retirer des codes d'accès au portail.
--
-- Le `tel` est désormais lu une seule fois, filtré, en tête de fonction — il
-- sert à la fois de contrôle d'existence et de clé du `delete`. Et le
-- `delete` ne part plus sur un numéro vide : une cliente sans téléphone
-- aurait effacé les tentatives de toutes les lignes à `tel = ''`.
--
-- ⚠ `definir_pin_client` appelle `crypt()` : son `search_path` DOIT rester
-- `public, extensions, pg_temp`. Avec `public, pg_temp` la fonction se crée
-- très bien et échoue seulement à l'appel. C'est arrivé deux fois sur ce
-- projet. Appeler la route une fois après application.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A. depot_compte_epargne
-- ---------------------------------------------------------------------------
create or replace function public.depot_compte_epargne(
  p_compte_id text, p_montant integer,
  p_date text default null::text, p_note text default null::text)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org   uuid := app.current_org();
  v_solde int;
begin
  if v_org is null or not app.has_role('proprietaire','admin','gestionnaire','vendeur') then
    return json_build_object('ok', false, 'erreur', 'Non autorisé.');
  end if;
  if not app.org_active() then
    return json_build_object('ok', false, 'erreur', 'Boutique suspendue.');
  end if;
  if p_montant is null or p_montant <= 0 or p_montant > 50000000 then
    return json_build_object('ok', false, 'erreur', 'Montant invalide.');
  end if;
  if not exists (select 1 from public.comptes_clients
                  where id = p_compte_id and organisation_id = v_org and actif) then
    return json_build_object('ok', false, 'erreur', 'Compte introuvable ou clôturé.');
  end if;

  insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
  values (p_compte_id, coalesce(p_date, to_char(now(),'YYYY-MM-DD')), 'depot', p_montant,
          coalesce(nullif(p_note,''), 'Dépôt'), v_org);

  -- Corrigé : la somme ne portait pas la boutique, elle additionnait les
  -- mouvements de toutes celles ayant ce numéro de compte.
  select coalesce(sum(case when type='retrait' then -montant else montant end),0)
    into v_solde
    from public.mouvements_cc
   where compte_id = p_compte_id
     and organisation_id = v_org;

  -- Corrigé : sans ce filtre, le total ci-dessus était écrit sur le compte
  -- homonyme de CHAQUE boutique.
  update public.comptes_clients
     set solde = v_solde
   where id = p_compte_id
     and organisation_id = v_org;

  return json_build_object('ok', true, 'nouveau_solde', v_solde);
end $function$;


-- ---------------------------------------------------------------------------
-- B. definir_pin_client
-- ---------------------------------------------------------------------------
create or replace function public.definir_pin_client(p_client_id text, p_pin text)
returns json
language plpgsql
security definer
-- `extensions` est obligatoire : pgcrypto y vit, et `crypt()` est appelé plus
-- bas. Retirer ce mot met le portail cliente hors service sans que la
-- migration échoue.
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_org uuid := app.current_org();
  v_tel text;
begin
  if v_org is null or not app.has_role('proprietaire','admin') then
    return json_build_object('ok', false, 'erreur', 'Action réservée aux administrateurs.');
  end if;

  -- B4 : poser un code d'accès est une écriture comme une autre.
  if not app.org_active() then
    return json_build_object('ok', false, 'erreur', 'Boutique suspendue : écriture impossible.');
  end if;

  -- Le numéro est lu UNE fois, dans la boutique de l'appelante. Il sert de
  -- contrôle d'existence et de clé au `delete` plus bas — là où une
  -- sous-requête scalaire non filtrée faisait tomber la fonction (B3).
  select regexp_replace(coalesce(tel,''), '\D', '', 'g')
    into v_tel
    from public.clients
   where id = p_client_id
     and organisation_id = v_org;
  if not found then
    return json_build_object('ok', false, 'erreur', 'Cliente introuvable.');
  end if;

  -- Chaîne vide ou null : on retire l'accès au portail.
  if p_pin is null or p_pin = '' then
    -- B1 : sans ce filtre, le code de la cliente homonyme de chaque autre
    -- boutique était effacé lui aussi, en silence.
    update public.clients
       set pin_hash = null
     where id = p_client_id
       and organisation_id = v_org;
    return json_build_object('ok', true, 'a_un_pin', false);
  end if;

  if p_pin !~ '^\d{4}$' then
    return json_build_object('ok', false, 'erreur', 'Le code doit contenir exactement 4 chiffres.');
  end if;

  -- B2 : sans ce filtre, le même code d'accès était posé sur la cliente
  -- homonyme de chaque boutique.
  update public.clients
     set pin_hash = crypt(p_pin, gen_salt('bf', 10))
   where id = p_client_id
     and organisation_id = v_org;

  -- Les tentatives échouées d'un ancien code ne doivent pas bloquer le
  -- nouveau. Le frein est volontairement global par numéro (migration 015),
  -- donc ce `delete` ne porte pas de boutique — mais il ne part jamais sur
  -- un numéro vide, qui aurait balayé toutes les lignes à `tel = ''`.
  if v_tel <> '' then
    delete from public.portail_tentatives where tel = v_tel;
  end if;

  return json_build_object('ok', true, 'a_un_pin', true);
end $function$;


-- ---------------------------------------------------------------------------
-- Droits réaffirmés. `create or replace` les conserve, le projet les réécrit
-- à chaque fois : le `grant` dit qui frappe à la porte, le contrôle de rôle
-- dans le corps dit qui entre.
-- ---------------------------------------------------------------------------
revoke all on function public.depot_compte_epargne(text, integer, text, text) from public, anon;
grant execute on function public.depot_compte_epargne(text, integer, text, text) to authenticated;

revoke all on function public.definir_pin_client(text, text) from public, anon;
grant execute on function public.definir_pin_client(text, text) to authenticated;


-- ===========================================================================
-- APRÈS APPLICATION
-- ===========================================================================
-- 1. Recaler les soldes sur l'historique de leur propre boutique. Au
--    2026-10-27 aucun n'était faux, mais la requête est idempotente et
--    c'est le filet.
--
--      update public.comptes_clients cc
--         set solde = coalesce((
--               select sum(case when m.type='retrait' then -m.montant else m.montant end)
--                 from public.mouvements_cc m
--                where m.compte_id = cc.id
--                  and m.organisation_id = cc.organisation_id), 0);
--
-- 2. APPELER LA ROUTE `definir_pin_client` UNE FOIS depuis l'application.
--    Une migration qui « réussit » ne prouve rien : l'oubli d'`extensions`
--    dans le `search_path` ne se voit qu'à l'appel, et il a déjà mis le
--    portail cliente hors service deux fois.
--
-- 3. Les deux gestes, dans les DEUX boutiques, en vérifiant à chaque fois
--    que l'autre n'a pas bougé. Le recouvrement existe déjà : `CC-0001` est
--    ouvert à Dakar (Djily) et à Saint-Louis (astou), `CL-010` dans les deux.
--
--      a. Déposer sur `CC-0001` à Dakar      → le solde de Saint-Louis ne
--                                               bouge pas, et inversement.
--      b. Poser un code PIN sur `CL-010`      → la cliente `CL-010` de
--                                               l'autre boutique garde le
--                                               sien (ou reste sans code).
--      c. Retirer ce code                     → même vérification. C'est le
--                                               chemin qui écrivait chez la
--                                               voisine sans rien dire.
-- ===========================================================================
