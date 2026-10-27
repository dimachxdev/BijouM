-- ===========================================================================
-- 023 — Portail cliente : étanchéité entre boutiques
-- Écrite le 2026-10-27, à partir des corps réellement en base.
-- ===========================================================================
-- Les clés primaires sont composées `(organisation_id, id)` : `CL-0001` et
-- `CC-0001` existent dans chaque boutique. Ces deux fonctions sont
-- `SECURITY DEFINER`, donc les policies ne s'y appliquent pas : le filtre
-- doit être écrit à la main. Il manquait à cinq endroits.
--
-- ───────────────────────────── portail_donnees ─────────────────────────────
--
--  A. `select nom, email into v_cli from clients where id = v_sess.client_id`
--     Sans filtre, et sans `if not found`. `SELECT INTO` prend la première
--     ligne EN SILENCE : la cliente pouvait hériter du nom d'une inconnue
--     d'une autre boutique. Ce nom sert ensuite de clé d'identité pour ses
--     comptes et ses commandes — elle voyait donc le vide, ou les données
--     d'une homonyme de SA boutique.
--
--  B. `from mouvements_cc m where m.compte_id = cc.id`    ← LA FUITE
--     Sous-requête imbriquée, aucun filtre. Le relevé d'épargne affiché à
--     une cliente **fusionnait les mouvements des boutiques partageant le
--     même numéro de compte**. Aucune collision de nom n'était nécessaire :
--     deux `CC-0001` suffisaient. C'était actif depuis la deuxième boutique.
--
-- ────────────────────────────── portail_depot ──────────────────────────────
--
--  C. Même lecture du nom sans filtre qu'en A.
--
--  D. `update comptes_clients set solde = (select sum(...) from mouvements_cc
--      where m.compte_id = p_compte) where id = p_compte`
--     Ni la somme ni le `where` ne filtrent — le défaut jumeau de celui de
--     `vente_sur_compte_epargne` (migration 022). Le dépôt d'une cliente
--     recalculait et ÉCRASAIT le solde du compte homonyme des autres
--     boutiques, avec le total de toutes.
--
--  E. `'nouveau_solde', (select solde from comptes_clients where id = p_compte)`
--     Sous-requête scalaire sans filtre : avec deux `CC-0001`, elle lève
--     « more than one row returned by a subquery used as an expression ».
--     Donc **le dépôt depuis le portail échoue déjà aujourd'hui**. L'appel
--     étant une transaction, l'écriture de D est annulée avec lui : pas de
--     corruption, mais la fonction est hors service.
--
-- ─────────────────────────────── INTO STRICT ───────────────────────────────
--
-- Chaque lecture qui attend UNE ligne passe en `into strict`, enveloppée
-- d'un bloc d'exception : `no_data_found` rend le refus poli qui existait
-- déjà, `too_many_rows` lève une erreur explicite. Le silence devient un
-- cri — c'est ce silence qui a laissé vivre A, B et C sans que rien ne
-- l'indique.
--
-- ───────────────────────── CE QUI N'EST PAS CORRIGÉ ────────────────────────
--
-- L'identité d'une cliente reste son NOM (`cc.client = v_cli.nom`). Deux
-- clientes homonymes d'une même boutique partagent donc épargne et
-- commandes. Défaut antérieur au multi-boutiques ; le corriger impose de
-- rattacher `comptes_clients` et `ventes` à `client_id`. Décision à prendre
-- à part — voir § 1 de CLAUDE.md.
-- ===========================================================================


