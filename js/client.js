/**
 * KAYOR — Portail Client
 * Connexion : téléphone + PIN 4 chiffres
 * Données directement depuis Supabase REST API
 */

const SUPA_URL = 'https://yflvtquowzvghwxyvuah.supabase.co';
const SUPA_KEY = 'sb_publishable_3EBGFxeT8B8cys54IZj3Nw_ZTS-4ZR1';
const SUPA_H = {
  'Content-Type': 'application/json',
  'apikey':        SUPA_KEY,
  'Authorization': 'Bearer ' + SUPA_KEY
};

// État courant
var CLIENT   = null; // objet client connecté
var COMPTES  = [];   // comptes épargne du client
var ARRHES   = [];   // bijoux en arrhes du client
var LAST_DEPOT = null; // dernier dépôt pour le reçu
var EMAILJS_LOADED = false;

// ─── Utilitaires ───────────────────────────────────────────

function fmt(n){ return Number(n||0).toLocaleString('fr-FR') + ' FCFA'; }
function fmtDate(d){ if(!d) return '—'; var p=d.split('-'); return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:d; }
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

function openModal(id){
  document.getElementById(id).classList.add('open');
}
function closeModal(id){
  document.getElementById(id).classList.remove('open');
}

// ─── Supabase REST ─────────────────────────────────────────

async function supaGet(table, filter){
  var url = SUPA_URL + '/rest/v1/' + table + '?select=*';
  if(filter) url += '&' + filter;
  var r = await fetch(url, { headers: SUPA_H });
  if(!r.ok) throw new Error(table + ' ' + r.status);
  return r.json();
}

async function supaPost(table, data){
  var r = await fetch(SUPA_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: Object.assign({}, SUPA_H, { 'Prefer': 'return=representation' }),
    body: JSON.stringify(Array.isArray(data) ? data : [data])
  });
  if(!r.ok) throw new Error(table + ' POST ' + r.status + ' — ' + await r.text());
  return r.json();
}

async function supaPatch(table, filter, data){
  var r = await fetch(SUPA_URL + '/rest/v1/' + table + '?' + filter, {
    method: 'PATCH',
    headers: Object.assign({}, SUPA_H, { 'Prefer': 'return=representation' }),
    body: JSON.stringify(data)
  });
  if(!r.ok) throw new Error(table + ' PATCH ' + r.status);
  return r.json();
}

// ─── Navigation ────────────────────────────────────────────

function showPage(id){
  document.getElementById('page-login').style.display = 'none';
  document.getElementById('page-dashboard').style.display = 'none';
  var el = document.getElementById(id);
  if(!el) return;
  el.style.display = (id === 'page-login') ? 'flex' : 'block';
}

// ─── PIN navigation ────────────────────────────────────────

