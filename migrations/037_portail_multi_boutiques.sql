-- ============================================================================
-- 037 — Une cliente peut etre cliente de deux bijouteries
-- ============================================================================
-- Signale le 2026-11-03 : « un client qui est dans deux bijouteries
-- differentes fait un depot sur une et pas sur l'autre, et doit pouvoir gerer
-- son compte sur les deux sans souci ».
--
-- LE DEFAUT, DANS LE CHEMIN D'AUTHENTIFICATION
--
-- `portail_login()` cherchait la fiche ainsi :
--
--   select c.id, ... into v_client
--     from public.clients c
--    where regexp_replace(c.tel,'\D','','g') = v_tel
--      and c.pin_hash = crypt(p_pin, c.pin_hash)
--    limit 1;                          -- <- ni ordre, ni boutique
--
-- C'est, mot pour mot, le motif que le § 1 decrit : « un `limit 1` aurait pris
-- en silence la ligne d'une AUTRE boutique ». Ici il ne vole rien — la session
-- porte bien `(client_id, organisation_id)`, et `portail_donnees()` filtre
-- dessus depuis la 023. Mais il CHOISIT a la place de la cliente, sans ordre
-- defini, donc potentiellement differemment d'un appel a l'autre :
--
--   — elle voit l'epargne d'une seule de ses deux bijouteries ;
--   — son depot part dans celle-la ;
--   — l'autre lui est inaccessible, et rien a l'ecran ne le lui dit.
--
-- Le defaut ne se declenche que si le MEME numero porte le MEME code dans deux
-- boutiques. Avec des codes differents, le `crypt()` departage tout seul —
-- c'est pour cela que personne ne l'avait vu. Verifie le 2026-11-03 : aucun
-- numero n'est aujourd'hui present dans deux boutiques. Le trou est ouvert,
-- personne n'est encore passe.
--
-- CE QUE FAIT CETTE MIGRATION
--
-- 1. Plus de `limit 1`. On ramasse TOUTES les fiches dont le numero et le code
--    concordent, on ouvre une session par boutique, et on les rend toutes. La
--    cliente choisit.
--
-- 2. `portail_donnees()` rend enfin le NOM de la boutique. Sans lui, aucun
--    ecran ne peut dire ou l'on est — et separer deux boutiques sans pouvoir
--    les nommer ne separe rien.
--
-- POURQUOI UNE SESSION PAR BOUTIQUE, ET NON UNE SESSION QUI LES COUVRE
--
-- `portail_sessions` porte `(client_id, organisation_id)`, et toutes les
-- fonctions du portail lisent `v_sess.organisation_id`. Une session
-- multi-boutiques obligerait a rouvrir ce filtre partout — c'est-a-dire a
-- defaire ce que les migrations 023 et 026 ont ferme. Une session reste donc
-- le lien vers UNE boutique, et on en ouvre simplement plusieurs.
--
-- CE QU'ON NE DIVULGUE PAS
--
-- Seules les fiches dont le code concorde sont listees. Un code juste dans une
-- boutique et faux dans l'autre ne revele pas l'existence de la seconde : la
-- cliente s'authentifie boutique par boutique, comme avant. Les freins du § 4
-- (par numero, et par numeros distincts vises) sont inchanges.
--
-- COMPATIBILITE AVEC LE PORTAIL DEJA EN LIGNE
--
-- La reponse garde `token` et `client` a la racine, renseignes avec le PREMIER
-- acces (par ordre alphabetique de boutique, donc stable). Un `client.html`
-- pas encore redeploye continue donc de fonctionner : il entre dans une
-- boutique, comme aujourd'hui, mais au moins toujours la meme. Le champ
-- `acces` est additif et ignore par l'ancien code.
-- ============================================================================

begin;

