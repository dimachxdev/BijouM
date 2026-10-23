/**
 * KAYOR v3 — Application complète
 * Modules : Auth, Journal, Stocks, Achats, Sorties, Décaissements,
 *           Clients, Comptes clients (épargne), Bijoux en arrhes
 */

// ============================================
// STATE
// ============================================
// Le logo KAYOR en base64 vivait ici (60 Ko chargés à chaque ouverture).
// Retiré le 2026-10-21 : il ne servait plus que de repli sur les factures,
// où il imprimait la marque du logiciel sur les documents d'autres boutiques.
// L'original reste dans assets/logo-b64.txt et assets/logo-kayor.jpg.

/**
 * Version du code. À incrémenter à chaque livraison.
 *
 * Sert à distinguer une vraie anomalie d'un poste qui affiche encore une
 * ancienne copie — cache du navigateur, ou déploiement pas à jour. Un vendeur
 * qui « peut tout faire » alors que les droits sont restreints, c'est presque
 * toujours ça.
 */
const APP_VERSION = '2026-10-23-vente-epargne';

function loadLS(k, fb) { try { const s=localStorage.getItem(k); return s?JSON.parse(s):fb; } catch { return fb; } }

const STATE = {
  currentUser: null,   // alimenté par Auth après connexion — plus de liste locale d'utilisateurs
  ventes:        loadLS('marjan_ventes',     INITIAL_VENTES),
  clients:       loadLS('marjan_clients',    INITIAL_CLIENTS),
  stock:         loadLS('marjan_stock',      INITIAL_STOCK),
  sorties:       loadLS('marjan_sorties',    INITIAL_SORTIES),
  decaissements: loadLS('marjan_decaiss',    INITIAL_DECAISSEMENTS),
  achatsClients: loadLS('marjan_ac',         INITIAL_ACHATS_CLIENTS),
  comptesClients:loadLS('marjan_cc',         INITIAL_COMPTES_CLIENTS),
  bijouxArr:     loadLS('marjan_ba',         INITIAL_BIJOUX_ARR),
  connexions:    loadLS('marjan_connexions', INITIAL_CONNEXIONS),
  counters: loadLS('marjan_counters', { v:16, s:3, d:6, a:5, ac:3, cc:3, ba:3, cl:10, u:4, cn:8, stk:0, fac:0 }),
};

const PAIEMENT_LABELS = {
  'especes':'Especes', 'wave':'Wave', 'orange-money':'Orange Money',
  'carte':'Carte', 'livraison':'Livraison', 'compte':'Compte'
};

// save() : localStorage + flag Supabase
function save() {
  const keyMap = {
    ventes:'ventes', clients:'clients', stock:'stock',
    sorties:'sorties', decaissements:'decaiss',
    achatsClients:'ac', comptesClients:'cc', bijouxArr:'ba',
    connexions:'connexions', counters:'counters'
  };
  Object.keys(keyMap).forEach(k => localStorage.setItem('marjan_'+keyMap[k], JSON.stringify(STATE[k])));
}
// nextId() a été supprimée : elle fabriquait les identifiants depuis un
// compteur local, qui pouvait être en retard et refabriquer un numéro déjà
// pris — l'écriture en upsert écrasait alors la ligne existante en silence.
// Les numéros sont désormais attribués par le serveur, de façon atomique :
// voir prochainId() et prochainsIdsVente() dans js/supabase.js.

// ── Wrappers save + Supabase : écriture → relecture → re-render ───────────

async function saveAndSyncVente(v) {
  save();
  try {
    await saveVente(v);
    // Relire toutes les ventes depuis Supabase
    var rows = await _supa.select('ventes', 'order=date.desc');
    STATE.ventes = rows.map(mapVente);
    save();
    renderJournal(); renderDashboard();
  } catch(e) { console.error('saveAndSyncVente:', e); }
}

async function saveAndSyncStock(items) {
  save(); // localStorage immédiat
  try {
    var rows = Array.isArray(items) ? items : [items];
    // Préparer les données à envoyer
    var toUpsert = rows.map(function(s) {
      return {
        ref:s.ref, nom:s.nom, type_bijou:s.typeBijou||null,
        carat:s.carat||null, provenance:s.provenance||null,
        type:s.type||'autre', poids:s.poids||0,
        poids_total_g:s.poidsTotalG||0, // ← poids ET qty envoyés
        qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50
      };
    });
    // Écrire dans Supabase et ATTENDRE la confirmation
    await _supa.upsert('stock', toUpsert);
    // Seulement après confirmation → relire depuis Supabase
    await reloadStock();
  } catch(e) {
    console.error('saveAndSyncStock:', e);
    showToast('Erreur sync stock: ' + e.message);
  }
}

async function saveAndSyncSortie(s) {
  save();
  try {
    await saveSortie(s);
    var rows = await _supa.select('sorties', 'order=date.desc');
    STATE.sorties = rows.map(mapSortie);
    save();
    renderSorties();
    // Aussi relire le stock (déduit)
    var stockRows = await _supa.select('stock');
    STATE.stock = stockRows.map(mapStock);
    save();
    renderStocks(); renderDashboard();
  } catch(e) { console.error('saveAndSyncSortie:', e); }
}

async function saveAndSyncDecaissement(d) {
  save();
  try {
    await saveDecaissement(d);
    var rows = await _supa.select('decaissements', 'order=date.desc');
    STATE.decaissements = rows.map(mapDecaissement);
    save();
    renderDecaissements(); renderDashboard();
  } catch(e) { console.error('saveAndSyncDecaissement:', e); }
}

async function saveAndSyncClient(c) {
  save();
  try {
    await saveClient(c);
    var rows = await _supa.select('clients');
    STATE.clients = rows;
    save();
    if(typeof renderClients === 'function') renderClients();
  } catch(e) { console.error('saveAndSyncClient:', e); }
}

async function saveAndSyncCC(cc) {
  save();
  try {
    await saveCompteClient(cc);
    // Relire comptes + mouvements
    var comptes = await _supa.select('comptes_clients');
    var mouvements = await _supa.select('mouvements_cc', 'order=id.asc');
    comptes.forEach(function(c) {
      c.mouvements = mouvements
        .filter(function(m){ return m.compte_id === c.id; })
        .map(function(m){ return {date:m.date,type:m.type,montant:m.montant,note:m.note}; });
    });
    STATE.comptesClients = comptes.map(mapCompte);
    save();
    renderComptesClients(); renderDashboard();
  } catch(e) { console.error('saveAndSyncCC:', e); }
}

async function saveAndSyncReprise(r) {
  save();
  try {
    await saveReprise(r);
    var rows = await _supa.select('reprises', 'order=date.desc');
    STATE.achatsClients = rows.map(mapReprise);
    // Aussi relire le stock (reprise l'alimente)
    var stockRows = await _supa.select('stock');
    STATE.stock = stockRows.map(mapStock);
    save();
    renderAchatsClients(); renderStocks(); renderDashboard();
  } catch(e) { console.error('saveAndSyncReprise:', e); }
}

async function saveAndSyncBijouArr(ba) {
  save();
  try {
    await saveBijouArr(ba);
    var arrhes = await _supa.select('bijoux_arrhes');
    var mvts = await _supa.select('mouvements_arrhes');
    arrhes.forEach(function(a){
      a.mouvements = mvts.filter(function(m){ return m.arrhes_id===a.id; })
        .map(function(m){ return {date:m.date,montant:m.montant,note:m.note}; });
    });
    STATE.bijouxArr = arrhes;
    // Aussi relire le stock (arrhes le déduit)
    var stockRows = await _supa.select('stock');
    STATE.stock = stockRows.map(mapStock);
    save();
    renderBijouxArr(); renderStocks(); renderDashboard();
  } catch(e) { console.error('saveAndSyncBijouArr:', e); }
}

async function saveAndSyncConnexion(cn) {
  save();
  try {
    await saveConnexion(cn);
  } catch(e) { console.error('saveAndSyncConnexion:', e); }
}


// ============================================
// PERMISSIONS
// ============================================
// Ces deux fonctions ne pilotent que l'affichage (masquer un onglet, un bouton).
// L'autorisation réelle est appliquée par les policies RLS dans PostgreSQL :
// forcer STATE.currentUser.role dans la console change l'interface, pas les
// droits — les requêtes sont rejetées côté serveur.
function peutAcceder(section) {
  const role = STATE.currentUser?.role;
  if (!role) return false;
  // Le profil boutique porte l'identité commerciale et fiscale de
  // l'entreprise. `all` ne doit pas l'ouvrir aux administrateurs, qui sont
  // des employés : seul le propriétaire y touche.
  if (section === 'profil_boutique') return role === 'proprietaire';
  // « Ma journée » est le relevé de remise de caisse de celle qui encaisse.
  // Les administrateurs ont le rapport journalier, bien plus complet.
  if (section === 'ma_journee') return role === 'vendeur' || role === 'gestionnaire';
  const perms = PERM_MAP[role] || [];
  return perms.includes('all') || perms.includes(section);
}

/**
 * Qui voit l'encaisse du magasin.
 *
 * Aligné sur le rapport journalier, déjà réservé aux administrateurs pour la
 * même raison. Ce n'est pas qu'un choix d'affichage : la migration 008 ferme
 * aussi la lecture des décaissements côté serveur, donc un vendeur qui
 * interroge l'API reçoit une liste vide.
 */
function peutVoirCaisse() { return isAdmin(); }

/** Retire de l'écran tout ce qui révèle l'encaisse, si le rôle n'y a pas droit. */
function appliquerVisibiliteCaisse() {
  var autorise = peutVoirCaisse();
  ['carte-solde-caisse', 'cumul-solde-caisse', 'btn-export-rapport'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = autorise ? '' : 'none';
  });
}

function isAdmin() {
  const role = STATE.currentUser?.role;
  return role === 'admin' || role === 'proprietaire';
}

// ============================================
// PROFIL DE LA BOUTIQUE
// ============================================
// L'identité imprimée sur les factures et reçus. Elle était écrite en dur
// dans le code : en SaaS, chaque boutique doit imprimer la sienne.

var LOGO_BOUTIQUE_TEMP = null;   // logo choisi, pas encore enregistré

/** Valeurs de repli tant qu'une boutique n'a pas rempli son profil. */
function boutiqueInfos() {
  var b = (typeof Auth !== 'undefined' && Auth.connecte()) ? Auth.boutique() : {};
  return {
    nom:       b.nom       || 'Bijouterie',
    slogan:    b.slogan    || '',
    adresse:   b.adresse   || '',
    telephone: b.telephone || '',
    ninea:     b.ninea     || '',
    rccm:      b.rccm      || '',
    pied:      b.pied_facture || '',
    logo:      b.logo      || ''
  };
}

/**
 * Logo pour les documents imprimés — celui de la boutique, ou rien.
 *
 * Le repli était le logo KAYOR : une bijouterie qui n'avait pas téléversé le
 * sien imprimait donc la marque de son fournisseur de logiciel sur ses
 * propres factures, remises à ses clientes. C'est exactement ce qu'interdit
 * la règle « aucune identité de boutique en dur ». Corrigé le 2026-10-21.
 *
 * Sans logo, aucune image : le nom commercial est juste à côté et tient seul
 * l'en-tête. Il n'y a jamais eu de cadre vide à combler.
 */
function _logoFacture(hauteur) {
  var b = boutiqueInfos();
  if (!b.logo) return '';
  return '<img src="' + esc(b.logo) + '" alt="' + esc(b.nom) + '" style="max-height:'
       + (hauteur || 54) + 'px;max-width:150px;object-fit:contain" />';
}

/**
 * Fragment de nom de fichier tiré de la boutique : « bijouterie-diamant ».
 * Les exports s'appelaient « ..._marjan_... », l'ancienne marque.
 */
function _slugFichier() {
  var n = boutiqueInfos().nom
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return n || 'boutique';
}

/** Ligne d'identité pour un document : « Adresse · Tél · NINEA ». */
function boutiqueLigneContact() {
  var b = boutiqueInfos();
  return [b.adresse, b.telephone ? 'Tél ' + b.telephone : '',
          b.ninea ? 'NINEA ' + b.ninea : '', b.rccm ? 'RCCM ' + b.rccm : '']
         .filter(Boolean).join(' · ');
}

function renderProfilBoutique() {
  if (STATE.currentUser?.role !== 'proprietaire') {
    showToast('⛔ Profil réservé au propriétaire.'); return;
  }
  var b = Auth.boutique();
  document.getElementById('b-nom').value       = b.nom || '';
  document.getElementById('b-slogan').value    = b.slogan || '';
  document.getElementById('b-adresse').value   = b.adresse || '';
  document.getElementById('b-telephone').value = b.telephone || '';
  document.getElementById('b-ninea').value     = b.ninea || '';
  document.getElementById('b-rccm').value      = b.rccm || '';
  document.getElementById('b-pied').value      = b.pied_facture || '';
  LOGO_BOUTIQUE_TEMP = null;
  afficherApercuLogo(b.logo || '');
  messageBoutique('');
}

function afficherApercuLogo(dataUri) {
  var el = document.getElementById('b-logo-apercu');
  if (!el) return;
  el.innerHTML = dataUri
    ? '<img src="' + dataUri + '" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain" />'
    : '<span style="font-size:11px;color:var(--text-tertiary)">aucun</span>';
}

function messageBoutique(texte, erreur) {
  var el = document.getElementById('b-message');
  if (!el) return;
  el.style.display = texte ? 'block' : 'none';
  el.textContent = texte || '';
  el.style.background = erreur ? 'var(--danger-bg)' : 'var(--success-bg)';
  el.style.color      = erreur ? 'var(--danger-text)' : 'var(--success-text)';
}

function chargerLogoBoutique(input) {
  var f = input.files && input.files[0];
  if (!f) return;
  // Le logo est relu à chaque impression : au-delà de 200 Ko, chaque facture
  // devient lente à afficher et la fiche boutique lourde à charger.
  if (f.size > 200 * 1024) {
    messageBoutique('Image trop lourde (' + Math.round(f.size/1024) + ' Ko). Maximum 200 Ko.', true);
    input.value = ''; return;
  }
  var reader = new FileReader();
  reader.onload = function (e) {
    LOGO_BOUTIQUE_TEMP = e.target.result;
    afficherApercuLogo(LOGO_BOUTIQUE_TEMP);
    messageBoutique('Logo prêt — cliquez sur Enregistrer pour l\'appliquer.');
  };
  reader.readAsDataURL(f);
}

function retirerLogoBoutique() {
  LOGO_BOUTIQUE_TEMP = '';
  afficherApercuLogo('');
  document.getElementById('b-logo-fichier').value = '';
  messageBoutique('Logo retiré — cliquez sur Enregistrer pour appliquer.');
}

async function enregistrerProfilBoutique() {
  if (STATE.currentUser?.role !== 'proprietaire') {
    showToast('⛔ Réservé au propriétaire.'); return;
  }
  var nom = document.getElementById('b-nom').value.trim();
  if (!nom) { messageBoutique('Le nom commercial est obligatoire.', true); return; }

  var maj = {
    nom:          nom,
    slogan:       document.getElementById('b-slogan').value.trim()    || null,
    adresse:      document.getElementById('b-adresse').value.trim()   || null,
    telephone:    document.getElementById('b-telephone').value.trim() || null,
    ninea:        document.getElementById('b-ninea').value.trim()     || null,
    rccm:         document.getElementById('b-rccm').value.trim()      || null,
    pied_facture: document.getElementById('b-pied').value.trim()      || null
  };
  if (LOGO_BOUTIQUE_TEMP !== null) maj.logo = LOGO_BOUTIQUE_TEMP || null;

  var btn = document.getElementById('btn-save-boutique');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/organisations?id=eq.' + encodeURIComponent(Auth.orgId()), {
      method: 'PATCH', headers: H(), body: JSON.stringify(maj)
    });
    if (!r.ok) throw new Error('Enregistrement refusé (' + r.status + ').');

    await Auth.chargerProfil();     // relire l'identité pour les impressions
    LOGO_BOUTIQUE_TEMP = null;
    var orgEl = document.getElementById('org-name');
    if (orgEl) orgEl.textContent = nom;
    appliquerIdentiteBoutique();   // logo, nom et slogan sans recharger la page
    messageBoutique('✓ Profil enregistré. Vos prochaines factures porteront ces informations.');
  } catch (e) {
    messageBoutique('⚠ ' + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = '✓ Enregistrer';
  }
}

// ============================================
// CAISSE — règles de calcul
// ============================================

/**
 * Argent réellement entré en caisse pour une vente.
 *
 * `acompte` mélange deux natures : ce que la cliente a sorti de sa poche, et
 * ce qui a été prélevé sur son compte épargne. Le second était déjà dans le
 * tiroir depuis son dépôt — le recompter gonflerait la caisse.
 *
 * Fonctionne aussi pour un paiement mixte (compte + espèces) : seule la part
 * hors compte est retenue.
 */
function encaisseReel(v) {
  return Math.max(0, (v.acompte || 0) - (v.payeParCompte || 0));
}

/** Somme des mouvements d'un compte épargne — la seule vérité sur son solde. */
function soldeDepuisMouvements(cc) {
  return (cc.mouvements || []).reduce(function (s, m) {
    return s + (m.type === 'retrait' ? -(m.montant || 0) : (m.montant || 0));
  }, 0);
}

/**
 * Recale le solde d'un compte sur son historique.
 * Le solde est une colonne stockée à côté des mouvements : les deux peuvent
 * diverger, et c'est arrivé. On les resynchronise à chaque écriture.
 */
function recalerSolde(cc) {
  cc.solde = soldeDepuisMouvements(cc);
  return cc.solde;
}

/**
 * Dépôts d'épargne entrés en caisse.
 *
 * Un dépôt est une avance sur un futur achat : l'argent entre physiquement
 * dans le tiroir le jour du versement. Quand la cliente choisit son bijou,
 * la vente n'ajoute rien de plus (encaisseReel vaut alors zéro pour la part
 * prélevée sur le compte) — elle ne verse que le complément éventuel.
 */
function totalDepotsEpargne(filtreMois) {
  return STATE.comptesClients.reduce(function (s, cc) {
    return s + (cc.mouvements || []).reduce(function (t, m) {
      // Seuls les dépôts font entrer de l'argent dans le tiroir.
      //
      // La règle était « tout ce qui n'est pas un retrait » : elle comptait
      // donc comme argent entrant toute écriture corrective, par exemple
      // l'annulation d'un retrait — qui ne fait pourtant rien entrer, elle
      // rend seulement à la cliente un droit de tirage qu'elle n'a jamais
      // dépensé.
      if (m.type !== 'depot') return t;
      if (filtreMois && !isMois(m.date)) return t;
      return t + (m.montant || 0);
    }, 0);
  }, 0);
}

/** Argent réellement présent en caisse : ventes encaissées + dépôts − décaissements. */
function soldeCaisse(filtreMois) {
  var ventes = STATE.ventes
    .filter(function (v) { return !filtreMois || isMois(v.date); })
    .reduce(function (s, v) { return s + encaisseReel(v); }, 0);
  var decaiss = STATE.decaissements
    .filter(function (d) { return !filtreMois || isMois(d.date); })
    .reduce(function (s, d) { return s + (d.montant || 0); }, 0);
  return ventes + totalDepotsEpargne(filtreMois) - decaiss;
}

/**
 * Avances déjà encaissées que les clientes n'ont pas encore converties en
 * bijou. Information, non déduite du solde : cet argent est bien à vous,
 * simplement pas encore transformé en vente.
 */
function totalAvancesAConvertir() {
  return STATE.comptesClients
    .filter(function (cc) { return cc.actif !== false; })
    .reduce(function (s, cc) { return s + Math.max(0, cc.solde || 0); }, 0);
}

// ============================================
// AUTH
// ============================================
document.getElementById('login-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('login-user').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('login-pass').focus(); });
// Entrée valide aussi les panneaux d'inscription et de réinitialisation.
[['forgot-email',()=>doForgot()],['reset-pass2',()=>doReset()]]
  .forEach(([id,fn]) => document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') fn(); }));

function resetAppData() {
  if (!confirm('Vider le cache local ?\n\nLes données restent dans Supabase et seront rechargées à la prochaine connexion.')) return;
  ['marjan_users','marjan_ventes','marjan_clients','marjan_stock','marjan_sorties',
   'marjan_decaiss','marjan_ac','marjan_cc','marjan_ba',
   'marjan_connexions','marjan_counters','marjan_clients_pin',
   'kayor_session'].forEach(k => localStorage.removeItem(k));
  location.reload();
}

/**
 * Connexion via Supabase Auth.
 *
 * Avant : STATE.users.find(u => u.password === pass) — mot de passe en clair,
 * comparé dans le navigateur, donc lisible par quiconque ouvre la console.
 * Maintenant : le serveur vérifie l'empreinte bcrypt et renvoie un JWT signé.
 * L'organisation et le rôle viennent de la table `membres`, et sont
 * revérifiés par PostgreSQL à chaque requête.
 */
async function doLogin() {
  const email = document.getElementById('login-user').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('btn-login');

  if (!email || !pass) {
    errEl.textContent = 'Renseignez votre email et votre mot de passe.';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.textContent = 'Connexion…'; }

  try {
    const profil = await Auth.connexion(email, pass);
    ouvrirSession(profil);
  } catch (e) {
    errEl.textContent = e.message || 'Connexion impossible.';
    errEl.style.display = 'block';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
  }
}

/**
 * Habille l'interface aux couleurs de la boutique connectée.
 * Le logo et le nom étaient écrits en dur dans index.html : en SaaS, chaque
 * boutique doit voir la sienne, pas KAYOR.
 */
function appliquerIdentiteBoutique() {
  var b = boutiqueInfos();
  var nom = document.getElementById('topbar-nom');
  if (nom) nom.textContent = b.nom;
  var logo = document.getElementById('sidebar-logo');
  if (logo) { logo.src = b.logo || 'assets/logo-kayor.jpg'; logo.alt = b.nom; }
  var slogan = document.getElementById('sidebar-slogan');
  if (slogan) {
    slogan.textContent = b.slogan || '';
    slogan.style.display = b.slogan ? '' : 'none';
  }
  document.title = b.nom + (b.slogan ? ' — ' + b.slogan : ' — Gestion');
}

/** Affiche l'application pour un profil authentifié (connexion ou reprise de session). */
function ouvrirSession(profil) {
  STATE.currentUser = {
    id:   profil.user_id,
    nom:  profil.nom,
    role: profil.role,
    organisationId: profil.organisation_id
  };

  // Le mot de passe posé par l'opérateur a transité par une conversation :
  // on ne laisse pas entrer avant qu'il soit remplacé (migration 018).
  if (profil.doitChangerMdp) {
    afficherPanneau('panel-premier-mdp');
    document.getElementById('pm-1').value = '';
    document.getElementById('pm-2').value = '';
    setTimeout(function () { document.getElementById('pm-1').focus(); }, 50);
    return;
  }

  // Remettre l'écran de connexion sur son panneau d'accueil : sans cela, une
  // déconnexion après un changement de mot de passe rouvrirait sur celui-ci.
  afficherPanneau('panel-login');

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').style.display     = 'block';
  appliquerIdentiteBoutique();
  appliquerVisibiliteCaisse();

  const role = ROLES[profil.role] || ROLES.vendeur;
  document.getElementById('user-avatar').textContent =
    profil.nom.split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase();
  document.getElementById('user-name').textContent = profil.nom;

  const badge = document.getElementById('user-role-badge');
  badge.textContent = role.label;
  badge.style.background = role.bg;
  badge.style.color = role.color;

  const tb = document.getElementById('topbar-role-badge');
  if (tb) { tb.textContent = role.label; tb.style.background = role.bg; tb.style.color = role.color; }

  // Nom de la boutique — l'utilisateur doit voir dans quel tenant il travaille.
  const orgEl = document.getElementById('org-name');
  if (orgEl && profil.org_nom) orgEl.textContent = profil.org_nom;

  buildNav();
  renderDashboard();
  startAutoRefresh();

  chargerDonnees().then(function () {
    enregistrerConnexion(STATE.currentUser, 'connexion');
    startRealtime();
  });
}

async function doLogout() {
  if (STATE.currentUser) enregistrerConnexion(STATE.currentUser, 'déconnexion');
  stopRealtime();
  stopAutoRefresh();
  await Auth.deconnexion();
  STATE.currentUser = null;
  document.getElementById('main-app').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('login-user').value='';
  document.getElementById('login-pass').value='';
  afficherPanneau('panel-login');
}

// ============================================
// INSCRIPTION / MOT DE PASSE OUBLIÉ
// ============================================
const PANNEAUX_AUTH = ['panel-login','panel-forgot','panel-reset','panel-premier-mdp'];

function afficherPanneau(id) {
  PANNEAUX_AUTH.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = (p === id) ? 'block' : 'none';
  });
  ['login-error','forgot-error','forgot-ok','reset-error','reset-ok','pm-error']
    .forEach(i => { const el = document.getElementById(i); if (el) el.style.display = 'none'; });
}


/**
 * Premier mot de passe choisi par la personne elle-même.
 *
 * Le mot de passe qu'on lui a remis cesse de valoir dès l'enregistrement, et
 * le drapeau tombe côté serveur. Tant que ça n'est pas fait, l'application
 * reste fermée — c'est le seul écran accessible après la connexion.
 */
async function doPremierMotDePasse() {
  const p1 = document.getElementById('pm-1').value;
  const p2 = document.getElementById('pm-2').value;
  messageAuth('pm-error', '');

  if (p1.length < 8)  { messageAuth('pm-error', 'Le mot de passe doit faire au moins 8 caractères.'); return; }
  if (p1 !== p2)      { messageAuth('pm-error', 'Les deux saisies ne correspondent pas.'); return; }

  const btn = document.getElementById('btn-premier-mdp');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    await Auth.changerMotDePasse(p1);
    // Le profil porte désormais doitChangerMdp = false : on peut entrer.
    ouvrirSession(Auth.profil());
  } catch (e) {
    messageAuth('pm-error', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Enregistrer et continuer';
  }
}

function messageAuth(id, texte) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = texte;
  el.style.display = texte ? 'block' : 'none';
}

async function doForgot() {
  const email = document.getElementById('forgot-email').value.trim();
  const btn   = document.getElementById('btn-forgot');
  messageAuth('forgot-error',''); messageAuth('forgot-ok','');

  if (!email) { messageAuth('forgot-error','Renseignez votre adresse email.'); return; }

  btn.disabled = true; btn.textContent = 'Envoi…';
  try {
    await Auth.demanderReinitialisation(email);
    // Réponse identique que l'adresse existe ou non : afficher « adresse
    // inconnue » révélerait qui possède un compte.
    messageAuth('forgot-ok', 'Si un compte existe pour ' + email + ', un lien vient d\'être envoyé. Pensez à vérifier les indésirables.');
  } catch (e) {
    messageAuth('forgot-error', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Envoyer le lien';
  }
}

/** Enregistrement du nouveau mot de passe, au retour du lien email. */
async function doReset() {
  const p1  = document.getElementById('reset-pass').value;
  const p2  = document.getElementById('reset-pass2').value;
  const btn = document.getElementById('btn-reset');
  messageAuth('reset-error',''); messageAuth('reset-ok','');

  if (!p1)            { messageAuth('reset-error','Saisissez un mot de passe.'); return; }
  if (p1 !== p2)      { messageAuth('reset-error','Les deux mots de passe ne correspondent pas.'); return; }
  if (p1.length < 12) { messageAuth('reset-error','Le mot de passe doit faire au moins 12 caractères.'); return; }

  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    const profil = await Auth.definirMotDePasse(p1);
    ouvrirSession(profil);
    showToast('✓ Mot de passe mis à jour.');
  } catch (e) {
    messageAuth('reset-error', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Enregistrer';
  }
}

/**
 * Reprise de session au chargement de la page.
 * Le JWT survit au rafraîchissement : inutile de ressaisir ses identifiants
 * à chaque F5. Un jeton expiré est renouvelé silencieusement ; s'il est
 * invalide, on reste sur l'écran de connexion.
 */
async function amorcerSession() {
  // Retour d'un lien de réinitialisation : on passe directement au choix du
  // nouveau mot de passe, sans tenter de restaurer l'ancienne session.
  if (Auth.detecterRecuperation()) {
    afficherPanneau('panel-reset');
    return;
  }
  try {
    const profil = await Auth.restaurer();
    if (profil) ouvrirSession(profil);
  } catch (e) {
    console.warn('Reprise de session impossible :', e.message);
  }
}

document.addEventListener('DOMContentLoaded', function(){
  var v = document.getElementById('app-version');
  if (v) v.textContent = 'version ' + APP_VERSION;
  console.log('KAYOR — version', APP_VERSION);
  amorcerSession();
});

function enregistrerConnexion(user, action) {
  const now = new Date();
  const heure = now.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  const date  = now.toISOString().split('T')[0];
  STATE.counters.cn = (STATE.counters.cn || 8) + 1;
  const cnId = 'CN-' + String(STATE.counters.cn).padStart(4,'0');
  const cnObj = { id:cnId, userId:user.id, nom:user.nom, role:user.role, date, heure, action, ip:'—' };
  STATE.connexions.unshift(cnObj);
  if (STATE.connexions.length > 200) STATE.connexions = STATE.connexions.slice(0, 200);
  save();
  // Sync Supabase
  saveConnexion({ id:cnId, userId:user.id, nom:user.nom, role:user.role, date, heure, action });
}

function buildNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    const section = btn.dataset.section;
    const canAccess = peutAcceder(section) || section==='dashboard';
    btn.style.display = canAccess ? '' : 'none';
  });
  // Sorties : visible pour tous mais bouton ajout admin seulement
  document.getElementById('btn-add-sortie').style.display = isAdmin() ? '' : 'none';
  document.getElementById('sorties-perm-warning').style.display = isAdmin() ? 'none' : 'flex';
  // Le bouton flottant recopie ces boutons : il doit être recalculé après
  // tout changement de rôle, sinon il garde celui du rôle précédent.
  majFab();
}