function pinNav(el, nextId, prevId, autoSubmit){
  var val = el.value.replace(/\D/g,'');
  el.value = val;
  if(val && nextId) {
    document.getElementById(nextId).focus();
  } else if(!val && prevId && event.key==='Backspace') {
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

// ─── LOGIN ─────────────────────────────────────────────────

async function doLogin(){
  var tel = document.getElementById('login-tel').value.trim();
  var pin = getPin();
  var err = document.getElementById('login-error');
  err.style.display = 'none';

  if(!tel){ err.textContent='Veuillez saisir votre numéro de téléphone.'; err.style.display='block'; return; }
  if(pin.length !== 4){ err.textContent='Veuillez saisir votre code PIN (4 chiffres).'; err.style.display='block'; return; }

  showLoading(true);

  try {
    // Chercher le client par téléphone
    var telNorm = tel.replace(/\s/g,'');
    var clients = await supaGet('clients', 'tel=eq.'+encodeURIComponent(tel));
    // Fallback sans espaces
    if(!clients.length){
      clients = await supaGet('clients', 'tel=ilike.*'+telNorm+'*');
    }

    if(!clients.length){
      showLoading(false);
      err.textContent='Numéro de téléphone introuvable.'; err.style.display='block';
      return;
    }

    var client = clients[0];

    // Vérifier le PIN — d'abord Supabase, puis localStorage fallback
    var pinOk = false;
    if(client.pin){
      pinOk = (client.pin === pin);
    } else {
      // Fallback localStorage (admin app même appareil)
      try {
        var localPins = JSON.parse(localStorage.getItem('marjan_clients_pin')||'{}');
        pinOk = (localPins[client.id] === pin);
      } catch(e) { pinOk = false; }
    }

    if(!pinOk){
      showLoading(false);
      err.textContent='Code PIN incorrect.'; err.style.display='block';
      clearPin();
      document.getElementById('pin-1').focus();
      return;
    }

    CLIENT = client;
    await chargerDonnees();
    afficherDashboard();
  } catch(e){
    showLoading(false);
    err.textContent='Erreur de connexion. Vérifiez votre réseau.'; err.style.display='block';
    console.error(e);
  }
}

async function chargerDonnees(){
  var [comptes, mvtsCC, arrhes, mvtsArr] = await Promise.all([
    supaGet('comptes_clients', 'client=eq.'+encodeURIComponent(CLIENT.nom)),
    supaGet('mouvements_cc', 'order=id.asc'),
    supaGet('bijoux_arrhes', 'client=eq.'+encodeURIComponent(CLIENT.nom)),
    supaGet('mouvements_arrhes', 'order=id.asc')
  ]);

  COMPTES = comptes.map(function(cc){
    return Object.assign({}, cc, {
      mouvements: mvtsCC.filter(function(m){ return m.compte_id === cc.id; })
    });
  });

  ARRHES = arrhes.map(function(ba){
    return Object.assign({}, ba, {
      mouvements: mvtsArr.filter(function(m){ return m.arrhes_id === ba.id; })
    });
  });
}

// ─── DASHBOARD ─────────────────────────────────────────────

function afficherDashboard(){
  showLoading(false);
  document.getElementById('dash-client-nom').textContent = CLIENT.nom;
  renderComptes();
  renderArrhes();
  showPage('page-dashboard');
}

function renderComptes(){
  var el = document.getElementById('comptes-list');
  if(!COMPTES.length){
    el.innerHTML = '<div class="empty-state"><div class="icon">💰</div><div>Aucun compte épargne</div></div>';
    return;
  }

  el.innerHTML = COMPTES.map(function(cc){
    var pct = cc.objectif ? Math.min(100, Math.round(cc.solde / cc.objectif * 100)) : 0;
    var derniers = (cc.mouvements||[]).slice(-5).reverse();

    var mvtHtml = derniers.length ? derniers.map(function(m){
      var cls = (m.type==='retrait') ? 'mvt-amount retrait' : 'mvt-amount';
      var signe = (m.type==='retrait') ? '-' : '+';
      return '<div class="mvt-item">' +
        '<div><div class="mvt-date">'+fmtDate(m.date)+'</div><div class="mvt-note">'+(m.note||m.type||'')+'</div></div>' +
        '<div class="'+cls+'">'+signe+' '+fmt(m.montant)+'</div>' +
      '</div>';
    }).join('') : '<div style="font-size:12px;color:var(--sub);text-align:center;padding:8px">Aucun mouvement</div>';

    return '<div class="cc-card">' +
      '<div class="cc-card-header">' +
        '<div><div class="cc-solde-label">Solde épargne</div><div class="cc-solde">'+fmt(cc.solde)+'</div></div>' +
        '<div>' + (cc.actif ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-red">Clôturé</span>') + '</div>' +
      '</div>' +
      (cc.objectif ? '<div class="cc-objet">Objectif : '+fmt(cc.objectif)+(cc.objetCible?' — '+cc.objetCible:'')+'</div>' : '') +
      (cc.objectif ? '<div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%"></div></div>' +
        '<div class="progress-label"><span>'+pct+'%</span><span>'+fmt(cc.objectif)+'</span></div>' : '') +
      '<div class="mvt-list">' + mvtHtml + '</div>' +
      (cc.actif ? '<button class="btn-depot" onclick="ouvrirDepot(\''+cc.id+'\')">+ Effectuer un dépôt</button>' : '') +
    '</div>';
  }).join('');
}

function renderArrhes(){
  var el = document.getElementById('arrhes-list');
  if(!ARRHES.length){
    el.innerHTML = '<div class="empty-state"><div class="icon">💍</div><div>Aucun bijou réservé</div></div>';
    return;
  }

  el.innerHTML = ARRHES.map(function(ba){
    var pct = ba.prix_total ? Math.min(100, Math.round(ba.arrhes_verse / ba.prix_total * 100)) : 0;
    var statutBadge = {en_cours:'badge-or', solde:'badge-green', annule:'badge-red'}[ba.statut] || 'badge-or';
    var statutLabel = {en_cours:'En cours', solde:'Soldé', annule:'Annulé'}[ba.statut] || ba.statut;

    return '<div class="arr-card">' +
      '<div class="arr-article">'+(ba.article||ba.description||'Bijou réservé')+'</div>' +
      '<div class="arr-meta">' +
        '<span>📅 '+fmtDate(ba.date)+'</span>' +
        (ba.date_echeance ? '<span>⏰ Échéance: '+fmtDate(ba.date_echeance)+'</span>' : '') +
        '<span class="badge '+statutBadge+'">'+statutLabel+'</span>' +
      '</div>' +
      '<div class="amounts-row">' +
        '<div class="amount-box"><div class="val">'+fmt(ba.prix_total)+'</div><div class="lbl">Prix total</div></div>' +
        '<div class="amount-box"><div class="val">'+fmt(ba.arrhes_verse)+'</div><div class="lbl">Versé</div></div>' +
        '<div class="amount-box"><div class="val" style="color:'+(ba.restant_du>0?'#f44336':'#4caf50')+'">'+fmt(ba.restant_du)+'</div><div class="lbl">Restant</div></div>' +
      '</div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%"></div></div>' +
      '<div class="progress-label"><span>'+pct+'% versé</span><span>'+fmt(ba.prix_total)+'</span></div>' +
    '</div>';
  }).join('');
}

// ─── DÉPÔT ─────────────────────────────────────────────────

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
    b.classList.toggle('active', parseInt(b.textContent.replace(/\s/g,'')) === val);
  });
}

