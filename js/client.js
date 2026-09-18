/**
 * KAYOR — Portail Client
 * ---------------------------------------------------------------------------
 * Connexion : téléphone + code PIN à 4 chiffres.
 *
 * Le portail n'accède plus aux tables. Auparavant il téléchargeait la fiche
 * cliente avec la clé publiable puis comparait le PIN dans le navigateur :
 * n'importe qui pouvait lire tous les codes, et 4 chiffres se forcent en
 * quelques secondes. Désormais il ne peut appeler que quatre fonctions
 * serveur, qui vérifient le PIN en bcrypt, bloquent après 5 échecs et
 * délivrent un jeton de session à durée limitée.
 */

const SUPA_URL = 'https://yflvtquowzvghwxyvuah.supabase.co';
const SUPA_KEY = 'sb_publishable_3EBGFxeT8B8cys54IZj3Nw_ZTS-4ZR1';

// Le jeton vit dans sessionStorage, pas localStorage : le portail est souvent
// ouvert depuis une tablette de boutique ou un téléphone prêté. La session
// disparaît à la fermeture de l'onglet.
const CLE_JETON = 'kayor_portail_token';

var JETON     = null;
var CLIENT    = null;
var COMPTES   = [];
var COMMANDES = [];
var DERNIER_DEPOT = null;

// ─── Utilitaires ───────────────────────────────────────────

function fmt(n){ return Number(n||0).toLocaleString('fr-FR') + ' FCFA'; }
function fmtDate(d){ if(!d) return '—'; var p=String(d).split('-'); return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:d; }
function today(){ return new Date().toISOString().slice(0,10); }

function showToast(msg, dur){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(function(){ t.classList.remove('show'); }, dur||3000);
}

function showLoading(on){
  document.getElementById('loading-overlay').style.display = on ? 'flex' : 'none';
}

function openModal(id){  document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }

function erreurLogin(msg){
  var e = document.getElementById('login-error');
  e.textContent = msg || '';
  e.style.display = msg ? 'block' : 'none';
}

// ─── Appels serveur ────────────────────────────────────────

/**
 * Seule porte d'entrée du portail : les quatre fonctions autorisées.
 * Tout accès direct aux tables est refusé par PostgreSQL depuis que RLS est
 * actif — le portail n'a volontairement aucun privilège de lecture.
 */