// ============================================
// NAVIGATION
// ============================================
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const section = btn.dataset.section;
    if (!peutAcceder(section) && section!=='dashboard') { showToast('⛔ Accès non autorisé pour votre rôle.'); return; }
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(section).classList.add('active');
    renderSection(section);
  });
});
function renderSection(id) {
  if(id==='dashboard')     renderDashboard();
  if(id==='journal')       renderJournal();
  if(id==='stocks')        renderStocks();
  if(id==='comptes_users')  renderGestionComptes();
  if(id==='profil_boutique')renderProfilBoutique();
  if(id==='rapport_jour')    renderRapportJournalier();
  if(id==='ma_journee')      renderMaJournee();
  if(id==='achats_clients')renderAchatsClients();
  if(id==='sorties')       renderSorties();
  if(id==='decaissements') renderDecaissements();
  if(id==='clients')       renderClients();
  if(id==='compte_client') renderComptesClients();
  if(id==='bijou_arr')     renderBijouxArr();
  if(id==='historique')    renderHistorique();
  majFab();
}

// ============================================
// BOUTON FLOTTANT (mobile)
// ============================================
// Sur un téléphone, le « + Nouvelle vente » de l'en-tête sort de l'écran au
// premier défilement : une vendeuse qui enchaîne les ventes devait remonter
// la liste à chaque fois.
//
// Ce bouton ne connaît aucune action. Il recopie le bouton de création de la
// section ouverte et lui relaie le clic. Donc aucun libellé à tenir à jour,
// et surtout : les règles de rôle restent à un seul endroit — `btn-add-sortie`
// masqué pour un vendeur masque aussi le flottant, sans une ligne de plus ici.

var FAB_CIBLE = null;

/** Le bouton de création de la section ouverte, s'il y en a un de visible. */
function boutonCreationSection() {
  var section = document.querySelector('.section.active');
  if (!section) return null;
  var boutons = section.querySelectorAll('.page-header .btn-primary');
  for (var i = 0; i < boutons.length; i++) {
    var b = boutons[i];
    // Seules les actions de création. « 🖨 Imprimer » ou « ✓ Enregistrer »
    // n'ont rien à faire sous le pouce.
    if (b.textContent.trim().charAt(0) !== '+') continue;
    // offsetParent nul = masqué, donc rôle insuffisant (cf. buildNav()).
    if (!b.offsetParent) continue;
    return b;
  }
  return null;
}

function majFab() {
  var fab = document.getElementById('fab');
  if (!fab) return;
  var cible = boutonCreationSection();
  var modaleOuverte = !!document.querySelector('.modal-backdrop.show');
  if (!cible || modaleOuverte) {
    FAB_CIBLE = null;
    fab.classList.remove('visible');
    document.body.classList.remove('fab-actif');
    return;
  }
  FAB_CIBLE = cible;
  fab.textContent = cible.textContent.trim();
  fab.setAttribute('aria-label', fab.textContent);
  fab.classList.add('visible');
  document.body.classList.add('fab-actif');
}

document.getElementById('fab')?.addEventListener('click', function () {
  if (FAB_CIBLE) FAB_CIBLE.click();
});

// Toutes les fermetures de modale ne passent pas par closeModal() : le clic
// sur le fond et la touche Échap retirent la classe directement. On observe
// donc la classe, au lieu de recenser à la main les endroits qui la changent
// — c'est l'erreur des « trois fonctions d'écriture » transposée à l'écran.
(function surveillerModales() {
  var obs = new MutationObserver(function () { majFab(); });
  document.querySelectorAll('.modal-backdrop').forEach(function (m) {
    obs.observe(m, { attributes: true, attributeFilter: ['class'] });
  });
})();

// ============================================
// MODALS
// ============================================
function openModal(id) {
  if(id==='modal-nouvelle-vente')   prepNouvelleVente();
  if(id==='modal-add-produit') { peuplerTypeBijou('p-type-bijou'); var orf2=document.getElementById('p-or-fields');if(orf2)orf2.style.display='none'; var sf2=document.getElementById('p-poids-simple');if(sf2)sf2.style.display='none'; STATE.counters.stk++; var refEl=document.getElementById('p-ref');if(refEl)refEl.value='ART-'+String(STATE.counters.stk).padStart(4,'0'); }
  if(id==='modal-add-sortie')       prepSortie();
  if(id==='modal-add-achat-client') { peuplerClientSelect('ac-client'); peuplerTypeBijou('ac-type-bijou'); document.getElementById('ac-date').value=today(); var orf=document.getElementById('ac-or-fields');if(orf)orf.style.display='none'; var sf=document.getElementById('ac-poids-simple');if(sf)sf.style.display='none'; }
  if(id==='modal-add-decaiss')      { prepDecaiss(); }
  if(id==='modal-add-compte-client'){ peuplerClientSelect('cc-client'); document.getElementById('cc-date').value=today(); }
  // (modale 'modal-add-bijou-arr' supprimée : les arrhes sont pilotées par le journal des ventes)
  document.getElementById(id).classList.add('show');
}
function closeModal(id) { document.getElementById(id)?.classList.remove('show'); }
document.querySelectorAll('.modal-backdrop').forEach(m=>{m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('show');});});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-backdrop.show').forEach(m=>m.classList.remove('show'));});

// ============================================
// TOAST
// ============================================
function showToast(msg,dur=3000){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),dur);}