function clearQA(){
  document.querySelectorAll('.qa-btn').forEach(function(b){ b.classList.remove('active'); });
}

async function confirmerDepot(){
  var compteId = document.getElementById('depot-compte-id').value;
  var montant  = parseFloat(document.getElementById('depot-montant').value) || 0;
  var note     = document.getElementById('depot-note').value.trim() || 'Dépôt client';

  if(montant < 500){ showToast('Montant minimum : 500 FCFA'); return; }

  var cc = COMPTES.find(function(c){ return c.id === compteId; });
  if(!cc){ showToast('Compte introuvable'); return; }

  var d = today();
  var nvSolde = (cc.solde || 0) + montant;

  showLoading(true);
  closeModal('modal-depot');

  try {
    // Ajouter le mouvement
    await supaPost('mouvements_cc', { compte_id: compteId, date: d, type: 'depot', montant: montant, note: note });
    // Mettre à jour le solde
    await supaPatch('comptes_clients', 'id=eq.'+encodeURIComponent(compteId), { solde: nvSolde });

    // Mettre à jour localement
    cc.solde = nvSolde;
    if(!cc.mouvements) cc.mouvements = [];
    cc.mouvements.push({ compte_id: compteId, date: d, type: 'depot', montant: montant, note: note });

    LAST_DEPOT = { compteId: compteId, montant: montant, note: note, date: d, nvSolde: nvSolde, cc: cc };

    renderComptes();
    showLoading(false);
    afficherRecu();
  } catch(e){
    showLoading(false);
    showToast('Erreur dépôt : ' + e.message);
    console.error(e);
  }
}

// ─── REÇU ──────────────────────────────────────────────────

function afficherRecu(){
  if(!LAST_DEPOT) return;
  var d = LAST_DEPOT;
  var cc = d.cc;
  var pct = cc.objectif ? Math.min(100, Math.round(d.nvSolde / cc.objectif * 100)) : null;

  var rows = [
    ['Client',         CLIENT.nom],
    ['Date',           fmtDate(d.date)],
    ['Montant déposé', fmt(d.montant)],
    ['Nouveau solde',  fmt(d.nvSolde)],
  ];
  if(cc.objectif) rows.push(['Progression', pct + '% de ' + fmt(cc.objectif)]);
  if(cc.objetCible) rows.push(['Objectif', cc.objetCible]);
  if(d.note) rows.push(['Note', d.note]);

  var html = rows.map(function(r, i){
    return '<tr class="'+(i===rows.length-1?'':'')+'"><td>'+r[0]+'</td><td>'+r[1]+'</td></tr>';
  }).join('');

  document.getElementById('recu-table').innerHTML = html;

  var btnEmail = document.getElementById('btn-send-email');
  btnEmail.style.display = CLIENT.email ? '' : 'none';

  openModal('modal-recu');
}

async function envoyerRecu(){
  if(!LAST_DEPOT){ return; }
  if(!CLIENT.email){ showToast('Aucun email associé à ce compte.'); return; }

  var conf = {};
  try { conf = JSON.parse(localStorage.getItem('marjan_emailjs')||'{}'); } catch(e){}
  if(!conf.serviceId || !conf.templateId || !conf.publicKey){
    showToast('EmailJS non configuré (demander à l\'admin).');
    return;
  }

  var d = LAST_DEPOT;
  var cc = d.cc;
  var pct = cc.objectif ? Math.min(100, Math.round(d.nvSolde / cc.objectif * 100)) : 0;

  var btn = document.getElementById('btn-send-email');
  btn.textContent = '⏳ Envoi…';
  btn.disabled = true;

  try {
    emailjs.init(conf.publicKey);
    await emailjs.send(conf.serviceId, conf.templateId, {
      to_email:     CLIENT.email,
      to_name:      CLIENT.nom,
      depot_montant: d.montant.toLocaleString('fr-FR'),
      nouveau_solde: d.nvSolde.toLocaleString('fr-FR'),
      objectif:      cc.objectif ? cc.objectif.toLocaleString('fr-FR') : '—',
      progression:   pct + '%',
      bijou_cible:   cc.objetCible || '—',
      date_depot:    fmtDate(d.date),
      note_depot:    d.note || ''
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

// ─── LOGOUT ────────────────────────────────────────────────

function doLogout(){
  CLIENT = null; COMPTES = []; ARRHES = []; LAST_DEPOT = null;
  clearPin();
  document.getElementById('login-tel').value = '';
  document.getElementById('login-error').style.display = 'none';
  showPage('page-login');
}

// ─── INIT ──────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', function(){
  showLoading(false);
  showPage('page-login');
  document.getElementById('login-tel').focus();
});