async function rpc(nom, params){
  var ctrl = new AbortController();
  var tid  = setTimeout(function(){ ctrl.abort(); }, 15000);
  try {
    var r = await fetch(SUPA_URL + '/rest/v1/rpc/' + nom, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY
      },
      body: JSON.stringify(params || {}),
      signal: ctrl.signal
    });
    if(!r.ok) throw new Error('Service indisponible (' + r.status + ').');
    return await r.json();
  } catch(e){
    if(e.name === 'AbortError') throw new Error('Le serveur met trop de temps à répondre.');
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

// ─── Navigation ────────────────────────────────────────────

function showPage(id){
  document.getElementById('page-login').style.display = 'none';
  document.getElementById('page-dashboard').style.display = 'none';
  var el = document.getElementById(id);
  if(!el) return;
  // Valeur explicite : une règle CSS pose display:none, et remettre une chaîne
  // vide laisserait cette règle s'appliquer — la page resterait invisible.
  el.style.display = (id === 'page-login') ? 'flex' : 'block';
}

// ─── Saisie du PIN ─────────────────────────────────────────

function pinNav(el, nextId, prevId, autoSubmit){
  var val = el.value.replace(/\D/g,'');
  el.value = val;
  if(val && nextId){
    document.getElementById(nextId).focus();
  } else if(!val && prevId && window.event && window.event.key === 'Backspace'){
    document.getElementById(prevId).focus();
  }
  if(autoSubmit && val) doLogin();
}

function getPin(){
  return ['pin-1','pin-2','pin-3','pin-4'].map(function(id){
    return document.getElementById(id).value.replace(/\D/g,'');
  }).join('');
}

function clearPin(){
  ['pin-1','pin-2','pin-3','pin-4'].forEach(function(id){
    document.getElementById(id).value = '';
  });
}

// ─── Connexion ─────────────────────────────────────────────

async function doLogin(){
  var tel = document.getElementById('login-tel').value.trim();
  var pin = getPin();
  erreurLogin('');

  if(!tel){ erreurLogin('Veuillez saisir votre numéro de téléphone.'); return; }
  if(pin.length !== 4){ erreurLogin('Veuillez saisir votre code PIN (4 chiffres).'); return; }

  showLoading(true);
  try {
    var res = await rpc('portail_login', { p_tel: tel, p_pin: pin });

    if(!res || !res.ok){
      showLoading(false);
      // Le serveur renvoie le même message pour un numéro inconnu et un PIN
      // faux : distinguer les deux permettrait de savoir qui est cliente.
      erreurLogin((res && res.erreur) || 'Connexion impossible.');
      clearPin();
      document.getElementById('pin-1').focus();
      return;
    }

    JETON  = res.token;
    CLIENT = res.client;
    try { sessionStorage.setItem(CLE_JETON, JETON); } catch(e){ /* navigation privée */ }

    await chargerDonnees();
    afficherDashboard();
  } catch(e){
    showLoading(false);
    erreurLogin(e.message || 'Erreur de connexion. Vérifiez votre réseau.');
    console.error(e);
  }
}

async function chargerDonnees(){
  var res = await rpc('portail_donnees', { p_token: JETON });
  if(!res || !res.ok){
    throw new Error((res && res.erreur) || 'Session expirée.');
  }
  CLIENT    = res.client   || CLIENT;
  COMPTES   = res.comptes  || [];
  COMMANDES = res.commandes || [];
}

/**
 * Reprise de session au chargement de la page.
 *
 * Le voile de chargement est visible par défaut dans le CSS : c'est ce code
 * qui doit le retirer, quel que soit le chemin pris. Sortir sans le masquer
 * laissait la page tourner indéfiniment pour toute première visite.
 */
async function reprendreSession(){
  var jeton = null;
  try { jeton = sessionStorage.getItem(CLE_JETON); } catch(e){}

  try {
    if(jeton){
      JETON = jeton;
      await chargerDonnees();
      afficherDashboard();
      return;
    }
  } catch(e){
    // Jeton expiré ou révoqué : on repart proprement de l'écran de connexion.
    JETON = null;
    try { sessionStorage.removeItem(CLE_JETON); } catch(_){}
  }

  // Le balisage pose display:none sur les deux pages : il faut afficher
  // explicitement l'écran de connexion, sinon la page reste noire.
  showPage('page-login');
  showLoading(false);
}

// ─── Tableau de bord ───────────────────────────────────────

function afficherDashboard(){
  showLoading(false);
  document.getElementById('dash-client-nom').textContent = CLIENT.nom || '';
  renderComptes();
  renderCommandes();
  showPage('page-dashboard');
}

function renderComptes(){
  var el = document.getElementById('comptes-list');
  if(!COMPTES.length){
    el.innerHTML = '<div class="empty-state"><div class="icon">💰</div><div>Aucun compte épargne</div></div>';
    return;
  }

  el.innerHTML = COMPTES.map(function(cc){
    var mvts = (cc.mouvements || []).slice(0, 5);
    var mvtHtml = mvts.length ? mvts.map(function(m){
      var retrait = (m.type === 'retrait');
      return '<div class="mvt-item">' +
        '<div><div class="mvt-date">' + fmtDate(m.date) + '</div>' +
        '<div class="mvt-note">' + esc(m.note || (retrait ? 'Achat en boutique' : 'Dépôt')) + '</div></div>' +
        '<div class="' + (retrait ? 'mvt-amount retrait' : 'mvt-amount') + '">' +
        (retrait ? '−' : '+') + ' ' + fmt(m.montant) + '</div>' +
      '</div>';
    }).join('') : '<div style="font-size:12px;color:var(--sub);text-align:center;padding:8px">Aucun mouvement</div>';

    return '<div class="cc-card">' +
      '<div class="cc-card-header">' +
        '<div><div class="cc-solde-label">Solde épargne</div>' +
        '<div class="cc-solde">' + fmt(cc.solde) + '</div></div>' +
        '<div>' + (cc.actif ? '<span class="badge badge-green">Actif</span>'
                            : '<span class="badge badge-red">Clôturé</span>') + '</div>' +
      '</div>' +
      '<div class="mvt-list">' + mvtHtml + '</div>' +
      (cc.actif ? '<button class="btn-depot" onclick="ouvrirDepot(\'' + escJs(cc.id) + '\')">+ Effectuer un dépôt</button>' : '') +
    '</div>';
  }).join('');
}

/**
 * Commandes en cours : les ventes dont il reste quelque chose à payer.
 * L'ancienne table `bijoux_arrhes` n'alimente plus rien — le suivi se fait
 * depuis le journal des ventes.
 */
function renderCommandes(){
  var el = document.getElementById('arrhes-list');
  if(!COMMANDES.length){
    el.innerHTML = '<div class="empty-state"><div class="icon">💍</div><div>Aucune commande en cours</div></div>';
    return;
  }

  el.innerHTML = COMMANDES.map(function(v){
    var montant = v.montant || 0;
    var verse   = v.acompte || 0;
    var restant = v.restant || 0;
    var pct = montant > 0 ? Math.min(100, Math.round(verse / montant * 100)) : 0;

    return '<div class="arr-card">' +
      '<div class="arr-article">' + esc(v.description || 'Commande') + '</div>' +
      '<div class="arr-meta">' +
        '<span>📅 ' + fmtDate(v.date) + '</span>' +
        (v.num_facture ? '<span>🧾 ' + esc(v.num_facture) + '</span>' : '') +
        '<span class="badge badge-or">En cours</span>' +
      '</div>' +
      '<div class="amounts-row">' +
        '<div class="amount-box"><div class="val">' + fmt(montant) + '</div><div class="lbl">Prix total</div></div>' +
        '<div class="amount-box"><div class="val">' + fmt(verse) + '</div><div class="lbl">Versé</div></div>' +
        '<div class="amount-box"><div class="val" style="color:#f44336">' + fmt(restant) + '</div><div class="lbl">Restant</div></div>' +
      '</div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="progress-label"><span>' + pct + '% versé</span><span>' + fmt(montant) + '</span></div>' +
    '</div>';
  }).join('');
}

// ─── Dépôt ─────────────────────────────────────────────────

function ouvrirDepot(compteId){
  document.getElementById('depot-compte-id').value = compteId;
  document.getElementById('depot-montant').value = '';
  document.getElementById('depot-note').value = '';
  document.querySelectorAll('.qa-btn').forEach(function(b){ b.classList.remove('active'); });
  openModal('modal-depot');
}

function setMontantDepot(val){
  document.getElementById('depot-montant').value = val;
  document.querySelectorAll('.qa-btn').forEach(function(b){
    b.classList.toggle('active', parseInt(b.textContent.replace(/\s/g,''), 10) === val);
  });
}

function clearQA(){
  document.querySelectorAll('.qa-btn').forEach(function(b){ b.classList.remove('active'); });
}

async function confirmerDepot(){
  var compteId = document.getElementById('depot-compte-id').value;
  var montant  = parseInt(document.getElementById('depot-montant').value, 10) || 0;
  var note     = document.getElementById('depot-note').value.trim();

  if(montant < 500){ showToast('Montant minimum : 500 FCFA'); return; }

  showLoading(true);
  closeModal('modal-depot');

  try {
    // Le serveur revérifie le montant et que le compte appartient bien à la
    // cliente connectée : un montant trafiqué côté navigateur ne passe pas.
    var res = await rpc('portail_depot', {
      p_token: JETON, p_compte: compteId,
      p_montant: montant, p_note: note || null
    });

    if(!res || !res.ok){
      showLoading(false);
      showToast((res && res.erreur) || 'Dépôt refusé.');
      if(res && /session/i.test(res.erreur||'')) doLogout();
      return;
    }

    DERNIER_DEPOT = {
      montant: montant, note: note, date: today(),
      nouveauSolde: res.nouveau_solde
    };

    await chargerDonnees();   // on relit le serveur plutôt que de deviner l'état
    renderComptes();
    showLoading(false);
    afficherRecu();
  } catch(e){
    showLoading(false);
    showToast('Erreur dépôt : ' + e.message);
    console.error(e);
  }
}

// ─── Reçu ──────────────────────────────────────────────────

function afficherRecu(){
  if(!DERNIER_DEPOT) return;
  var d = DERNIER_DEPOT;

  var lignes = [
    ['Client',         CLIENT.nom],
    ['Date',           fmtDate(d.date)],
    ['Montant déposé', fmt(d.montant)],
    ['Nouveau solde',  fmt(d.nouveauSolde)]
  ];
  if(d.note) lignes.push(['Note', d.note]);

  document.getElementById('recu-table').innerHTML = lignes.map(function(l){
    return '<tr><td>' + esc(l[0]) + '</td><td>' + esc(l[1]) + '</td></tr>';
  }).join('');

  var btn = document.getElementById('btn-send-email');
  if(btn) btn.style.display = CLIENT.email ? '' : 'none';

  openModal('modal-recu');
}

async function envoyerRecu(){
  if(!DERNIER_DEPOT) return;
  if(!CLIENT.email){ showToast('Aucun email associé à votre compte.'); return; }

  // EmailJS se configure depuis le navigateur de l'administrateur : sur
  // l'appareil d'une cliente, cette configuration est absente. L'envoi de
  // reçus devra passer par le serveur (voir ARCHITECTURE.md).
  var conf = {};
  try { conf = JSON.parse(localStorage.getItem('marjan_emailjs') || '{}'); } catch(e){}
  if(!conf.serviceId || !conf.templateId || !conf.publicKey){
    showToast('L\'envoi par email n\'est pas disponible pour le moment.');
    return;
  }

  var btn = document.getElementById('btn-send-email');
  btn.textContent = '⏳ Envoi…';
  btn.disabled = true;

  try {
    emailjs.init(conf.publicKey);
    await emailjs.send(conf.serviceId, conf.templateId, {
      to_email:      CLIENT.email,
      to_name:       CLIENT.nom,
      depot_montant: Number(DERNIER_DEPOT.montant).toLocaleString('fr-FR'),
      nouveau_solde: Number(DERNIER_DEPOT.nouveauSolde).toLocaleString('fr-FR'),
      date_depot:    fmtDate(DERNIER_DEPOT.date),
      note_depot:    DERNIER_DEPOT.note || ''
    });
    showToast('✓ Reçu envoyé à ' + CLIENT.email);
    closeModal('modal-recu');
  } catch(e){
    showToast('Erreur email : ' + e.message);
    console.error(e);
  } finally {
    btn.textContent = '📧 Recevoir par email';
    btn.disabled = false;
  }
}

// ─── Déconnexion ───────────────────────────────────────────

async function doLogout(){
  var jeton = JETON;
  JETON = null; CLIENT = null; COMPTES = []; COMMANDES = []; DERNIER_DEPOT = null;
  try { sessionStorage.removeItem(CLE_JETON); } catch(e){}

  clearPin();
  document.getElementById('login-tel').value = '';
  erreurLogin('');
  showPage('page-login');

  // Invalide le jeton côté serveur : sans cela il resterait valable deux heures.
  if(jeton){ try { await rpc('portail_logout', { p_token: jeton }); } catch(e){} }
}

document.addEventListener('DOMContentLoaded', reprendreSession);
