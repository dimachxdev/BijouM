// KAYOR — comptes de l'équipe et des propriétaires
//
// Seul endroit du projet qui détient la clé de service, injectée
// automatiquement par Supabase. Elle ne quitte jamais ce fichier : le
// navigateur ne fait que demander, c'est ici qu'on décide.
//
// Deux appelants, deux pouvoirs distincts :
//
//   l'OPÉRATEUR du service          → creer_boutique, motdepasse_proprietaire
//     ouvre une boutique, pose le compte de sa propriétaire, et le lui rend
//     si elle l'a perdu. Il ne touche jamais aux vendeuses.
//
//   la PROPRIÉTAIRE d'une boutique  → creer, motdepasse
//     crée et reprend en main les comptes de SON équipe.
//
// La chaîne de responsabilité est volontaire : l'opérateur débloque la
// propriétaire, la propriétaire débloque son équipe. Personne ne saute un
// échelon.
//
// POURQUOI verify_jwt EST DÉSACTIVÉ
// Le portail Supabase refuse sans en-têtes CORS : le navigateur affiche
// « Failed to fetch », incompréhensible au comptoir. On vérifie nous-mêmes,
// plus strictement, et chaque refus revient en JSON lisible.
//
// PRÉFLIGHT : on renvoie les en-têtes que le navigateur annonce. Une liste
// figée a déjà tout bloqué une fois — le client envoyait `Prefer`, absent de
// la liste, et l'appel était refusé avant même de partir.
//
// Aucun mot de passe n'est stocké ni renvoyé : Supabase le hache, et il ne
// ressort que de la bouche de celle qui l'a posé.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL_SUPA = Deno.env.get('SUPABASE_URL')!;
const CLE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SUFFIXE = '.kayor.app';
const ROLES_EQUIPE = ['vendeur', 'gestionnaire', 'admin'];
const ENTETES_DEFAUT = 'authorization, content-type, apikey, prefer, x-client-info';

function entetes(req: Request) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') || ENTETES_DEFAUT,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function valideIdentifiant(v: string) { return /^[a-z0-9._-]{2,30}$/.test(v); }

/**
 * Ce mot de passe figure-t-il dans une fuite connue ?
 *
 * Supabase sait le faire nativement — mais c'est réservé au plan Pro. On le
 * refait ici, et mieux placé : la vérification est côté serveur, donc c'est
 * une barrière, pas un conseil affiché à l'écran.
 *
 * k-ANONYMAT. Le SHA-1 est calculé ICI et on n'envoie que ses CINQ premiers
 * caractères. Have I Been Pwned renvoie tous les suffixes commençant ainsi —
 * plusieurs centaines — et la comparaison se fait chez nous. Le mot de passe
 * ne sort pas, son empreinte complète non plus. `Add-Padding` complète la
 * réponse de lignes factices pour que sa taille ne dise rien non plus.
 *
 * Et c'est l'Edge Function qui appelle, JAMAIS le navigateur : la règle
 * « aucune page ne charge quoi que ce soit hors de son domaine » tient. C'est
 * la seule façon d'avoir cette protection sans écorner la règle 6.
 *
 * En cas de panne ou de lenteur de HIBP, on laisse passer. Refuser tous les
 * mots de passe parce qu'un service tiers est tombé bloquerait la création de
 * comptes — et le vrai verrou reste le minimum de caractères imposé au-dessus.
 */