// ============================================
// HELPERS
// ============================================
function fmt(n){return Number(n||0).toLocaleString('fr-FR')+' F';}
function fmtG(n){return n?(+n).toFixed(2).replace(/\.00$/,'')+'g':'—';}
function ini(nom){return nom.trim().split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase();}
function today(){return new Date().toISOString().split('T')[0];}
function isToday(d){return d===today();}
function isMois(d){const n=new Date(),dt=new Date(d+'T00:00:00');return dt.getFullYear()===n.getFullYear()&&dt.getMonth()===n.getMonth();}
function fmtDate(d){if(!d)return'—';return new Date(d+'T00:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});}
function getCarat(code){return CARATS_LIST.find(c=>c.code===code);}
function statutStock(i){
  var enRuptPoids=(i.poidsTotalG||0)<=0;
  var enRuptQty=i.qty===0;
  if(enRuptPoids||enRuptQty) return{label:'Rupture',cls:'stock-out'};
  var seuilOk=((i.poidsTotalG||0)<=(i.seuil||50))||(i.qty<=(i.seuil||5));
  if(seuilOk) return{label:'Stock bas',cls:'stock-low'};
  return{label:'En stock',cls:'stock-ok'};
}
function tier(t){if(t>=1000000)return{label:'Platine',cls:'tier-platine'};if(t>=500000)return{label:'Or',cls:'tier-gold'};return{label:'Argent',cls:'tier-silver'};}

/**
 * Affiche le restant dû sous le couple montant / acompte.
 *
 * `videVautSolde` : sur la NOUVELLE vente, un acompte laissé vide signifie
 * « soldé » — c'est ce que fait `enregistrerVente()`, et ce que promet le
 * libellé du champ (« Laisser vide = soldé »). L'affichage, lui, lisait le
 * vide comme zéro et annonçait « Restant dû : 50 000 F » sur une vente qui
 * allait être enregistrée soldée. La vendeuse voyait l'inverse de ce qui
 * partait en base.
 *
 * La fenêtre de MODIFICATION garde l'autre règle : vide y vaut bien zéro,
 * parce qu'on y corrige un acompte existant. D'où le drapeau plutôt qu'un
 * changement global.
 */
function calcRestant(mId,aId,dId,videVautSolde){
  const m=parseFloat(document.getElementById(mId)?.value)||0;
  const brut=(document.getElementById(aId)?.value||'').trim();
  const a=(videVautSolde && brut==='') ? m : (parseFloat(brut)||0);
  const r=Math.max(0,m-a);
  const el=document.getElementById(dId);
  if(!el)return;
  el.value=m>0?(r===0?'Soldé ✓':fmt(r)):'—';
  el.style.color=r===0&&m>0?'var(--success-text)':r>0?'var(--warning-text)':'';
}

// ============================================
// PEUPLEMENT SELECTS
// ============================================
function peuplerSelect(id, selected='') {
  const sel = document.getElementById(id); if(!sel) return;
  // Deux groupes simples : Local / Importé
  const groupes = [
    { label:'Or local',    items: CARATS_LIST.filter(c=>c.origine==='local')   },
    { label:'Or importé',  items: CARATS_LIST.filter(c=>c.origine==='importe') },
  ];
  sel.innerHTML = '<option value="">— Choisir —</option>';
  groupes.forEach(g => {
    if (!g.items.length) return;
    const og = document.createElement('optgroup');
    og.label = g.label;
    g.items.forEach(c => {
      const o = document.createElement('option');
      o.value = c.code;
      o.textContent = c.label;
      if (c.code === selected) o.selected = true;
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
}

function peuplerTypeBijou(id, selected='') {
  const sel = document.getElementById(id); if(!sel) return;
  sel.innerHTML = '<option value="">— Type de bijou —</option>';
  TYPES_BIJOUX.forEach(t => {
    const o = document.createElement('option');
    o.value = t.code; o.textContent = t.label;
    if (t.code === selected) o.selected = true;
    sel.appendChild(o);
  });
}


function peuplerClientSelect(id, selected='') {
  // Compatibilité : si c'est un picker, initialiser proprement
  initClientPicker(id, selected);
}

// ============================================
// CLIENT PICKER — recherche nom + téléphone
// ============================================
const _pickerTimers = {};

function initClientPicker(fieldId, selected='') {
  const searchEl = document.getElementById(fieldId+'-search');
  const hiddenEl = document.getElementById(fieldId);
  if (!searchEl || !hiddenEl) {
    // Fallback : select classique
    const sel = document.getElementById(fieldId); if(!sel)return;
    sel.innerHTML='<option value="">— Sélectionner —</option>';
    STATE.clients.forEach(c=>{const o=document.createElement('option');o.value=c.nom;o.textContent=c.nom;if(c.nom===selected)o.selected=true;sel.appendChild(o);});
    return;
  }
  hiddenEl.value = selected || '';
  if (selected) {
    const cl = STATE.clients.find(c=>c.nom===selected);
    searchEl.value = cl ? cl.nom + (cl.tel ? ' — ' + cl.tel : '') : selected;
    document.getElementById('picker-'+fieldId)?.classList.add('client-picker-selected');
  } else {
    searchEl.value = '';
    document.getElementById('picker-'+fieldId)?.classList.remove('client-picker-selected');
  }
  document.getElementById('picker-drop-'+fieldId).style.display = 'none';
}

function filtrerClientPicker(fieldId) {
  const q = (document.getElementById(fieldId+'-search')?.value||'').toLowerCase();
  // Si le champ est vidé, effacer la sélection
  if (!q) {
    document.getElementById(fieldId).value = '';
    document.getElementById('picker-'+fieldId)?.classList.remove('client-picker-selected');
  }
  renderClientPickerDrop(fieldId, q);
}

function ouvrirClientPicker(fieldId) {
  const q = (document.getElementById(fieldId+'-search')?.value||'').toLowerCase();
  renderClientPickerDrop(fieldId, q);
}

function fermerClientPicker(fieldId, delai=200) {
  _pickerTimers[fieldId] = setTimeout(() => {
    const drop = document.getElementById('picker-drop-'+fieldId);
    if (drop) drop.style.display = 'none';
  }, delai);
}

function renderClientPickerDrop(fieldId, q='') {
  const drop = document.getElementById('picker-drop-'+fieldId);
  if (!drop) return;
  const filtres = STATE.clients.filter(c =>
    !q || c.nom.toLowerCase().includes(q) || normalizeStr(c.tel||'').includes(normalizeStr(q))
  ).slice(0, 30);

  if (filtres.length === 0) {
    drop.innerHTML = '<div class="client-picker-empty">Aucun client trouvé</div>';
  } else {
    drop.innerHTML = filtres.map(c => `
      <div class="client-picker-item" onmousedown="selectionnerClientPicker('${fieldId}','${c.nom.replace(/'/g,"\'")}')">
        <div class="client-picker-avatar">${ini(c.nom)}</div>
        <div>
          <div class="client-picker-nom">${c.nom}</div>
          <div class="client-picker-tel">${c.tel||''}</div>
        </div>
      </div>`).join('');
  }
  drop.style.display = 'block';
}

function selectionnerClientPicker(fieldId, nom) {
  // Annuler le timer de fermeture
  clearTimeout(_pickerTimers[fieldId]);
  const cl = STATE.clients.find(c=>c.nom===nom);
  const searchEl = document.getElementById(fieldId+'-search');
  const hiddenEl = document.getElementById(fieldId);
  if (!searchEl || !hiddenEl) return;
  hiddenEl.value = nom;
  searchEl.value  = cl ? cl.nom + (cl.tel ? ' — ' + cl.tel : '') : nom;
  document.getElementById('picker-'+fieldId)?.classList.add('client-picker-selected');
  document.getElementById('picker-drop-'+fieldId).style.display = 'none';
}

function valeurClientPicker(fieldId) {
  // Retourne la valeur sélectionnée (depuis hidden input)
  return document.getElementById(fieldId)?.value || '';
}

function peuplerArticleSelect(id) {
  const sel=document.getElementById(id); if(!sel)return;
  sel.innerHTML='<option value="">— Choisir un article en stock —</option>';
  STATE.stock.filter(i=>i.qty>0).forEach(i=>{
    const o=document.createElement('option'); o.value=i.ref;
    o.textContent=`${i.ref} — ${i.nom} (${i.qty} dispo) — ${fmt(i.prix)}`;
    o.dataset.prix=i.prix;
    sel.appendChild(o);
  });
}

function afficherInfoCarat(selectId, badgeId) {
  const code=document.getElementById(selectId)?.value;
  const badge=document.getElementById(badgeId); if(!badge)return;
  if(!code){badge.style.display='none';return;}
  const c=getCarat(code); if(!c){badge.style.display='none';return;}
  badge.style.display='flex';
  badge.innerHTML=`<span class="carat-dot" style="background:${c.couleur}"></span><span class="carat-code">${c.label}</span><span class="carat-purete">${c.purete}</span><span class="carat-desc">${c.origine==='local'?'Or fabriqué localement':'Or importé'}</span>`;
}

function peuplerFiltreCarat(){
  const sel=document.getElementById('filtre-carat'); if(!sel)return;
  const currentVal=sel.value; // sauvegarder la valeur sélectionnée
  const used=[...new Set(STATE.ventes.map(v=>v.carat).filter(Boolean))];
  sel.innerHTML='<option value="">Tous les carats</option>';
  CARATS_LIST.filter(c=>used.includes(c.code)).forEach(c=>{
    const o=document.createElement('option');
    o.value=c.code; o.textContent=c.label;
    if(c.code===currentVal) o.selected=true; // restaurer la sélection
    sel.appendChild(o);
  });
}

// ============================================
// CUMULS VENTES
// ============================================
function calculerCumuls(){
  const sorted=[...STATE.ventes].sort((a,b)=>a.date.localeCompare(b.date));
  let cumul=0; const map={};
  sorted.forEach(v=>{cumul+=(v.montant||0);map[v.id]=cumul;});
  STATE.ventes.forEach(v=>v._cumul=map[v.id]||0);
}

// ============================================
// DASHBOARD
// ============================================
function renderDashboard(){
  calculerCumuls();
  const now=new Date();
  document.getElementById('dashboard-date').textContent=now.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  // Chiffre d'affaires : une vente annulée n'en fait plus partie.
  // L'encaissé, lui, la conserve — l'argent est bien entré en caisse, et c'est
  // le décaissement de remboursement qui le fait ressortir à sa date.
  const ventesMois=STATE.ventes.filter(v=>isMois(v.date)&&!v.annulee);
  const totalMois =ventesMois.reduce((s,v)=>s+(v.montant||0),0);
  // Argent réellement reçu au comptoir. On retire la part réglée avec le solde
  // d'un compte épargne : cet argent est déjà dans le tiroir depuis le dépôt,
  // le compter ici le ferait apparaître une seconde fois.
  const totalEncaisse=STATE.ventes.reduce((s,v)=>s+encaisseReel(v),0);
  const totalDecaiss =STATE.decaissements.reduce((s,d)=>s+(d.montant||0),0);
  const totalDepots  =totalDepotsEpargne(false);
  const soldeNet     =soldeCaisse(false);   // ventes encaissées + dépôts − décaissements
  const totalRestants=STATE.ventes.filter(v=>!v.annulee).reduce((s,v)=>s+(v.restant||0),0);
  const nbRestants   =STATE.ventes.filter(v=>!v.annulee&&(v.restant||0)>0).length;
  const decMois      =STATE.decaissements.filter(d=>isMois(d.date));
  const totalDecMois =decMois.reduce((s,d)=>s+(d.montant||0),0);
  const arrhesEnCours=STATE.ventes.filter(v=>!v.annulee&&(v.restant||0)>0);
  const totalArrhes  =arrhesEnCours.reduce((s,v)=>s+(v.restant||0),0);

  document.getElementById('metric-ca').textContent=fmt(totalMois);
  document.getElementById('metric-ca-nb').textContent=ventesMois.length+' vente'+(ventesMois.length>1?'s':'');
  document.getElementById('metric-restants').textContent=fmt(totalRestants);
  document.getElementById('metric-nb-restants').textContent=nbRestants+' client'+(nbRestants>1?'s':'');
  // Les trois composantes du solde, chacune sur sa propre tuile. Elles
  // tenaient dans le sous-titre du solde, sous forme d'opération à refaire.
  const nbVentesEncaissees = STATE.ventes.filter(v=>encaisseReel(v)>0).length;
  const nbDepots = (STATE.comptesClients||[]).reduce((s,cc)=>
    s + (cc.mouvements||[]).filter(m=>m.type==='depot').length, 0);
  document.getElementById('metric-encaisse').textContent   = fmt(totalEncaisse);
  document.getElementById('metric-nb-encaisse').textContent =
    nbVentesEncaissees+' vente'+(nbVentesEncaissees>1?'s':'');
  document.getElementById('metric-depots').textContent     = fmt(totalDepots);
  document.getElementById('metric-nb-depots').textContent  =
    nbDepots+' dépôt'+(nbDepots>1?'s':'');
  document.getElementById('metric-sorti').textContent      = '− '+fmt(totalDecaiss);
  document.getElementById('metric-nb-sorti').textContent   =
    STATE.decaissements.length+' sortie'+(STATE.decaissements.length>1?'s':'');

  document.getElementById('metric-decaiss').textContent=fmt(soldeNet);
  document.getElementById('metric-nb-decaiss').textContent='ce qui doit être en caisse';
  document.getElementById('metric-arrhes').textContent=fmt(totalArrhes);
  document.getElementById('metric-nb-arrhes').textContent=arrhesEnCours.length+' bijou'+(arrhesEnCours.length>1?'x':'');

  // Sparkline 7j
  const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return d.toISOString().split('T')[0];});
  const dayTotals=days.map(d=>STATE.ventes.filter(v=>v.date===d).reduce((s,v)=>s+(v.montant||0),0));
  const maxV=Math.max(...dayTotals,1);
  document.getElementById('sparkline').innerHTML=dayTotals.map((v,i)=>`<div class="spark-bar ${i===6?'highlight':''}" style="height:${Math.max(6,Math.round(v/maxV*100))}%" title="${fmtDate(days[i])}: ${fmt(v)}"></div>`).join('');
  document.getElementById('spark-labels').innerHTML=days.map(d=>`<span>${new Date(d+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'short'}).slice(0,3)}</span>`).join('');

  // Bar carats
  const cm={};STATE.ventes.forEach(v=>{if(!v.carat)return;cm[v.carat]=(cm[v.carat]||0)+(v.montant||0);});
  const cs=Object.entries(cm).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const cmax=Math.max(...cs.map(c=>c[1]),1);
  document.getElementById('bar-carats').innerHTML=cs.map(([code,val])=>{const c=getCarat(code);return`<div class="bar-row"><span class="bar-label" style="display:flex;align-items:center;gap:5px"><span style="width:9px;height:9px;border-radius:50%;background:${c?c.couleur:'#ccc'};display:inline-block;flex-shrink:0"></span>${code.toUpperCase()}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(val/cmax*100)}%"></div></div><span class="bar-val">${fmt(val)}</span></div>`;}).join('');

  // Comptes clients
  const ccActive=STATE.comptesClients.filter(c=>c.actif);
  document.getElementById('dash-comptes').innerHTML=ccActive.length===0?'<p style="color:var(--text-tertiary);font-size:13px">Aucun compte actif</p>':
  ccActive.map(cc=>`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span style="font-weight:500">${cc.client}</span><span style="font-weight:600;color:var(--success-text)">${fmt(cc.solde)}</span></div><div style="font-size:11px;color:var(--text-tertiary)">Ouvert le ${fmtDate(cc.dateOuverture)} · ${cc.mouvements.length} dépôt${cc.mouvements.length>1?'s':''}</div></div>`).join('');

  // Alertes
  const alertes=[];
  STATE.stock.filter(i=>i.qty===0).forEach(i=>alertes.push({type:'danger',msg:`Rupture stock : ${i.nom}`}));
  STATE.stock.filter(i=>i.qty>0&&i.qty<=i.seuil).forEach(i=>alertes.push({type:'warn',msg:`Stock bas : ${i.nom} (${i.qty} restant${i.qty>1?'s':''})`}));
  // (alertes arrhes supprimées — géré via ventes avec restant)
  STATE.ventes.filter(v=>!v.annulee&&(v.restant||0)>0).forEach(v=>alertes.push({type:'warn',msg:`Restant dû : ${v.client} — ${fmt(v.restant)}`}));
  document.getElementById('dash-alertes').innerHTML=alertes.slice(0,6).map(a=>`<div style="display:flex;align-items:center;gap:8px;padding:9px 16px;border-bottom:0.5px solid var(--border-light);font-size:12px"><span class="stock-badge ${a.type==='danger'?'stock-out':'stock-low'}" style="flex-shrink:0">${a.type==='danger'?'!':'⚠'}</span><span>${a.msg}</span></div>`).join('')||'<div style="padding:14px 16px;font-size:13px;color:var(--text-tertiary)">Aucune alerte en cours</div>';
}

// ============================================
// JOURNAL DES VENTES
// ============================================
function renderJournal(){
  calculerCumuls(); peuplerFiltreCarat();
  const q=(document.getElementById('journal-search')?.value||'').toLowerCase();
  const fc=document.getElementById('filtre-carat')?.value||'';
  const ft=document.getElementById('filtre-type')?.value||'';
  const fr=document.getElementById('filtre-restant')?.value||'';
  const ventes=[...STATE.ventes].sort((a,b)=>b.date.localeCompare(a.date)).filter(v=>{
    const clV=STATE.clients.find(c=>c.nom===v.client);
    const qn=normalizeStr(q);
    if(q&&!v.client.toLowerCase().includes(q)&&!v.description.toLowerCase().includes(q)&&!normalizeStr(clV?.tel||'').includes(qn))return false;
    if(fc&&v.carat!==fc)return false;
    if(ft==='local'&&!(parseFloat(v.local)||0))return false;
    if(ft==='importe'&&!(parseFloat(v.importe)||0))return false;
    if(fr==='annulee') return !!v.annulee;
    if(fr==='solde'&&((v.restant||0)>0||v.annulee))return false;
    if(fr==='en-cours'&&(!(v.restant||0)||v.annulee))return false;
    return true;
  });

  // Le solde vient de soldeCaisse(), la même fonction que le tableau de bord
  // et l'onglet Décaissements. Auparavant le Journal refaisait son propre
  // calcul (Σ acompte − Σ décaissements) : il ignorait les dépôts d'épargne
  // et recomptait les règlements par compte, donc les trois écrans
  // affichaient trois chiffres différents.
  const tCumul    = STATE.ventes.filter(v=>!v.annulee).reduce((s,v)=>s+(v.montant||0),0);
  const tSoldeNet = soldeCaisse(false);
  const tRest     = STATE.ventes.filter(v=>!v.annulee).reduce((s,v)=>s+(v.restant||0),0);
  const tLoc      = STATE.ventes.reduce((s,v)=>s+(parseFloat(v.local)||0),0);
  const tImp      = STATE.ventes.reduce((s,v)=>s+(parseFloat(v.importe)||0),0);

  // Les annulées sont comptées à part : « Total ventes » les exclut, mais
  // elles restent dans la liste. Sans ce rappel, additionner les montants
  // affichés ne retombe pas sur le cumul, et le chiffre paraît faux.
  const nbAnnulees = STATE.ventes.filter(v=>v.annulee).length;
  document.getElementById('journal-count-label').textContent =
    `${STATE.ventes.length} ventes · ${ventes.length} retenue${ventes.length>1?'s':''} par le filtre`
    + (nbAnnulees ? ` · ${nbAnnulees} annulée${nbAnnulees>1?'s':''} (hors total)` : '');
  document.getElementById('montant-cumul').textContent   = fmt(tCumul);
  document.getElementById('montant-encaisse').textContent= fmt(tSoldeNet);

  // Les trois composantes du solde, chacune comme total à part entière.
  // Elles tenaient dans une parenthèse « 135 000 encaissé + 85 000 dépôts
  // − 80 000 décaissé » : il fallait refaire l'addition pour s'en servir.
  // Ce sont les mêmes fonctions que le tableau de bord et l'onglet
  // Décaissements — trois écrans, un seul calcul.
  document.getElementById('total-encaisse').textContent =
    fmt(STATE.ventes.reduce((s,v)=>s+encaisseReel(v),0));
  document.getElementById('total-depots').textContent   = fmt(totalDepotsEpargne(false));
  document.getElementById('total-decaisse').textContent =
    '− ' + fmt(STATE.decaissements.reduce((s,d)=>s+(d.montant||0),0));

  document.getElementById('total-restants').textContent  = fmt(tRest);
  document.getElementById('poids-local-total').textContent  = tLoc.toFixed(2)+'g';
  document.getElementById('poids-importe-total').textContent= tImp.toFixed(2)+'g';

  const admin = isAdmin();

  // ---- Pagination ----------------------------------------------------
  // On change de page quand on tourne la page, pas quand on filtre : si le
  // filtre change, on revient à la première, sinon on resterait sur une page
  // 5 devenue vide. La signature détecte ce changement sans avoir à toucher
  // chaque appelant de renderJournal().
  const signature = [q, fc, ft, fr].join('|');
  if (signature !== JOURNAL_SIGNATURE) { JOURNAL_SIGNATURE = signature; JOURNAL_PAGE = 1; }

  const total   = ventes.length;
  const nbPages = Math.max(1, Math.ceil(total / JOURNAL_PAR_PAGE));
  if (JOURNAL_PAGE > nbPages) JOURNAL_PAGE = nbPages;
  const debut   = (JOURNAL_PAGE - 1) * JOURNAL_PAR_PAGE;
  const page    = ventes.slice(debut, debut + JOURNAL_PAR_PAGE);

  rendreJournalPagination(total, nbPages, debut, page.length);

  document.getElementById('journal-body').innerHTML=page.map(v=>{
    const c=getCarat(v.carat);
    const dot=c?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.couleur};margin-right:4px;vertical-align:middle"></span>`:'';
    const rb = v.annulee
      ? `<span class="stock-badge" style="background:var(--danger-bg);color:var(--danger-text)" title="${esc(v.annuleeMotif||'Vente annulée')}">Annulée</span>`
      : (v.restant||0)>0
        ? `<span class="stock-badge stock-low">${fmt(v.restant)}</span>`
        : `<span class="stock-badge stock-ok">Soldé</span>`;

    const nonFinalisee = (v.restant||0) > 0;

    // Modifier une vente : administrateurs seulement. Le serveur applique la
    // même règle — afficher le bouton aux autres rôles leur ouvrirait un
    // formulaire qui échouerait à l'enregistrement.
    const btnModif = admin
      ? `<button class="btn small" onclick="ouvrirEditVente('${v.id}')" title="Modifier">✎</button>`
      : `<span class="perm-lock" title="Modification réservée à l'administrateur">🔒</span>`;

    // Supprimer : admin uniquement
    const btnSuppr = admin
      ? `<button class="btn small btn-danger" onclick="supprimerVente('${v.id}')" title="Supprimer">✕</button>`
      : '';

    // Acompte : accessible si restant > 0
    const btnAcompte = nonFinalisee
      ? `<button class="btn small" style="background:var(--warning-bg);color:var(--warning-text);border-color:transparent" onclick="ouvrirAjoutAcompte('${v.id}')" title="Ajouter un acompte">+&nbsp;Acompte</button>`
      : '';

    return`<tr${v.annulee?' style="opacity:.6"':''}>
      <td style="white-space:nowrap;font-size:12px;color:var(--text-secondary)">${fmtDate(v.date)}</td>
      <td><div style="display:flex;align-items:center;gap:7px">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${ini(v.client)}</div>
        <span>${v.client}</span>
      </div></td>
      <td style="font-size:12px;color:var(--text-secondary)">${v.description}${v.typeBijou?` <span class="type-bijou-pill">${TYPES_BIJOUX.find(t=>t.code===v.typeBijou)?.label||v.typeBijou}</span>`:''}</td>
      <td style="text-align:center">${(parseFloat(v.local)||0)>0?`<span class="badge-local">${fmtG(v.local)}</span>`:'<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td style="text-align:center">${(parseFloat(v.importe)||0)>0?`<span class="badge-importe">${fmtG(v.importe)}</span>`:'<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td><span class="carat-pill">${dot}${(v.carat||'—').toUpperCase()}</span></td>
      <td style="font-weight:500;white-space:nowrap${v.annulee?';text-decoration:line-through;color:var(--text-tertiary)':''}">${fmt(v.montant)}</td>
      
      <td><span class="paiement-pill paiement-${v.paiement||'especes'}">${PAIEMENT_LABELS[v.paiement||'especes']||''}</span></td>
      <td>${rb}</td>
      <td><div style="display:flex;gap:4px;align-items:center">${btnModif}${btnSuppr}</div></td>
      <td><button class="btn small" onclick="afficherFacture('${v.id}')" title="Imprimer la facture" style="font-size:14px">🖨</button></td>
    </tr>`;
  }).join('');

  const btnF = document.getElementById('btn-filtres-avances');
  if (btnF) {
    const actifs = (fc ? 1 : 0) + (ft ? 1 : 0);
    btnF.textContent = actifs ? '⚙ Filtres (' + actifs + ')' : '⚙ Filtres';
    btnF.style.borderColor = actifs ? 'var(--warning-text)' : '';
    btnF.style.color       = actifs ? 'var(--warning-text)' : '';
  }

  // La même liste, en cartes — c'est elle qu'on voit sur téléphone.
  // Le tableau de onze colonnes y imposait deux écrans et demi de
  // défilement horizontal ; une carte tient dans la largeur.
  rendreJournalCartes(page, admin);
}
['journal-search','filtre-type','filtre-restant'].forEach(id=>{document.getElementById(id)?.addEventListener('input',renderJournal);});
document.getElementById('filtre-carat')?.addEventListener('change',renderJournal);
document.getElementById('filtre-carat')?.addEventListener('input',renderJournal);

function prepNouvelleVente(){
  peuplerClientSelect('v-client');
  peuplerStockSelect('v-stock-ref');
  var vDate=document.getElementById('v-date'); if(vDate) vDate.value=today();
  var vDesc=document.getElementById('v-description'); if(vDesc) vDesc.value='';
  var vMont=document.getElementById('v-montant'); if(vMont) vMont.value='';
  var vAc=document.getElementById('v-acompte'); if(vAc) vAc.value='';
  var vPoids=document.getElementById('v-poids-vente'); if(vPoids) vPoids.value='';
  var vNb=document.getElementById('v-nb-articles'); if(vNb) vNb.value='';
  var vRest=document.getElementById('v-restant-disp'); if(vRest) vRest.value='—';
  var vp=document.getElementById('v-paiement'); if(vp) vp.value='especes';
  var cb=document.getElementById('v-compte-bloc'); if(cb) cb.style.display='none';
  var si=document.getElementById('v-stock-info'); if(si) si.style.display='none';
  ['v-type-bijou','v-carat','v-provenance'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  ['v-local','v-importe'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='0';
  });
}

async function enregistrerVente(){
  const date    = document.getElementById('v-date').value;
  const client  = document.getElementById('v-client').value;
  const desc    = document.getElementById('v-description').value.trim();
  const paiement= (document.getElementById('v-paiement')&&document.getElementById('v-paiement').value)||'especes';
  const montant = parseInt(document.getElementById('v-montant').value)||0;
  let   acompte = parseInt(document.getElementById('v-acompte').value)||0;

  // Lecture depuis le sélecteur d'article stock
  const stockRef  = document.getElementById('v-stock-ref')&&document.getElementById('v-stock-ref').value||'';
  const stockItem = getStockItem(stockRef);
  const poids     = parseFloat(document.getElementById('v-poids-vente')&&document.getElementById('v-poids-vente').value)||0;
  const nbArticlesV = parseInt(document.getElementById('v-nb-articles')&&document.getElementById('v-nb-articles').value)||0;

  // Infos depuis l'article stock
  const typeBijou = stockItem ? (stockItem.typeBijou||'') : '';
  const carat     = stockItem ? (stockItem.carat||'') : '';
  const local     = stockItem && stockItem.provenance==='local'  ? poids : 0;
  const importe   = stockItem && stockItem.provenance==='importe'? poids : 0;

  // Validations
  if(!date||!client||!stockRef||montant<=0){showToast('Date, client, article en stock et montant sont obligatoires.');return;}
  if(poids<=0 && nbArticlesV<=0){showToast('Saisissez le poids vendu et/ou le nombre d\'articles.');return;}
  if(acompte>montant){showToast('Acompte ne peut pas depasser le montant.');return;}
  if(stockItem){
    if(poids>0 && poids>(stockItem.poidsTotalG||0)){showToast('Poids insuffisant (dispo: '+(stockItem.poidsTotalG||0).toFixed(2)+'g)');return;}
    if(nbArticlesV>0 && nbArticlesV>(stockItem.qty||0)){showToast('Nombre d\'articles insuffisant (dispo: '+(stockItem.qty||0)+')');return;}
  }

  let compteClientId=null;
  let payeParCompte=0;   // part réglée avec le solde épargne, hors caisse
  if(paiement==='compte'){
    const cc=STATE.comptesClients.find(c=>c.client===client&&c.actif!==false);
    if(!cc){showToast('Aucun compte epargne actif pour ce client.');return;}
    if(montant>cc.solde){
      // Solde insuffisant ou vide → ouvrir modal complément
      ouvrirComplementCC(cc, montant, date, desc, carat, typeBijou);
      return;
    }
    // Vente + retrait en une seule transaction serveur : les enchaîner ici
    // laissait passer le retrait quand la vente échouait.
    try {
      // Numéros attribués par le serveur : le compteur local peut être en
      // retard et refabriquer un identifiant déjà pris.
      const num = await prochainsIdsVente();
      const idCpt = num.id, facCpt = num.numFacture;
      const res = await venteSurCompteEpargne({
        id: idCpt, compteId: cc.id, date: date, description: desc,
        montant: montant, montantCompte: montant,
        paiement: 'compte', carat: carat, typeBijou: typeBijou, numFacture: facCpt
      });
      if(!res || res.ok===false){ showToast('⛔ '+((res&&res.erreur)||'Vente refusée.')); return; }
      if(stockRef && (poids>0 || nbArticlesV>0)) await deduireStock(stockRef, poids, nbArticlesV);
      await chargerDonnees();
      closeModal('modal-nouvelle-vente');
      renderJournal(); renderStocks();
      showToast('Vente '+idCpt+' — '+fmt(montant)+' déduit du compte de '+client);
    } catch(e){ showToast('⚠ '+e.message); }
    return;
  } else {
    // Si acompte non rempli (0 ou vide) → vente soldée directement
    const acompteEl = document.getElementById('v-acompte');
    const acompteRaw = acompteEl && acompteEl.value.trim();
    if(!acompteRaw || acompteRaw === '0') acompte = montant;
  }

  const num = await prochainsIdsVente();
  const id = num.id;
  var numFacture = num.numFacture;
  // Déduire poids ET nombre d'articles du stock (article exact via stockRef)
  const poidsVente = poids||0;
  if(stockRef && (poidsVente>0 || nbArticlesV>0)){
    var ok = await deduireStock(stockRef, poidsVente, nbArticlesV);
    if(!ok) return;
  }
  const venteObj={id,date,client,description:desc,local,importe,poids:poidsVente,carat,typeBijou,paiement,montant,acompte,restant:montant-acompte,compteClientId,numFacture,payeParCompte};
  STATE.ventes.unshift(venteObj);
  saveAndSyncVente(venteObj);
  closeModal('modal-nouvelle-vente');renderJournal();renderDashboard();renderStocks();
  showToast(paiement==='compte'?('Vente '+id+' — '+fmt(montant)+' deduit compte '+client):('Vente '+id+' — '+fmt(montant)));
}

function ouvrirEditVente(id){
  const v=STATE.ventes.find(x=>x.id===id);if(!v)return;
  const nonFinalisee = (v.restant||0) > 0;
  const admin = isAdmin();
  // Modifier une vente : administrateurs seulement, comme côté serveur.
  // Pour encaisser un versement, les autres rôles utilisent « + Paiement »
  // dans Arrhes & Commandes, qui passe par une opération dédiée.
  if(!admin){
    showToast('⛔ Modification réservée à l\'administrateur.');return;
  }
  peuplerSelect('edit-v-carat',v.carat);peuplerTypeBijou('edit-v-type-bijou',v.typeBijou||'');peuplerClientSelect('edit-v-client',v.client);
  document.getElementById('edit-v-id').value=id;
  document.getElementById('edit-v-id-label').textContent='#'+id;
  document.getElementById('edit-v-date').value=v.date;
  document.getElementById('edit-v-description').value=v.description;
  document.getElementById('edit-v-local').value=v.local||'';
  document.getElementById('edit-v-importe').value=v.importe||'';
  document.getElementById('edit-v-montant').value=v.montant||'';
  document.getElementById('edit-v-acompte').value=v.acompte||'';
  calcRestant('edit-v-montant','edit-v-acompte','edit-v-restant-disp');
  afficherInfoCarat('edit-v-carat','edit-v-carat-badge');
  // Champs désactivés pour non-admin sur ventes non finalisées (montant, date, carat non modifiables)
  const readOnly = !admin;
  ['edit-v-date','edit-v-montant','edit-v-local','edit-v-importe'].forEach(eid=>{
    const el=document.getElementById(eid);
    if(el) el.disabled = readOnly;
  });
  document.getElementById('edit-v-carat').disabled = readOnly;
  // Boutons acompte
  const restant=(v.montant||0)-(v.acompte||0);
  document.getElementById('btn-add-acompte').style.display = restant>0?'':'none';
  document.getElementById('btn-regler-total').style.display= restant>0?'':'none';
  document.getElementById('modal-edit-vente').classList.add('show');
}

function sauvegarderVente(){
  const id=document.getElementById('edit-v-id').value;
  const v=STATE.ventes.find(x=>x.id===id);if(!v)return;
  const admin=isAdmin();
  if(!admin){showToast('⛔ Modification réservée à l\'administrateur.');return;}

  // Non-admin : seulement acompte et description modifiables
  const montant = admin ? (parseInt(document.getElementById('edit-v-montant').value)||0) : v.montant;
  const acompte = parseInt(document.getElementById('edit-v-acompte').value)||0;
  const desc    = document.getElementById('edit-v-description').value.trim();
  const client  = admin ? document.getElementById('edit-v-client').value : v.client;
  const date    = admin ? document.getElementById('edit-v-date').value : v.date;
  const local   = admin ? (parseFloat(document.getElementById('edit-v-local').value)||0) : v.local;
  const importe = admin ? (parseFloat(document.getElementById('edit-v-importe').value)||0) : v.importe;
  const carat      = admin ? document.getElementById('edit-v-carat').value : v.carat;
  const typeBijou  = document.getElementById('edit-v-type-bijou')?.value || v.typeBijou || '';

  if(acompte>montant){showToast('⚠ L\'acompte ne peut pas dépasser le montant.');return;}
  if(!desc){showToast('⚠ La description est obligatoire.');return;}

  // Réactiver les champs avant sauvegarde
  ['edit-v-date','edit-v-montant','edit-v-local','edit-v-importe'].forEach(eid=>{
    const el=document.getElementById(eid); if(el) el.disabled=false;
  });
  document.getElementById('edit-v-carat').disabled=false;

  Object.assign(v,{date,client,description:desc,local,importe,carat,typeBijou,montant,acompte,restant:montant-acompte});
  save();
  saveVente(v); // App → Supabase → App
  closeModal('modal-edit-vente');
  showToast('✓ Vente mise à jour.');
}

function ajouterAcompteVente(){
  // Lire les valeurs actuelles du formulaire d'édition
  const montant=parseInt(document.getElementById('edit-v-montant').value)||0;
  const acompteActuel=parseInt(document.getElementById('edit-v-acompte').value)||0;
  const restantActuel=montant-acompteActuel;
  if(restantActuel<=0){showToast('ℹ Cette vente est déjà soldée.');return;}
  const saisie=prompt(`Acompte supplémentaire à ajouter :\nRestant actuel : ${restantActuel.toLocaleString('fr-FR')} F\n\nMontant à encaisser (F CFA) :`, '');
  if(saisie===null)return;
  const montantAdd=parseInt(saisie)||0;
  if(montantAdd<=0){showToast('⚠ Montant invalide.');return;}
  if(montantAdd>restantActuel){showToast(`⚠ Montant supérieur au restant dû (${restantActuel.toLocaleString('fr-FR')} F).`);return;}
  const nouvelAcompte=acompteActuel+montantAdd;
  document.getElementById('edit-v-acompte').value=nouvelAcompte;
  calcRestant('edit-v-montant','edit-v-acompte','edit-v-restant-disp');
  const newRestant=montant-nouvelAcompte;
  if(newRestant===0){
    document.getElementById('btn-add-acompte').style.display='none';
    document.getElementById('btn-regler-total').style.display='none';
  }
  showToast(`✓ Acompte de ${montantAdd.toLocaleString('fr-FR')} F ajouté. Nouveau restant : ${newRestant.toLocaleString('fr-FR')} F`);
}

function reglerTotalVente(){
  const montant=parseInt(document.getElementById('edit-v-montant').value)||0;
  document.getElementById('edit-v-acompte').value=montant;
  calcRestant('edit-v-montant','edit-v-acompte','edit-v-restant-disp');
  document.getElementById('btn-add-acompte').style.display='none';
  document.getElementById('btn-regler-total').style.display='none';
  showToast('✓ Vente réglée en totalité. Cliquez Sauvegarder pour confirmer.');
}

function ouvrirAjoutAcompte(id){
  // Ouvrir la vente en édition avec focus sur acompte
  ouvrirEditVente(id);
}

function supprimerVente(id){
  if(!isAdmin()){showToast('Suppression reservee admin.');return;}
  if(!confirm('Supprimer la vente '+id+' ?'))return;
  _supa.deleteRow('ventes',id)
    .then(function(){return reloadVentes();})
    .then(function(){showToast('Vente supprimee.');})
    .catch(function(e){showToast('Erreur: '+e.message);});
}

/**
 * Le journal en cartes, pour les écrans étroits.
 *
 * On ne garde que ce qui sert au comptoir : la cliente, ce qu'elle a pris,
 * combien, et où en est le paiement. Le poids, le carat et le détail
 * local/importé restent sur le tableau de l'ordinateur — personne ne les
 * consulte en servant une cliente.
 */
// ============================================
// CARTES DE LISTE — la vue mobile de toutes les listes
// ============================================
// Un tableau de dix colonnes sur un écran de 375 px, c'est un défilement
// horizontal à l'aveugle. Chaque liste a donc une seconde vue en cartes, que
// le CSS substitue au tableau sous 768 px (classe `.avec-cartes`).
//
// Un seul gabarit pour toutes : l'allure des cartes se change ici, pas dans
// huit fonctions de rendu. Chaque écran se contente de décrire sa ligne —
// titre, valeur, description, pastilles, actions.
//
// Échappement : titre, valeur, desc et les textes des pastilles et boutons
// passent par esc() ici, donc jamais à l'appel. Seul `onclick` est du code
// écrit par l'appelant : à lui de passer ses arguments par escJs(), comme
// partout ailleurs — esc() referme ensuite proprement l'attribut.
//
// `pastille.fond` et `pastille.couleur` entrent dans un attribut style : ce
// sont des constantes du code (ROLES, CARATS_LIST), jamais une donnée saisie.

function carteListe(o) {
  var p = o.pastille;
  var pastille = p
    ? '<div class="cl-pastille" style="background:' + esc(p.fond || 'var(--info-bg)')
      + ';color:' + esc(p.couleur || 'var(--info-text)') + '">' + esc(p.texte || '') + '</div>'
    : '';

  var badges = (o.badges || []).filter(Boolean).map(function (b) {
    return '<span class="' + esc(b.classe || 'stock-badge') + '"'
      + (b.style ? ' style="' + esc(b.style) + '"' : '')
      + '>' + esc(b.texte) + '</span>';
  }).join('');

  var metas = (o.meta || []).filter(Boolean).map(function (m) {
    if (typeof m === 'string') return '<span>' + esc(m) + '</span>';
    return '<span class="' + esc(m.classe || '') + '">' + esc(m.texte) + '</span>';
  }).join('<span>·</span>');

  var actions = (o.actions || []).filter(Boolean).map(function (a) {
    if (a.inerte) return '<span class="cl-inerte">' + esc(a.texte) + '</span>';
    return '<button class="btn small ' + esc(a.classe || '') + '"'
      + (a.style ? ' style="' + esc(a.style) + '"' : '')
      + ' onclick="' + esc(a.onclick) + '">' + esc(a.texte) + '</button>';
  }).join('');

  // `ton` colore la tranche gauche : ok (vert), attente (ambre), sortie
  // (rouge), info (bleu). C'est ce qui rend une liste lisible sans la lire.
  return '<div class="carte-liste' + (o.ton ? ' ton-' + esc(o.ton) : '')
       + (o.estompee ? ' estompee' : '') + '">'
    + '<div class="cl-haut">'
      + '<div class="cl-titre">' + pastille
        + '<span class="cl-nom">' + esc(o.titre || '—') + '</span>'
      + '</div>'
      + (o.valeur ? '<span class="cl-valeur">' + esc(o.valeur) + '</span>' : '')
    + '</div>'
    + (o.desc ? '<div class="cl-desc">' + esc(o.desc) + '</div>' : '')
    + (metas || badges ? '<div class="cl-meta">' + metas + badges + '</div>' : '')
    + (actions ? '<div class="cl-actions">' + actions + '</div>' : '')
  + '</div>';
}

/**
 * Remplit la vue en cartes d'une liste.
 *
 * `lignes` doit être le tableau déjà filtré et trié qui a servi au <tbody> :
 * les deux vues montrent alors forcément la même chose. Les recalculer de
 * leur côté serait la garantie qu'elles divergent un jour.
 */
function rendreCartes(zoneId, lignes, versCarte, messageVide) {
  var zone = document.getElementById(zoneId);
  if (!zone) return;
  if (!lignes.length) {
    zone.innerHTML = '<div class="cl-vide">' + esc(messageVide || 'Rien à afficher.') + '</div>';
    return;
  }
  zone.innerHTML = lignes.map(function (x) { return carteListe(versCarte(x)); }).join('');
}

function rendreJournalCartes(ventes, admin) {
  rendreCartes('journal-cartes', ventes, function (v) {
    var paiement = v.paiement || 'especes';
    // Mêmes règles que le tableau : encaisser est ouvert à tous, modifier et
    // supprimer sont réservés aux administrateurs.
    var actions = [];
    if ((v.restant || 0) > 0 && !v.annulee) actions.push({
      texte: '+ Paiement',
      style: 'background:var(--warning-bg);color:var(--warning-text);border-color:transparent',
      onclick: "ouvrirFinalisation('" + escJs(v.id) + "')"
    });
    actions.push({ texte: '🖨 Facture', onclick: "afficherFacture('" + escJs(v.id) + "')" });
    if (admin) {
      actions.push({ texte: '✎', onclick: "ouvrirEditVente('" + escJs(v.id) + "')" });
      actions.push({ texte: '✕', classe: 'btn-danger', onclick: "supprimerVente('" + escJs(v.id) + "')" });
    }
    return {
      estompee: v.annulee,
      ton: v.annulee ? null : ((v.restant || 0) > 0 ? 'attente' : 'ok'),
      pastille: { texte: ini(v.client || '?') },
      titre: v.client || '—',
      valeur: fmt(v.montant),
      desc: v.description || '',
      meta: [{ texte: v.id, classe: 'ref-code' }, fmtDate(v.date)],
      badges: [
        { texte: PAIEMENT_LABELS[paiement] || '', classe: 'paiement-pill paiement-' + paiement },
        v.annulee
          ? { texte: 'Annulée', style: 'background:var(--danger-bg);color:var(--danger-text)' }
          : (v.restant || 0) > 0
            ? { texte: 'Reste ' + fmt(v.restant), classe: 'stock-badge stock-low' }
            : { texte: 'Soldé', classe: 'stock-badge stock-ok' }
      ],
      actions: actions
    };
  }, 'Aucune vente à afficher.');
}

// ============================================
// PAGINATION DU JOURNAL
// ============================================
// Vingt-cinq lignes par page. Le total, les cumuls et le CSV portent
// toujours sur la sélection ENTIÈRE : seule la liste est découpée.

const JOURNAL_PAR_PAGE = 25;
let JOURNAL_PAGE = 1;
let JOURNAL_SIGNATURE = null;

function allerPageJournal(n) {
  JOURNAL_PAGE = Math.max(1, n);
  renderJournal();
  // Remonter : sinon on arrive au milieu de la nouvelle page.
  const haut = document.getElementById('journal');
  if (haut) haut.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function rendreJournalPagination(total, nbPages, debut, combien) {
  const z = document.getElementById('journal-pagination');
  if (!z) return;

  // Une seule page : la barre n'apprend rien, on ne l'affiche pas.
  if (nbPages <= 1) { z.innerHTML = ''; return; }

  z.innerHTML =
      '<button onclick="allerPageJournal(' + (JOURNAL_PAGE - 1) + ')"'
    + (JOURNAL_PAGE <= 1 ? ' disabled' : '') + ' title="Page précédente">‹</button>'
    + '<span><span class="page-courante">' + (debut + 1) + '–' + (debut + combien) + '</span>'
    + ' sur ' + total + '</span>'
    + '<button onclick="allerPageJournal(' + (JOURNAL_PAGE + 1) + ')"'
    + (JOURNAL_PAGE >= nbPages ? ' disabled' : '') + ' title="Page suivante">›</button>';
}

/** Plie ou déplie les filtres carat et provenance. */
function basculerFiltresAvances() {
  const z = document.getElementById('filtres-avances');
  if (!z) return;
  z.style.display = z.style.display === 'none' ? 'flex' : 'none';
}

/** Un onglet de statut devient actif, et la liste se refait. */
function choisirStatutJournal(valeur, bouton) {
  document.getElementById('filtre-restant').value = valeur;
  document.querySelectorAll('#onglets-statut .onglet-filtre')
    .forEach(function (b) { b.classList.toggle('actif', b === bouton); });
  renderJournal();
}

function exporterJournalCSV(){
  calculerCumuls();const sorted=[...STATE.ventes].sort((a,b)=>a.date.localeCompare(b.date));
  let c=0;const hdr=['Date','Nom et Prénom','Description','Local(g)','Importé(g)','Carat','Montant','Acompte','Restant','Montant Cumul'];
  const rows=sorted.map(v=>{c+=(v.montant||0);return[fmtDate(v.date),v.client,v.description,v.local||'',v.importe||'',v.carat||'',v.montant||'',v.acompte||'',v.restant||'',c];});
  downloadFile('journal_ventes_'+today()+'.csv',[hdr,...rows].map(r=>r.map(x=>`"${x}"`).join(',')).join('\n'),'text/csv');showToast('✓ CSV exporté.');
}

// ============================================
// STOCKS
// ============================================
function renderStocks(f=''){
  const q=f.toLowerCase();
  const data=STATE.stock.filter(i=>i.nom.toLowerCase().includes(q)||i.ref.toLowerCase().includes(q)||(i.carat||'').toLowerCase().includes(q));
  const totalUnites=STATE.stock.reduce((s,i)=>s+(i.qty||0),0);
  const totalPoids=STATE.stock.reduce((s,i)=>s+(parseFloat(i.poidsTotalG)||0),0);
  document.getElementById('stock-count-label').textContent=STATE.stock.length+' references — '+totalUnites+' articles — '+totalPoids.toFixed(2)+'g total';

  var byCarat={};
  STATE.stock.forEach(function(i){ if(!i.carat)return; byCarat[i.carat]=(byCarat[i.carat]||0)+(parseFloat(i.poidsTotalG)||0); });
  var caratMax=Math.max.apply(null,Object.values(byCarat).concat([0.01]));
  var rcEl=document.getElementById('stock-recap-carats');
  if(rcEl) rcEl.innerHTML=Object.keys(byCarat).length===0?'<p style="color:var(--text-tertiary);font-size:13px">Aucun poids enregistre</p>':
    Object.entries(byCarat).sort(function(a,b){return b[1]-a[1];}).map(function(e){
      var c=getCarat(e[0])||{label:e[0],couleur:'#ccc'};
      return '<div class="bar-row"><span class="bar-label" style="width:150px;display:flex;align-items:center;gap:5px"><span style="width:9px;height:9px;border-radius:50%;background:'+c.couleur+';display:inline-block"></span>'+c.label+'</span><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(e[1]/caratMax*100)+'%"></div></div><span class="bar-val">'+e[1].toFixed(2)+'g</span></div>';
    }).join('');

  var byType={};
  STATE.stock.forEach(function(i){ var k=i.type||'autre'; byType[k]=(byType[k]||0)+(parseFloat(i.poidsTotalG)||0); });
  var typeMax=Math.max.apply(null,Object.values(byType).concat([0.01]));
  var rtEl=document.getElementById('stock-recap-types');
  if(rtEl) rtEl.innerHTML=Object.keys(byType).length===0?'<p style="color:var(--text-tertiary);font-size:13px">Aucun type enregistre</p>':
    Object.entries(byType).sort(function(a,b){return b[1]-a[1];}).map(function(e){
      var lbl={'local':'Or local','importe':'Or importe','mixte':'Mixte','argent':'Argent','autre':'Autre'}[e[0]]||e[0];
      return '<div class="bar-row"><span class="bar-label" style="width:120px">'+lbl+'</span><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(e[1]/typeMax*100)+'%"></div></div><span class="bar-val">'+e[1].toFixed(2)+'g</span></div>';
    }).join('');
  document.getElementById('stock-body').innerHTML=data.map(item=>{
    const st=statutStock(item);const c=getCarat(item.carat);const dot=c?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.couleur};margin-right:4px;vertical-align:middle"></span>`:'';
    const typeL={local:'Local',importe:'Importé',mixte:'Mixte',argent:'Argent',autre:'Autre'}[item.type]||item.type||'—';
    return`<tr><td><span class="ref-code">${esc(item.ref)}</span></td><td>${esc(item.nom)}</td><td><span class="carat-pill">${dot}${esc((item.carat||'—').toUpperCase())}</span></td><td><span style="font-size:12px;color:var(--text-secondary)">${esc(typeL)}</span></td><td style="text-align:center;font-weight:600;color:var(--success-text)">${(item.poidsTotalG||0).toFixed(2)}g</td><td style="text-align:center"><strong>${item.qty||0}</strong></td><td>${fmt(item.prix)}</td><td>${fmt((item.qty||0)*item.prix)}</td><td><span class="stock-badge ${st.cls}">${st.label}</span></td><td><div style="display:flex;gap:4px"><button class="btn small" onclick="ajusterStock('${escJs(item.ref)}')">Ajuster</button><button class="btn small btn-danger" onclick="supprimerArticle('${escJs(item.ref)}')">✕</button></div></td></tr>`;
  }).join('');
  rendreStockCartes(data);
}

// La vue mobile de la même liste — mêmes données, mêmes actions.
// Le stock se pilote au poids : c'est lui qu'on met en valeur, pas le prix,
// qui reste à zéro tant qu'aucune vente n'a été chiffrée.
function rendreStockCartes(data){
  rendreCartes('stock-cartes', data, function(item){
    const st = statutStock(item);
    const typeL = {local:'Local',importe:'Importé',mixte:'Mixte',argent:'Argent',autre:'Autre'}[item.type]||item.type||'—';
    return {
      ton: { 'stock-ok':'ok', 'stock-low':'attente', 'stock-out':'sortie' }[st.cls],
      titre: item.nom,
      valeur: (item.poidsTotalG||0).toFixed(2)+' g',
      meta: [
        { texte:item.ref, classe:'ref-code' },
        (item.qty||0)+' article'+((item.qty||0)>1?'s':''),
        typeL
      ],
      badges: [
        { texte:(item.carat||'—').toUpperCase(), classe:'carat-pill' },
        { texte:st.label, classe:'stock-badge '+st.cls },
        item.prix>0 ? { texte:fmt(item.prix)+' / u', classe:'stock-badge' } : null
      ],
      actions: [
        { texte:'Ajuster', onclick:"ajusterStock('"+escJs(item.ref)+"')" },
        { texte:'✕', classe:'btn-danger', onclick:"supprimerArticle('"+escJs(item.ref)+"')" }
      ]
    };
  }, 'Aucun article en stock.');
}
document.getElementById('stock-search')?.addEventListener('input',function(){renderStocks(this.value);});

function ajouterProduit(){
  var nom=document.getElementById('p-nom').value.trim();
  var typeBijouP=(document.getElementById('p-type-bijou')&&document.getElementById('p-type-bijou').value)||'';
  var hasOrP=TYPES_AVEC_OR_CODES.indexOf(typeBijouP)>=0;
  var carat=hasOrP?(document.getElementById('p-carat')&&document.getElementById('p-carat').value||''):'';
  var prov=hasOrP?(document.getElementById('p-provenance')&&document.getElementById('p-provenance').value||'local'):'';
  var poids=hasOrP?(parseFloat(document.getElementById('p-poids')&&document.getElementById('p-poids').value)||0):(parseFloat(document.getElementById('p-poids-s')&&document.getElementById('p-poids-s').value)||0);
  var qty=parseInt(document.getElementById('p-qty')&&document.getElementById('p-qty').value)||1;
  var seuil=parseFloat(document.getElementById('p-seuil')&&document.getElementById('p-seuil').value)||50;
  var ref=''; var prix=0; var type=hasOrP?prov:(typeBijouP||'autre');
  if(!nom||!typeBijouP||poids<=0){showToast('Designation, type de bijou et poids sont obligatoires.');return;}
  STATE.counters.stk++; ref='STK-'+String(STATE.counters.stk).padStart(4,'0');
  // Le stock est géré en poids total (g) — qty=poids pour compatibilité déduction
  var stockObj={ref,nom,carat,type,typeBijou:typeBijouP,provenance:prov,poids:poids,qty:qty,poidsTotalG:poids,prix,seuil};STATE.stock.unshift(stockObj);
  saveStock(stockObj).then(function(){closeModal('modal-add-produit');showToast('Article ajouté.');});
}
function ajusterStock(ref){
  const i=STATE.stock.find(x=>x.ref===ref); if(!i) return;
  document.getElementById('ajust-stock-ref').value=ref;
  document.getElementById('ajust-stock-nom').textContent=i.nom;
  document.getElementById('ajust-stock-poids').value='';
  document.getElementById('ajust-stock-qty').value='';
  document.getElementById('ajust-stock-poids-actuel').textContent='Stock actuel : '+(i.poidsTotalG||0).toFixed(2)+'g';
  document.getElementById('ajust-stock-qty-actuel').textContent='Stock actuel : '+(i.qty||0)+' article'+(i.qty>1?'s':'');
  document.getElementById('modal-ajust-stock').classList.add('show');
}
async function validerAjustStock(){
  const ref=document.getElementById('ajust-stock-ref').value;
  const ajoutPoids=parseFloat(document.getElementById('ajust-stock-poids').value)||0;
  const ajoutQty=parseInt(document.getElementById('ajust-stock-qty').value)||0;
  const i=STATE.stock.find(x=>x.ref===ref); if(!i) return;
  if(ajoutPoids<=0&&ajoutQty<=0){showToast('Saisissez le poids et/ou le nombre d\'articles à ajouter.');return;}
  // INCRÉMENTER — pas remplacer
  i.poidsTotalG=(i.poidsTotalG||0)+ajoutPoids;
  i.qty=(i.qty||0)+ajoutQty;
  await saveAndSyncStock([i]);
  closeModal('modal-ajust-stock');
  showToast('Stock mis à jour — '+i.poidsTotalG.toFixed(2)+'g / '+i.qty+' article'+(i.qty>1?'s':''));
}
function supprimerArticle(ref){if(!confirm('Supprimer cet article ?'))return;
  _supa.deleteRow('stock',ref).then(function(){reloadStock();}).catch(function(e){showToast('Erreur: '+e.message);});
}

// ============================================
// SORTIES DE STOCK (admin only)
// ============================================
function prepSortie(){
  peuplerStockSelect('s-stock-ref');
  var sDate=document.getElementById('s-date'); if(sDate) sDate.value=today();
  var sPoids=document.getElementById('s-poids'); if(sPoids) sPoids.value='';
  var sQty=document.getElementById('s-qty'); if(sQty) sQty.value='';
  var sMotif=document.getElementById('s-motif'); if(sMotif) sMotif.value='';
  var sCom=document.getElementById('s-commentaire'); if(sCom) sCom.value='';
  var si=document.getElementById('s-stock-info'); if(si) si.style.display='none';
  ['s-type-bijou','s-carat','s-provenance'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
}

function onChangeSortieType(){
  var type=document.getElementById('s-type-bijou').value;
  var hasOr=TYPES_AVEC_OR_CODES.indexOf(type)>=0;
  var sof=document.getElementById('s-or-fields'); if(sof) sof.style.display=hasOr?'block':'none';
  document.getElementById('s-stock-info').style.display='none';
  document.getElementById('s-poids').value='';
  if(hasOr){
    // Peupler carats selon prov par défaut (local)
    onChangeSortieProv();
    // Forcer 18k-importe pour raika/extra
    if(TYPES_FORCE_IMPORTE_18K.indexOf(type)>=0){
      var provEl=document.getElementById('s-provenance');
      if(provEl){provEl.value='importe';provEl.disabled=true;}
      onChangeSortieProv();
      setTimeout(function(){
        var cEl=document.getElementById('s-carat');
        if(cEl) cEl.value='18k-importe';
        afficherStockSortie();
      },50);
    } else {
      var provEl2=document.getElementById('s-provenance');
      if(provEl2) provEl2.disabled=false;
    }
  } else {
    afficherStockSortie();
  }
}

function onChangeSortieProv(){
  var prov=document.getElementById('s-provenance')&&document.getElementById('s-provenance').value||'local';
  var cSel=document.getElementById('s-carat'); if(!cSel) return;
  var curVal=cSel.value;
  cSel.innerHTML='<option value="">— Choisir —</option>';
  CARATS_LIST.filter(function(c){return c.origine===prov;}).forEach(function(c){
    var o=document.createElement('option');
    o.value=c.code; o.textContent=c.label;
    if(c.code===curVal) o.selected=true;
    cSel.appendChild(o);
  });
  afficherStockSortie();
}

function onChangeSortieCarat(){ afficherStockSortie(); }

function afficherStockSortie(){
  var type=document.getElementById('s-type-bijou')&&document.getElementById('s-type-bijou').value||'';
  var hasOr=TYPES_AVEC_OR_CODES.indexOf(type)>=0;
  var carat=hasOr?(document.getElementById('s-carat')&&document.getElementById('s-carat').value||''):'';
  var prov=hasOr?(document.getElementById('s-provenance')&&document.getElementById('s-provenance').value||''):'';
  var info=document.getElementById('s-stock-info');
  // Calculer le poids total disponible en stock pour ce type/carat
  var totalPoids=0;
  STATE.stock.forEach(function(s){
    if(!type) return;
    var typeBijouMatch = (s.typeBijou===type)||(s.type===prov)||(s.type===type);
    var caratMatch = !hasOr || !carat || s.carat===carat;
    if(typeBijouMatch && caratMatch && s.qty>0 && s.poids>0){
      totalPoids += (parseFloat(s.poids)||0)*s.qty;
    }
  });
  if(totalPoids>0){
    document.getElementById('s-stock-poids').textContent=totalPoids.toFixed(2)+'g';
    document.getElementById('s-stock-poids').style.color='var(--success-text)';
    info.style.display='block';
  } else {
    document.getElementById('s-stock-poids').textContent='Aucun stock';
    document.getElementById('s-stock-poids').style.color='var(--danger-text)';
    info.style.display='block';
  }
}

function previewSortie(){
  var poids=parseFloat(document.getElementById('s-poids')&&document.getElementById('s-poids').value)||0;
  var stockEl=document.getElementById('s-stock-poids');
  if(!stockEl) return;
  var dispo=parseFloat(stockEl.textContent)||0;
  stockEl.style.color=poids>dispo?'var(--danger-text)':'var(--success-text)';
}
function renderSorties(){
  document.getElementById('sorties-count-label').textContent=`${STATE.sorties.length} sortie${STATE.sorties.length>1?'s':''} enregistrée${STATE.sorties.length>1?'s':''}`;
  document.getElementById('btn-add-sortie').style.display=isAdmin()?'':'none';
  document.getElementById('sorties-perm-warning').style.display=isAdmin()?'none':'flex';
  // Une seule liste triée, partagée par le tableau et les cartes.
  const triees=[...STATE.sorties].sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('sorties-body').innerHTML=triees.map(s=>`<tr><td style="white-space:nowrap;font-size:12px;color:var(--text-secondary)">${fmtDate(s.date)}</td><td>${esc(s.typeBijou||s.ref||'—')}</td><td><span class="ref-code">${esc(s.carat||'—')}</span></td><td style="text-align:center"><strong>${s.poids||s.qty||'—'}g</strong>${s.nbArticles?' <span style="font-size:10px;color:var(--text-tertiary)">'+s.nbArticles+' art.</span>':''}</td><td>${esc(s.motif)}${s.commentaire?` — <span style="color:var(--text-secondary)">${esc(s.commentaire)}</span>`:''}</td><td><span class="role-pill role-${esc(s.validePar)}">${esc(s.validePar)}</span></td></tr>`).join('');
  rendreSortiesCartes(triees);
}

function rendreSortiesCartes(triees){
  rendreCartes('sorties-cartes', triees, function(s){
    return {
      ton: 'sortie',
      titre: s.typeBijou || s.ref || '—',
      valeur: (s.poids || s.qty || '—') + 'g',
      desc: s.motif + (s.commentaire ? ' — ' + s.commentaire : ''),
      meta: [
        fmtDate(s.date),
        { texte:(s.carat||'—'), classe:'ref-code' },
        s.nbArticles ? s.nbArticles + ' art.' : null
      ],
      badges: [{ texte:s.validePar, classe:'role-pill role-'+s.validePar }]
    };
  }, 'Aucune sortie enregistrée.');
}
async function enregistrerSortie(){
  if(!isAdmin()){showToast('Seul l\'administrateur peut effectuer des sorties.');return;}
  var date        = document.getElementById('s-date').value;
  var stockRef    = document.getElementById('s-stock-ref')&&document.getElementById('s-stock-ref').value||'';
  var stockItem   = getStockItem(stockRef);
  var typeBijou   = stockItem?(stockItem.typeBijou||''):(document.getElementById('s-type-bijou')&&document.getElementById('s-type-bijou').value||'');
  var carat       = stockItem?(stockItem.carat||''):(document.getElementById('s-carat')&&document.getElementById('s-carat').value||'');
  var motif       = document.getElementById('s-motif').value;
  var commentaire = document.getElementById('s-commentaire').value;
  var nbArticles  = parseInt(document.getElementById('s-qty')&&document.getElementById('s-qty').value)||0;
  var poidsSort   = parseFloat(document.getElementById('s-poids')&&document.getElementById('s-poids').value)||0;

  if(!date||!stockRef){showToast('Date et article en stock sont obligatoires.');return;}
  if(poidsSort<=0&&nbArticles<=0){showToast('Saisissez le poids et/ou le nombre d\'articles.');return;}
  if(stockItem){
    if(poidsSort>0&&poidsSort>(stockItem.poidsTotalG||0)){showToast('Poids insuffisant (dispo: '+(stockItem.poidsTotalG||0).toFixed(2)+'g)');return;}
    if(nbArticles>0&&nbArticles>(stockItem.qty||0)){showToast('Nombre insuffisant (dispo: '+(stockItem.qty||0)+')');return;}
  }

  if(stockRef && (poidsSort>0 || nbArticles>0)){
    var okS = await deduireStock(stockRef, poidsSort, nbArticles);
    if(!okS) return;
  }

  // Numéro attribué par le serveur, comme pour les ventes.
  var id = await prochainId('s','S',4);
  var labelType=(stockItem?stockItem.nom:typeBijou)+(carat?' — '+carat.toUpperCase():'');
  const sortieObj={id,date,stockRef:stockRef||'',typeBijou:labelType,carat:carat||'—',poids:poidsSort,nbArticles:nbArticles||0,motif,commentaire,validePar:STATE.currentUser?.nom||'admin'};
  STATE.sorties.unshift(sortieObj);
  await saveAndSyncSortie(sortieObj);
  closeModal('modal-add-sortie');renderSorties();renderStocks();renderDashboard();
  showToast('Sortie '+id+' — '+(poidsSort?poidsSort+'g':'')+(nbArticles?' '+nbArticles+' art.':''));
}


// Le module « Achats fournisseurs » a été supprimé : STATE.achats n'était
// jamais initialisé, l'onglet n'existait pas dans la navigation, aucune table
// Supabase ne lui correspondait, et ses fonctions visaient des éléments HTML
// absents. Les sorties d'argent vers les fournisseurs se saisissent en
// décaissement, comme les autres.

// ============================================
// DÉCAISSEMENTS
// ============================================
function prepDecaiss(){
  const sel=document.getElementById('d-categorie');sel.innerHTML='<option value="">— Choisir —</option>';
  CATEGORIES_DECAISSEMENT.forEach(c=>{const o=document.createElement('option');o.textContent=c;sel.appendChild(o);});
  document.getElementById('d-date').value=today();
}
function renderDecaissements(){
  const mois=STATE.decaissements.filter(d=>isMois(d.date));
  const totalAll=STATE.decaissements.reduce((s,d)=>s+(d.montant||0),0);
  const totalMois=mois.reduce((s,d)=>s+(d.montant||0),0);
  // Encaissé = argent réellement entré, hors part réglée sur compte épargne.
  const encaisseMois=STATE.ventes.filter(v=>isMois(v.date)).reduce((s,v)=>s+encaisseReel(v),0);
  const encaisseTotal=STATE.ventes.reduce((s,v)=>s+encaisseReel(v),0);
  const depotsMois   =totalDepotsEpargne(true);
  const depotsTotal  =totalDepotsEpargne(false);
  const soldeNetMois =soldeCaisse(true);
  const soldeNetTotal=soldeCaisse(false);
  const avances      =totalAvancesAConvertir();
  document.getElementById('decaiss-count-label').textContent=`${STATE.decaissements.length} décaissement${STATE.decaissements.length>1?'s':''}`;
  document.getElementById('metric-decaiss-mois').textContent=fmt(totalMois);
  document.getElementById('metric-decaiss-all').textContent=fmt(totalAll);
  // Solde net = encaissé − décaissé (sur tout)
  const soldeEl=document.getElementById('metric-solde-net');
  if(soldeEl){
    soldeEl.textContent=fmt(soldeNetTotal);
    soldeEl.style.color=soldeNetTotal>=0?'var(--success-text)':'var(--danger-text)';
  }
  // Sous-titre explicatif
  const soldeSubEl=document.getElementById('metric-solde-net-sub');
  if(soldeSubEl){
    soldeSubEl.textContent=fmt(encaisseTotal)+' ventes + '+fmt(depotsTotal)+' dépôts − '+fmt(totalAll)+' décaissé'
      +(avances>0?' · dont '+fmt(avances)+' d\'avances à convertir en bijoux':'');
  }
  const triesDec=[...STATE.decaissements].sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('decaiss-body').innerHTML=triesDec.map(d=>`<tr><td style="white-space:nowrap;font-size:12px;color:var(--text-secondary)">${fmtDate(d.date)}</td><td><span class="cat-badge">${esc(d.categorie)}</span></td><td>${esc(d.description)}</td><td style="font-weight:500;color:var(--danger-text)">${fmt(d.montant)}</td><td><span class="role-pill role-${esc(d.saisiPar)}">${esc(d.saisiPar)}</span></td><td><button class="btn small btn-danger" onclick="supprimerDecaiss('${escJs(d.id)}')">✕</button></td></tr>`).join('');
  rendreDecaissCartes(triesDec);
}

function rendreDecaissCartes(tries){
  rendreCartes('decaiss-cartes', tries, function(d){
    return {
      ton: 'sortie',
      titre: d.description,
      valeur: '− ' + fmt(d.montant),
      meta: [{ texte:d.id, classe:'ref-code' }, fmtDate(d.date), d.saisiPar],
      badges: [{ texte:d.categorie, classe:'cat-badge' }],
      actions: [{ texte:'✕ Supprimer', classe:'btn-danger', onclick:"supprimerDecaiss('"+escJs(d.id)+"')" }]
    };
  }, 'Aucun décaissement.');
}
function enregistrerDecaissement(){
  const date=document.getElementById('d-date').value,cat=document.getElementById('d-categorie').value,desc=document.getElementById('d-description').value.trim(),montant=parseInt(document.getElementById('d-montant').value)||0;
  if(!date||!cat||!desc||montant<=0){showToast('⚠ Tous les champs sont obligatoires.');return;}
  // Numéro attribué par le serveur : le compteur local peut être en retard et
  // refabriquer un identifiant déjà pris, que l'upsert écraserait alors.
  prochainId('d','D',4)
    .then(function(id){
      return saveDecaissement({
        id:id, date:date, categorie:cat, description:desc, montant:montant,
        saisiPar:STATE.currentUser?.nom||STATE.currentUser?.role||'admin'
      }).then(function(){ return id; });
    })
    .then(function(id){
      return chargerDonnees().then(function(){
        closeModal('modal-add-decaiss');
        renderDecaissements(); renderDashboard();
        showToast('✓ Décaissement '+id+' enregistré.');
      });
    })
    .catch(function(e){ showToast('⚠ '+e.message); });
}
function supprimerDecaiss(id){
  if(!isAdmin())return;
  if(!confirm('Supprimer ce decaissement ?'))return;
  _supa.deleteRow('decaissements',id)
    .then(function(){return reloadDecaissements();})
    .then(function(){showToast('Decaissement supprime.');})
    .catch(function(e){showToast('Erreur: '+e.message);});
}

// ============================================
// CLIENTS
// ============================================
function renderClients(f=''){
  const q=f.toLowerCase();
  const qn2=normalizeStr(q);const data=STATE.clients.filter(c=>c.nom.toLowerCase().includes(q)||normalizeStr(c.tel||'').includes(qn2)||(c.email||'').toLowerCase().includes(q));
  document.getElementById('clients-count-label').textContent=`${STATE.clients.length} clients`;
  const stats={};STATE.ventes.forEach(v=>{if(!stats[v.client])stats[v.client]={total:0,restant:0,nb:0,derniere:''};stats[v.client].total+=(v.montant||0);stats[v.client].restant+=(v.restant||0);stats[v.client].nb+=1;if(!stats[v.client].derniere||v.date>stats[v.client].derniere)stats[v.client].derniere=v.date;});
  // L'existence d'un code vient du serveur (colonne a_un_pin) : l'empreinte
  // elle-même n'est lisible par personne, et l'ancien miroir localStorage
  // `marjan_clients_pin` conservait les codes en clair sur le poste.
  document.getElementById('clients-body').innerHTML=data.map(c=>{const s=stats[c.nom]||{total:0,restant:0,nb:0,derniere:''};const t=tier(s.total);const d=s.derniere===today()?"Aujourd'hui":s.derniere?fmtDate(s.derniere):'—';const hasPin=(c.a_un_pin===true||c.aUnPin===true);const pinCell=isAdmin()?`<td>${hasPin?`<span style="font-size:11px;color:var(--success-text);cursor:pointer" onclick="modifierPinClient('${c.id}')">🔑 Actif</span>`:`<button onclick="modifierPinClient('${c.id}')" style="font-size:11px;padding:3px 8px;border-radius:4px;background:transparent;border:1px solid var(--border-light);color:var(--text-secondary);cursor:pointer">+ PIN</button>`}</td>`:'<td>—</td>';return`<tr><td><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${ini(c.nom)}</div><div><div style="font-size:13px;font-weight:500">${c.nom}</div><div style="font-size:11px;color:var(--text-tertiary)">${c.tel}</div></div></div></td><td>${c.tel}</td><td><strong>${fmt(s.total)}</strong></td><td>${s.restant>0?`<span class="stock-badge stock-low">${fmt(s.restant)}</span>`:'<span style="color:var(--success-text);font-size:12px">Soldé</span>'}</td><td>${s.nb}</td><td><span class="tier-badge ${t.cls}">${t.label}</span></td><td style="font-size:12px;color:var(--text-secondary)">${d}</td>${pinCell}</tr>`;}).join('');
  rendreClientsCartes(data, stats);
}

function rendreClientsCartes(data, stats){
  rendreCartes('clients-cartes', data, function(c){
    const s = stats[c.nom] || {total:0,restant:0,nb:0,derniere:''};
    const t = tier(s.total);
    const vue = s.derniere===today() ? "Aujourd'hui" : (s.derniere ? fmtDate(s.derniere) : 'jamais');
    const aUnPin = (c.a_un_pin===true || c.aUnPin===true);
    return {
      ton: s.restant > 0 ? 'attente' : 'ok',
      pastille: { texte:ini(c.nom) },
      titre: c.nom,
      valeur: fmt(s.total),
      desc: c.tel,
      meta: [
        s.nb + ' vente' + (s.nb>1?'s':''),
        'Vue : ' + vue
      ],
      badges: [
        { texte:t.label, classe:'tier-badge '+t.cls },
        s.restant>0 ? { texte:'Doit '+fmt(s.restant), classe:'stock-badge stock-low' }
                    : { texte:'Soldé', classe:'stock-badge stock-ok' }
      ],
      // Le code du portail ne se pose que depuis un compte administrateur,
      // exactement comme dans le tableau.
      actions: isAdmin()
        ? [{ texte: aUnPin ? '🔑 Code actif' : '+ Code portail',
             onclick: "modifierPinClient('"+escJs(c.id)+"')" }]
        : []
    };
  }, 'Aucune cliente.');
}
document.getElementById('client-search')?.addEventListener('input',function(){renderClients(this.value);});
document.getElementById('cc-search')?.addEventListener('input',function(){renderComptesClients(this.value);});
document.getElementById('arr-search')?.addEventListener('input',renderBijouxArr);
document.getElementById('arr-filtre')?.addEventListener('change',renderBijouxArr);
function ajouterClient(){
  const nom=document.getElementById('c-nom').value.trim(),tel=document.getElementById('c-tel').value.trim(),email=document.getElementById('c-email').value.trim(),adresse=document.getElementById('c-adresse').value.trim();
  const pin=(document.getElementById('c-pin')?.value||'').replace(/\D/g,'').slice(0,4);
  if(!nom||!tel){showToast('⚠ Nom et téléphone obligatoires.');return;}
  if(STATE.clients.find(c=>c.tel===tel)){showToast('⚠ Ce numéro existe déjà.');return;}
  if(pin&&pin.length!==4){showToast('⚠ Le PIN doit faire exactement 4 chiffres.');return;}
  closeModal('modal-add-client');
  ['c-nom','c-tel','c-email','c-adresse'].forEach(x=>document.getElementById(x).value='');
  if(document.getElementById('c-pin')) document.getElementById('c-pin').value='';

  // Le numéro vient du serveur, puis la fiche, puis le code — dans cet ordre.
  // Le code est haché par PostgreSQL et ne transite ni par localStorage ni
  // par la table en clair.
  var id;
  prochainId('cl','CL',4)
    .then(function(nouvelId){
      id = nouvelId;
      return saveClient({ id:id, nom:nom, tel:tel, email:email, adresse:adresse });
    })
    .then(function(){ return pin ? definirPinClient(id, pin) : null; })
    .then(function(){ return chargerDonnees(); })
    .then(function(){
      renderClients();
      showToast('✓ Cliente « '+nom+' » ajoutée.'+(pin?' Accès portail activé.':''));
    })
    .catch(function(e){ showToast('⚠ '+e.message); });
}

function modifierPinClient(clientId){
  if(!isAdmin()){showToast('⛔ Admin seulement.');return;}
  const client=STATE.clients.find(c=>c.id===clientId);
  if(!client){showToast('Cliente introuvable.');return;}

  const saisie=prompt(`Code portail pour ${client.nom}\n(4 chiffres, laisser vide pour retirer l'accès)`,'');
  if(saisie===null) return;
  const pin=saisie.replace(/\D/g,'');
  if(saisie!==''&&pin.length!==4){showToast('⚠ Le code doit faire 4 chiffres.');return;}

  definirPinClient(clientId, pin)
    .then(function(res){
      if(res && res.ok===false){ showToast('⛔ '+res.erreur); return; }
      client.aUnPin = !!pin;          // reflet local, l'empreinte reste au serveur
      save(); renderClients();
      showToast(pin?`✓ Accès portail activé pour ${client.nom}.`
                   :`Accès portail retiré pour ${client.nom}.`);
    })
    .catch(function(e){ showToast('⚠ '+e.message); });
}

// ============================================
// COMPTES CLIENTS (épargne)
// ============================================
function renderComptesClients(filtre=''){
  const q = filtre ? filtre.toLowerCase() : '';
  document.getElementById('cc-count-label').textContent=`${STATE.comptesClients.length} compte${STATE.comptesClients.length>1?'s':''} — épargne bijoux`;
  const qn3=normalizeStr(q);const ccFiltres = STATE.comptesClients.filter(cc => { if(!q) return true; const clCC=STATE.clients.find(c=>c.nom===cc.client); return cc.client.toLowerCase().includes(q)||normalizeStr(clCC?.tel||'').includes(qn3); });
  document.getElementById('cc-list').innerHTML = ccFiltres.length===0
    ? '<div style="padding:24px;text-align:center;color:var(--text-secondary);font-size:13px">Aucun compte ouvert</div>'
    : ccFiltres.map(cc=>{
    const mvts = cc.mouvements || [];
    return`<div style="padding:16px 20px;border-bottom:0.5px solid var(--border-light)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:38px;height:38px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0">${ini(cc.client)}</div>
          <div>
            <div style="font-size:14px;font-weight:600">${cc.client}</div>
            <div style="font-size:12px;color:var(--text-secondary)">Ouvert le ${fmtDate(cc.dateOuverture)} · ${mvts.length} dépôt${mvts.length>1?'s':''}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:700;color:var(--success-text)">${fmt(cc.solde)}</div>
          <div style="font-size:11px;color:var(--text-tertiary)">solde disponible</div>
        </div>
      </div>
      <div style="margin-bottom:12px;background:var(--bg-secondary);border-radius:var(--radius-md);padding:10px 12px">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);margin-bottom:6px">Mouvements</div>
        ${mvts.slice().reverse().slice(0,8).map(m=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:0.5px solid var(--border-light)"><span style="color:var(--text-secondary)">${fmtDate(m.date)} — ${m.note||''}</span><span style="font-weight:600;color:${m.type==='retrait'?'var(--danger-text)':'var(--success-text)'}">${m.type==='retrait'?'- ':'+'}${fmt(m.montant)}</span></div>`).join('')}
        ${(()=>{
          const vcc=STATE.ventes.filter(v=>v.client===cc.client&&v.compteClientId===cc.id);
          if(!vcc.length) return '';
          return '<div style="margin-top:8px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-tertiary);margin-bottom:4px">Ventes sur ce compte</div>'
            +vcc.map(v=>'<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:0.5px solid var(--border-light)">'
              +'<span style="color:var(--text-secondary)">'+fmtDate(v.date)+' — '+(v.numFacture||v.id)+' — '+v.description+'</span>'
              +'<span style="font-weight:600;color:var(--danger-text)">- '+fmt(v.montant)+'</span></div>').join('');
        })()}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small btn-primary" onclick="openDepotCC('${cc.id}')">+ Depot</button>
        <button class="btn small" onclick="imprimerCompteClient('${cc.id}')">Imprimer</button>
        ${isAdmin() && soldeDepuisMouvements(cc) > 0
          ? `<button class="btn small" style="color:var(--warning-text);border-color:var(--warning-text)" onclick="ouvrirViderCompte('${cc.id}')">Solder</button>`
          : ''}
        <button class="btn small btn-danger" onclick="supprimerCC('${cc.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}
// ============================================
// SOLDER UN COMPTE ÉPARGNE
// ============================================
/**
 * Mettre un compte à zéro n'a pas un seul sens, et les deux ne font pas la
 * même chose à la caisse :
 *
 *   espèces — la cliente reprend son argent : il SORT du tiroir, donc un
 *             décaissement est créé en même temps.
 *   bijou   — le solde part en bijou : l'argent était entré au dépôt et
 *             reste dans le tiroir en règlement. Aucun décaissement.
 *
 * L'opératrice doit donc dire laquelle. Le serveur fait le reste en une
 * transaction — voir vider_compte_epargne() (migration 013).
 */
function ouvrirViderCompte(id) {
  if (!isAdmin()) { showToast('⛔ Réservé aux administrateurs.'); return; }
  var cc = STATE.comptesClients.find(function (c) { return c.id === id; });
  if (!cc) return;
  var solde = soldeDepuisMouvements(cc);
  if (solde <= 0) { showToast('Ce compte est déjà à zéro.'); return; }

  document.getElementById('vc-id').value     = id;
  document.getElementById('vc-client').textContent = cc.client;
  document.getElementById('vc-solde').textContent  = fmt(solde);
  document.getElementById('vc-date').value   = today();
  document.getElementById('vc-motif').value  = 'especes';
  document.getElementById('vc-note').value   = '';
  majAvertissementVider();
  openModal('modal-vider-compte');
}

/** Dit à l'écran ce que le geste va faire à la caisse. */
function majAvertissementVider() {
  var motif = document.getElementById('vc-motif').value;
  var el    = document.getElementById('vc-avertissement');
  var solde = document.getElementById('vc-solde').textContent;
  if (!el) return;
  el.innerHTML = motif === 'especes'
    ? '<strong>' + solde + '</strong> sortiront de la caisse. Un décaissement sera créé automatiquement.'
    : 'La caisse ne bouge pas : cet argent y est entré au moment des dépôts et y reste en règlement du bijou.';
}

async function confirmerViderCompte() {
  if (!isAdmin()) { showToast('⛔ Réservé aux administrateurs.'); return; }
  var id    = document.getElementById('vc-id').value;
  var motif = document.getElementById('vc-motif').value;
  var date  = document.getElementById('vc-date').value;
  var note  = document.getElementById('vc-note').value.trim();
  if (!date) { showToast('⚠ Date obligatoire.'); return; }

  var btn = document.getElementById('btn-vider-compte');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    var r = await viderCompteEpargne(id, motif, date, note);
    closeModal('modal-vider-compte');
    await chargerDonnees();
    renderComptesClients(); renderJournal(); renderDecaissements(); renderDashboard();
    showToast('✓ Compte de ' + r.client + ' soldé — ' + fmt(r.montant)
            + (r.decaissement ? ' (décaissement ' + r.decaissement + ')' : ''));
  } catch (e) {
    showToast('⚠ ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '✓ Solder le compte';
  }
}

function creerCompteClient(){
  const client=document.getElementById('cc-client').value,date=document.getElementById('cc-date').value,depot=parseInt(document.getElementById('cc-depot-init').value)||0;
  if(!client||!date||depot<=0){showToast('⚠ Client, date et dépôt initial sont obligatoires.');return;}
  // Le compte et son dépôt d'ouverture dans une seule transaction serveur :
  // séparés, un compte pouvait exister avec un solde sans mouvement en face.
  var id;
  prochainId('cc','CC',4)
    .then(function(nouvelId){
      id = nouvelId;
      return ouvrirCompteEpargne(id, client, date, depot);
    })
    .then(function(res){
      if(!res || res.ok===false){ showToast('⛔ '+((res&&res.erreur)||'Création refusée.')); return; }
      return chargerDonnees().then(function(){
        closeModal('modal-add-compte-client');
        renderComptesClients(); renderDashboard();
        showToast('Compte '+id+' créé pour '+client+'.');
      });
    })
    .catch(function(e){ showToast('⚠ '+e.message); });
}
function openDepotCC(id){
  const cc=STATE.comptesClients.find(c=>c.id===id); if(!cc)return;
  document.getElementById('depot-cc-id').value=id;
  document.getElementById('depot-cc-date').value=today();
  document.getElementById('depot-cc-montant').value='';
  document.getElementById('depot-cc-note').value='';
  // Afficher le solde actuel dans le modal
  const infoEl=document.getElementById('depot-cc-info');
  if(infoEl) infoEl.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--bg-secondary);border-radius:var(--radius-md);margin-bottom:12px">'
    +'<span style="font-size:13px;font-weight:600">'+cc.client+'</span>'
    +'<span style="font-size:18px;font-weight:700;color:var(--success-text)">'+fmt(cc.solde)+'<span style="font-size:11px;font-weight:400;color:var(--text-tertiary)"> solde actuel</span></span></div>';
  document.getElementById('modal-depot-cc').classList.add('show');
}
function ajouterDepotCC(){
  const id=document.getElementById('depot-cc-id').value,date=document.getElementById('depot-cc-date').value,montant=parseInt(document.getElementById('depot-cc-montant').value)||0,note=document.getElementById('depot-cc-note').value||'Dépôt';
  if(!date||montant<=0){showToast('⚠ Date et montant obligatoires.');return;}
  const cc=STATE.comptesClients.find(c=>c.id===id);if(!cc)return;
  // Un dépôt est une saisie de comptoir, ouverte à toute l'équipe — mais c'est
  // techniquement un UPDATE du solde, désormais fermé au vendeur. L'opération
  // serveur écrit le mouvement et recale le solde sur son historique.
  depotCompteEpargne(id, montant, date, note)
    .then(function(res){
      if(!res || res.ok===false){ showToast('⛔ '+((res&&res.erreur)||'Dépôt refusé.')); return; }
      return chargerDonnees().then(function(){
        closeModal('modal-depot-cc');
        renderComptesClients(); renderDashboard();
        showToast('✓ Dépôt de '+fmt(montant)+' enregistré. Nouveau solde : '+fmt(res.nouveau_solde));
      });
    })
    .catch(function(e){ showToast('⚠ '+e.message); });
}
function cloturerCC(id){
  const cc=STATE.comptesClients.find(c=>c.id===id);if(!cc)return;
  if(!confirm(`Clôturer le compte de ${cc.client} et créer une vente de ${fmt(cc.solde)} ?`))return;
  if(!isAdmin() && STATE.currentUser?.role!=='gestionnaire'){
    showToast('⛔ Clôture réservée aux responsables.');return;
  }
  const soldeACloturer = cc.solde || 0;

  // Clôturer, c'est convertir le solde en vente. L'argent est entré en caisse
  // au moment des dépôts : la vente ne doit donc rien y ajouter, d'où
  // `montantCompte` égal au montant. L'ancienne version mettait `acompte` au
  // solde sans le signaler, ce qui recomptait la somme une seconde fois.
  prochainsIdsVente()
    .then(function(num){
      return venteSurCompteEpargne({
        id: num.id, compteId: cc.id, date: today(),
        description: 'Clôture compte épargne — solde converti',
        montant: soldeACloturer, montantCompte: soldeACloturer,
        paiement: 'compte', numFacture: num.numFacture
      }).then(function(res){ return { res:res, id:num.id }; });
    })
    .then(function(r){
      if(!r.res || r.res.ok===false){ showToast('⛔ '+((r.res&&r.res.erreur)||'Clôture refusée.')); return; }
      return fetch(SUPABASE_URL+'/rest/v1/comptes_clients?id=eq.'+encodeURIComponent(cc.id),
                   { method:'PATCH', headers:H(), body:JSON.stringify({ actif:false }) })
        .then(function(){ return chargerDonnees(); })
        .then(function(){
          renderComptesClients(); renderJournal(); renderDashboard();
          showToast('Compte clôturé — vente '+r.id+' créée.');
        });
    })
    .catch(function(e){ showToast('⚠ '+e.message); });
}
function supprimerCC(id){
  if(!isAdmin())return;
  if(!confirm('Supprimer ce compte ?'))return;
  fetch(SUPABASE_URL+'/rest/v1/mouvements_cc?compte_id=eq.'+encodeURIComponent(id),{method:'DELETE',headers:_supa.headers})
    .then(function(){return _supa.deleteRow('comptes_clients',id);})
    .then(function(){return reloadComptes();})
    .then(function(){showToast('Compte supprime.');})
    .catch(function(e){showToast('Erreur: '+e.message);});
}

// ============================================
// ARRHES & COMMANDES — basé sur journal de vente
// ============================================
function renderBijouxArr(){
  const q=(document.getElementById('arr-search')?.value||'').toLowerCase();
  const filtre=document.getElementById('arr-filtre')?.value||'en_cours';

  // Source = ventes avec restant > 0 (en cours) + soldées ce mois (soldé récent)
  var data=STATE.ventes.filter(function(v){
    if(v.annulee) return false;
    if(filtre==='en_cours') return (v.restant||0)>0;
    if(filtre==='solde')    return (v.restant||0)===0 && (v.acompte||0)>0 && isMois(v.date);
    // tous = en cours + soldés ce mois
    return (v.restant||0)>0 || ((v.restant||0)===0 && (v.acompte||0)>0 && isMois(v.date));
  });
  if(q) data=data.filter(function(v){ return (v.client||'').toLowerCase().includes(q)||(v.description||'').toLowerCase().includes(q); });
  data.sort(function(a,b){ return b.date.localeCompare(a.date); });

  const nbEnCours=STATE.ventes.filter(function(v){return !v.annulee&&(v.restant||0)>0;}).length;
  document.getElementById('ba-count-label').textContent=nbEnCours+' commande'+(nbEnCours>1?'s':'')+' avec restant dû · '+data.length+' affichée'+(data.length>1?'s':'');

  if(!data.length){
    document.getElementById('ba-list').innerHTML='<div style="padding:32px;text-align:center;color:var(--text-secondary);font-size:13px">Aucune commande avec acompte dans ce filtre</div>';
    return;
  }

  document.getElementById('ba-list').innerHTML=data.map(function(v){
    const restant=v.restant||0;
    const acompte=v.acompte||0;
    const montant=v.montant||0;
    const pct=montant>0?Math.min(100,Math.round(acompte/montant*100)):0;
    const solde=restant===0;
    const caratLabel=v.carat?v.carat.replace(/-local|-importe/gi,'').toUpperCase():'';
    const typeLabel=v.typeBijou||'';
    const poidsTxt=(v.poids||0)>0?`${v.poids}g`:'';

    return`<div style="padding:16px 20px;border-bottom:0.5px solid var(--border-light)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-weight:600;font-size:14px">${v.client||'—'}</span>
            <span class="stock-badge ${solde?'stock-ok':'stock-low'}">${solde?'Soldé':'En cours'}</span>
            <span class="ref-code">${v.numFacture||v.id}</span>
          </div>
          <div style="font-size:13px;color:var(--text-secondary);margin-bottom:2px">${v.description||'—'}</div>
          <div style="font-size:11px;color:var(--text-tertiary);display:flex;gap:10px;flex-wrap:wrap">
            <span>📅 ${fmtDate(v.date)}</span>
            ${caratLabel?`<span>${caratLabel}${poidsTxt?' · '+poidsTxt:''}</span>`:''}
            ${v.paiement?`<span>💳 ${v.paiement}</span>`:''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:16px;font-weight:700">${fmt(montant)}</div>
          <div style="font-size:12px;color:var(--success-text)">Versé : ${fmt(acompte)}</div>
          ${restant>0?`<div style="font-size:13px;font-weight:600;color:var(--warning-text)">Restant : ${fmt(restant)}</div>`:'<div style="font-size:12px;color:var(--success-text)">✓ Soldé</div>'}
        </div>
      </div>
      <div class="bar-track" style="height:6px;margin-bottom:10px"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:11px;color:var(--text-tertiary)">${pct}% versé</span>
        ${!solde&&isAdmin()?`<div style="display:flex;gap:8px">
          <button class="btn small btn-primary" onclick="ouvrirFinalisation('${v.id}')">+ Paiement</button>
          <button class="btn small" style="color:var(--danger-text);border-color:var(--danger-text)" onclick="ouvrirRemboursement('${v.id}')">⟲ Rembourser</button>
        </div>`:''}
        ${!solde&&!isAdmin()?`<button class="btn small btn-primary" onclick="ouvrirFinalisation('${v.id}')">+ Paiement</button>`:''}
      </div>
    </div>`;
  }).join('');
}

function ouvrirFinalisation(venteId){
  const v=STATE.ventes.find(x=>x.id===venteId);if(!v)return;
  document.getElementById('fin-vente-id').value=venteId;
  document.getElementById('fin-info-client').textContent=v.client||'—';
  document.getElementById('fin-info-desc').textContent=v.description||'';
  document.getElementById('fin-info-total').textContent=fmt(v.montant||0);
  document.getElementById('fin-info-acompte').textContent=fmt(v.acompte||0);
  document.getElementById('fin-info-restant').textContent=fmt(v.restant||0);
  document.getElementById('fin-date').value=today();
  document.getElementById('fin-montant').value=v.restant||'';
  document.getElementById('fin-paiement').value='especes';
  openModal('modal-finaliser');
}

function confirmerFinalisation(){
  const venteId=document.getElementById('fin-vente-id').value;
  const montant=parseInt(document.getElementById('fin-montant').value)||0;
  const date=document.getElementById('fin-date').value;
  const paiement=document.getElementById('fin-paiement').value;
  const v=STATE.ventes.find(x=>x.id===venteId);
  if(!v||!date){showToast('⚠ Date obligatoire.');return;}
  if(montant<=0){showToast('⚠ Montant obligatoire.');return;}
  if(montant>(v.restant||0)){showToast(`⚠ Montant supérieur au restant dû (${fmt(v.restant)})`);return;}

  const btn=document.getElementById('btn-finaliser');
  if(btn){ btn.disabled=true; btn.textContent='Enregistrement…'; }

  // Passe par une opération serveur dédiée : encaisser est ouvert à toute
  // l'équipe, alors que modifier une vente (montant, cliente, description)
  // est réservé aux administrateurs. Sans cette séparation, ouvrir l'un
  // reviendrait à ouvrir l'autre — c'est la même ligne en base.
  enregistrerPaiementVente(venteId, montant, date, paiement)
    .then(function(res){
      if(!res || res.ok===false){ showToast('⛔ '+((res&&res.erreur)||'Paiement refusé.')); return; }
      v.acompte = res.acompte;
      v.restant = res.restant;
      if(paiement) v.paiement = paiement;
      save();
      closeModal('modal-finaliser');
      renderBijouxArr(); renderJournal(); renderDashboard();
      showToast(res.solde
        ? `✓ Commande soldée ! Paiement de ${fmt(montant)} encaissé.`
        : `✓ Paiement de ${fmt(montant)} encaissé. Restant : ${fmt(res.restant)}`);
    })
    .catch(function(e){ showToast('⚠ '+e.message); })
    .finally(function(){ if(btn){ btn.disabled=false; btn.textContent="✓ Valider l'encaissement"; } });
}

function ouvrirRemboursement(venteId){
  if(!isAdmin()){showToast('⛔ Admin seulement.');return;}
  const v=STATE.ventes.find(x=>x.id===venteId);if(!v)return;
  document.getElementById('remb-vente-id').value=venteId;
  document.getElementById('remb-info-client').textContent=v.client||'—';
  document.getElementById('remb-info-desc').textContent=v.description||'';
  document.getElementById('remb-info-acompte').textContent=fmt(v.acompte||0);
  document.getElementById('remb-date').value=today();
  document.getElementById('remb-montant').value=v.acompte||0;
  document.getElementById('remb-motif').value='';
  openModal('modal-remboursement');
}

function confirmerRemboursement(){
  const venteId=document.getElementById('remb-vente-id').value;
  const montant=parseInt(document.getElementById('remb-montant').value)||0;
  const date=document.getElementById('remb-date').value;
  const motif=document.getElementById('remb-motif').value.trim()||'Remboursement client';
  const v=STATE.ventes.find(x=>x.id===venteId);
  if(!v||!date){showToast('⚠ Date obligatoire.');return;}
  if(montant<0){showToast('⚠ Montant invalide.');return;}
  if(montant>(v.acompte||0)){
    showToast(`⚠ Impossible de rembourser plus que le versé (${fmt(v.acompte||0)}).`);
    return;
  }

  // L'acompte n'est PAS remis à zéro : cet argent est bien entré en caisse le
  // jour de la vente. Le décaissement le fait ressortir à sa date réelle.
  // Effacer l'acompte ferait baisser la caisse une seconde fois pour le même
  // remboursement, et perdrait la trace de l'encaissement d'origine.
  v.annulee = true;
  v.annuleeLe = new Date().toISOString();
  v.annuleeMotif = motif;
  v.restant = 0;                 // plus rien à réclamer

  (montant > 0
    ? prochainId('d','D',4).then(function(dId){
        return saveDecaissement({
          id:dId, date:date, categorie:'Remboursement client',
          description:`Remb. ${v.client||''} — ${v.description||''}${motif?' ('+motif+')':''}`,
          montant:montant, saisiPar:STATE.currentUser?.nom||'admin',
          origineType:'vente', origineId:v.id
        });
      })
    : Promise.resolve())
    .then(function(){ return saveVente(v); })
    .then(function(){ return chargerDonnees(); })
    .then(function(){
      closeModal('modal-remboursement');
      renderBijouxArr(); renderJournal(); renderDecaissements(); renderDashboard();
      showToast(`✓ Remboursement de ${fmt(montant)} enregistré. Commande annulée.`);
    })
    .catch(function(e){ showToast('⚠ '+e.message); });
}

// ============================================
// ACHATS DEPUIS CLIENTS (rachat bijoux)
// ============================================
function renderAchatsClients(){
  const mois=STATE.achatsClients.filter(a=>isMois(a.date));
  const totalAll =STATE.achatsClients.reduce((s,a)=>s+(a.prixPropose||0),0);
  const totalMois=mois.reduce((s,a)=>s+(a.prixPropose||0),0);
  const poidsAll =STATE.achatsClients.reduce((s,a)=>s+(a.poids||0),0);
  document.getElementById('ac-count-label').textContent=`${STATE.achatsClients.length} reprise${STATE.achatsClients.length>1?'s':''} enregistrée${STATE.achatsClients.length>1?'s':''}`;
  document.getElementById('metric-ac-mois').textContent =fmt(totalMois);
  document.getElementById('metric-ac-total').textContent=fmt(totalAll);
  document.getElementById('metric-ac-poids').textContent=poidsAll.toFixed(2)+' g';

  const triees=[...STATE.achatsClients].sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('achats-clients-body').innerHTML=triees.map(a=>{
    const c=getCarat(a.carat);
    const dot=c?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.couleur};margin-right:4px;vertical-align:middle"></span>`:'';
    const btnSuppr=isAdmin()?`<button class="btn small btn-danger" onclick="supprimerAchatClient('${a.id}')">✕</button>`:'<span class="perm-lock" title="Admin uniquement">🔒</span>';
    return`<tr>
      <td style="white-space:nowrap;font-size:12px;color:var(--text-secondary)">${fmtDate(a.date)}</td>
      <td><div style="display:flex;align-items:center;gap:7px">
        <div style="width:26px;height:26px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${ini(a.client)}</div>
        <span>${a.client}</span>
      </div></td>
      <td style="font-size:12px;color:var(--text-secondary)">${a.description}</td>
      <td style="text-align:center">
        ${a.photo
          ? `<img src="${a.photo}" alt="Photo" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:0.5px solid var(--border-light);cursor:pointer" onclick="agrandirPhotoReprise('${a.id}')" title="Cliquer pour agrandir" />`
          : '<span style="color:var(--text-tertiary);font-size:12px">—</span>'}
      </td>
      <td><span class="carat-pill">${dot}${(a.carat||'—').toUpperCase()}</span></td>
      <td style="text-align:center">${a.poids}g</td>
      <td style="font-weight:500;color:var(--success-text)">${fmt(a.prixPropose)}</td>
      <td>${celluleSortieCaisse(a)}</td>
      <td><span class="role-pill role-${a.saisiPar}">${a.saisiPar}</span></td>
      <td>${btnSuppr}</td>
    </tr>`;
  }).join('');
  rendreReprisesCartes(triees);

  // Bandeau récapitulatif : une reprise sans décaissement est de l'argent sorti
  // du tiroir que la caisse ignore encore.
  const sansSortie = STATE.achatsClients.filter(a=>!decaissementDeLaPiece('reprise',a.id));
  const montantSansSortie = sansSortie.reduce((s,a)=>s+(a.prixPropose||0),0);
  const bandeau = document.getElementById('ac-alerte-caisse');
  if(bandeau){
    if(sansSortie.length && peutVoirCaisse()){
      bandeau.style.display='flex';
      bandeau.innerHTML=`<span>⚠</span><span>${sansSortie.length} reprise${sansSortie.length>1?'s':''} sans décaissement — <strong>${fmt(montantSansSortie)}</strong> payé${sansSortie.length>1?'s':''} aux clientes mais pas encore déduit${sansSortie.length>1?'s':''} de la caisse.</span>`;
    } else {
      bandeau.style.display='none';
    }
  }
}

function rendreReprisesCartes(triees){
  rendreCartes('ac-cartes', triees, function(a){
    const e = etatSortieCaisse(a);
    var actions = [];
    if (a.photo) actions.push({ texte:'🖼 Photo', onclick:"agrandirPhotoReprise('"+escJs(a.id)+"')" });
    // Même règle que le tableau : seul un rôle qui voit la caisse peut
    // rattacher le décaissement, et seul l'administrateur peut supprimer.
    if (!e.masque && !e.dec) actions.push({
      texte:'+ Sortie caisse',
      style:'color:var(--warning-text);border-color:var(--warning-text)',
      onclick:"creerDecaissementReprise('"+escJs(a.id)+"')"
    });
    actions.push(isAdmin()
      ? { texte:'✕', classe:'btn-danger', onclick:"supprimerAchatClient('"+escJs(a.id)+"')" }
      : { texte:'🔒 Admin', inerte:true });
    return {
      ton: e.masque ? 'sortie' : (e.dec ? 'ok' : 'attente'),
      pastille: { texte:ini(a.client) },
      titre: a.client,
      valeur: fmt(a.prixPropose),
      desc: a.description,
      meta: [fmtDate(a.date), a.poids + 'g', a.saisiPar],
      badges: [
        { texte:(a.carat||'—').toUpperCase(), classe:'carat-pill' },
        e.masque ? null
          : e.dec ? { texte:'✓ Sortie '+fmt(e.dec.montant), classe:'stock-badge stock-ok' }
                  : { texte:'Pas de sortie caisse', classe:'stock-badge stock-low' }
      ],
      actions: actions
    };
  }, 'Aucune reprise enregistrée.');
}

/** Décaissement rattaché à une pièce (reprise, achat, vente), s'il existe. */
function decaissementDeLaPiece(type, id){
  return STATE.decaissements.find(function(d){
    return d.origineType===type && d.origineId===id;
  }) || null;
}

/**
 * L'état « sortie de caisse » d'une reprise, sans HTML.
 *
 * Le tableau et la vue en cartes doivent dire exactement la même chose. En
 * décidant ici, il n'y a qu'un endroit à relire — et un seul à corriger.
 *
 * `masque` : un rôle sans accès à la caisse ne lit aucun décaissement, donc
 * il ne faut rien conclure de leur absence. Lui montrer « + Enregistrer »
 * lui ferait croire que la reprise n'a pas été payée.
 */
function etatSortieCaisse(a){
  if(!peutVoirCaisse()) return { masque:true, dec:null };
  return { masque:false, dec:decaissementDeLaPiece('reprise', a.id) };
}

function celluleSortieCaisse(a){
  const e = etatSortieCaisse(a);
  if(e.masque) return '<span style="color:var(--text-tertiary);font-size:12px">—</span>';
  if(e.dec){
    return `<span class="stock-badge stock-ok" title="Décaissement ${esc(e.dec.id)} du ${fmtDate(e.dec.date)}">✓ ${fmt(e.dec.montant)}</span>`;
  }
  return `<button class="btn small" style="color:var(--warning-text);border-color:var(--warning-text)"
            onclick="creerDecaissementReprise('${escJs(a.id)}')"
            title="Cette somme est sortie du tiroir mais n'apparaît pas encore en décaissement">+ Enregistrer</button>`;
}

/**
 * Crée le décaissement correspondant à une reprise.
 *
 * La saisie reste volontairement manuelle — le paiement d'une reprise peut
 * être différé — mais le rattachement évite qu'un oubli passe inaperçu.
 */
function creerDecaissementReprise(repriseId){
  if(!isAdmin()){showToast('⛔ Réservé à l\'administrateur.');return;}
  const a = STATE.achatsClients.find(x=>x.id===repriseId);
  if(!a) return;
  if(decaissementDeLaPiece('reprise', a.id)){showToast('Un décaissement existe déjà pour cette reprise.');return;}

  const montant = a.prixPropose||0;
  if(montant<=0){showToast('⚠ Montant de reprise invalide.');return;}
  if(!confirm(`Enregistrer une sortie de caisse de ${fmt(montant)} pour la reprise de ${a.client} ?`)) return;

  // Numéro attribué par le serveur : le calculer ici à partir du compteur en
  // cache refabriquait un identifiant déjà pris, et l'écriture en upsert
  // écrasait alors le décaissement d'une autre reprise.
  prochainId('d','D',4)
    .then(function(dId){
      const dec={
        id:dId, date:a.date, categorie:'Reprise client',
        description:`Reprise ${a.id} — ${a.client} — ${a.description||''}`,
        montant, saisiPar:STATE.currentUser?.nom||'admin',
        origineType:'reprise', origineId:a.id
      };
      return saveDecaissement(dec).then(function(){ return dId; });
    })
    .then(function(dId){
      // On relit le serveur plutôt que de deviner : c'est lui qui fait foi.
      return chargerDonnees().then(function(){
        renderAchatsClients(); renderDecaissements(); renderDashboard();
        showToast(`✓ Sortie de ${fmt(montant)} enregistrée (${dId}).`);
      });
    })
    .catch(function(e){ showToast('⚠ '+e.message); });
}

function enregistrerAchatClient(){
  var date   = document.getElementById('ac-date').value;
  var client = document.getElementById('ac-client').value;
  var desc   = document.getElementById('ac-description').value.trim();
  var typeBijou = (document.getElementById('ac-type-bijou')&&document.getElementById('ac-type-bijou').value)||'';
  var hasOrAC = TYPES_AVEC_OR_CODES.indexOf(typeBijou)>=0;
  var carat  = hasOrAC?(document.getElementById('ac-carat')&&document.getElementById('ac-carat').value||''):'';
  var poids  = hasOrAC?(parseFloat(document.getElementById('ac-poids')&&document.getElementById('ac-poids').value)||0):(parseFloat(document.getElementById('ac-poids-s')&&document.getElementById('ac-poids-s').value)||0);
  var prov   = hasOrAC?(document.getElementById('ac-provenance')&&document.getElementById('ac-provenance').value||'local'):'';
  var localAC  = (hasOrAC&&prov==='local')?poids:0;
  var importeAC= (hasOrAC&&prov==='importe')?poids:0;
  var prix   = parseInt(document.getElementById('ac-prix').value)||0;
  var note   = document.getElementById('ac-note').value.trim();
  if(!date||!client||!desc||!typeBijou||prix<=0){
    showToast('Tous les champs obligatoires doivent etre remplis.');return;
  }
  const fileEl = document.getElementById('ac-photo');
  const file   = fileEl?.files?.[0];
  if (file) {
    // Lire la photo en base64 puis enregistrer
    const reader = new FileReader();
    reader.onload = function(e) {
      // La fonction est asynchrone depuis que le numéro vient du serveur :
      // sans ce .catch, un échec resterait invisible.
      _sauvegarderReprise(date,client,desc,carat,typeBijou,poids,localAC,importeAC,prix,note,e.target.result)
        .catch(function(err){ showToast('⚠ '+err.message); });
    };
    reader.readAsDataURL(file);
  } else {
    _sauvegarderReprise(date,client,desc,carat,typeBijou,poids,localAC,importeAC,prix,note,null)
      .catch(function(err){ showToast('⚠ '+err.message); });
  }
}

async function _sauvegarderReprise(date,client,desc,carat,typeBijou,poids,localVal,importeVal,prix,note,photo){
  // Numéro attribué par le serveur, comme pour les autres pièces.
  const id = await prochainId('ac','AC',4);
  const reprise={
    id, date, client, description:desc, carat, typeBijou, poids,
    local:localVal||0, importe:importeVal||0,
    prixPropose:prix, note, photo: photo||null,
    saisiPar:STATE.currentUser?.role||'admin'
  };
  STATE.achatsClients.unshift(reprise);

  // ── Alimenter le stock avec l'article repris ──────────────────
  if(poids>0 && typeBijou){
    // Chercher si un article du même type+carat existe déjà
    var prov = localVal>0?'local':(importeVal>0?'importe':'');
    var existing = STATE.stock.find(function(s){
      return s.typeBijou===typeBijou && s.carat===carat && s.provenance===prov;
    });
    if(existing){
      // Ajouter au stock existant
      existing.poidsTotalG=(existing.poidsTotalG||0)+poids;
      saveStockBatch([existing]);
    } else {
      // Créer un nouvel article en stock
      STATE.counters.stk=(STATE.counters.stk||0)+1;
      var newRef='STK-'+String(STATE.counters.stk).padStart(4,'0');
      var newStock={
        ref:newRef, nom:'Reprise — '+desc,
        typeBijou:typeBijou, carat:carat||'', provenance:prov,
        type:prov||typeBijou, poids:poids, poidsTotalG:poids,
        qty:1, prix:prix, seuil:50
      };
      STATE.stock.unshift(newStock);
      saveStock(newStock);
    }
    renderStocks();
  }

  saveReprise(reprise).then(function(){closeModal('modal-add-achat-client');renderDashboard();});
  ['ac-description','ac-note'].forEach(x=>document.getElementById(x).value='');
  document.getElementById('ac-photo').value='';
  document.getElementById('ac-photo-preview').style.display='none';
  renderAchatsClients();renderDashboard();
  showToast('Reprise '+id+' enregistree — '+fmt(prix)+' — Stock mis a jour');
}

function supprimerAchatClient(id){
  if(!isAdmin()){showToast('Admin uniquement.');return;}
  if(!confirm('Supprimer cette reprise ?'))return;
  STATE.achatsClients=STATE.achatsClients.filter(a=>a.id!==id);
  save();
  deleteReprise(id); // App → Supabase → App
}

// ============================================
// EXPORT & RAPPORT
// ============================================
function downloadFile(f,c,t='text/plain'){const b=new Blob(['\uFEFF'+c],{type:t+';charset=utf-8;'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=f;a.click();URL.revokeObjectURL(u);}

function exporterRapport(){
  if (!peutVoirCaisse()) { showToast('⛔ Rapport réservé aux administrateurs.'); return; }
  const now=new Date();
  const _b=boutiqueInfos();
  const caM       =STATE.ventes.filter(v=>isMois(v.date)).reduce((s,v)=>s+(v.montant||0),0);
  const encaisseTotal=STATE.ventes.reduce((s,v)=>s+(v.acompte||0),0);
  const decTotal  =STATE.decaissements.reduce((s,d)=>s+(d.montant||0),0);
  const soldeNet  =encaisseTotal-decTotal;
  const rachatTotal=STATE.achatsClients.reduce((s,a)=>s+(a.prixPropose||0),0);
  const content=`RAPPORT DE GESTION — ${_b.nom.toUpperCase()}
${now.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
${'='.repeat(60)}

JOURNAL DES VENTES
------------------
Ventes totales     : ${STATE.ventes.length}
CA ce mois         : ${fmt(caM)}
Total encaissé     : ${fmt(encaisseTotal)}
Total restants dus : ${fmt(STATE.ventes.reduce((s,v)=>s+(v.restant||0),0))}

CAISSE (Solde net)
------------------
Encaissé total     : ${fmt(encaisseTotal)}
Décaissements      : ${fmt(decTotal)}
SOLDE NET CAISSE   : ${fmt(soldeNet)}

ACHATS DEPUIS CLIENTS
---------------------
Reprises total     : ${STATE.achatsClients.length}
Montant total reprises : ${fmt(rachatTotal)}

STOCKS
------
Références : ${STATE.stock.length} · Ruptures : ${STATE.stock.filter(i=>i.qty===0).length}
Valeur totale : ${fmt(STATE.stock.reduce((s,i)=>s+(i.qty*i.prix),0))}

CLIENTS
-------
Total clients : ${STATE.clients.length}

${'='.repeat(60)}
Généré le ${now.toLocaleString('fr-FR')} par ${STATE.currentUser?.nom||'—'}`;
  downloadFile('rapport_'+_slugFichier()+'_'+today()+'.txt',content);
  showToast('✓ Rapport exporté.');
}


// ============================================
// HISTORIQUE DES CONNEXIONS
// ============================================
function renderHistorique() {
  const q    = (document.getElementById('hist-search')?.value || '').toLowerCase();
  const role = document.getElementById('filtre-hist-role')?.value || '';
  const action = document.getElementById('filtre-hist-action')?.value || '';

  const filtered = STATE.connexions.filter(c => {
    if (q && !c.nom.toLowerCase().includes(q) && !c.login?.toLowerCase().includes(q)) return false;
    if (role && c.role !== role) return false;
    if (action && c.action !== action) return false;
    return true;
  });

  // Métriques
  const connJour = STATE.connexions.filter(c => c.date === today() && c.action === 'connexion').length;
  const sept = new Date(); sept.setDate(sept.getDate() - 7);
  const septStr = sept.toISOString().split('T')[0];
  const usersActifs = new Set(STATE.connexions.filter(c => c.date >= septStr && c.action === 'connexion').map(c => c.userId)).size;
  const lastConn = STATE.connexions.find(c => c.action === 'connexion');

  document.getElementById('hist-count-label').textContent = `${STATE.connexions.length} entrée${STATE.connexions.length > 1 ? 's' : ''} · ${filtered.length} affichée${filtered.length > 1 ? 's' : ''}`;
  document.getElementById('hist-conn-jour').textContent = connJour;
  document.getElementById('hist-users-actifs').textContent = usersActifs;
  document.getElementById('hist-last-conn').textContent = lastConn
    ? `${lastConn.nom.split(' ')[0]} — ${fmtDate(lastConn.date)} ${lastConn.heure}`
    : '—';

  // Bouton vider : admin seulement
  const btnVider = document.getElementById('btn-vider-hist');
  if (btnVider) btnVider.style.display = isAdmin() ? '' : 'none';

  document.getElementById('hist-body').innerHTML = filtered.map(c => {
    const role = ROLES[c.role] || { label: c.role, color: '#888', bg: '#eee' };
    const isConn = c.action === 'connexion';
    return `<tr>
      <td style="white-space:nowrap;font-size:12px;color:var(--text-secondary)">${fmtDate(c.date)}</td>
      <td style="font-size:12px;font-weight:500">${c.heure}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:30px;height:30px;border-radius:50%;background:${role.bg};color:${role.color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${ini(c.nom)}</div>
          <div>
            <div style="font-size:13px;font-weight:500">${c.nom}</div>
          </div>
        </div>
      </td>
      <td><span class="role-pill role-${c.role}">${role.label}</span></td>
      <td>
        <span class="stock-badge ${isConn ? 'stock-ok' : 'stock-low'}" style="display:inline-flex;align-items:center;gap:5px">
          <span style="font-size:10px">${isConn ? '▶' : '◼'}</span>
          ${c.action.charAt(0).toUpperCase() + c.action.slice(1)}
        </span>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:24px;font-size:13px">Aucune entrée trouvée</td></tr>`;

  rendreCartes('hist-cartes', filtered, function (c) {
    const role = ROLES[c.role] || { label: c.role, color: '#888', bg: '#eee' };
    const isConn = c.action === 'connexion';
    return {
      ton: isConn ? 'ok' : 'info',
      pastille: { texte: ini(c.nom), fond: role.bg, couleur: role.color },
      titre: c.nom,
      valeur: c.heure,
      meta: [fmtDate(c.date)],
      badges: [
        { texte: role.label, classe: 'role-pill role-' + c.role },
        { texte: c.action.charAt(0).toUpperCase() + c.action.slice(1),
          classe: 'stock-badge ' + (isConn ? 'stock-ok' : 'stock-low') }
      ]
    };
  }, 'Aucune entrée trouvée.');
}

function exporterHistorique() {
  const header = ['Date', 'Heure', 'Utilisateur', 'Rôle', 'Action'];
  const rows = STATE.connexions.map(c => [fmtDate(c.date), c.heure, c.nom, ROLES[c.role]?.label || c.role, c.action]);
  const csv = [header, ...rows].map(r => r.map(x => `"${x}"`).join(',')).join('\n');
  downloadFile('historique_connexions_' + _slugFichier() + '_' + today() + '.csv', csv, 'text/csv');
  showToast('✓ Historique exporté.');
}

function viderHistorique() {
  if (!isAdmin()) { showToast('⛔ Action réservée à l\'administrateur.'); return; }
  if (!confirm('Vider tout l\'historique des connexions ? Cette action est irréversible.')) return;
  STATE.connexions = [];
  const lastCn = STATE.connexions[0];
  if(lastCn) saveConnexion({
    id:lastCn.id, userId:lastCn.userId||lastCn.user,
    nom:lastCn.nom, role:lastCn.role,
    date:lastCn.date, heure:lastCn.heure, action:lastCn.action
  });
  save();
  renderHistorique();
  showToast('Historique vidé.');
}

// Filtres historique
['hist-search', 'filtre-hist-role', 'filtre-hist-action'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', renderHistorique);
});

// ============================================
// INIT
// ============================================
(function(){
  // Application prête — attente de connexion
})();

// ============================================
// MINI CLIENT RAPIDE (depuis modals)
// ============================================
function ouvrirMiniClient(targetSelectId) {
  document.getElementById('mini-client-target').value = targetSelectId;
  document.getElementById('mini-c-nom').value     = '';
  document.getElementById('mini-c-tel').value     = '';
  document.getElementById('mini-c-adresse').value = '';
  document.getElementById('modal-mini-client').classList.add('show');
  setTimeout(() => document.getElementById('mini-c-nom').focus(), 100);
}

function closeMiniClient() {
  document.getElementById('modal-mini-client').classList.remove('show');
}

function enregistrerMiniClient() {
  const nom     = document.getElementById('mini-c-nom').value.trim();
  const tel     = document.getElementById('mini-c-tel').value.trim();
  const adresse = document.getElementById('mini-c-adresse').value.trim();
  const targetId= document.getElementById('mini-client-target').value;

  if (!nom || !tel) { showToast('⚠ Nom et téléphone obligatoires.'); return; }
  if (STATE.clients.find(c => c.tel === tel)) { showToast('⚠ Ce numéro existe déjà.'); return; }

  STATE.counters.cl = (STATE.counters.cl || 9) + 1;
  const newClient = {
    id: 'CL-' + String(STATE.counters.cl).padStart(3,'0'),
    nom, tel, email: '', adresse
  };
  STATE.clients.unshift(newClient);
  save();
  saveClient(newClient); // App→Supabase→App
  ['v-client','edit-v-client','cc-client','ac-client'].forEach(selId => {
    // Picker style
    const searchEl = document.getElementById(selId+'-search');
    const hiddenEl = document.getElementById(selId);
    if (searchEl && hiddenEl) {
      if (selId === targetId) { selectionnerClientPicker(selId, nom); }
      return;
    }
    // Fallback select classique
    const sel = document.getElementById(selId); if(!sel)return;
    const opt = document.createElement('option');
    opt.value=nom; opt.textContent=nom;
    sel.insertBefore(opt, sel.options[1]||null);
    if (selId===targetId) sel.value=nom;
  });

  closeMiniClient();
  showToast(`✓ Client "${nom}" créé et sélectionné.`);
}


// ============================================
// PHOTO REPRISE BIJOU
// ============================================
function previewReprise(input) {
  const file = input.files[0];
  const preview = document.getElementById('ac-photo-preview');
  const img     = document.getElementById('ac-photo-img');
  if (!file) { preview.style.display='none'; return; }
  const reader  = new FileReader();
  reader.onload = e => { img.src = e.target.result; preview.style.display='block'; };
  reader.readAsDataURL(file);
}

function supprimerPhotoReprise() {
  document.getElementById('ac-photo').value = '';
  document.getElementById('ac-photo-preview').style.display = 'none';
  document.getElementById('ac-photo-img').src = '';
}

function agrandirPhotoReprise(id) {
  const a = STATE.achatsClients.find(x=>x.id===id);
  if (!a?.photo) return;
  // Ouvrir dans une nouvelle fenêtre
  const win = window.open('','_blank','width=700,height=600');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Photo reprise ${a.id}</title>
  <style>body{margin:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:12px}
  img{max-width:95vw;max-height:90vh;object-fit:contain;border-radius:8px}
  p{color:#fff;font-family:sans-serif;font-size:13px;opacity:0.7}</style></head>
  <body><img src="${a.photo}" alt="Photo reprise" /><p>${a.client} — ${a.description} — ${fmtDate(a.date)}</p></body></html>`);
  win.document.close();
}


function ouvrirAjustCC(id){
  var cc=STATE.comptesClients.find(function(c){return c.id===id;});if(!cc)return;
  document.getElementById('ajust-cc-id').value=id;
  document.getElementById('ajust-cc-montant').value='';
  document.getElementById('ajust-cc-restant').value='';
  document.getElementById('ajust-cc-desc').value='';
  peuplerSelect('ajust-cc-carat');
  document.getElementById('ajust-cc-info').innerHTML='<div style="display:flex;justify-content:space-between"><div><strong>'+cc.client+'</strong><br><small>Ouvert le '+fmtDate(cc.dateOuverture)+'</small></div><div style="text-align:right"><div style="font-size:20px;font-weight:700;color:var(--success-text)">'+fmt(cc.solde)+'</div><small>solde disponible</small></div></div>';
  document.getElementById('modal-ajust-cc').classList.add('show');
}
function previewAjustCC(){
  var id=document.getElementById('ajust-cc-id').value;
  var cc=STATE.comptesClients.find(function(c){return c.id===id;});if(!cc)return;
  var montant=parseInt(document.getElementById('ajust-cc-montant').value)||0;
  var restant=cc.solde-montant;
  document.getElementById('ajust-cc-restant').value=montant>0?(restant<0?'Depassement':fmt(restant)):'';
}
function validerAjustCC(){
  var id=document.getElementById('ajust-cc-id').value;
  var cc=STATE.comptesClients.find(function(c){return c.id===id;});if(!cc)return;
  var montant=parseInt(document.getElementById('ajust-cc-montant').value)||0;
  var desc=document.getElementById('ajust-cc-desc').value.trim();
  var carat=document.getElementById('ajust-cc-carat')&&document.getElementById('ajust-cc-carat').value||'';
  if(montant<=0){showToast('Montant obligatoire.');return;}
  if(!desc){showToast('Description obligatoire.');return;}
  if(montant>cc.solde){showToast('Solde insuffisant ('+fmt(cc.solde)+' disponible).');return;}
  // Vente + retrait en une seule transaction serveur, numéros attribués par
  // PostgreSQL : les enchaîner ici laissait passer le retrait quand la vente
  // échouait, et le compteur local pouvait refabriquer un numéro déjà pris.
  prochainsIdsVente()
    .then(function(num){
      return venteSurCompteEpargne({
        id: num.id, compteId: cc.id, date: today(), description: desc,
        montant: montant, montantCompte: montant,
        paiement: 'compte', carat: carat, numFacture: num.numFacture
      }).then(function(res){ return { res:res, id:num.id }; });
    })
    .then(function(r){
      if(!r.res || r.res.ok===false){ showToast('⛔ '+((r.res&&r.res.erreur)||'Opération refusée.')); return; }
      return chargerDonnees().then(function(){
        closeModal('modal-ajust-cc');
        renderComptesClients(); renderJournal(); renderDashboard();
        showToast('Vente '+r.id+' créée — '+fmt(montant)+' déduit du compte de '+cc.client);
      });
    })
    .catch(function(e){ showToast('⚠ '+e.message); });
}
function imprimerCompteClient(id){
  var cc=STATE.comptesClients.find(function(c){return c.id===id;});if(!cc)return;
  var ventesCC=STATE.ventes.filter(function(v){return v.client===cc.client&&v.compteClientId===cc.id;});
  var totalDepots=cc.mouvements.filter(function(m){return m.type!=='retrait';}).reduce(function(s,m){return s+m.montant;},0);
  var totalRetraits=cc.mouvements.filter(function(m){return m.type==='retrait';}).reduce(function(s,m){return s+m.montant;},0);
  var now=new Date();
  var _b=boutiqueInfos(), _contact=boutiqueLigneContact();
  var win=window.open('','_blank','width=750,height=900');
  win.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Compte - '+cc.client+'</title>'
    +'<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;font-size:13px;color:#111;padding:30px;max-width:700px;margin:0 auto}'
    +'h1{font-size:18px;margin-bottom:4px}h2{font-size:13px;font-weight:600;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px}'
    +'.header{display:flex;justify-content:space-between;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #111}'
    +'.solde{font-size:22px;font-weight:700;color:#3b6d11}'
    +'table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px}'
    +'th{text-align:left;padding:6px 8px;background:#f5f5f5;font-size:10px;text-transform:uppercase}'
    +'td{padding:6px 8px;border-bottom:1px solid #eee}'
    +'.credit{color:#3b6d11}.debit{color:#a32d2d}'
    +'</style></head><body>'
    +'<div class="header"><div><div style="font-size:18px;font-weight:700">'+esc(_b.nom)+'</div><div style="font-size:11px;color:#888">'+esc(_contact)+'</div></div>'
    +'<div style="text-align:right"><div style="font-size:15px;font-weight:700">RELEVE DE COMPTE EPARGNE</div><div style="font-size:11px;color:#888">'+now.toLocaleDateString('fr-FR')+'</div></div></div>'
    +'<div style="background:#f7f6f3;border-radius:8px;padding:14px;margin-bottom:16px;display:flex;justify-content:space-between">'
    +'<div><div style="font-size:16px;font-weight:700">'+cc.client+'</div><div style="font-size:12px;color:#666">Compte ouvert le '+fmtDate(cc.dateOuverture)+'</div></div>'
    +'<div style="text-align:right"><div class="solde">'+fmt(cc.solde)+'</div><div style="font-size:11px;color:#888">Solde disponible</div></div></div>'
    +'<h2>Historique des mouvements</h2>'
    +'<table><thead><tr><th>Date</th><th>Operation</th><th>Credit</th><th>Debit</th></tr></thead><tbody>'
    +cc.mouvements.map(function(m){return '<tr><td>'+fmtDate(m.date)+'</td><td>'+m.note+'</td><td class="credit">'+(m.type!=='retrait'?fmt(m.montant):'')+'</td><td class="debit">'+(m.type==='retrait'?fmt(m.montant):'')+'</td></tr>';}).join('')
    +'<tr style="font-weight:600;border-top:2px solid #111"><td colspan="2">SOLDE</td><td class="credit">'+fmt(totalDepots)+'</td><td class="debit">'+fmt(totalRetraits)+'</td></tr>'
    +'</tbody></table>'
    +(ventesCC.length?'<h2>Ventes associees</h2><table><thead><tr><th>Date</th><th>Description</th><th>Montant</th></tr></thead><tbody>'+ventesCC.map(function(v){return '<tr><td>'+fmtDate(v.date)+'</td><td>'+v.description+'</td><td class="debit">'+fmt(v.montant)+'</td></tr>';}).join('')+'</tbody></table>':'')
    +'<div style="margin-top:24px;padding-top:12px;border-top:1px dashed #ccc;font-size:11px;color:#888;text-align:center">'+esc(_b.nom)+(_contact?' - '+esc(_contact):'')+' - '+now.toLocaleString('fr-FR')+'</div>'
    +'</body></html>');
  win.document.close();
  setTimeout(function(){win.focus();win.print();},500);
}

function onChangePaiementVente(){
  var paiement=document.getElementById('v-paiement')&&document.getElementById('v-paiement').value;
  var bloc=document.getElementById('v-compte-bloc');
  if(!bloc)return;
  if(paiement!=='compte'){bloc.style.display='none';return;}
  var clientNom=document.getElementById('v-client')&&document.getElementById('v-client').value;
  if(!clientNom){bloc.style.display='none';showToast('Selectionnez d\'abord un client.');document.getElementById('v-paiement').value='especes';return;}
  var cc=STATE.comptesClients.find(function(c){return c.client===clientNom&&c.actif!==false;});
  if(!cc){bloc.style.display='none';showToast(clientNom+' n\'a pas de compte epargne actif.');document.getElementById('v-paiement').value='especes';return;}
  document.getElementById('v-compte-nom').textContent=cc.client+' — '+cc.id;
  document.getElementById('v-compte-solde').textContent=fmt(cc.solde);
  bloc.style.display='block';
}


// ============================================
// LOGIQUE TYPE BIJOU / PROVENANCE / CARAT
// ============================================
var TYPES_AVEC_OR_CODES = ['or','raika','extra','argent-or'];
// Raika et Extra sont TOUJOURS importé 18 carats
var TYPES_FORCE_IMPORTE_18K = ['raika','extra'];

function _getFieldIds(prefix) {
  // Retourne les IDs des champs selon le prefix
  var m = {
    'v':      { type:'v-type-bijou',      carat:'v-carat',      local:'v-local',      importe:'v-importe',      badge:null,                poids:'v-poids-vente',   prov:'v-provenance',      simple:null               },
    'edit-v': { type:'edit-v-type-bijou', carat:'edit-v-carat', local:'edit-v-local', importe:'edit-v-importe', badge:'edit-v-carat-badge', poids:'edit-v-poids-or', prov:'edit-v-provenance', simple:null               },
    'ac':     { type:'ac-type-bijou',     carat:'ac-carat',     local:'ac-local',     importe:'ac-importe',     badge:'ac-carat-badge',     poids:'ac-poids',        prov:'ac-provenance',     simple:'ac-poids-simple'  },
    'p':      { type:'p-type-bijou',      carat:'p-carat',      local:null,           importe:null,             badge:'p-carat-badge',      poids:'p-poids',         prov:'p-provenance',      simple:'p-poids-simple'   },
  };
  return m[prefix] || m['v'];
}

function onChangeTypeBijou(prefix) {
  var ids = _getFieldIds(prefix);
  var typeEl = document.getElementById(ids.type);
  var type = typeEl && typeEl.value || '';
  var hasOr = TYPES_AVEC_OR_CODES.indexOf(type) >= 0;

  var orFields = document.getElementById(prefix + '-or-fields');
  if (orFields) orFields.style.display = hasOr ? 'block' : 'none';

  var simpleField = ids.simple && document.getElementById(ids.simple);
  if (simpleField) simpleField.style.display = (!hasOr && type) ? 'block' : 'none';
  // Reset poids-simple quand type change
  if (hasOr && ids.simple) {
    var spInput = document.getElementById(prefix+'-poids-simple-input');
    if (spInput) spInput.value = '';
  }

  if (!hasOr) {
    var poidsEl = document.getElementById(ids.poids);
    var caratEl = document.getElementById(ids.carat);
    var badgeEl = document.getElementById(ids.badge);
    var localEl = ids.local && document.getElementById(ids.local);
    var importEl= ids.importe && document.getElementById(ids.importe);
    if (poidsEl) poidsEl.value = '';
    if (caratEl) caratEl.value = '';
    if (badgeEl) badgeEl.style.display = 'none';
    if (localEl) localEl.value = '0';
    if (importEl) importEl.value = '0';
    // Mettre à jour p-type pour le stock
    if (prefix === 'p') {
      var ptEl = document.getElementById('p-type');
      if (ptEl) ptEl.value = type || 'autre';
    }
  } else {
    onChangeProvenance(prefix);
    // Raika et Extra : forcer importé 18k
    if (TYPES_FORCE_IMPORTE_18K.indexOf(type) >= 0) {
      var provEl = document.getElementById(ids.prov);
      if (provEl) { provEl.value = 'importe'; provEl.disabled = true; }
      onChangeProvenance(prefix);
      setTimeout(function() {
        var caratEl = document.getElementById(ids.carat);
        if (caratEl) { caratEl.value = '18k-importe'; afficherInfoCarat(ids.carat, ids.badge); }
      }, 50);
    } else {
      var provEl2 = document.getElementById(ids.prov);
      if (provEl2) provEl2.disabled = false;
    }
  }
}

function onChangeProvenance(prefix) {
  var ids = _getFieldIds(prefix);
  var prov = document.getElementById(ids.prov) && document.getElementById(ids.prov).value || 'local';
  var poids = parseFloat(document.getElementById(ids.poids) && document.getElementById(ids.poids).value) || 0;
  var filtre = prov === 'local' ? 'local' : 'importe';
  var sel = document.getElementById(ids.carat); if (!sel) return;
  var curVal = sel.value;
  sel.innerHTML = '<option value="">— Choisir —</option>';
  CARATS_LIST.filter(function(c){ return c.origine === filtre; }).forEach(function(c) {
    var o = document.createElement('option');
    o.value = c.code; o.textContent = c.label;
    if (c.code === curVal) o.selected = true;
    sel.appendChild(o);
  });
  if (ids.local) { var lEl=document.getElementById(ids.local); if(lEl) lEl.value = prov==='local'?poids:0; }
  if (ids.importe){ var iEl=document.getElementById(ids.importe); if(iEl) iEl.value = prov==='importe'?poids:0; }
  // Mettre à jour p-type pour le stock
  if (prefix === 'p') {
    var ptEl = document.getElementById('p-type');
    if (ptEl) ptEl.value = prov;
  }
}

function syncPoidsOr(prefix) {
  var ids = _getFieldIds(prefix);
  var prov = document.getElementById(ids.prov) && document.getElementById(ids.prov).value || 'local';
  var poids = parseFloat(document.getElementById(ids.poids) && document.getElementById(ids.poids).value) || 0;
  if (ids.local)  { var lEl=document.getElementById(ids.local);  if(lEl) lEl.value = prov==='local'?poids:0; }
  if (ids.importe){ var iEl=document.getElementById(ids.importe);if(iEl) iEl.value = prov==='importe'?poids:0; }
}


// ============================================
// COMPLEMENT COMPTE ÉPARGNE INSUFFISANT
// ============================================
function ouvrirComplementCC(cc, montantVente, date, desc, carat, typeBijou) {
  var manque = montantVente - cc.solde;
  document.getElementById('complement-cc-id').value      = cc.id;
  document.getElementById('complement-cc-montant').value = montantVente;
  document.getElementById('complement-cc-date').value    = date;
  document.getElementById('complement-cc-desc').value    = desc;
  document.getElementById('complement-cc-carat').value   = carat;
  document.getElementById('complement-cc-type').value    = typeBijou;
  document.getElementById('complement-cc-manque').textContent = fmt(manque);
  document.getElementById('complement-cc-solde').textContent  = fmt(cc.solde);
  document.getElementById('complement-cc-total').textContent  = fmt(montantVente);
  document.getElementById('complement-cc-client').textContent = cc.client;
  document.getElementById('complement-cc-montant-comp').value = manque;
  // Peupler modes de paiement complément
  document.getElementById('complement-cc-paiement').value = 'especes';
  majResteComplementCC();
  document.getElementById('modal-complement-cc').classList.add('show');
}

/**
 * Dit ce qui restera dû si la cliente ne complète pas tout.
 *
 * Avant, le complément devait couvrir la totalité : impossible de régler une
 * partie avec l'épargne, de verser un peu, et de laisser le bijou en commande.
 * C'est pourtant le cas courant — et la vente partait enregistrée comme
 * soldée, ce qui gonflait la caisse du reste jamais versé.
 */
function majResteComplementCC() {
  var total   = parseInt(document.getElementById('complement-cc-montant').value) || 0;
  var cc      = STATE.comptesClients.find(function (c) {
                  return c.id === document.getElementById('complement-cc-id').value; });
  var solde   = cc ? soldeDepuisMouvements(cc) : 0;
  var verse   = parseInt(document.getElementById('complement-cc-montant-comp').value) || 0;
  var reste   = total - solde - verse;
  var el      = document.getElementById('complement-cc-reste');
  var btn     = document.getElementById('btn-complement-cc');
  if (!el) return;

  if (verse < 0 || reste < 0) {
    el.style.background = 'var(--danger-bg)'; el.style.color = 'var(--danger-text)';
    el.textContent = 'Le total versé dépasse le prix du bijou.';
    if (btn) btn.disabled = true;
    return;
  }
  if (btn) btn.disabled = false;

  if (reste === 0) {
    el.style.background = 'var(--success-bg)'; el.style.color = 'var(--success-text)';
    el.textContent = '✓ Vente entièrement réglée.';
  } else {
    el.style.background = 'var(--warning-bg)'; el.style.color = 'var(--warning-text)';
    el.innerHTML = 'Restera dû : <strong>' + fmt(reste) + '</strong>'
                 + ' — la vente ira dans « Arrhes & Commandes ».';
  }
}

function validerComplementCC() {
  var ccId        = document.getElementById('complement-cc-id').value;
  var montant     = parseInt(document.getElementById('complement-cc-montant').value)||0;
  var date        = document.getElementById('complement-cc-date').value;
  var desc        = document.getElementById('complement-cc-desc').value;
  var carat       = document.getElementById('complement-cc-carat').value;
  var typeBijou   = document.getElementById('complement-cc-type').value;
  var montantComp = parseInt(document.getElementById('complement-cc-montant-comp').value)||0;
  var paiementComp= document.getElementById('complement-cc-paiement').value;
  var cc = STATE.comptesClients.find(function(c){ return c.id===ccId; });
  if(!cc) return;
  // Le complément peut être partiel : le reste devient un restant dû et la
  // vente rejoint « Arrhes & Commandes ». Seul le trop-perçu est refusé.
  if(montantComp < 0){ showToast('⚠ Montant invalide.'); return; }
  var soldeUtilise = soldeDepuisMouvements(cc);   // part venant du compte : hors caisse
  if(soldeUtilise + montantComp > montant){
    showToast('⚠ Le total versé dépasse le prix du bijou.'); return;
  }
  var resteDu = montant - soldeUtilise - montantComp;
  var id;

  // Une seule transaction serveur : la vente et le retrait aboutissent
  // ensemble, ou aucun des deux. L'ancienne version les lançait en parallèle
  // sans intercepter l'échec — le retrait passait, la vente non.
  prochainsIdsVente()
  .then(function(num){
    id = num.id;
    return venteSurCompteEpargne({
      id: id, compteId: cc.id, date: date, description: desc,
      montant: montant, montantCompte: soldeUtilise, espece: montantComp,
      paiement: 'compte+'+paiementComp, carat: carat, typeBijou: typeBijou,
      numFacture: num.numFacture,
      noteComplement: 'Compte: '+fmt(soldeUtilise)+' + '+paiementComp+': '+fmt(montantComp)
                    + (resteDu > 0 ? ' — restant dû : '+fmt(resteDu) : '')
    });
  })
  .then(function(res){
    if(!res || res.ok===false){ showToast('⛔ '+((res&&res.erreur)||'Vente refusée.')); return; }
    // On relit depuis le serveur plutôt que de reconstituer l'état à la main.
    return chargerDonnees().then(function(){
      closeModal('modal-complement-cc'); closeModal('modal-nouvelle-vente');
      renderJournal(); renderBijouxArr(); renderComptesClients(); renderDashboard();
      showToast(res.restant > 0
        ? 'Vente '+id+' — reste '+fmt(res.restant)+' dû. Suivi dans Arrhes & Commandes.'
        : 'Vente '+id+' — Compte : '+fmt(soldeUtilise)+' + '+paiementComp+' : '+fmt(montantComp));
    });
  })
  .catch(function(e){ showToast('⚠ '+e.message); });
}



// ============================================
// LIAISON STOCK → VENTE / SORTIE / ARRHES
// ============================================
function peuplerStockSelect(selId, filtreDispoMin) {
  var sel = document.getElementById(selId); if(!sel) return;
  var curVal = sel.value;
  sel.innerHTML = '<option value="">— Choisir un article en stock —</option>';
  var minPoids = filtreDispoMin || 0;
  STATE.stock
    .filter(function(s){ return (s.poidsTotalG||0) > minPoids; })
    .sort(function(a,b){ return (a.nom||'').localeCompare(b.nom||''); })
    .forEach(function(s) {
      var o = document.createElement('option');
      o.value = s.ref;
      var typeLbl = TYPES_BIJOUX.find(function(t){return t.code===s.typeBijou;});
      var label = s.nom
        + ' — ' + (typeLbl?typeLbl.label:(s.typeBijou||''))
        + (s.carat?' '+s.carat.toUpperCase():'')
        + ' — ' + (s.poidsTotalG||0).toFixed(2)+'g'
        + ' / ' + (s.qty||0)+' art.';
      o.textContent = label;
      if(s.ref === curVal) o.selected = true;
      sel.appendChild(o);
    });
}

function getStockItem(ref) {
  return STATE.stock.find(function(s){ return s.ref === ref; });
}

function afficherInfoStock(stockItem, labelId, dispoId, infoId, poidsDispoId, qtyDispoId) {
  var info = document.getElementById(infoId);
  if (!stockItem || !info) { if(info) info.style.display='none'; return; }
  var typeLbl = TYPES_BIJOUX.find(function(t){return t.code===stockItem.typeBijou;});
  var label = stockItem.nom
    + (typeLbl?' — '+typeLbl.label:'')
    + (stockItem.carat?' — '+stockItem.carat.toUpperCase():'')
    + (stockItem.provenance?' ('+stockItem.provenance+')':'');
  if(document.getElementById(labelId)) document.getElementById(labelId).textContent = label;
  // Champ dispo générique (pour ba-stock-dispo)
  if(dispoId && document.getElementById(dispoId)) {
    document.getElementById(dispoId).textContent = (stockItem.poidsTotalG||0).toFixed(2)+'g disponible';
    document.getElementById(dispoId).style.color = (stockItem.poidsTotalG||0) > 0 ? 'var(--success-text)' : 'var(--danger-text)';
  }
  // Poids dispo
  if(poidsDispoId && document.getElementById(poidsDispoId)) {
    var pds = (stockItem.poidsTotalG||0).toFixed(2)+'g';
    document.getElementById(poidsDispoId).textContent = pds;
    document.getElementById(poidsDispoId).style.color = (stockItem.poidsTotalG||0)>0?'var(--success-text)':'var(--danger-text)';
  }
  // Qty dispo
  if(qtyDispoId && document.getElementById(qtyDispoId)) {
    document.getElementById(qtyDispoId).textContent = (stockItem.qty||0)+' article'+(stockItem.qty>1?'s':'');
    document.getElementById(qtyDispoId).style.color = (stockItem.qty||0)>0?'var(--success-text)':'var(--danger-text)';
  }
  info.style.display = 'block';
}

// Sélection article pour VENTE
function onSelectStockVente(prefix) {
  var ref = document.getElementById('v-stock-ref') && document.getElementById('v-stock-ref').value;
  var s = getStockItem(ref);
  afficherInfoStock(s, 'v-stock-label', 'v-stock-dispo', 'v-stock-info', 'v-stock-poids-dispo', 'v-stock-qty-dispo');
  if (s) {
    // Remplir les champs cachés
    document.getElementById('v-type-bijou').value  = s.typeBijou || '';
    document.getElementById('v-carat').value       = s.carat || '';
    document.getElementById('v-provenance').value  = s.provenance || '';
    document.getElementById('v-local').value       = s.provenance==='local'?(s.poidsTotalG||0):0;
    document.getElementById('v-importe').value     = s.provenance==='importe'?(s.poidsTotalG||0):0;
    // Pré-remplir description si vide
    var desc = document.getElementById('v-description');
    if (desc && !desc.value) desc.value = s.nom;
  }
}

// Sélection article pour SORTIE
function onSelectStockSortie() {
  var ref = document.getElementById('s-stock-ref') && document.getElementById('s-stock-ref').value;
  var s = getStockItem(ref);
  afficherInfoStock(s, 's-stock-label', null, 's-stock-info', 's-stock-poids', 's-stock-qty');
  document.getElementById('s-type-bijou').value  = s ? (s.typeBijou||'') : '';
  document.getElementById('s-carat').value       = s ? (s.carat||'') : '';
  document.getElementById('s-provenance').value  = s ? (s.provenance||'') : '';
  document.getElementById('s-poids').value       = '';
}

function checkPoidsVente() {
  var ref = document.getElementById('v-stock-ref') && document.getElementById('v-stock-ref').value;
  var s = getStockItem(ref);
  var poids = parseFloat(document.getElementById('v-poids-vente') && document.getElementById('v-poids-vente').value) || 0;
  var dispoEl = document.getElementById('v-stock-dispo');
  if (s && dispoEl) {
    var ok = poids <= (s.poidsTotalG||0);
    dispoEl.style.color = ok ? 'var(--success-text)' : 'var(--danger-text)';
  }
}


// ============================================
// ACTUALISATION GLOBALE DEPUIS SUPABASE
// ============================================
var _refreshTimer = null;

async function refreshAll(silent) {
  if(!silent) showToast('Actualisation en cours...');
  try {
    await chargerDonnees();
    // Re-render la section active
    var activeBtn = document.querySelector('.nav-item.active');
    var section = activeBtn ? activeBtn.dataset.section : 'dashboard';
    renderSection(section);
    renderDashboard();
    if(!silent) showToast('Données actualisées');
  } catch(e) {
    if(!silent) showToast('Erreur actualisation: ' + e.message);
  }
}

// Auto-actualisation toutes les 60 secondes
function startAutoRefresh() {
  if(_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(function(){
    refreshAll(true); // silencieux
  }, 60000);
}

function stopAutoRefresh() {
  if(_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer=null; }
}


// ============================================
// DÉDUCTION/RESTITUTION STOCK CENTRALE
// ============================================
async function deduireStock(stockRef, poids, nbArticles) {
  var s = getStockItem(stockRef);
  if (!s) return true;

  // Vérifier disponibilité
  if (poids > 0 && poids > (s.poidsTotalG||0)) {
    showToast('Poids insuffisant (dispo: '+(s.poidsTotalG||0).toFixed(2)+'g)');
    return false;
  }
  if (nbArticles > 0 && nbArticles > (s.qty||0)) {
    showToast('Articles insuffisants (dispo: '+(s.qty||0)+')');
    return false;
  }

  // Déduire poids
  if (poids > 0) s.poidsTotalG = Math.max(0, (s.poidsTotalG||0) - poids);

  // Déduire qty
  if (nbArticles > 0) s.qty = Math.max(0, (s.qty||0) - nbArticles);

  // Recalc croisé si poids unitaire connu
  if (poids > 0 && nbArticles <= 0 && (s.poids||0) > 0)
    s.qty = Math.max(0, Math.floor(s.poidsTotalG / s.poids));
  if (nbArticles > 0 && poids <= 0 && (s.poids||0) > 0)
    s.poidsTotalG = Math.max(0, s.qty * s.poids);

  await saveAndSyncStock([s]);
  return true;
}

async function restituerStock(stockRef, poids, nbArticles) {
  var s = getStockItem(stockRef);
  if (!s) return;
  if (poids > 0)      s.poidsTotalG = (s.poidsTotalG||0) + poids;
  if (nbArticles > 0) s.qty         = (s.qty||0) + nbArticles;
  await saveAndSyncStock([s]);
}


// ============================================
// DRAWER MOBILE
// ============================================
function toggleDrawer() {
  const sidebar  = document.querySelector('.sidebar');
  const overlay  = document.getElementById('drawer-overlay');
  const isOpen   = sidebar.classList.contains('open');
  if (isOpen) { closeDrawer(); } else {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeDrawer() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('drawer-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

// Fermer le drawer à chaque clic de nav sur mobile
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if (window.innerWidth < 900) closeDrawer();
  });
});

// Fermer le drawer au resize vers desktop
window.addEventListener('resize', () => {
  if (window.innerWidth >= 900) closeDrawer();
});

// ============================================
// GESTION COMPTES UTILISATEURS (admin)
// ============================================
// Les comptes vivent désormais dans auth.users ; `membres` les rattache à la
// boutique avec un rôle. L'application ne manipule donc plus de mots de passe :
// on invite une adresse email, la personne choisit son mot de passe elle-même.

async function renderGestionComptes() {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}

  const corps  = document.getElementById('users-body');
  const cartes = document.getElementById('users-cartes');
  corps.innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:13px">Chargement…</td></tr>';
  // La vue mobile aussi, sinon elle garde la liste précédente pendant le
  // chargement — et la garderait indéfiniment si la requête échoue.
  if (cartes) cartes.innerHTML = '<div class="cl-vide">Chargement…</div>';

  let membres = [], invitations = [];
  try {
    [membres, invitations] = await Promise.all([ chargerMembres(), chargerInvitations() ]);
  } catch (e) {
    corps.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--danger-text);font-size:13px">${esc(e.message)}</td></tr>`;
    if (cartes) cartes.innerHTML = `<div class="cl-vide" style="color:var(--danger-text)">${esc(e.message)}</div>`;
    return;
  }

  var btnCreer = document.getElementById('btn-creer-compte');
  if (btnCreer) btnCreer.style.display = estProprietaire() ? '' : 'none';

  document.getElementById('gc-count-label').textContent =
    `${membres.length} membre${membres.length>1?'s':''}` +
    (invitations.length ? ` · ${invitations.length} invitation${invitations.length>1?'s':''} en attente` : '');

  const moi = STATE.currentUser?.id;

  const lignesMembres = membres.map(m => {
    const role   = ROLES[m.role] || { label:m.role, color:'#888', bg:'#eee' };
    const estMoi = m.user_id === moi;
    // Identifiant court pour les comptes d'équipe, numéro pour les comptes
    // WhatsApp, adresse réelle pour les comptes historiques.
    const email  = loginCourt(m) || (m.telephone ? '+' + m.telephone : '—');
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;border-radius:50%;background:${role.bg};color:${role.color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${esc(ini(m.nom))}</div>
        <div><div style="font-size:13px;font-weight:500">${esc(m.nom)}</div>${estMoi?'<span style="font-size:10px;color:var(--success-text);font-weight:500">Vous</span>':''}</div>
      </div></td>
      <td><span class="ref-code">${esc(email)}</span></td>
      <td><span class="role-pill role-${esc(m.role)}">${esc(role.label)}</span></td>
      <td><span class="stock-badge ${m.actif?'stock-ok':'stock-out'}">${m.actif?'Actif':'Suspendu'}</span></td>
      <td style="font-size:12px;color:var(--text-secondary)">${esc((m.created_at||'').slice(0,10)||'—')}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">
        ${estMoi ? '<span style="font-size:11px;color:var(--text-tertiary)">—</span>' : `
          <button class="btn small" onclick="ouvrirEditMembre('${escJs(m.user_id)}')">✎ Rôle</button>
          ${estProprietaire()
            ? `<button class="btn small" onclick="ouvrirMotDePasseMembre('${escJs(m.user_id)}','${escJs(m.nom)}','${escJs(loginCourt(m))}')" title="Poser un nouveau mot de passe">🔑</button>`
            : ''}
          <button class="btn small" onclick="basculerMembreActif('${escJs(m.user_id)}')" style="${m.actif?'color:var(--warning-text)':'color:var(--success-text)'}">${m.actif?'Suspendre':'Réactiver'}</button>
          <button class="btn small btn-danger" onclick="retirerMembre('${escJs(m.user_id)}','${escJs(m.nom)}')">✕</button>`}
      </div></td>
    </tr>`;
  }).join('');

  const lignesInvits = invitations.map(i => `<tr style="opacity:.75">
      <td><div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;border-radius:50%;background:var(--warning-bg,#faeeda);color:var(--warning-text);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">✉</div>
        <div><div style="font-size:13px;font-weight:500">${esc(i.nom)}</div><span style="font-size:10px;color:var(--warning-text)">Invitation en attente</span></div>
      </div></td>
      <td><span class="ref-code">${esc(i.telephone ? '+' + i.telephone : (i.email || '—'))}</span></td>
      <td><span class="role-pill role-${esc(i.role)}">${esc((ROLES[i.role]||{}).label||i.role)}</span></td>
      <td><span class="stock-badge stock-low">Expire le ${esc((i.expire_le||'').slice(0,10))}</span></td>
      <td style="font-size:12px;color:var(--text-secondary)">${esc((i.created_at||'').slice(0,10))}</td>
      <td><button class="btn small btn-danger" onclick="annulerInvitation('${escJs(i.id)}')">✕ Annuler</button></td>
    </tr>`).join('');

  corps.innerHTML = lignesMembres + lignesInvits ||
    '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:13px">Aucun membre</td></tr>';

  // Vue mobile : membres puis invitations, dans le même ordre que le tableau.
  // Le drapeau `invit` distingue les deux, les deux listes partageant la
  // même carte — c'est la seule différence entre elles.
  const tous = membres.map(m => ({ m: m, invit: false }))
          .concat(invitations.map(i => ({ m: i, invit: true })));

  rendreCartes('users-cartes', tous, function (x) {
    const m = x.m;
    const role = ROLES[m.role] || { label: m.role, color: '#888', bg: '#eee' };

    if (x.invit) {
      return {
        estompee: true,
        ton: 'attente',
        pastille: { texte: '✉', fond: 'var(--warning-bg)', couleur: 'var(--warning-text)' },
        titre: m.nom,
        desc: m.telephone ? '+' + m.telephone : (m.email || '—'),
        meta: ['Invitation en attente'],
        badges: [
          { texte: role.label, classe: 'role-pill role-' + m.role },
          { texte: 'Expire le ' + (m.expire_le || '').slice(0, 10), classe: 'stock-badge stock-low' }
        ],
        actions: [{ texte: '✕ Annuler', classe: 'btn-danger',
                    onclick: "annulerInvitation('" + escJs(m.id) + "')" }]
      };
    }

    const estMoi = m.user_id === moi;
    var actions = [];
    if (estMoi) {
      actions.push({ texte: 'Votre compte', inerte: true });
    } else {
      actions.push({ texte: '✎ Rôle', onclick: "ouvrirEditMembre('" + escJs(m.user_id) + "')" });
      // Seule la propriétaire remplace un mot de passe — même règle que le
      // tableau, et de toute façon revérifiée par l'Edge Function.
      if (estProprietaire()) actions.push({
        texte: '🔑 Mot de passe',
        onclick: "ouvrirMotDePasseMembre('" + escJs(m.user_id) + "','" + escJs(m.nom) + "','" + escJs(loginCourt(m)) + "')"
      });
      actions.push({
        texte: m.actif ? 'Suspendre' : 'Réactiver',
        style: m.actif ? 'color:var(--warning-text)' : 'color:var(--success-text)',
        onclick: "basculerMembreActif('" + escJs(m.user_id) + "')"
      });
      actions.push({ texte: '✕', classe: 'btn-danger',
                     onclick: "retirerMembre('" + escJs(m.user_id) + "','" + escJs(m.nom) + "')" });
    }

    return {
      estompee: !m.actif,
      ton: m.actif ? 'ok' : null,
      pastille: { texte: ini(m.nom), fond: role.bg, couleur: role.color },
      titre: m.nom + (estMoi ? ' (vous)' : ''),
      desc: loginCourt(m) || (m.telephone ? '+' + m.telephone : '—'),
      meta: ['Ajouté le ' + ((m.created_at || '').slice(0, 10) || '—')],
      badges: [
        { texte: role.label, classe: 'role-pill role-' + m.role },
        { texte: m.actif ? 'Actif' : 'Suspendu', classe: 'stock-badge ' + (m.actif ? 'stock-ok' : 'stock-out') }
      ],
      actions: actions
    };
  }, 'Aucun membre.');
}

async function chargerMembres() {
  // `email` est recopié sur `membres` : PostgREST n'expose que le schéma
  // `public`, auth.users n'est donc pas embarquable depuis une requête REST.
  const r = await fetch(SUPABASE_URL +
    '/rest/v1/membres?select=user_id,nom,email,telephone,role,actif,created_at' +
    '&order=created_at.asc', { headers: H() });
  if (!r.ok) throw new Error('Membres inaccessibles (' + r.status + ').');
  return r.json();
}

async function chargerInvitations() {
  const r = await fetch(SUPABASE_URL +
    '/rest/v1/invitations?select=id,email,telephone,nom,role,expire_le,created_at' +
    '&utilisee_le=is.null&order=created_at.desc', { headers: H() });
  if (!r.ok) return [];   // table absente tant que 005 n'est pas appliquée
  return r.json();
}

// ============================================
// COMPTES DE L'ÉQUIPE — créés par la propriétaire
// ============================================
// La propriétaire pose elle-même l'identifiant et le mot de passe : aucune
// invitation, aucun message à envoyer. C'est ce qui rend l'arrivée d'une
// vendeuse indépendante du SMTP et de Twilio.
//
// Toute l'autorisation est côté serveur (fonction `membres-admin`, seule
// détentrice de la clé de service) : les gardes ci-dessous ne font que
// masquer des boutons.

// ============================================
// MA JOURNÉE — relevé de remise de caisse
// ============================================
// Ce que la personne connectée a saisi AUJOURD'HUI, et rien d'autre.
//
// Volontairement absent : le solde de caisse de la boutique, les
// décaissements, et le travail des collègues. Ce n'est pas le rapport
// journalier de l'administrateur — c'est ce qu'une vendeuse doit pouvoir
// poser sur la table en rendant sa caisse.

/** Les lignes du jour saisies par la personne connectée. */
function maJourneeDonnees() {
  var moi = STATE.currentUser?.id;
  var auj = today();
  var aMoi = function (x) { return x.creePar === moi; };

  var ventes = STATE.ventes.filter(function (v) {
    return v.date === auj && !v.annulee && aMoi(v);
  });

  // Un dépôt venu du portail cliente n'a pas d'auteur : il n'est pas passé
  // par le comptoir, il ne figure donc pas dans la remise de caisse.
  var depots = [];
  STATE.comptesClients.forEach(function (cc) {
    (cc.mouvements || []).forEach(function (m) {
      if (m.type === 'depot' && m.date === auj && aMoi(m)) {
        depots.push({ client: cc.client, montant: m.montant || 0, note: m.note || '' });
      }
    });
  });

  var reprises = STATE.achatsClients.filter(function (a) {
    return a.date === auj && aMoi(a);
  });

  return { ventes: ventes, depots: depots, reprises: reprises };
}

function renderMaJournee() {
  var d = maJourneeDonnees();

  var encaisseVentes = d.ventes.reduce(function (s, v) { return s + encaisseReel(v); }, 0);
  var totalDepots    = d.depots.reduce(function (s, x) { return s + x.montant; }, 0);
  var ca             = d.ventes.reduce(function (s, v) { return s + (v.montant || 0); }, 0);
  var totalReprises  = d.reprises.reduce(function (s, a) { return s + (a.prixPropose || 0); }, 0);
  var encaisse       = encaisseVentes + totalDepots;

  document.getElementById('mj-sous-titre').textContent =
    (STATE.currentUser?.nom || '') + ' · ' + fmtDateLong(today());

  document.getElementById('mj-encaisse').textContent        = fmt(encaisse);
  document.getElementById('mj-encaisse-detail').textContent =
    fmt(encaisseVentes) + ' ventes + ' + fmt(totalDepots) + ' dépôts';
  document.getElementById('mj-nb-ventes').textContent = d.ventes.length;
  document.getElementById('mj-ca').textContent        = fmt(ca) + ' de ventes';
  document.getElementById('mj-depots').textContent    = fmt(totalDepots);
  document.getElementById('mj-nb-depots').textContent = d.depots.length + ' dépôt' + (d.depots.length > 1 ? 's' : '');
  document.getElementById('mj-reprises').textContent  = fmt(totalReprises);
  document.getElementById('mj-nb-reprises').textContent = d.reprises.length + ' reprise' + (d.reprises.length > 1 ? 's' : '');

  // Répartition par moyen de paiement : c'est elle qui dit combien de billets
  // doivent être dans le tiroir, et combien sont partis sur un compte mobile.
  var parMoyen = {};
  d.ventes.forEach(function (v) {
    var reel = encaisseReel(v);
    if (!reel) return;
    // Une vente « compte+wave » n'a fait entrer que la part Wave : l'épargne
    // était déjà dans le tiroir. C'est donc le complément qu'il faut compter,
    // sinon la vendeuse chercherait des billets qui n'existent pas.
    var m = v.paiement || 'especes';
    if (m.indexOf('compte+') === 0) m = m.slice('compte+'.length);
    parMoyen[m] = (parMoyen[m] || 0) + reel;
  });

  var lignes = Object.keys(parMoyen).map(function (m) {
    return '<tr><td><span class="paiement-pill paiement-' + esc(m) + '">'
         + esc(PAIEMENT_LABELS[m] || m) + '</span></td>'
         + '<td style="text-align:right;font-weight:600">' + fmt(parMoyen[m]) + '</td></tr>';
  });

  // Les dépôts restent sur leur propre ligne : rien n'enregistre par quel
  // moyen ils ont été versés, et les ranger d'office en espèces serait une
  // affirmation que la base ne permet pas.
  if (totalDepots) {
    lignes.push('<tr><td><span class="metric-badge badge-success">Dépôts épargne</span></td>'
              + '<td style="text-align:right;font-weight:600">' + fmt(totalDepots) + '</td></tr>');
  }

  document.getElementById('mj-paiements').innerHTML = lignes.length
    ? lignes.join('')
      + '<tr style="border-top:2px solid var(--text-primary)"><td style="font-weight:700">Total</td>'
      + '<td style="text-align:right;font-weight:700">' + fmt(encaisse) + '</td></tr>'
    : '<tr><td colspan="2" style="text-align:center;color:var(--text-tertiary);padding:16px">Rien encaissé pour le moment.</td></tr>';

  document.getElementById('mj-ventes').innerHTML = d.ventes.length
    ? d.ventes.map(function (v) {
        return '<tr><td><span class="ref-code">' + esc(v.id) + '</span></td>'
             + '<td>' + esc(v.client || '—') + '</td>'
             + '<td style="font-size:12px;color:var(--text-secondary)">' + esc(v.description || '') + '</td>'
             + '<td style="text-align:right">' + fmt(v.montant) + '</td>'
             + '<td style="text-align:right;font-weight:600">' + fmt(encaisseReel(v)) + '</td>'
             + '<td style="text-align:right">' + ((v.restant || 0) > 0
                 ? '<span class="stock-badge stock-low">' + fmt(v.restant) + '</span>'
                 : '<span class="stock-badge stock-ok">Soldé</span>') + '</td></tr>';
      }).join('')
    : '<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary);padding:16px">Aucune vente saisie aujourd\'hui.</td></tr>';

  var autres = d.depots.map(function (x) {
      return '<tr><td><span class="metric-badge badge-success">Dépôt</span></td>'
           + '<td>' + esc(x.client) + '</td>'
           + '<td style="font-size:12px;color:var(--text-secondary)">' + esc(x.note) + '</td>'
           + '<td style="text-align:right;font-weight:600">' + fmt(x.montant) + '</td></tr>';
    }).concat(d.reprises.map(function (a) {
      return '<tr><td><span class="metric-badge badge-warn">Reprise</span></td>'
           + '<td>' + esc(a.client || '—') + '</td>'
           + '<td style="font-size:12px;color:var(--text-secondary)">' + esc(a.description || '') + '</td>'
           + '<td style="text-align:right">' + fmt(a.prixPropose) + '</td></tr>';
    })).join('');

  document.getElementById('mj-autres').innerHTML = autres
    || '<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary);padding:16px">Aucun dépôt ni reprise aujourd\'hui.</td></tr>';

  // Les mêmes deux listes en cartes, pour le téléphone de la vendeuse —
  // c'est là que ce relevé est lu, au moment de rendre la caisse.
  rendreCartes('mj-ventes-cartes', d.ventes, function (v) {
    return {
      ton: (v.restant || 0) > 0 ? 'attente' : 'ok',
      titre: v.client || '—',
      valeur: fmt(encaisseReel(v)),
      desc: v.description || '',
      meta: [{ texte: v.id, classe: 'ref-code' }, 'Vente ' + fmt(v.montant)],
      badges: [(v.restant || 0) > 0
        ? { texte: 'Reste ' + fmt(v.restant), classe: 'stock-badge stock-low' }
        : { texte: 'Soldé', classe: 'stock-badge stock-ok' }]
    };
  }, "Aucune vente saisie aujourd'hui.");

  var autresLignes = d.depots.map(function (x) {
      return { type: 'Dépôt', classe: 'metric-badge badge-success', client: x.client,
               detail: x.note, montant: x.montant };
    }).concat(d.reprises.map(function (a) {
      return { type: 'Reprise', classe: 'metric-badge badge-warn', client: a.client || '—',
               detail: a.description || '', montant: a.prixPropose };
    }));

  rendreCartes('mj-autres-cartes', autresLignes, function (x) {
    return {
      ton: x.type === 'Dépôt' ? 'ok' : 'sortie',
      titre: x.client,
      valeur: fmt(x.montant),
      desc: x.detail,
      badges: [{ texte: x.type, classe: x.classe }]
    };
  }, "Aucun dépôt ni reprise aujourd'hui.");
}

function imprimerMaJournee() {
  var section = document.getElementById('ma_journee');
  if (!section) return;
  var copie = section.cloneNode(true);
  var entete = copie.querySelector('.page-header');
  if (entete) entete.remove();
  // La vue en cartes double chaque tableau. À l'écran le CSS n'en montre
  // qu'une ; la fenêtre d'impression a sa propre feuille, elle imprimerait
  // les deux.
  copie.querySelectorAll('.liste-cartes').forEach(function (z) { z.remove(); });

  var b = boutiqueInfos();
  var win = window.open('', '_blank', 'width=800,height=1000');
  win.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">'
    + '<title>Ma journée — ' + esc(STATE.currentUser?.nom || '') + '</title>'
    + '<style>*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:20px}'
    + 'h1{font-size:17px;margin-bottom:2px}'
    + '.metrics-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}'
    + '.metric-card{background:#f7f6f3;border-radius:6px;padding:10px}'
    + '.metric-label{font-size:9px;text-transform:uppercase;color:#666;margin-bottom:3px}'
    + '.metric-value{font-size:15px;font-weight:700}.metric-badge{font-size:10px;color:#555}'
    + '.card{border:1px solid #e0e0e0;border-radius:6px;margin-bottom:12px;overflow:hidden}'
    + '.card-header{padding:7px 11px;background:#f7f6f3;border-bottom:1px solid #e0e0e0;font-weight:600}'
    + 'table{width:100%;border-collapse:collapse;font-size:11px}'
    + 'th{text-align:left;padding:6px 8px;background:#1a1916;color:#fff;font-size:9px;text-transform:uppercase}'
    + 'td{padding:6px 8px;border-bottom:1px solid #f0f0f0}'
    + '.ref-code{font-family:monospace;font-size:10px;color:#666}'
    + '.signature{margin-top:26px;display:flex;justify-content:space-between;font-size:11px}'
    + '</style></head><body>'
    + '<div style="text-align:center;margin-bottom:6px">' + _logoFacture(44) + '</div>'
    + '<h1 style="text-align:center">Remise de caisse — ' + esc(b.nom) + '</h1>'
    + '<div style="text-align:center;font-size:11px;color:#666;margin-bottom:6px">'
    + esc(STATE.currentUser?.nom || '') + ' · ' + fmtDateLong(today()) + '</div>'
    + copie.innerHTML
    + '<div class="signature"><div>Remis par : ____________________</div>'
    + '<div>Reçu par : ____________________</div></div>'
    + '</body></html>');
  win.document.close();
  setTimeout(function () { win.focus(); win.print(); }, 500);
}

function estProprietaire() { return STATE.currentUser?.role === 'proprietaire'; }

/**
 * Affiche ou masque un mot de passe.
 *
 * Masqué par défaut : au comptoir, l'écran est vu par les clientes, et une
 * capture d'écran emporte le mot de passe avec elle. Révélable le temps de le
 * dicter, puis remasqué.
 */
function basculerVisibilite(idChamp, bouton) {
  var el = document.getElementById(idChamp);
  if (!el) return;
  var cache = el.type === 'password';
  el.type = cache ? 'text' : 'password';
  bouton.textContent = cache ? '🙈' : '👁';
  bouton.title = cache ? 'Masquer' : 'Afficher';
}

/**
 * « fatou@kay.kayor.app » → « fatou@kay ».
 * Le suffixe technique n'est jamais montré : la propriétaire ne dicte que la
 * partie courte, et c'est aussi ce que la vendeuse tape pour se connecter.
 */
function loginCourt(m) {
  var e = m && m.email ? String(m.email) : '';
  if (!e) return '';
  return e.endsWith('.kayor.app') ? e.slice(0, -'.kayor.app'.length) : e;
}

/** Montre à la propriétaire ce qu'elle devra dicter à sa vendeuse. */
function majApercuLogin() {
  var id   = (document.getElementById('cc-identifiant').value || '').trim().toLowerCase();
  var el   = document.getElementById('cc-apercu');
  var slug = (Auth.orgSlug() || '').toLowerCase();
  if (!el) return;
  el.innerHTML = id
    ? 'Elle se connectera avec <strong>' + esc(id + '@' + slug) + '</strong>'
    : 'Saisissez un identifiant pour voir ce qu\'elle devra taper.';
}

function ouvrirCreerCompte() {
  if (!estProprietaire()) { showToast('⛔ Réservé à la propriétaire.'); return; }
  ['cc-nom','cc-identifiant','cc-tel','cc-mdp'].forEach(function (i) {
    document.getElementById(i).value = '';
  });
  document.getElementById('cc-role').value = 'vendeur';
  document.getElementById('cc-erreur').style.display = 'none';
  majApercuLogin();
  openModal('modal-creer-compte');
}

async function validerCreerCompte() {
  document.getElementById('cc-erreur').style.display = 'none';

  var p = {
    nom:         document.getElementById('cc-nom').value.trim(),
    identifiant: document.getElementById('cc-identifiant').value.trim().toLowerCase(),
    role:        document.getElementById('cc-role').value,
    motdepasse:  document.getElementById('cc-mdp').value,
    telephone:   document.getElementById('cc-tel').value
  };

  if (!p.nom) { messageAuth('cc-erreur', 'Le nom est obligatoire.'); return; }
  if (!/^[a-z0-9._-]{2,30}$/.test(p.identifiant)) {
    messageAuth('cc-erreur', 'Identifiant : 2 à 30 caractères, lettres, chiffres, point ou tiret.'); return;
  }
  if (p.motdepasse.length < 8) { messageAuth('cc-erreur', 'Mot de passe : 8 caractères minimum.'); return; }

  var btn = document.getElementById('btn-valider-compte');
  btn.disabled = true; btn.textContent = 'Création…';
  try {
    var r = await creerCompteMembre(p);
    closeModal('modal-creer-compte');
    renderGestionComptes();
    // Le mot de passe n'est pas répété ici : elle vient de le choisir.
    showToast('✓ Compte créé. ' + r.nom + ' se connecte avec « ' + r.login + ' ».');
  } catch (e) {
    messageAuth('cc-erreur', e.message);
  } finally {
    btn.disabled = false; btn.textContent = '✓ Créer le compte';
  }
}

function ouvrirMotDePasseMembre(userId, nom, login) {
  if (!estProprietaire()) { showToast('⛔ Réservé à la propriétaire.'); return; }
  document.getElementById('mdp-user-id').value  = userId;
  document.getElementById('mdp-nom').textContent   = nom;
  document.getElementById('mdp-login').textContent = login || '';
  document.getElementById('mdp-valeur').value   = '';
  document.getElementById('mdp-erreur').style.display = 'none';
  openModal('modal-mdp-membre');
}

async function validerMotDePasseMembre() {
  var userId = document.getElementById('mdp-user-id').value;
  var mdp    = document.getElementById('mdp-valeur').value;
  if (mdp.length < 8) { messageAuth('mdp-erreur', 'Mot de passe : 8 caractères minimum.'); return; }

  var btn = document.getElementById('btn-valider-mdp');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    var r = await changerMotDePasseMembre(userId, mdp);
    closeModal('modal-mdp-membre');
    showToast('✓ Mot de passe remplacé pour ' + r.nom + '.');
  } catch (e) {
    messageAuth('mdp-erreur', e.message);
  } finally {
    btn.disabled = false; btn.textContent = '✓ Remplacer';
  }
}

function ouvrirInvitation() {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  document.getElementById('u-edit-id').value = '';
  document.getElementById('u-nom').value     = '';
  document.getElementById('u-email').value   = '';
  document.getElementById('u-tel').value     = '';
  document.getElementById('u-tel').disabled  = false;
  document.getElementById('u-role').value    = 'vendeur';
  document.getElementById('u-email').disabled = false;
  document.getElementById('modal-user-title').textContent = 'Inviter un membre';
  document.getElementById('btn-save-user').textContent    = 'Envoyer l\'invitation';
  openModal('modal-add-user');
}

async function ouvrirEditMembre(userId) {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  const membres = await chargerMembres();
  const m = membres.find(x => x.user_id === userId);
  if (!m) return;
  document.getElementById('u-edit-id').value = userId;
  document.getElementById('u-nom').value     = m.nom;
  document.getElementById('u-email').value   = m.email || '';
  document.getElementById('u-email').disabled = true;   // l'email appartient au compte Auth
  document.getElementById('u-tel').value      = m.telephone ? '+' + m.telephone : '';
  document.getElementById('u-tel').disabled   = true;   // le numéro aussi : il identifie le compte
  document.getElementById('u-role').value    = m.role;
  document.getElementById('modal-user-title').textContent = 'Modifier — ' + m.nom;
  document.getElementById('btn-save-user').textContent    = 'Sauvegarder';
  openModal('modal-add-user');
}

/**
 * Met à jour le nom et le rôle d'un membre.
 *
 * L'invitation d'équipe a été retirée le 2026-10-20 : un compte se crée
 * désormais par « + Créer un compte », où la propriétaire pose elle-même
 * l'identifiant et le mot de passe. Plus rien à envoyer, plus rien à attendre.
 */
async function sauvegarderMembre() {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  const userId = document.getElementById('u-edit-id').value;
  const nom    = document.getElementById('u-nom').value.trim();
  const role   = document.getElementById('u-role').value;

  if (!userId) { showToast('⚠ Utilisez « + Créer un compte » pour ajouter un membre.'); return; }
  if (!nom)    { showToast('⚠ Le nom est obligatoire.'); return; }

  try {
    {
      const r = await fetch(SUPABASE_URL + '/rest/v1/membres?user_id=eq.' + encodeURIComponent(userId), {
        method: 'PATCH', headers: H(), body: JSON.stringify({ nom, role })
      });
      if (!r.ok) throw new Error(await r.text());
      showToast(`✓ ${nom} — mis à jour.`);
    }
    closeModal('modal-add-user');
    renderGestionComptes();
  } catch (e) {
    // RLS renvoie 403/42501 quand le rôle demandé dépasse les droits de l'appelant.
    showToast(/42501|403/.test(String(e.message))
      ? '⛔ Votre rôle ne permet pas cette action.'
      : '⚠ Échec : ' + String(e.message).slice(0, 120));
  }
}

async function basculerMembreActif(userId) {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  const membres = await chargerMembres();
  const m = membres.find(x => x.user_id === userId);
  if (!m) return;
  const r = await fetch(SUPABASE_URL + '/rest/v1/membres?user_id=eq.' + encodeURIComponent(userId), {
    method: 'PATCH', headers: H(), body: JSON.stringify({ actif: !m.actif })
  });
  if (!r.ok) { showToast('⚠ Modification refusée.'); return; }
  showToast(`${m.nom} ${!m.actif ? 'réactivé' : 'suspendu'}.`);
  renderGestionComptes();
}

async function retirerMembre(userId, nom) {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  if(!confirm(`Retirer "${nom}" de la boutique ?\n\nSon compte est conservé et l'historique reste attribuable, mais l'accès est coupé immédiatement.`)) return;
  // Passe par une fonction serveur : elle refuse de laisser la boutique sans
  // propriétaire et empêche un admin de retirer un propriétaire.
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/retirer_membre', {
    method: 'POST', headers: H(), body: JSON.stringify({ p_user_id: userId })
  });
  const res = r.ok ? await r.json() : { ok:false, erreur:'Requête refusée.' };
  if (!res.ok) { showToast('⛔ ' + res.erreur); return; }
  showToast(`${nom} retiré de la boutique.`);
  renderGestionComptes();
}

async function annulerInvitation(id) {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  const r = await fetch(SUPABASE_URL + '/rest/v1/invitations?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE', headers: H()
  });
  if (!r.ok) { showToast('⚠ Suppression refusée.'); return; }
  showToast('Invitation annulée.');
  renderGestionComptes();
}

// ============================================
// FACTURE PDF
// ============================================



function normalizeStr(s) {
  return (s||'').toLowerCase().replace(/\s+/g,'');
}
function fmtDateLong(d){ if(!d)return'—'; return new Date(d+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
function genNumFacture(ventId){
  var v = STATE.ventes.find(function(x){ return x.id === ventId; });
  if (!v) return 'FAC-'+ventId;
  // Repli pour les ventes anciennes sans numéro. On dérive de l'identifiant
  // de la vente au lieu d'en attribuer un nouveau : piocher dans le compteur
  // ici produirait un numéro de facture déjà utilisé ailleurs.
  return v.numFacture || ('FAC-' + String(ventId).replace(/^V-/, ''));
}
/**
 * La feuille de style de la facture — une seule, pour l'aperçu à l'écran ET
 * la fenêtre d'impression.
 *
 * Elles avaient divergé jusqu'à l'absurde : les classes `.facture-*`
 * n'existaient QUE dans la fenêtre d'impression, donc l'aperçu affichait du
 * HTML brut. On validait une facture sans mise en page avant d'en imprimer
 * une autre. Un seul texte ici, deux consommateurs.
 *
 * Toutes les règles sont préfixées `.facture` : l'injecter dans la page de
 * l'application ne peut rien déborder ailleurs.
 */
const FACTURE_CSS = `
.facture{max-width:720px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#111;background:#fff;padding:20px}
.facture-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:24px}
.facture-logo-zone{display:flex;align-items:center;gap:14px;min-width:0}
.facture-logo-icon{font-size:40px;line-height:1}
.facture-shop-name{font-size:20px;font-weight:700;letter-spacing:1px}
.facture-shop-info{font-size:12px;color:#666;margin-top:2px}
.facture-num-zone{text-align:right;flex-shrink:0}
.facture-num-label{font-size:10px;font-weight:700;letter-spacing:2px;color:#888;text-transform:uppercase}
.facture-num{font-size:22px;font-weight:700;margin:4px 0}
.facture-num-date{font-size:11px;color:#666}
.facture-parties{display:flex;gap:16px;margin:20px 0}
.facture-partie{flex:1;min-width:0;background:#f7f6f3;border-radius:8px;padding:14px}
.facture-partie-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin-bottom:6px}
.facture-partie-nom{font-size:15px;font-weight:700;margin-bottom:4px;overflow-wrap:anywhere}
.facture-partie-info{font-size:12px;color:#555;margin-top:2px;overflow-wrap:anywhere}
.facture-sep{border-top:1.5px solid #e0e0e0;margin:18px 0}
.facture-section-title{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin-bottom:10px}
/* min-width:0 est indispensable dans l'aperçu : la feuille de l'application
   impose min-width:520px à TOUTE table, pour le défilement horizontal des
   listes. La facture héritait donc de 520 px dans une modale de 330 px. */
.facture-table{width:100%;min-width:0;border-collapse:collapse;font-size:13px;table-layout:fixed}
.facture-table th{background:#1a1916;color:#fff;padding:9px 10px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
.facture-table td{padding:10px;border-bottom:1px solid #f0f0f0;vertical-align:top;overflow-wrap:anywhere}
/* Largeurs explicites : sans elles, table-layout:fixed donne quatre colonnes
   égales, et la description — seule colonne vraiment longue — se replie sur
   six lignes pendant que « Poids » garde la même place qu'elle. */
.facture-table th:nth-child(1){width:42%}
.facture-table th:nth-child(2){width:24%}
.facture-table th:nth-child(3){width:14%}
.facture-table th:nth-child(4){width:20%}
/* Seuls les nombres restent insécables. Le libellé de carat, lui, doit
   pouvoir se replier : « 18 carats - Local (750/1000) » tenu d'une pièce
   poussait tout le tableau hors de l'écran.
   ATTENTION : aucun accent grave dans ce bloc — il est lui-même un littéral
   de gabarit, un seul le refermerait et casserait tout le fichier. */
.facture-table .fa-nowrap{white-space:nowrap;overflow-wrap:normal}
.facture-totaux{display:flex;flex-direction:column;align-items:flex-end;gap:6px;margin:12px 0}
.facture-total-row{display:flex;justify-content:space-between;gap:12px;width:300px;max-width:100%;font-size:14px;padding:5px 0;border-bottom:1px solid #f0f0f0}
.facture-total-final{font-size:16px;font-weight:700;padding:8px 0;border-top:2px solid #1a1916;border-bottom:none}
.facture .restant-due{color:#a32d2d}
.facture .solde-ok{color:#3b6d11}
.facture-footer{margin-top:24px;text-align:center}
.facture-merci{font-size:15px;font-weight:600;margin-bottom:10px}
.facture-conditions{font-size:11px;color:#888;line-height:1.6;margin-bottom:8px}
.facture-footer-ref{font-size:11px;color:#aaa;margin-top:6px}

/* Téléphone : les deux bandeaux en vis-à-vis s'empilent, sinon le numéro de
   facture et l'adresse de la cliente se écrasent sur trois caractères. */
@media (max-width:640px){
  .facture{padding:14px;font-size:12.5px}
  .facture-header{flex-direction:column;gap:12px;margin-bottom:18px}
  .facture-num-zone{text-align:left}
  .facture-num{font-size:19px}
  .facture-parties{flex-direction:column;gap:10px}
  .facture-table{font-size:12px}
  .facture-table th,.facture-table td{padding:7px 6px}
  /* L'interlettrage des en-têtes coûte une dizaine de pixels sur « MONTANT »,
     soit exactement ce qui manquait pour qu'il tienne. */
  .facture-table th{font-size:10px;letter-spacing:0}
  .facture-table th:nth-child(1){width:36%}
  .facture-table th:nth-child(2){width:25%}
  .facture-table th:nth-child(3){width:16%}
  .facture-table th:nth-child(4){width:23%}
  .facture-totaux{align-items:stretch}
  .facture-total-row{width:100%}
}

/* Sur papier, on reprend la mise en page large quelle que soit la machine
   qui imprime — un téléphone imprime sur du A4 comme les autres. */
@media print{
  .facture{max-width:100%;padding:0}
  .facture-header{flex-direction:row}
  .facture-num-zone{text-align:right}
  .facture-parties{flex-direction:row}
  .facture-totaux{align-items:flex-end}
  .facture-total-row{width:300px}
}
`;

/** Pose la feuille dans la page, une seule fois, pour l'aperçu. */
function _styleFacture() {
  if (document.getElementById('style-facture')) return;
  var st = document.createElement('style');
  st.id = 'style-facture';
  st.textContent = FACTURE_CSS;
  document.head.appendChild(st);
}

function afficherFacture(id) {
  _styleFacture();
  calculerCumuls();
  const v=STATE.ventes.find(x=>x.id===id); if(!v)return;
  const c=getCarat(v.carat);
  const numFac=genNumFacture(v.id);
  const caratLabel=c?`${c.label} (${c.purete})`:v.carat?.toUpperCase()||'—';
  const cl=STATE.clients.find(x=>x.nom===v.client)||{};
  // Un seul poids sur la facture : c'est le total qui engage la boutique,
  // avec le carat. La distinction local / importé reste au journal, elle
  // regarde la gestion du stock, pas la cliente.
  // `poids` est la saisie ; `local` et `importe` en découlent par provenance
  // (l'un des deux vaut toujours zéro). Le repli couvre les ventes anciennes
  // où seul le couple local/importé avait été renseigné.
  const poidsFacture = (parseFloat(v.poids)||0) > 0
    ? parseFloat(v.poids)
    : (parseFloat(v.local)||0) + (parseFloat(v.importe)||0);
  const restant=v.restant||0;
  const now=new Date();
  // Identité de la boutique connectée, plus celle codée en dur : en SaaS,
  // chaque bijouterie imprime la sienne.
  const _b = boutiqueInfos();
  document.getElementById('facture-content').innerHTML=`
<div class="facture" id="facture-print-zone" data-numfac="${esc(numFac)}" data-client="${esc(v.client)}" data-date="${fmtDate(v.date)}">
  <div class="facture-header">
    <div class="facture-logo-zone">
      ${_logoFacture()}
      <div>
        <div class="facture-shop-name">${esc(_b.nom)}</div>
        ${_b.slogan?`<div class="facture-shop-info">${esc(_b.slogan)}</div>`:""}
        ${_b.adresse?`<div class="facture-shop-info">${esc(_b.adresse)}</div>`:""}
      </div>
    </div>
    <div class="facture-num-zone">
      <div class="facture-num-label">FACTURE</div>
      <div class="facture-num">${numFac}</div>
      <div class="facture-num-date">Date : ${fmtDate(v.date)}</div>
      <div class="facture-num-date">Imprimée : ${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
    </div>
  </div>
  <div class="facture-parties">
    <div class="facture-partie">
      <div class="facture-partie-label">VENDEUR</div>
      <div class="facture-partie-nom">${esc(_b.nom)}</div>
      ${_b.slogan?`<div class="facture-partie-info">${esc(_b.slogan)}</div>`:""}
      ${_b.adresse?`<div class="facture-partie-info">${esc(_b.adresse)}</div>`:""}
      ${boutiqueLigneContact()?`<div class="facture-partie-info">${esc(boutiqueLigneContact())}</div>`:""}
      <div class="facture-partie-info">Gérant : ${esc(STATE.currentUser?.nom||'—')}</div>
    </div>
    <div class="facture-partie">
      <div class="facture-partie-label">CLIENT</div>
      <div class="facture-partie-nom">${esc(v.client)}</div>
      ${cl.tel?`<div class="facture-partie-info">Tél : ${esc(cl.tel)}</div>`:''}
      ${cl.email?`<div class="facture-partie-info">Email : ${esc(cl.email)}</div>`:''}
      ${cl.adresse?`<div class="facture-partie-info">Adresse : ${esc(cl.adresse)}</div>`:''}
    </div>
  </div>
  <div class="facture-sep"></div>
  <div class="facture-section-title">DÉTAIL DE LA PRESTATION</div>
  <table class="facture-table">
    <thead><tr><th>Description</th><th>Carat</th><th style="text-align:center">Poids</th><th style="text-align:right">Montant</th></tr></thead>
    <tbody>
      <tr>
        <td>${esc(v.description)}</td>
        <td>${esc(caratLabel)}</td>
        <td class="fa-nowrap" style="text-align:center">${poidsFacture>0?fmtG(poidsFacture):'—'}</td>
        <td class="fa-nowrap" style="text-align:right;font-weight:600">${fmt(v.montant)}</td>
      </tr>
    </tbody>
  </table>
  <div class="facture-sep"></div>
  <div class="facture-totaux">
    <div class="facture-total-row"><span>Montant total</span><strong>${fmt(v.montant)}</strong></div>
    ${(v.acompte||0)>0 && (v.acompte||0)<v.montant ? `<div class="facture-total-row"><span>Acompte versé</span><span>${fmt(v.acompte)}</span></div>` : ''}
    ${v.noteComplement ? `<div class="facture-total-row" style="font-size:11px;color:#666"><span>Détail paiement</span><span>${esc(v.noteComplement)}</span></div>` : ''}
    <div class="facture-total-row facture-total-final ${restant>0?'restant-due':'solde-ok'}">
      <span>${restant>0?'Restant dû':'Statut paiement'}</span>
      <strong>${restant>0?fmt(restant):'✓ SOLDÉ'}</strong>
    </div>
  </div>
  <div class="facture-sep"></div>
  <div class="facture-footer">
    <div class="facture-merci">Merci pour votre confiance</div>
    <div class="facture-conditions">${_b.pied ? esc(_b.pied) : 'Cette facture fait foi de paiement. Les bijoux vendus ne sont ni repris ni échangés sauf défaut de fabrication. Poids et titres garantis.'}</div>
    ${boutiqueLigneContact() ? `<div class="facture-conditions">${esc(boutiqueLigneContact())}</div>` : ''}
    <div class="facture-footer-ref">Réf. : ${numFac} — ${fmtDate(v.date)}</div>
  </div>
</div>`;
  document.getElementById('modal-facture').classList.add('show');
}

function imprimerFacture() {
  const zone=document.getElementById('facture-print-zone');
  const numFac=zone&&zone.dataset.numfac||'Facture';
  const client=zone&&zone.dataset.client||'';
  const date=zone&&zone.dataset.date||'';
  const pdfTitle=numFac+(client?' - '+client:'')+(date?' - '+date:'');
  const win=window.open('','_blank','width=800,height=1000');
  // Même feuille que l'aperçu (FACTURE_CSS) : il n'y a plus deux mises en
  // page à tenir d'accord. Seules les règles du document lui-même — celles
  // qui ne peuvent pas vivre dans la page de l'application — restent ici.
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(pdfTitle)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}
body{background:#fff;padding:20px}
@media (max-width:640px){body{padding:8px}}
@media print{body{padding:10px}@page{margin:12mm}}
${FACTURE_CSS}</style></head><body>${zone.outerHTML}</body></html>`);
  win.document.close();
  setTimeout(()=>{win.focus();win.print();win.close();},500);
}

// ============================================
// RAPPORT JOURNALIER
// ============================================
function renderRapportJour(){ renderRapportJournalier(); }

/**
 * Bornes de la période choisie, au format AAAA-MM-JJ.
 *
 * Le rapport ne couvrait qu'une journée. Une bijoutière veut aussi voir sa
 * semaine, son mois, son semestre — et l'addition doit rester la même quelle
 * que soit la largeur de la fenêtre.
 */
function periodeRapport() {
  var sel   = document.getElementById('rapport-periode');
  var choix = sel ? sel.value : 'jour';
  var fin   = today();
  var debut = fin;

  function decaler(jours) {
    var d = new Date(fin + 'T12:00:00');
    d.setDate(d.getDate() - jours);
    return d.toISOString().slice(0, 10);
  }

  if (choix === 'hier')          { debut = fin = decaler(1); }
  else if (choix === 'semaine')  { debut = decaler(6); }
  else if (choix === 'mois')     { debut = fin.slice(0, 8) + '01'; }
  else if (choix === 'mois3')    { debut = decaler(89); }
  else if (choix === 'mois6')    { debut = decaler(181); }
  else if (choix === 'perso') {
    debut = document.getElementById('rapport-date-picker')?.value || fin;
    fin   = document.getElementById('rapport-date-fin')?.value    || debut;
    if (fin < debut) { var t = debut; debut = fin; fin = t; }
  }

  var libelle = (debut === fin)
    ? fmtDateLong(debut)
    : 'Du ' + fmtDate(debut) + ' au ' + fmtDate(fin);

  return { debut: debut, fin: fin, libelle: libelle, unJour: debut === fin };
}

/** Affiche ou masque les deux champs de dates selon le choix. */
function majPeriodeRapport() {
  var choix = document.getElementById('rapport-periode').value;
  var perso = choix === 'perso';
  var d1 = document.getElementById('rapport-date-picker');
  var d2 = document.getElementById('rapport-date-fin');
  d1.style.display = perso ? '' : 'none';
  d2.style.display = perso ? '' : 'none';
  if (perso && !d2.value) { d1.value = d1.value || today(); d2.value = today(); }
  renderRapportJournalier();
}
function renderRapportJournalier() {
  // Ce rapport expose le solde de caisse et le détail des décaissements.
  if(!isAdmin()){ showToast('⛔ Rapport réservé à l\'administrateur.'); return; }
  const per   = periodeRapport();
  const date  = per.debut;                       // conservé pour l'impression
  const dansPeriode = function(d){ return d >= per.debut && d <= per.fin; };
  document.getElementById('rapport-date-label').textContent = per.libelle;

  const ventesJ   = STATE.ventes.filter(v=>dansPeriode(v.date));
  const achatsJ   = STATE.achatsClients.filter(a=>dansPeriode(a.date));
  const decaissJ  = STATE.decaissements.filter(d=>dansPeriode(d.date));
  const sortiesJ  = STATE.sorties.filter(s=>dansPeriode(s.date));
  const connJ     = STATE.connexions.filter(c=>dansPeriode(c.date));

  // Mêmes règles que le solde global, appliquées à la seule journée : on
  // retire la part réglée sur compte épargne et on ajoute les dépôts du jour,
  // sinon le rapport d'une journée ne correspond pas au contenu du tiroir.
  // Seuls les dépôts font entrer de l'argent : une écriture d'annulation de
  // retrait n'apporte rien au tiroir (même règle que totalDepotsEpargne).
  const depotsJ = (STATE.comptesClients||[]).reduce(function(s, cc){
    return s + (cc.mouvements||[]).reduce(function(t, m){
      return (m.type === 'depot' && dansPeriode(m.date)) ? t + (m.montant||0) : t;
    }, 0);
  }, 0);

  const tV = ventesJ.filter(v=>!v.annulee).reduce((s,v)=>s+(v.montant||0),0);
  // `tE` additionnait les dépôts et s'affichait sous l'intitulé « Encaissé
  // du jour » : le chiffre ne correspondait pas à son étiquette. Les deux
  // sont maintenant séparés — le solde, lui, ne bouge pas.
  const tE = ventesJ.reduce((s,v)=>s+encaisseReel(v),0);
  const tD = decaissJ.reduce((s,d)=>s+(d.montant||0),0);
  const sNet = tE + depotsJ - tD;

  const nbVentesEncaissees = ventesJ.filter(v=>encaisseReel(v)>0).length;
  const nbDepotsJ = (STATE.comptesClients||[]).reduce(function(s, cc){
    return s + (cc.mouvements||[]).filter(function(m){
      return m.type === 'depot' && dansPeriode(m.date);
    }).length;
  }, 0);

  // Métriques
  document.getElementById('rj-ventes').textContent   = fmt(tV);
  document.getElementById('rj-ventes-nb').textContent= ventesJ.length+' vente'+(ventesJ.length>1?'s':'');
  document.getElementById('rj-encaisse').textContent  = fmt(tE);
  document.getElementById('rj-encaisse-nb').textContent=
    nbVentesEncaissees+' vente'+(nbVentesEncaissees>1?'s':'');
  document.getElementById('rj-depots').textContent    = fmt(depotsJ);
  document.getElementById('rj-depots-nb').textContent =
    nbDepotsJ+' dépôt'+(nbDepotsJ>1?'s':'');
  document.getElementById('rj-decaiss').textContent   = '− '+fmt(tD);
  document.getElementById('rj-decaiss-nb').textContent= decaissJ.length+' op.'+(decaissJ.length>1?'s':'');
  document.getElementById('rj-solde').textContent     = fmt(sNet);
  const sb = document.getElementById('rj-solde-badge');
  if(sb){ sb.textContent = sNet>=0?'Positif':'Négatif'; sb.className='metric-badge '+(sNet>=0?'badge-success':'badge-danger'); }

  const empty = '<div style="padding:14px 16px;color:var(--text-tertiary);font-size:13px;text-align:center">Aucune opération ce jour</div>';
  const rowSt = 'display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:0.5px solid var(--border-light);font-size:13px';

  // Ventes
  document.getElementById('rj-detail-ventes').innerHTML = ventesJ.length===0 ? empty :
    ventesJ.map(v=>`<div style="${rowSt}">
      <div>
        <div style="font-weight:500">${v.client} <span class="carat-pill" style="font-size:10px">${(v.carat||'').toUpperCase()}</span></div>
        <div style="font-size:11px;color:var(--text-secondary)">${v.description} · <span class="ref-code">${genNumFacture(v.id)}</span></div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:600">${fmt(v.montant)}</div>
        <span class="stock-badge ${(v.restant||0)>0?'stock-low':'stock-ok'}" style="font-size:10px">${(v.restant||0)>0?'Restant: '+fmt(v.restant):'Soldé'}</span>
      </div>
    </div>`).join('');

  // Décaissements
  document.getElementById('rj-detail-decaiss').innerHTML = decaissJ.length===0 ? empty :
    decaissJ.map(d=>`<div style="${rowSt}">
      <div>
        <div style="font-weight:500">${d.description}</div>
        <div style="font-size:11px;color:var(--text-secondary)">${d.categorie}</div>
      </div>
      <div style="font-weight:600;color:var(--danger-text)">-${fmt(d.montant)}</div>
    </div>`).join('');

  // Rachats
  const elR = document.getElementById('rj-detail-rachats');
  if(elR) elR.innerHTML = achatsJ.length===0 ? empty :
    achatsJ.map(a=>`<div style="${rowSt}">
      <div>
        <div style="font-weight:500">${a.client}</div>
        <div style="font-size:11px;color:var(--text-secondary)">${a.description} — ${(a.carat||'').toUpperCase()} — ${a.poids}g</div>
      </div>
      <div style="font-weight:600;color:var(--success-text)">${fmt(a.prixPropose)}</div>
    </div>`).join('');

  // Connexions
  const elC = document.getElementById('rj-detail-connexions');
  if(elC) elC.innerHTML = connJ.length===0 ? empty :
    connJ.map(c=>`<div style="${rowSt}">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:26px;height:26px;border-radius:50%;background:${ROLES[c.role]?.bg||'#eee'};color:${ROLES[c.role]?.color||'#888'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600">${ini(c.nom)}</div>
        <div><div style="font-weight:500">${c.nom}</div><div style="font-size:11px;color:var(--text-secondary)">${ROLES[c.role]?.label||c.role}</div></div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:500">${c.heure}</div>
        <span class="stock-badge ${c.action==='connexion'?'stock-ok':'stock-low'}" style="font-size:10px">${c.action}</span>
      </div>
    </div>`).join('');
}

function genererRapportJournalier() {
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelector('.nav-item[data-section="rapport_journalier"]')?.classList.add('active');
  document.getElementById('rapport_journalier')?.classList.add('active');
  const rdp=document.getElementById('rapport-date-picker'); if(rdp)rdp.value=today();
  const rdf=document.getElementById('rapport-date-fin');    if(rdf)rdf.value=today();
  const rpe=document.getElementById('rapport-periode');     if(rpe)rpe.value='jour';
  majPeriodeRapport();
  renderRapportJournalier();
}

function imprimerRapportJournalier() {
  const per  = periodeRapport();
  const date = per.libelle;          // titre du document : la période entière
  const _b=boutiqueInfos(), _contact=boutiqueLigneContact();

  // On recopie la section telle qu'elle est affichée, en retirant l'en-tête
  // (sélecteur de date et bouton d'impression n'ont rien à faire sur le PDF).
  // Auparavant la fonction lisait un conteneur `rapport-journalier-content`
  // qui appartenait à une section en double, jamais alimentée : le PDF
  // ne contenait que le logo.
  const section = document.getElementById('rapport_jour');
  let content = '';
  if (section) {
    const copie = section.cloneNode(true);
    const entete = copie.querySelector('.page-header');
    if (entete) entete.remove();
    copie.querySelectorAll('.liste-cartes').forEach(function (z) { z.remove(); });
    content = copie.innerHTML;
  }
  if (!content.trim()) { showToast('⚠ Rien à imprimer — ouvrez d\'abord le rapport.'); return; }
  const win=window.open('','_blank','width=900,height=1100');
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport ${date}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#111;background:#fff;padding:20px}
h1{font-size:18px;margin-bottom:4px}.rpt-head{margin-bottom:18px;padding-bottom:10px;border-bottom:2px solid #1a1916}
.metrics-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
/* Sur papier aussi : cinq totaux tiennent sur une rangée, sans quoi le
   solde net se retrouve seul sous les quatre autres. */
.metrics-grid-5{grid-template-columns:repeat(5,1fr)}
.metric-card{background:#f7f6f3;border-radius:6px;padding:10px}.metric-label{font-size:9px;text-transform:uppercase;letter-spacing:0.4px;color:#666;margin-bottom:3px}
.metric-value{font-size:16px;font-weight:700}.metric-badge{font-size:10px;padding:2px 6px;border-radius:20px;display:inline-block;margin-top:3px}
.badge-info{background:#e6f1fb;color:#185fa5}.badge-success{background:#eaf3de;color:#3b6d11}.badge-warn{background:#faeeda;color:#854f0b}.badge-danger{background:#fcebeb;color:#a32d2d}
.card{background:#fff;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:12px;overflow:hidden}
.card-header{padding:8px 12px;border-bottom:1px solid #e0e0e0;background:#f7f6f3}.card-title{font-size:12px;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:11px}
th{text-align:left;padding:7px 8px;font-size:9px;font-weight:700;text-transform:uppercase;background:#1a1916;color:#fff}
td{padding:7px 8px;border-bottom:1px solid #f0f0f0}
.ref-code{font-family:monospace;font-size:10px;color:#666}.carat-pill,.role-pill,.stock-badge,.cat-badge{font-size:10px;padding:2px 6px;border-radius:20px;display:inline-block}
.stock-ok{background:#eaf3de;color:#3b6d11}.stock-low{background:#faeeda;color:#854f0b}
.role-admin{background:#eeedfe;color:#534ab7}.role-gestionnaire{background:#e1f5ee;color:#0f6e56}.role-vendeur{background:#faeeda;color:#854f0b}
.cat-badge{background:#fcebeb;color:#a32d2d}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.two-col>.card{margin-bottom:0}
@media print{body{padding:8px}.card{break-inside:avoid}}</style></head><body>
<div class="rpt-head"><div style="text-align:center;margin-bottom:8px">${_logoFacture(55)}</div><h1>Rapport journalier — ${esc(_b.nom)}</h1><div style="font-size:12px;color:#666">${_contact?esc(_contact)+' · ':''}${date} · Imprimé le ${new Date().toLocaleString('fr-FR')}</div></div>
${content}</body></html>`);
  win.document.close();
  setTimeout(()=>{win.focus();win.print();win.close();},500);
}

// ============================================
// CSS FACTURE (injectée dynamiquement)
// ============================================
(function addFactureCSS(){
  const s=document.createElement('style');
  s.textContent=`
.modal-facture{width:min(700px,96vw)}
.facture{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#111;max-width:680px}
.facture-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:12px}
.facture-logo-zone{display:flex;align-items:center;gap:12px}
.facture-logo-icon{font-size:36px;line-height:1}
.facture-shop-name{font-size:18px;font-weight:700;letter-spacing:1px;color:var(--text-primary)}
.facture-shop-info{font-size:12px;color:var(--text-secondary);margin-top:2px}
.facture-num-zone{text-align:right}
.facture-num-label{font-size:10px;font-weight:700;letter-spacing:2px;color:var(--text-tertiary);text-transform:uppercase}
.facture-num{font-size:20px;font-weight:700;color:var(--text-primary);margin:3px 0}
.facture-num-date{font-size:11px;color:var(--text-secondary)}
.facture-parties{display:flex;gap:16px;margin:16px 0;flex-wrap:wrap}
.facture-partie{flex:1;min-width:200px;background:var(--bg-secondary);border-radius:var(--radius-md);padding:12px}
.facture-partie-label{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:5px}
.facture-partie-nom{font-size:14px;font-weight:600;margin-bottom:3px;color:var(--text-primary)}
.facture-partie-info{font-size:12px;color:var(--text-secondary);margin-top:2px}
.facture-sep{border-top:1px solid var(--border-light);margin:14px 0}
.facture-section-title{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px}
.facture-table{width:100%;border-collapse:collapse;font-size:13px}
.facture-table th{background:var(--text-primary);color:var(--bg-primary);padding:8px 10px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
.facture-table td{padding:9px 10px;border-bottom:0.5px solid var(--border-light);color:var(--text-primary)}
.facture-totaux{display:flex;flex-direction:column;align-items:flex-end;gap:5px;margin:10px 0}
.facture-total-row{display:flex;justify-content:space-between;width:280px;font-size:13px;padding:4px 0;border-bottom:0.5px solid var(--border-light)}
.facture-total-final{font-size:15px;font-weight:700;padding:7px 0;border-top:2px solid var(--text-primary);border-bottom:none}
.restant-due{color:var(--danger-text)}.solde-ok{color:var(--success-text)}
.facture-footer{margin-top:20px;text-align:center;padding-top:12px;border-top:0.5px solid var(--border-light)}
.facture-merci{font-size:14px;font-weight:600;margin-bottom:8px;color:var(--text-primary)}
.facture-conditions{font-size:11px;color:var(--text-tertiary);line-height:1.6;margin-bottom:6px}
.facture-footer-ref{font-size:10px;color:var(--text-tertiary);margin-top:4px}
`;
  document.head.appendChild(s);
})();

// ============================================
// INIT
// ============================================
(function init(){
  calculerCumuls();
  const rdEl=document.getElementById('rapport-date');
  if(rdEl) rdEl.value=today();

  // Onglets de statut du journal. Un seul écouteur sur le conteneur : les
  // boutons sont fixes, et poser un écouteur à chaque rendu les empilerait.
  const onglets = document.getElementById('onglets-statut');
  if (onglets) {
    onglets.addEventListener('click', function (e) {
      const b = e.target.closest('.onglet-filtre');
      if (b) choisirStatutJournal(b.dataset.statut || '', b);
    });
  }
})();
