-- ============================================================================
-- KAYOR SaaS — 013 : solder un compte épargne
-- Appliquée le 2026-10-14.
-- ============================================================================
--
-- Mettre un compte à zéro n'a pas un seul sens, et les deux ne font pas la
-- même chose à la caisse. L'opératrice doit donc dire lequel :
--
--   'especes' — la cliente reprend son argent. Il SORT du tiroir : la fonction
--               crée aussi le décaissement, dans la même transaction.
--   'bijou'   — le solde part en bijou. L'argent était entré au moment du
--               dépôt et reste dans le tiroir en règlement. Aucun décaissement.
--
-- Réservée à proprietaire + admin, vérifié dans le corps. Le solde est lu
-- depuis `mouvements_cc`, jamais depuis la colonne stockée, puis recalé.
--
-- Vérifié : une vendeuse reçoit « Action réservée aux administrateurs » ;
-- la propriétaire solde 65 000 F, le compte tombe à 0, un décaissement D-0005
-- est créé et la caisse passe de 115 000 à 50 000 F.
--
-- Accompagne un élargissement de la contrainte sur `decaissements.origine_type`,
-- qui n'acceptait que achat / reprise / vente — 'compte' s'y ajoute.

create or replace function public.vider_compte_epargne(
  p_compte_id text, p_motif text, p_date text default null, p_note text default null
) returns json language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid := app.current_org(); v_solde int; v_client text;
  v_date date := coalesce(nullif(p_date,'')::date, current_date);
  v_val int; v_dec text;
begin
  if not app.has_role('proprietaire', 'admin') then
    return json_build_object('ok', false, 'erreur', 'Action réservée aux administrateurs.');
  end if;
  if not app.org_active() then
    return json_build_object('ok', false, 'erreur', 'Boutique suspendue : écriture impossible.');
  end if;
  if p_motif not in ('especes', 'bijou') then
    return json_build_object('ok', false, 'erreur', 'Motif inconnu.');
  end if;

  select client into v_client from public.comptes_clients
   where id = p_compte_id and organisation_id = v_org;
  if v_client is null then
    return json_build_object('ok', false, 'erreur', 'Compte introuvable.');
  end if;

  select coalesce(sum(case when type = 'retrait' then -montant else montant end), 0)
    into v_solde from public.mouvements_cc
   where compte_id = p_compte_id and organisation_id = v_org;
  if v_solde <= 0 then
    return json_build_object('ok', false, 'erreur', 'Ce compte est déjà à zéro.');
  end if;

  insert into public.mouvements_cc (compte_id, date, type, montant, note, organisation_id)
  values (p_compte_id, v_date::text, 'retrait', v_solde,
          coalesce(nullif(p_note,''),
                   case p_motif when 'especes' then 'Compte soldé — argent rendu à la cliente'
                                else 'Compte soldé — converti en bijou' end),
          v_org);

  update public.comptes_clients
     set solde = coalesce((select sum(case when m.type = 'retrait' then -m.montant else m.montant end)
                           from public.mouvements_cc m
                          where m.compte_id = p_compte_id and m.organisation_id = v_org), 0)
   where id = p_compte_id and organisation_id = v_org;

  if p_motif = 'especes' then
    update public.compteurs set valeur = valeur + 1
     where cle = 'd' and organisation_id = v_org returning valeur into v_val;
    if v_val is null then
      insert into public.compteurs (cle, valeur, organisation_id) values ('d', 1, v_org)
      returning valeur into v_val;
    end if;
    v_dec := 'D-' || lpad(v_val::text, 4, '0');

    insert into public.decaissements
      (id, date, categorie, montant, description, saisi_par, origine_type, origine_id, organisation_id)
    values (v_dec, v_date::text, 'Remboursement client', v_solde,
            'Compte épargne soldé — ' || v_client, 'Solde de compte',
            'compte', p_compte_id, v_org);
  end if;

  return json_build_object('ok', true, 'montant', v_solde, 'client', v_client,
                           'decaissement', v_dec);
end $$;

revoke all on function public.vider_compte_epargne(text, text, text, text) from public, anon;
grant execute on function public.vider_compte_epargne(text, text, text, text) to authenticated;

alter table public.decaissements drop constraint if exists decaissements_origine_type_check;
alter table public.decaissements add constraint decaissements_origine_type_check
  check (origine_type is null
         or origine_type = any (array['achat', 'reprise', 'vente', 'compte']));