create or replace function public.portail_donnees(p_token uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sess record;
  v_cli  record;
  v_out  json;
begin
  select * into v_sess from public.portail_sessions
   where token = p_token and expire_le > now();
  if not found then
    return json_build_object('ok', false, 'erreur', 'Session expirée.');
  end if;

  -- A corrigé : la cliente est lue DANS SA boutique, et une ambiguïté crie.
  begin
    select nom, email into strict v_cli
      from public.clients
     where id = v_sess.client_id
       and organisation_id = v_sess.organisation_id;
  exception
    when no_data_found then
      return json_build_object('ok', false, 'erreur', 'Compte introuvable.');
    when too_many_rows then
      raise exception
        'Plusieurs clientes portent l''identifiant % dans la boutique % : filtre manquant.',
        v_sess.client_id, v_sess.organisation_id;
  end;

  select json_build_object(
    'ok', true,
    'client', json_build_object('id', v_sess.client_id, 'nom', v_cli.nom, 'email', v_cli.email),
    'comptes', coalesce((
      select json_agg(json_build_object(
        'id', cc.id, 'solde', cc.solde, 'actif', cc.actif,
        'date_ouverture', cc.date_ouverture,
        'mouvements', coalesce((
          select json_agg(json_build_object('date', m.date, 'type', m.type,
                                            'montant', m.montant, 'note', m.note)
                          order by m.date desc, m.id desc)
          -- B corrigé : c'est ici que les relevés de deux boutiques
          -- fusionnaient dans le portail d'une cliente.
          from public.mouvements_cc m
         where m.compte_id = cc.id
           and m.organisation_id = cc.organisation_id), '[]'::json)))
      from public.comptes_clients cc
      where cc.organisation_id = v_sess.organisation_id and cc.client = v_cli.nom), '[]'::json),
    'commandes', coalesce((
      select json_agg(json_build_object(
        'id', v.id, 'date', v.date, 'description', v.description,
        'montant', v.montant, 'acompte', v.acompte, 'restant', v.restant,
        'num_facture', v.num_facture) order by v.date desc)
      from public.ventes v
      where v.organisation_id = v_sess.organisation_id
        and v.client = v_cli.nom and coalesce(v.restant,0) > 0
        and coalesce(v.annulee,false) = false), '[]'::json)
  ) into v_out;

  return v_out;
end $function$;


create or replace function public.portail_depot(
  p_token uuid, p_compte text, p_montant integer, p_note text default null::text)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sess   record;
  v_nom    text;
  v_compte record;
  v_solde  integer;
begin
  select * into v_sess from public.portail_sessions
   where token = p_token and expire_le > now();
  if not found then
    return json_build_object('ok', false, 'erreur', 'Session expirée.');
  end if;

  if p_montant is null or p_montant <= 0 or p_montant > 50000000 then
    return json_build_object('ok', false, 'erreur', 'Montant invalide.');
  end if;

  -- C corrigé.
  begin
    select nom into strict v_nom
      from public.clients
     where id = v_sess.client_id
       and organisation_id = v_sess.organisation_id;
  exception
    when no_data_found then
      return json_build_object('ok', false, 'erreur', 'Compte introuvable.');
    when too_many_rows then
      raise exception
        'Plusieurs clientes portent l''identifiant % dans la boutique % : filtre manquant.',
        v_sess.client_id, v_sess.organisation_id;
  end;

  begin
    select * into strict v_compte from public.comptes_clients
     where id = p_compte and client = v_nom
       and organisation_id = v_sess.organisation_id and actif;
  exception
    when no_data_found then
      return json_build_object('ok', false, 'erreur', 'Compte introuvable.');
    when too_many_rows then
      raise exception
        'Plusieurs comptes % dans la boutique % : filtre manquant.',
        p_compte, v_sess.organisation_id;
  end;

  insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
  values (p_compte, to_char(now(),'YYYY-MM-DD'), 'depot', p_montant,
          coalesce(p_note,'Dépôt portail client'), v_sess.organisation_id);

  -- D corrigé : la somme ET le `where` portent la boutique. Sans eux, le
  -- dépôt d'une cliente écrasait le solde du compte homonyme des autres.
  select coalesce(sum(case when m.type='retrait' then -m.montant else m.montant end), 0)
    into v_solde
    from public.mouvements_cc m
   where m.compte_id = p_compte
     and m.organisation_id = v_sess.organisation_id;

  update public.comptes_clients
     set solde = v_solde
   where id = p_compte
     and organisation_id = v_sess.organisation_id;

  -- E corrigé : c'est cette sous-requête qui levait l'erreur. On renvoie la
  -- valeur déjà calculée, plutôt que de relire.
  return json_build_object('ok', true, 'nouveau_solde', v_solde);
end $function$;


-- `create or replace` conserve les privilèges, mais le projet les réaffirme
-- à chaque fois : le `grant` dit qui frappe à la porte, le contrôle interne
-- dit qui entre. Ici c'est le jeton de session qui fait l'identité — le
-- portail cliente n'a pas de session Supabase.
revoke all on function public.portail_donnees(uuid) from public;
grant execute on function public.portail_donnees(uuid) to anon, authenticated;

revoke all on function public.portail_depot(uuid, text, integer, text) from public;
grant execute on function public.portail_depot(uuid, text, integer, text) to anon, authenticated;


-- ===========================================================================
-- APRÈS APPLICATION
-- ===========================================================================
-- 1. Recalculer les soldes : le défaut D a pu les fausser, comme celui de la
--    migration 022. Même requête, l'historique sert de référence.
--
--      update comptes_clients cc
--         set solde = coalesce((
--               select sum(case when m.type='retrait' then -m.montant else m.montant end)
--                 from mouvements_cc m
--                where m.compte_id = cc.id
--                  and m.organisation_id = cc.organisation_id), 0);
--
-- 2. Vérifier le recouvrement, qui est ce qui rend le test utile :
--
--      select id, organisation_id, client, solde from comptes_clients order by id;
--
-- 3. Depuis le portail, dans DEUX boutiques ayant le même numéro de compte :
--    ouvrir le relevé — il ne doit montrer que les mouvements de sa boutique —
--    puis déposer, et vérifier que le solde de l'autre n'a pas bougé.
-- ===========================================================================