create or replace function public.portail_login(p_tel text, p_pin text)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
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
  v_acces     jsonb := '[]'::jsonb;
  v_nb        int := 0;

  c_max         constant int      := 5;
  c_blocage     constant interval := interval '15 minutes';
  c_max_numeros constant int      := 12;
  c_fenetre_ip  constant interval := interval '30 minutes';
  c_blocage_ip  constant interval := interval '60 minutes';
begin
  v_hash   := md5(v_tel);
  v_masque := case when length(v_tel) >= 4 then '…' || right(v_tel, 4) else '…' end;

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
        update public.portail_tentatives_ip
           set echecs = 0, bloque_jusqu = null where ip = v_ip;
      end if;
    end if;
  end if;

  -- ---- 2. Forme des identifiants ------------------------------------------
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

  -- ---- 4. Vérification du code, DANS CHAQUE BOUTIQUE ----------------------
  -- Plus de `limit 1`. L'ordre est explicite : sans lui, la « première »
  -- boutique changerait d'un appel à l'autre, et la cliente ne saurait jamais
  -- où elle atterrit.
  for v_client in
    select c.id, c.nom, c.tel, c.email, c.organisation_id, o.nom as boutique, o.slug
      from public.clients c
      join public.organisations o on o.id = c.organisation_id
     where regexp_replace(coalesce(c.tel,''), '\D', '', 'g') = v_tel
       and c.pin_hash is not null
       and c.pin_hash = crypt(p_pin, c.pin_hash)
     order by o.nom, c.id
  loop
    v_nb := v_nb + 1;

    insert into public.portail_sessions (client_id, organisation_id)
    values (v_client.id, v_client.organisation_id)
    returning token into v_token;

    -- Une trace par boutique : chaque propriétaire doit voir que le portail
    -- de SA cliente a été ouvert, et aucune ne doit voir les autres.
    insert into public.portail_journal (ip, tel_hash, tel_masque, organisation_id, resultat)
    values (v_ip, v_hash, v_masque, v_client.organisation_id, 'succes');

    v_acces := v_acces || jsonb_build_object(
      'token', v_token,
      'boutique', jsonb_build_object('nom', v_client.boutique, 'code', v_client.slug),
      'client', jsonb_build_object('id', v_client.id, 'nom', v_client.nom,
                                   'tel', v_client.tel, 'email', v_client.email));
  end loop;

  -- ---- 5. Échec -----------------------------------------------------------
  if v_nb = 0 then
    insert into public.portail_tentatives (tel, echecs, derniere)
    values (v_tel, 1, now())
    on conflict (tel) do update
      set echecs = public.portail_tentatives.echecs + 1,
          derniere = now(),
          bloque_jusqu = case when public.portail_tentatives.echecs + 1 >= c_max
                              then now() + c_blocage else null end;

    select c.organisation_id into v_org from public.clients c
     where regexp_replace(coalesce(c.tel,''), '\D', '', 'g') = v_tel limit 1;

    insert into public.portail_journal (ip, tel_hash, tel_masque, organisation_id, resultat)
    values (v_ip, v_hash, v_masque, v_org, 'echec');

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

  -- ---- 6. Succès -----------------------------------------------------------
  delete from public.portail_tentatives where tel = v_tel;
  if v_ip is not null then
    delete from public.portail_tentatives_ip where ip = v_ip;
  end if;

  -- `token` et `client` restent à la racine, pris sur le PREMIER accès : un
  -- portail pas encore redéployé continue d'entrer dans une boutique — la
  -- même à chaque fois, désormais. `acces` et `plusieurs` sont additifs.
  return json_build_object(
    'ok', true,
    'plusieurs', (v_nb > 1),
    'token',  v_acces -> 0 ->> 'token',
    'client', v_acces -> 0 -> 'client',
    'boutique', v_acces -> 0 -> 'boutique',
    'acces', v_acces);
end $function$;