async function motDePasseCompromis(mdp: string): Promise<boolean> {
  try {
    const somme = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(mdp));
    const sha1 = Array.from(new Uint8Array(somme))
      .map((o) => o.toString(16).padStart(2, '0')).join('').toUpperCase();

    const r = await fetch('https://api.pwnedpasswords.com/range/' + sha1.slice(0, 5), {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return false;

    const suffixe = sha1.slice(5);
    const texte = await r.text();
    return texte.split('\n').some((ligne) => {
      const [suf, nb] = ligne.split(':');
      // Les lignes de remplissage de `Add-Padding` portent un compte de 0.
      return suf.trim() === suffixe && parseInt(nb || '0', 10) > 0;
    });
  } catch {
    return false;
  }
}

const MDP_COMPROMIS =
  'Ce mot de passe figure dans une fuite de données connue. Choisissez-en un autre.';

/** « fatou@kay.kayor.app » → « fatou@kay », ce qu'on dicte à voix haute. */
function loginCourt(adresse: string) {
  return adresse.endsWith(SUFFIXE) ? adresse.slice(0, -SUFFIXE.length) : adresse;
}

Deno.serve(async (req: Request) => {
  const cors = entetes(req);
  const repondre = (corps: unknown, statut = 200) =>
    new Response(JSON.stringify(corps), { status: statut, headers: cors });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return repondre({ ok: false, erreur: 'Méthode non autorisée.' }, 405);

  const admin = createClient(URL_SUPA, CLE_SERVICE, { auth: { persistSession: false } });

  const jeton = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jeton) return repondre({ ok: false, erreur: 'Non authentifié.' }, 401);

  const { data: auteur, error: errAuteur } = await admin.auth.getUser(jeton);
  if (errAuteur || !auteur?.user) {
    return repondre({ ok: false, erreur: 'Session expirée. Déconnectez-vous et reconnectez-vous.' }, 401);
  }
  const appelant = auteur.user.id;

  let corps: Record<string, string> = {};
  try { corps = await req.json(); } catch { /* corps vide */ }
  const action = corps.action;

  const estOperateur = async () => {
    const { data } = await admin.from('operateurs')
      .select('user_id').eq('user_id', appelant).maybeSingle();
    return !!data;
  };

  // =========================================================================
  // CHACUN — changer SON propre mot de passe
  // =========================================================================
  // Ce chemin passait auparavant en direct par /auth/v1/user : aucune règle
  // ne s'y appliquait côté serveur, et c'est pourtant là que la propriétaire
  // choisit son mot de passe définitif à la première connexion.
  //
  // On revérifie que l'appelant est un membre ACTIF, et pas seulement porteur
  // d'un jeton valide : sans ça, suspendre quelqu'un ne l'empêcherait pas de
  // changer son mot de passe jusqu'à l'expiration de son jeton.
  if (action === 'mon_mot_de_passe') {
    const motdepasse = corps.motdepasse || '';
    if (motdepasse.length < 12) {
      return repondre({ ok: false, erreur: 'Le mot de passe doit faire au moins 12 caractères.' }, 400);
    }

    const { data: moi } = await admin.from('membres')
      .select('user_id').eq('user_id', appelant).eq('actif', true).maybeSingle();
    const operateur = moi ? false : await estOperateur();
    if (!moi && !operateur) {
      return repondre({ ok: false, erreur: 'Compte inactif. Contactez votre responsable.' }, 403);
    }

    if (await motDePasseCompromis(motdepasse)) {
      return repondre({ ok: false, erreur: MDP_COMPROMIS }, 400);
    }

    const { error: errMdp } = await admin.auth.admin
      .updateUserById(appelant, { password: motdepasse });
    if (errMdp) return repondre({ ok: false, erreur: errMdp.message }, 400);

    return repondre({ ok: true });
  }

  // =========================================================================
  // OPÉRATEUR — ouvrir une boutique et poser le compte de sa propriétaire
  // =========================================================================
  if (action === 'creer_boutique') {
    if (!await estOperateur()) {
      return repondre({ ok: false, erreur: "Réservé à l'opérateur du service." }, 403);
    }

    const nomBoutique = (corps.nom || '').trim();
    const slug        = (corps.slug || '').trim().toUpperCase();
    const identifiant = (corps.identifiant || '').trim().toLowerCase();
    const nomProprio  = (corps.nom_proprietaire || '').trim();
    const motdepasse  = corps.motdepasse || '';
    const plan        = (corps.plan || 'essai').trim();
    const jours       = parseInt(corps.jours_essai ?? '30', 10);
    const telephone   = (corps.telephone || '').replace(/[^0-9]/g, '') || null;

    if (!nomBoutique)  return repondre({ ok: false, erreur: 'Le nom de la boutique est obligatoire.' }, 400);
    if (!/^[A-Z0-9]{2,6}$/.test(slug)) {
      return repondre({ ok: false, erreur: 'Le code boutique doit faire 2 à 6 lettres majuscules ou chiffres.' }, 400);
    }
    if (!nomProprio)   return repondre({ ok: false, erreur: 'Le nom de la propriétaire est obligatoire.' }, 400);
    if (!valideIdentifiant(identifiant)) {
      return repondre({ ok: false, erreur: "L'identifiant doit faire 2 à 30 caractères : lettres, chiffres, point, tiret." }, 400);
    }
    if (motdepasse.length < 8) {
      return repondre({ ok: false, erreur: 'Le mot de passe doit faire au moins 8 caractères.' }, 400);
    }

    if (await motDePasseCompromis(motdepasse)) {
      return repondre({ ok: false, erreur: MDP_COMPROMIS }, 400);
    }

    const { data: existe } = await admin.from('organisations')
      .select('id').eq('slug', slug).maybeSingle();
    if (existe) return repondre({ ok: false, erreur: 'Ce code boutique est déjà pris.' }, 409);

    const expire = jours > 0
      ? new Date(Date.now() + jours * 86400000).toISOString().slice(0, 10)
      : null;

    const { data: org, error: errOrg } = await admin.from('organisations')
      .insert({ nom: nomBoutique, slug, plan, actif: true, expire_le: expire })
      .select('id').single();
    if (errOrg || !org) {
      return repondre({ ok: false, erreur: errOrg?.message || 'Création de la boutique refusée.' }, 400);
    }

    const adresse = identifiant + '@' + slug.toLowerCase() + SUFFIXE;
    const { data: cree, error: errCompte } = await admin.auth.admin.createUser({
      email: adresse, password: motdepasse, email_confirm: true,
      user_metadata: { nom: nomProprio, cree_par: appelant },
    });

    if (errCompte || !cree?.user) {
      await admin.from('organisations').delete().eq('id', org.id);
      const m = (errCompte?.message || '').toLowerCase();
      return repondre({ ok: false, erreur: (m.includes('already') || m.includes('exist'))
        ? 'Cet identifiant est déjà pris.' : (errCompte?.message || 'Création du compte refusée.') }, 400);
    }

    // Ce mot de passe a transité par une conversation : il ne doit pas durer.
    const { error: errMembre } = await admin.from('membres').insert({
      user_id: cree.user.id, organisation_id: org.id,
      nom: nomProprio, role: 'proprietaire', actif: true,
      email: adresse, telephone, doit_changer_mdp: true,
    });

    if (errMembre) {
      await admin.auth.admin.deleteUser(cree.user.id);
      await admin.from('organisations').delete().eq('id', org.id);
      return repondre({ ok: false, erreur: 'Rattachement impossible : ' + errMembre.message }, 400);
    }

    return repondre({
      ok: true, organisation_id: org.id, slug,
      nom_boutique: nomBoutique, nom_proprietaire: nomProprio,
      login: identifiant + '@' + slug.toLowerCase(),
    });
  }

  // =========================================================================
  // OPÉRATEUR — poser une propriétaire sur une boutique qui existe déjà
  // =========================================================================
  // `creer_boutique` crée la propriétaire en même temps que la boutique, et
  // c'était le seul chemin. Il n'y en avait donc aucun pour :
  //   — détacher le compte du fondateur d'une boutique en lui donnant une
  //     vraie propriétaire (ce qu'on fait le 2026-10-22) ;
  //   — réparer une boutique restée sans aucun membre, où plus personne ne
  //     peut entrer. « Marjan Bijouterie Saint louis » est dans ce cas.
  //
  // Volontairement réservé à l'opérateur : donner une propriétaire à une
  // boutique est un geste de service, pas un geste de commerçante.
  if (action === 'creer_proprietaire') {
    if (!await estOperateur()) {
      return repondre({ ok: false, erreur: "Réservé à l'opérateur du service." }, 403);
    }

    const orgId       = (corps.organisation_id || '').trim();
    const identifiant = (corps.identifiant || '').trim().toLowerCase();
    const nom         = (corps.nom || '').trim();
    const motdepasse  = corps.motdepasse || '';
    const telephone   = (corps.telephone || '').replace(/[^0-9]/g, '') || null;

    if (!orgId) return repondre({ ok: false, erreur: 'Boutique non précisée.' }, 400);
    if (!nom)   return repondre({ ok: false, erreur: 'Le nom est obligatoire.' }, 400);
    if (!valideIdentifiant(identifiant)) {
      return repondre({ ok: false, erreur: "L'identifiant doit faire 2 à 30 caractères : lettres, chiffres, point, tiret." }, 400);
    }
    if (motdepasse.length < 8) {
      return repondre({ ok: false, erreur: 'Le mot de passe doit faire au moins 8 caractères.' }, 400);
    }

    if (await motDePasseCompromis(motdepasse)) {
      return repondre({ ok: false, erreur: MDP_COMPROMIS }, 400);
    }

    const { data: org } = await admin.from('organisations')
      .select('id, nom, slug').eq('id', orgId).maybeSingle();
    if (!org)       return repondre({ ok: false, erreur: 'Boutique introuvable.' }, 404);
    if (!org.slug)  return repondre({ ok: false, erreur: 'Boutique sans code.' }, 400);

    const adresse = identifiant + '@' + String(org.slug).toLowerCase() + SUFFIXE;
    const { data: cree, error: errCompte } = await admin.auth.admin.createUser({
      email: adresse, password: motdepasse, email_confirm: true,
      user_metadata: { nom, cree_par: appelant },
    });

    if (errCompte || !cree?.user) {
      const m = (errCompte?.message || '').toLowerCase();
      return repondre({ ok: false, erreur: (m.includes('already') || m.includes('exist'))
        ? 'Cet identifiant est déjà pris dans cette boutique.'
        : (errCompte?.message || 'Création du compte refusée.') }, 400);
    }

    // Même raison qu'à la création d'une boutique : ce mot de passe a été
    // posé par l'opérateur et dicté de vive voix, il ne doit pas durer.
    const { error: errMembre } = await admin.from('membres').insert({
      user_id: cree.user.id, organisation_id: org.id,
      nom, role: 'proprietaire', actif: true,
      email: adresse, telephone, doit_changer_mdp: true,
    });

    if (errMembre) {
      await admin.auth.admin.deleteUser(cree.user.id);
      return repondre({ ok: false, erreur: 'Rattachement impossible : ' + errMembre.message }, 400);
    }

    return repondre({ ok: true, user_id: cree.user.id,
      nom_boutique: org.nom, nom, login: identifiant + '@' + String(org.slug).toLowerCase() });
  }

  // =========================================================================
  // OPÉRATEUR — retirer les comptes d'une boutique supprimée
  // =========================================================================
  // Second temps de la suppression. Le premier, `supprimer_boutique()` en
  // SQL, efface les données et renvoie les comptes à retirer ; il ne peut pas
  // les supprimer lui-même, parce que les identités et les sessions ne vivent
  // pas dans une table ordinaire — seule l'API Admin les nettoie.
  //
  // Volontairement bête : elle ne décide rien. Les verrous sont dans la
  // fonction SQL, qui a déjà refusé si quoi que ce soit l'interdisait. On
  // refuse seulement de toucher un compte encore rattaché à une boutique —
  // filet de sécurité si cette action était appelée seule.
  if (action === 'supprimer_comptes') {
    if (!await estOperateur()) {
      return repondre({ ok: false, erreur: "Réservé à l'opérateur du service." }, 403);
    }

    const ids: string[] = Array.isArray((corps as Record<string, unknown>).user_ids)
      ? ((corps as unknown as { user_ids: string[] }).user_ids) : [];
    if (ids.length === 0) return repondre({ ok: true, retires: 0 });

    let retires = 0;
    const gardes: string[] = [];
    for (const id of ids) {
      if (id === appelant) { gardes.push(id); continue; }   // jamais soi-même

      // Jamais un compte du plan service non plus. « Jamais soi-même » ne
      // suffit pas : le jour où un deuxième opérateur existe, il supprimerait
      // une boutique dont un autre opérateur est membre, et emporterait le
      // compte de service de celui-ci — la console entière avec. Le seul
      // opérateur d'aujourd'hui est aussi propriétaire d'une boutique : la
      // mine est déjà posée, elle attend le deuxième.
      const { data: estOp } = await admin.from('operateurs')
        .select('user_id').eq('user_id', id).maybeSingle();
      if (estOp) { gardes.push(id); continue; }

      const { data: encore } = await admin.from('membres')
        .select('user_id').eq('user_id', id).maybeSingle();
      if (encore) { gardes.push(id); continue; }            // encore rattaché ailleurs
      const { error } = await admin.auth.admin.deleteUser(id);
      if (!error) retires++;
    }

    return repondre({ ok: true, retires, conserves: gardes.length });
  }

  // =========================================================================
  // OPÉRATEUR — rendre son accès à une propriétaire qui l'a perdu
  // =========================================================================
  if (action === 'motdepasse_proprietaire') {
    if (!await estOperateur()) {
      return repondre({ ok: false, erreur: "Réservé à l'opérateur du service." }, 403);
    }

    const orgId = corps.organisation_id || '';
    const motdepasse = corps.motdepasse || '';
    if (!orgId) return repondre({ ok: false, erreur: 'Boutique non précisée.' }, 400);
    if (motdepasse.length < 8) {
      return repondre({ ok: false, erreur: 'Le mot de passe doit faire au moins 8 caractères.' }, 400);
    }

    if (await motDePasseCompromis(motdepasse)) {
      return repondre({ ok: false, erreur: MDP_COMPROMIS }, 400);
    }

    // Volontairement limité à la propriétaire : l'équipe relève d'elle, pas
    // de l'opérateur. Une boutique en compte normalement une seule active.
    const { data: proprios } = await admin.from('membres')
      .select('user_id, nom, email')
      .eq('organisation_id', orgId).eq('role', 'proprietaire').eq('actif', true);

    if (!proprios || proprios.length === 0) {
      return repondre({ ok: false, erreur: "Cette boutique n'a pas de propriétaire active." }, 404);
    }
    if (proprios.length > 1) {
      return repondre({ ok: false, erreur: 'Cette boutique a plusieurs propriétaires : intervention manuelle requise.' }, 409);
    }

    const cible = proprios[0];
    const { error: errMaj } = await admin.auth.admin
      .updateUserById(cible.user_id as string, { password: motdepasse });
    if (errMaj) return repondre({ ok: false, erreur: errMaj.message }, 400);

    // Même raison qu'à la création : ce mot de passe est passé par vous.
    await admin.from('membres')
      .update({ doit_changer_mdp: true })
      .eq('user_id', cible.user_id as string);

    return repondre({ ok: true, nom: cible.nom,
      login: loginCourt(String(cible.email || '')) });
  }

  // =========================================================================
  // PROPRIÉTAIRE — les comptes de son équipe
  // =========================================================================
  const { data: membre } = await admin
    .from('membres')
    .select('organisation_id, role, actif, organisations(slug, nom)')
    .eq('user_id', appelant).eq('actif', true).maybeSingle();

  if (!membre) return repondre({ ok: false, erreur: 'Compte rattaché à aucune boutique.' }, 403);
  if (membre.role !== 'proprietaire') {
    return repondre({ ok: false, erreur: 'Action réservée à la propriétaire de la boutique.' }, 403);
  }

  const orgId = membre.organisation_id as string;
  const slug = (membre.organisations as { slug: string } | null)?.slug;
  if (!slug) return repondre({ ok: false, erreur: 'Boutique sans code.' }, 400);

  if (action === 'creer') {
    const identifiant = (corps.identifiant || '').trim().toLowerCase();
    const nom = (corps.nom || '').trim();
    const role = (corps.role || '').trim();
    const motdepasse = corps.motdepasse || '';
    const telephone = (corps.telephone || '').replace(/[^0-9]/g, '') || null;

    if (!valideIdentifiant(identifiant)) {
      return repondre({ ok: false, erreur: "L'identifiant doit faire 2 à 30 caractères : lettres, chiffres, point, tiret." }, 400);
    }
    if (!nom) return repondre({ ok: false, erreur: 'Le nom est obligatoire.' }, 400);
    if (!ROLES_EQUIPE.includes(role)) return repondre({ ok: false, erreur: 'Rôle invalide.' }, 400);
    if (motdepasse.length < 8) {
      return repondre({ ok: false, erreur: 'Le mot de passe doit faire au moins 8 caractères.' }, 400);
    }

    if (await motDePasseCompromis(motdepasse)) {
      return repondre({ ok: false, erreur: MDP_COMPROMIS }, 400);
    }

    const adresse = identifiant + '@' + slug.toLowerCase() + SUFFIXE;
    const { data: cree, error: errCreation } = await admin.auth.admin.createUser({
      email: adresse, password: motdepasse, email_confirm: true,
      user_metadata: { nom, cree_par: appelant },
    });

    if (errCreation || !cree?.user) {
      const m = (errCreation?.message || '').toLowerCase();
      if (m.includes('already') || m.includes('exist')) {
        return repondre({ ok: false, erreur: 'Cet identifiant est déjà pris dans votre boutique.' }, 409);
      }
      return repondre({ ok: false, erreur: errCreation?.message || 'Création refusée.' }, 400);
    }

    // Pas de changement imposé ici : la propriétaire garde volontairement la
    // main sur les accès de son équipe (décidé le 2026-10-19).
    const { error: errMembre } = await admin.from('membres').insert({
      user_id: cree.user.id, organisation_id: orgId,
      nom, role, actif: true, email: adresse, telephone,
    });

    if (errMembre) {
      await admin.auth.admin.deleteUser(cree.user.id);
      return repondre({ ok: false, erreur: 'Rattachement impossible : ' + errMembre.message }, 400);
    }

    return repondre({ ok: true, user_id: cree.user.id, identifiant,
      login: identifiant + '@' + slug.toLowerCase(), nom, role });
  }

  if (action === 'motdepasse') {
    const userId = corps.user_id || '';
    const motdepasse = corps.motdepasse || '';

    if (!userId) return repondre({ ok: false, erreur: 'Membre non précisé.' }, 400);
    if (motdepasse.length < 8) {
      return repondre({ ok: false, erreur: 'Le mot de passe doit faire au moins 8 caractères.' }, 400);
    }

    if (userId === appelant) {
      return repondre({ ok: false, erreur: 'Changez votre propre mot de passe depuis votre profil.' }, 400);
    }

    if (await motDePasseCompromis(motdepasse)) {
      return repondre({ ok: false, erreur: MDP_COMPROMIS }, 400);
    }

    const { data: cible } = await admin.from('membres')
      .select('user_id, nom').eq('user_id', userId)
      .eq('organisation_id', orgId).maybeSingle();
    if (!cible) return repondre({ ok: false, erreur: "Ce membre n'est pas de votre boutique." }, 403);

    const { error: errMaj } = await admin.auth.admin.updateUserById(userId, { password: motdepasse });
    if (errMaj) return repondre({ ok: false, erreur: errMaj.message }, 400);

    return repondre({ ok: true, nom: cible.nom });
  }

  return repondre({ ok: false, erreur: 'Action inconnue.' }, 400);
});