revoke all on function public.portail_login(text, text) from public;
grant execute on function public.portail_login(text, text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- `portail_donnees` sait enfin nommer la boutique
-- --------------------------------------------------------------------------
-- Separer deux boutiques sans pouvoir les nommer ne separe rien : la cliente
-- doit lire, sur l'ecran de depot comme ailleurs, chez QUI elle depose.
--
-- Le nom seulement, pas le logo : `organisations.logo` est du base64 plafonne
-- a 200 Ko, et le portail se consulte en donnees mobiles. Le nom suffit a
-- departager, et il tient dans la reponse.
--
-- Tout le reste est recopie a l'identique de la 023/026 : filtres
-- `organisation_id` et `client_id` sur chaque sous-requete, `into strict` qui
-- proteste au lieu de choisir.
create or replace function public.portail_donnees(p_token uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sess record;
  v_cli  record;
  v_bout record;
  v_out  json;
begin
  select * into v_sess from public.portail_sessions
   where token = p_token and expire_le > now();
  if not found then
    return json_build_object('ok', false, 'erreur', 'Session expirée.');
  end if;

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

  select nom, slug, telephone into v_bout
    from public.organisations where id = v_sess.organisation_id;

  select json_build_object(
    'ok', true,
    'boutique', json_build_object('nom', v_bout.nom, 'code', v_bout.slug,
                                  'telephone', v_bout.telephone),
    'client', json_build_object('id', v_sess.client_id, 'nom', v_cli.nom, 'email', v_cli.email),
    'comptes', coalesce((
      select json_agg(json_build_object(
        'id', cc.id, 'solde', cc.solde, 'actif', cc.actif,
        'date_ouverture', cc.date_ouverture,
        'mouvements', coalesce((
          select json_agg(json_build_object('date', m.date, 'type', m.type,
                                            'montant', m.montant, 'note', m.note)
                          order by m.date desc, m.id desc)
          from public.mouvements_cc m
         where m.compte_id = cc.id
           and m.organisation_id = cc.organisation_id), '[]'::json)))
      from public.comptes_clients cc
      where cc.organisation_id = v_sess.organisation_id
        and cc.client_id = v_sess.client_id), '[]'::json),
    'commandes', coalesce((
      select json_agg(json_build_object(
        'id', v.id, 'date', v.date, 'description', v.description,
        'montant', v.montant, 'acompte', v.acompte, 'restant', v.restant,
        'num_facture', v.num_facture) order by v.date desc)
      from public.ventes v
      where v.organisation_id = v_sess.organisation_id
        and v.client_id = v_sess.client_id
        and coalesce(v.restant,0) > 0
        and coalesce(v.annulee,false) = false), '[]'::json)
  ) into v_out;

  return v_out;
end $function$;

revoke all on function public.portail_donnees(uuid) from public;
grant execute on function public.portail_donnees(uuid) to anon, authenticated;

commit;

-- ============================================================================
-- A VERIFIER APRES APPLICATION
-- ============================================================================
-- `portail_login` appelle `crypt()` : son `search_path` DOIT porter
-- `extensions`, sinon la fonction se cree tres bien et echoue seulement a
-- l'appel, avec « function crypt(text, text) does not exist » — le portail
-- entier tombe. C'est arrive DEUX FOIS (§ 1). Donc, avant toute autre chose :
--
--   select proname, array_to_string(proconfig,' | ')
--     from pg_proc where proname in ('portail_login','portail_donnees');
--   -- portail_login doit montrer : search_path=public, extensions, pg_temp
--
-- ET SURTOUT : appeler la route une fois pour de vrai. Une migration qui
-- « reussit » ne prouve rien.
--
-- L'essai qui compte, dans une transaction annulee : donner le MEME numero et
-- le MEME code a une cliente de deux boutiques, puis se connecter.
--   — `plusieurs` doit valoir true ;
--   — `acces` doit contenir DEUX entrees, nommant les deux boutiques ;
--   — chaque jeton, passe a portail_donnees(), ne doit montrer QUE l'epargne
--     de sa boutique.
-- ============================================================================
