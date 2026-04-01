/**
 * MARJAN BIJOUTERIE v3 — Application complète
 * Modules : Auth, Journal, Stocks, Achats, Sorties, Décaissements,
 *           Clients, Comptes clients (épargne), Bijoux en arrhes
 */

// ============================================
// STATE
// ============================================
const STATE = {
  currentUser: null,
  users:         loadLS('marjan_users',      INITIAL_USERS),
  ventes:        loadLS('marjan_ventes',     INITIAL_VENTES),
  clients:       loadLS('marjan_clients',    INITIAL_CLIENTS),
  stock:         loadLS('marjan_stock',      INITIAL_STOCK),
  sorties:       loadLS('marjan_sorties',    INITIAL_SORTIES),
  decaissements: loadLS('marjan_decaiss',    INITIAL_DECAISSEMENTS),
  achatsClients: loadLS('marjan_ac',         INITIAL_ACHATS_CLIENTS),
  comptesClients:loadLS('marjan_cc',         INITIAL_COMPTES_CLIENTS),
  bijouxArr:     loadLS('marjan_ba',         INITIAL_BIJOUX_ARR),
  connexions:    loadLS('marjan_connexions', INITIAL_CONNEXIONS),
  counters: loadLS('marjan_counters', { v:16, s:3, d:6, a:5, ac:3, cc:3, ba:3, cl:10, u:4, cn:8 }),
};

function loadLS(k, fb) { try { const s=localStorage.getItem(k); return s?JSON.parse(s):fb; } catch { return fb; } }
function save() {
  const keyMap = {
    users:'users', ventes:'ventes', clients:'clients', stock:'stock',
    sorties:'sorties', decaissements:'decaiss', achats:'achats',
    achatsClients:'ac', comptesClients:'cc', bijouxArr:'ba',
    connexions:'connexions', counters:'counters'
  };
  Object.keys(keyMap).forEach(k => localStorage.setItem('marjan_'+keyMap[k], JSON.stringify(STATE[k])));
}
function nextId(prefix, key) { STATE.counters[key]++; save(); return prefix+'-'+String(STATE.counters[key]).padStart(4,'0'); }

// ============================================
// PERMISSIONS
// ============================================
function peutAcceder(section) {
  if (!STATE.currentUser) return false;
  const perms = PERM_MAP[STATE.currentUser.role] || [];
  return perms.includes('all') || perms.includes(section);
}

function isAdmin() { return STATE.currentUser?.role === 'admin'; }

// ============================================
// AUTH
// ============================================
document.getElementById('login-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('login-user').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('login-pass').focus(); });

function resetAppData() {
  if (!confirm('Réinitialiser toutes les données ? (Utiliser uniquement en cas de problème de connexion)')) return;
  ['marjan_users','marjan_ventes','marjan_clients','marjan_stock','marjan_sorties',
   'marjan_decaiss','marjan_achats','marjan_ac','marjan_cc','marjan_ba',
   'marjan_connexions','marjan_counters'].forEach(k => localStorage.removeItem(k));
  location.reload();
}

function doLogin() {
  const login = document.getElementById('login-user').value.trim();
  const pass  = document.getElementById('login-pass').value;
  // Sécurité : vérifier que STATE.users est valide
  if (!Array.isArray(STATE.users) || STATE.users.length === 0) {
    document.getElementById('login-error').textContent = 'Données corrompues — réinitialisez via le bouton ci-dessous.';
    document.getElementById('login-error').style.display = 'block';
    return;
  }
  const user  = STATE.users.find(u => u.login===login && u.password===pass && u.actif);
  const errEl = document.getElementById('login-error');
  if (!user) { errEl.textContent='Identifiant ou mot de passe incorrect.'; errEl.style.display='block'; return; }
  errEl.style.display='none';
  STATE.currentUser = user;

  // Enregistrer la connexion
  enregistrerConnexion(user, 'connexion');

  document.getElementById('login-screen').style.display='none';
  document.getElementById('main-app').style.display='block';
  const role = ROLES[user.role];
  document.getElementById('user-avatar').textContent = user.nom.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase();
  document.getElementById('user-name').textContent = user.nom;
  document.getElementById('user-role-badge').textContent = role.label;
  document.getElementById('user-role-badge').style.background = role.bg;
  document.getElementById('user-role-badge').style.color = role.color;
  // Topbar mobile badge
  const tb = document.getElementById('topbar-role-badge');
  if (tb) { tb.textContent = role.label; tb.style.background = role.bg; tb.style.color = role.color; }
  buildNav();
  renderDashboard();
}

function doLogout() {
  if (STATE.currentUser) enregistrerConnexion(STATE.currentUser, 'déconnexion');
  STATE.currentUser = null;
  document.getElementById('main-app').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('login-user').value='';
  document.getElementById('login-pass').value='';
}

function enregistrerConnexion(user, action) {
  const now = new Date();
  const heure = now.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  const date  = now.toISOString().split('T')[0];
  STATE.counters.cn = (STATE.counters.cn || 8) + 1;
  STATE.connexions.unshift({
    id:    'CN-' + String(STATE.counters.cn).padStart(4,'0'),
    userId: user.id, nom: user.nom, role: user.role,
    date, heure, action,
    ip: '—',
  });
  // Garder max 200 entrées
  if (STATE.connexions.length > 200) STATE.connexions = STATE.connexions.slice(0, 200);
  save();
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
  if(id==='rapport_jour')    renderRapportJournalier();
  if(id==='achats_clients')renderAchatsClients();
  if(id==='sorties')       renderSorties();
  if(id==='decaissements') renderDecaissements();
  if(id==='clients')       renderClients();
  if(id==='compte_client') renderComptesClients();
  if(id==='bijou_arr')     renderBijouxArr();
  if(id==='historique')    renderHistorique();
}

// ============================================
// MODALS
// ============================================
function openModal(id) {
  if(id==='modal-nouvelle-vente')   prepNouvelleVente();
  if(id==='modal-add-produit')      { peuplerSelect('p-carat'); }
  if(id==='modal-add-sortie')       prepSortie();
  if(id==='modal-add-achat-client') { peuplerClientSelect('ac-client'); peuplerSelect('ac-carat'); peuplerTypeBijou('ac-type-bijou'); document.getElementById('ac-date').value=today(); }
  if(id==='modal-add-decaiss')      { prepDecaiss(); }
  if(id==='modal-add-compte-client'){ peuplerClientSelect('cc-client'); document.getElementById('cc-date').value=today(); }
  if(id==='modal-add-bijou-arr')    { peuplerClientSelect('ba-client'); peuplerArticleSelect('ba-article'); document.getElementById('ba-date').value=today(); }
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
function statutStock(i){if(i.qty===0)return{label:'Rupture',cls:'stock-out'};if(i.qty<=i.seuil)return{label:'Stock bas',cls:'stock-low'};return{label:'En stock',cls:'stock-ok'};}
function tier(t){if(t>=1000000)return{label:'Platine',cls:'tier-platine'};if(t>=500000)return{label:'Or',cls:'tier-gold'};return{label:'Argent',cls:'tier-silver'};}

function calcRestant(mId,aId,dId){
  const m=parseFloat(document.getElementById(mId)?.value)||0;
  const a=parseFloat(document.getElementById(aId)?.value)||0;
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
    !q || c.nom.toLowerCase().includes(q) || (c.tel||'').includes(q)
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
  const used=[...new Set(STATE.ventes.map(v=>v.carat).filter(Boolean))];
  sel.innerHTML='<option value="">Tous les carats</option>';
  CARATS_LIST.filter(c=>used.includes(c.code)).forEach(c=>{const o=document.createElement('option');o.value=c.code;o.textContent=c.code.toUpperCase();sel.appendChild(o);});
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

  const ventesMois=STATE.ventes.filter(v=>isMois(v.date));
  const totalMois =ventesMois.reduce((s,v)=>s+(v.montant||0),0);
  const totalEncaisse=STATE.ventes.reduce((s,v)=>s+(v.acompte||0),0);  // argent réellement reçu
  const totalDecaiss =STATE.decaissements.reduce((s,d)=>s+(d.montant||0),0);
  const soldeNet     =totalEncaisse - totalDecaiss;                      // en caisse net
  const totalRestants=STATE.ventes.reduce((s,v)=>s+(v.restant||0),0);
  const nbRestants   =STATE.ventes.filter(v=>(v.restant||0)>0).length;
  const decMois      =STATE.decaissements.filter(d=>isMois(d.date));
  const totalDecMois =decMois.reduce((s,d)=>s+(d.montant||0),0);
  const arrhesEnCours=STATE.bijouxArr.filter(b=>b.statut==='en_cours');
  const totalArrhes  =arrhesEnCours.reduce((s,b)=>s+(b.restantDu||0),0);

  document.getElementById('metric-ca').textContent=fmt(totalMois);
  document.getElementById('metric-ca-nb').textContent=ventesMois.length+' vente'+(ventesMois.length>1?'s':'');
  document.getElementById('metric-restants').textContent=fmt(totalRestants);
  document.getElementById('metric-nb-restants').textContent=nbRestants+' client'+(nbRestants>1?'s':'');
  document.getElementById('metric-decaiss').textContent=fmt(soldeNet);
  document.getElementById('metric-nb-decaiss').textContent=soldeNet>=0?'Solde positif':'Solde négatif';
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
  STATE.bijouxArr.filter(b=>b.statut==='en_cours'&&b.dateEcheance<today()).forEach(b=>alertes.push({type:'danger',msg:`Échéance dépassée : ${b.client} — ${b.article}`}));
  STATE.ventes.filter(v=>(v.restant||0)>0).forEach(v=>alertes.push({type:'warn',msg:`Restant dû : ${v.client} — ${fmt(v.restant)}`}));
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
    if(q&&!v.client.toLowerCase().includes(q)&&!v.description.toLowerCase().includes(q)&&!(clV?.tel||'').includes(q))return false;
    if(fc&&v.carat!==fc)return false;
    if(ft==='local'&&!(parseFloat(v.local)||0))return false;
    if(ft==='importe'&&!(parseFloat(v.importe)||0))return false;
    if(fr==='solde'&&(v.restant||0)>0)return false;
    if(fr==='en-cours'&&!(v.restant||0))return false;
    return true;
  });

  // Calculs cumul bar (pour la barre de totaux uniquement, plus de colonne)
  const tCumul    = STATE.ventes.reduce((s,v)=>s+(v.montant||0),0);
  const tEncaisse = STATE.ventes.reduce((s,v)=>s+(v.acompte||0),0);
  const tRest     = STATE.ventes.reduce((s,v)=>s+(v.restant||0),0);
  const tLoc      = STATE.ventes.reduce((s,v)=>s+(parseFloat(v.local)||0),0);
  const tImp      = STATE.ventes.reduce((s,v)=>s+(parseFloat(v.importe)||0),0);

  document.getElementById('journal-count-label').textContent=`${STATE.ventes.length} ventes · ${ventes.length} affichées`;
  document.getElementById('montant-cumul').textContent   = fmt(tCumul);
  document.getElementById('montant-encaisse').textContent= fmt(tEncaisse);
  document.getElementById('total-restants').textContent  = fmt(tRest);
  document.getElementById('poids-local-total').textContent  = tLoc.toFixed(2)+'g';
  document.getElementById('poids-importe-total').textContent= tImp.toFixed(2)+'g';

  const admin    = isAdmin();
  const canEdit  = admin || STATE.currentUser?.role === 'gestionnaire' || STATE.currentUser?.role === 'vendeur';

  document.getElementById('journal-body').innerHTML=ventes.map(v=>{
    const c=getCarat(v.carat);
    const dot=c?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.couleur};margin-right:4px;vertical-align:middle"></span>`:'';
    const rb=(v.restant||0)>0
      ? `<span class="stock-badge stock-low">${fmt(v.restant)}</span>`
      : `<span class="stock-badge stock-ok">Soldé</span>`;

    const nonFinalisee = (v.restant||0) > 0;

    // Modifier : admin toujours, gestionnaire/vendeur seulement si non finalisée
    const peutModifier = admin || (canEdit && nonFinalisee);
    const btnModif = peutModifier
      ? `<button class="btn small" onclick="ouvrirEditVente('${v.id}')" title="${nonFinalisee?'Modifier (non finalisée)':'Modifier'}">✎</button>`
      : `<span class="perm-lock" title="${nonFinalisee?'Non autorisé':'Vente finalisée — admin uniquement'}">🔒</span>`;

    // Supprimer : admin uniquement
    const btnSuppr = admin
      ? `<button class="btn small btn-danger" onclick="supprimerVente('${v.id}')" title="Supprimer">✕</button>`
      : '';

    // Acompte : accessible si restant > 0
    const btnAcompte = nonFinalisee
      ? `<button class="btn small" style="background:var(--warning-bg);color:var(--warning-text);border-color:transparent" onclick="ouvrirAjoutAcompte('${v.id}')" title="Ajouter un acompte">+&nbsp;Acompte</button>`
      : '';

    return`<tr>
      <td style="white-space:nowrap;font-size:12px;color:var(--text-secondary)">${fmtDate(v.date)}</td>
      <td><div style="display:flex;align-items:center;gap:7px">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${ini(v.client)}</div>
        <span>${v.client}</span>
      </div></td>
      <td style="font-size:12px;color:var(--text-secondary)">${v.description}${v.typeBijou?` <span class="type-bijou-pill">${TYPES_BIJOUX.find(t=>t.code===v.typeBijou)?.label||v.typeBijou}</span>`:''}</td>
      <td style="text-align:center">${(parseFloat(v.local)||0)>0?`<span class="badge-local">${fmtG(v.local)}</span>`:'<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td style="text-align:center">${(parseFloat(v.importe)||0)>0?`<span class="badge-importe">${fmtG(v.importe)}</span>`:'<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td><span class="carat-pill">${dot}${(v.carat||'—').toUpperCase()}</span></td>
      <td style="font-weight:500;white-space:nowrap">${fmt(v.montant)}</td>
      <td>${rb}</td>
      <td><div style="display:flex;gap:4px;align-items:center">${btnModif}${btnSuppr}</div></td>
      <td><div style="display:flex;gap:4px">${btnAcompte}</div></td>
      <td><button class="btn small" onclick="afficherFacture('${v.id}')" title="Ticket" style="font-size:14px">🖨</button></td>
    </tr>`;
  }).join('');
}
['journal-search','filtre-carat','filtre-type','filtre-restant'].forEach(id=>{document.getElementById(id)?.addEventListener('input',renderJournal);});

function prepNouvelleVente(){peuplerSelect('v-carat');peuplerTypeBijou('v-type-bijou');peuplerClientSelect('v-client');document.getElementById('v-date').value=today();['v-description','v-local','v-importe','v-montant','v-acompte'].forEach(id=>document.getElementById(id).value='');document.getElementById('v-restant-disp').value='—';document.getElementById('v-carat-badge').style.display='none';}

function enregistrerVente(){
  const date=document.getElementById('v-date').value,client=document.getElementById('v-client').value,desc=document.getElementById('v-description').value.trim(),local=parseFloat(document.getElementById('v-local').value)||0,importe=parseFloat(document.getElementById('v-importe').value)||0,carat=document.getElementById('v-carat').value,typeBijou=document.getElementById('v-type-bijou')?.value||'',montant=parseInt(document.getElementById('v-montant').value)||0,acompte=parseInt(document.getElementById('v-acompte').value)||0;
  if(!date||!client||!desc||!carat||montant<=0){showToast('⚠ Tous les champs obligatoires doivent être remplis.');return;}
  if(acompte>montant){showToast('⚠ L\'acompte ne peut pas dépasser le montant.');return;}
  const id=nextId('V','v');
  STATE.ventes.unshift({id,date,client,description:desc,local,importe,carat,typeBijou,montant,acompte,restant:montant-acompte});
  save();closeModal('modal-nouvelle-vente');renderJournal();renderDashboard();showToast(`✓ Vente ${id} — ${fmt(montant)}`);
}

function ouvrirEditVente(id){
  const v=STATE.ventes.find(x=>x.id===id);if(!v)return;
  const nonFinalisee = (v.restant||0) > 0;
  const admin = isAdmin();
  const role  = STATE.currentUser?.role;
  // Admin = toujours. Gestionnaire/Vendeur = seulement si non finalisée
  if(!admin && !nonFinalisee){
    showToast('⛔ Vente finalisée — modification réservée à l\'administrateur.');return;
  }
  if(!admin && role !== 'gestionnaire' && role !== 'vendeur'){
    showToast('⛔ Accès non autorisé.');return;
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
  const nonFinalisee=(v.restant||0)>0;
  const admin=isAdmin();
  const role=STATE.currentUser?.role;
  if(!admin && !nonFinalisee){showToast('⛔ Vente finalisée — modification réservée à l\'administrateur.');return;}
  if(!admin && role!=='gestionnaire' && role!=='vendeur'){showToast('⛔ Accès non autorisé.');return;}

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
  save();closeModal('modal-edit-vente');renderJournal();renderDashboard();
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
  if(!isAdmin()){showToast('⛔ Seul l\'administrateur peut supprimer une vente.');return;}
  if(!confirm(`Supprimer la vente ${id} ? Cette action est irréversible.`))return;
  STATE.ventes=STATE.ventes.filter(v=>v.id!==id);
  save();renderJournal();renderDashboard();showToast('Vente supprimée.');
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
  document.getElementById('stock-count-label').textContent=`${STATE.stock.length} références · ${STATE.stock.reduce((s,i)=>s+i.qty,0)} unités`;
  document.getElementById('stock-body').innerHTML=data.map(item=>{
    const st=statutStock(item);const c=getCarat(item.carat);const dot=c?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.couleur};margin-right:4px;vertical-align:middle"></span>`:'';
    const typeL={local:'Local',importe:'Importé',mixte:'Mixte',argent:'Argent',autre:'Autre'}[item.type]||item.type||'—';
    return`<tr><td><span class="ref-code">${item.ref}</span></td><td>${item.nom}</td><td><span class="carat-pill">${dot}${(item.carat||'—').toUpperCase()}</span></td><td><span style="font-size:12px;color:var(--text-secondary)">${typeL}</span></td><td style="text-align:center">${item.poids?item.poids+'g':'—'}</td><td><strong>${item.qty}</strong></td><td>${fmt(item.prix)}</td><td>${fmt(item.qty*item.prix)}</td><td><span class="stock-badge ${st.cls}">${st.label}</span></td><td><div style="display:flex;gap:4px"><button class="btn small" onclick="ajusterStock('${item.ref}')">Ajuster</button><button class="btn small btn-danger" onclick="supprimerArticle('${item.ref}')">✕</button></div></td></tr>`;
  }).join('');
}
document.getElementById('stock-search')?.addEventListener('input',function(){renderStocks(this.value);});

function ajouterProduit(){
  const ref=document.getElementById('p-ref').value.trim(),nom=document.getElementById('p-nom').value.trim(),carat=document.getElementById('p-carat').value,type=document.getElementById('p-type').value,poids=parseFloat(document.getElementById('p-poids').value)||0,qty=parseInt(document.getElementById('p-qty').value)||0,prix=parseInt(document.getElementById('p-prix').value)||0,seuil=parseInt(document.getElementById('p-seuil').value)||5;
  if(!ref||!nom){showToast('⚠ Référence et désignation obligatoires.');return;}
  if(STATE.stock.find(i=>i.ref===ref)){showToast('⚠ Cette référence existe déjà.');return;}
  STATE.stock.unshift({ref,nom,carat,type,poids,qty,prix,seuil});save();renderStocks();closeModal('modal-add-produit');showToast('✓ Article ajouté.');
}
function ajusterStock(ref){const i=STATE.stock.find(x=>x.ref===ref);if(!i)return;const n=prompt(`Qté pour "${i.nom}" (actuel: ${i.qty}):`,i.qty);if(n===null)return;const q=parseInt(n);if(isNaN(q)||q<0){showToast('⚠ Qté invalide.');return;}i.qty=q;save();renderStocks();showToast('✓ Stock ajusté.');}
function supprimerArticle(ref){if(!confirm('Supprimer '+ref+' ?'))return;STATE.stock=STATE.stock.filter(i=>i.ref!==ref);save();renderStocks();showToast('Article supprimé.');}

// ============================================
// SORTIES DE STOCK (admin only)
// ============================================
function prepSortie(){
  const sel=document.getElementById('s-article');sel.innerHTML='<option value="">— Sélectionner —</option>';
  STATE.stock.filter(i=>i.qty>0).forEach(i=>{const o=document.createElement('option');o.value=i.ref;o.textContent=`${i.ref} — ${i.nom} (${i.qty} dispo)`;sel.appendChild(o);});
  document.getElementById('s-date').value=today();
}
function renderSorties(){
  document.getElementById('sorties-count-label').textContent=`${STATE.sorties.length} sortie${STATE.sorties.length>1?'s':''} enregistrée${STATE.sorties.length>1?'s':''}`;
  document.getElementById('btn-add-sortie').style.display=isAdmin()?'':'none';
  document.getElementById('sorties-perm-warning').style.display=isAdmin()?'none':'flex';
  document.getElementById('sorties-body').innerHTML=[...STATE.sorties].sort((a,b)=>b.date.localeCompare(a.date)).map(s=>`<tr><td style="white-space:nowrap;font-size:12px;color:var(--text-secondary)">${fmtDate(s.date)}</td><td>${s.article}</td><td><span class="ref-code">${s.ref}</span></td><td style="text-align:center"><strong>${s.qty}</strong></td><td>${s.motif}${s.commentaire?` — <span style="color:var(--text-secondary)">${s.commentaire}</span>`:''}</td><td><span class="role-pill role-${s.validePar}">${s.validePar}</span></td></tr>`).join('');
}
function enregistrerSortie(){
  if(!isAdmin()){showToast('⛔ Seul l\'administrateur peut effectuer des sorties.');return;}
  const date=document.getElementById('s-date').value,ref=document.getElementById('s-article').value,motif=document.getElementById('s-motif').value,commentaire=document.getElementById('s-commentaire').value,qty=parseInt(document.getElementById('s-qty').value)||0;
  if(!date||!ref||!motif||qty<=0){showToast('⚠ Tous les champs sont obligatoires.');return;}
  const stock=STATE.stock.find(i=>i.ref===ref);if(!stock){showToast('⚠ Article introuvable.');return;}
  if(qty>stock.qty){showToast(`⚠ Quantité insuffisante (stock: ${stock.qty})`);return;}
  stock.qty-=qty;
  const id=nextId('S','s');
  STATE.sorties.unshift({id,date,ref,article:stock.nom,qty,motif,commentaire,validePar:'admin'});
  save();closeModal('modal-add-sortie');renderSorties();renderStocks();renderDashboard();showToast(`✓ Sortie ${id} enregistrée.`);
}

// ============================================
// ACHATS
// ============================================
function calcAchatTotal(){
  const p=parseFloat(document.getElementById('a-poids')?.value)||0,g=parseFloat(document.getElementById('a-prix-g')?.value)||0;
  const el=document.getElementById('a-total-disp');if(el)el.value=p>0&&g>0?fmt(Math.round(p*g)):'—';
}
function renderAchats(){
  const mois=STATE.achats.filter(a=>isMois(a.date));
  document.getElementById('achats-count-label').textContent=`${STATE.achats.length} achat${STATE.achats.length>1?'s':''} enregistré${STATE.achats.length>1?'s':''}`;
  document.getElementById('metric-achat-mois').textContent=fmt(mois.reduce((s,a)=>s+(a.montantTotal||0),0));
  document.getElementById('metric-achat-total').textContent=fmt(STATE.achats.reduce((s,a)=>s+(a.montantTotal||0),0));
  document.getElementById('metric-achat-poids').textContent=STATE.achats.reduce((s,a)=>s+(a.poids||0),0).toFixed(2)+' g';
  document.getElementById('achats-body').innerHTML=[...STATE.achats].sort((a,b)=>b.date.localeCompare(a.date)).map(a=>{
    const c=getCarat(a.carat);const dot=c?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.couleur};margin-right:4px;vertical-align:middle"></span>`:'';
    return`<tr><td style="white-space:nowrap;font-size:12px;color:var(--text-secondary)">${fmtDate(a.date)}</td><td>${a.fournisseur}</td><td>${a.description}</td><td><span class="carat-pill">${dot}${(a.carat||'—').toUpperCase()}</span></td><td style="text-align:center">${a.poids}g</td><td>${fmt(a.prixUnitaire)}/g</td><td style="font-weight:500">${fmt(a.montantTotal)}</td><td><span class="role-pill role-${a.saisiPar}">${a.saisiPar}</span></td><td><button class="btn small btn-danger" onclick="supprimerAchat('${a.id}')">✕</button></td></tr>`;
  }).join('');
}
function enregistrerAchat(){
  const date=document.getElementById('a-date').value,four=document.getElementById('a-fournisseur').value.trim(),desc=document.getElementById('a-description').value.trim(),carat=document.getElementById('a-carat').value,poids=parseFloat(document.getElementById('a-poids').value)||0,prixG=parseFloat(document.getElementById('a-prix-g').value)||0;
  if(!date||!four||!desc||!carat||poids<=0||prixG<=0){showToast('⚠ Tous les champs sont obligatoires.');return;}
  const id=nextId('A','a');
  STATE.achats.unshift({id,date,fournisseur:four,description:desc,carat,poids,prixUnitaire:Math.round(prixG),montantTotal:Math.round(poids*prixG),saisiPar:STATE.currentUser?.role||'admin'});
  save();closeModal('modal-add-achat');renderAchats();renderDashboard();showToast(`✓ Achat ${id} enregistré.`);
}
function supprimerAchat(id){if(!confirm('Supprimer cet achat ?'))return;STATE.achats=STATE.achats.filter(a=>a.id!==id);save();renderAchats();showToast('Achat supprimé.');}

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
  const caVentes=STATE.ventes.filter(v=>isMois(v.date)).reduce((s,v)=>s+(v.montant||0),0);
  document.getElementById('decaiss-count-label').textContent=`${STATE.decaissements.length} décaissement${STATE.decaissements.length>1?'s':''}`;
  document.getElementById('metric-decaiss-mois').textContent=fmt(totalMois);
  document.getElementById('metric-decaiss-all').textContent=fmt(totalAll);
  document.getElementById('metric-solde-net').textContent=fmt(caVentes-totalMois);
  document.getElementById('decaiss-body').innerHTML=[...STATE.decaissements].sort((a,b)=>b.date.localeCompare(a.date)).map(d=>`<tr><td style="white-space:nowrap;font-size:12px;color:var(--text-secondary)">${fmtDate(d.date)}</td><td><span class="cat-badge">${d.categorie}</span></td><td>${d.description}</td><td style="font-weight:500;color:var(--danger-text)">${fmt(d.montant)}</td><td><span class="role-pill role-${d.saisiPar}">${d.saisiPar}</span></td><td><button class="btn small btn-danger" onclick="supprimerDecaiss('${d.id}')">✕</button></td></tr>`).join('');
}
function enregistrerDecaissement(){
  const date=document.getElementById('d-date').value,cat=document.getElementById('d-categorie').value,desc=document.getElementById('d-description').value.trim(),montant=parseInt(document.getElementById('d-montant').value)||0;
  if(!date||!cat||!desc||montant<=0){showToast('⚠ Tous les champs sont obligatoires.');return;}
  const id=nextId('D','d');
  STATE.decaissements.unshift({id,date,categorie:cat,description:desc,montant,saisiPar:STATE.currentUser?.role||'admin'});
  save();closeModal('modal-add-decaiss');renderDecaissements();renderDashboard();showToast(`✓ Décaissement ${id} enregistré.`);
}
function supprimerDecaiss(id){if(!isAdmin()){showToast('⛔ Seul l\'administrateur peut supprimer un décaissement.');return;}if(!confirm('Supprimer ce décaissement ?'))return;STATE.decaissements=STATE.decaissements.filter(d=>d.id!==id);save();renderDecaissements();showToast('Décaissement supprimé.');}

// ============================================
// CLIENTS
// ============================================
function renderClients(f=''){
  const q=f.toLowerCase();
  const data=STATE.clients.filter(c=>c.nom.toLowerCase().includes(q)||c.tel.includes(q)||(c.email||'').toLowerCase().includes(q));
  document.getElementById('clients-count-label').textContent=`${STATE.clients.length} clients`;
  const stats={};STATE.ventes.forEach(v=>{if(!stats[v.client])stats[v.client]={total:0,restant:0,nb:0,derniere:''};stats[v.client].total+=(v.montant||0);stats[v.client].restant+=(v.restant||0);stats[v.client].nb+=1;if(!stats[v.client].derniere||v.date>stats[v.client].derniere)stats[v.client].derniere=v.date;});
  document.getElementById('clients-body').innerHTML=data.map(c=>{const s=stats[c.nom]||{total:0,restant:0,nb:0,derniere:''};const t=tier(s.total);const d=s.derniere===today()?"Aujourd'hui":s.derniere?fmtDate(s.derniere):'—';return`<tr><td><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${ini(c.nom)}</div><div><div style="font-size:13px;font-weight:500">${c.nom}</div><div style="font-size:11px;color:var(--text-tertiary)">${c.tel}</div></div></div></td><td>${c.tel}</td><td><strong>${fmt(s.total)}</strong></td><td>${s.restant>0?`<span class="stock-badge stock-low">${fmt(s.restant)}</span>`:'<span style="color:var(--success-text);font-size:12px">Soldé</span>'}</td><td>${s.nb}</td><td><span class="tier-badge ${t.cls}">${t.label}</span></td><td style="font-size:12px;color:var(--text-secondary)">${d}</td></tr>`;}).join('');
}
document.getElementById('client-search')?.addEventListener('input',function(){renderClients(this.value);});
document.getElementById('cc-search')?.addEventListener('input',function(){renderComptesClients(this.value);});
function ajouterClient(){
  const nom=document.getElementById('c-nom').value.trim(),tel=document.getElementById('c-tel').value.trim(),email=document.getElementById('c-email').value.trim(),adresse=document.getElementById('c-adresse').value.trim();
  if(!nom||!tel){showToast('⚠ Nom et téléphone obligatoires.');return;}
  if(STATE.clients.find(c=>c.tel===tel)){showToast('⚠ Ce numéro existe déjà.');return;}
  const id=nextId('CL','cl');STATE.clients.unshift({id,nom,tel,email,adresse});save();renderClients();closeModal('modal-add-client');['c-nom','c-tel','c-email','c-adresse'].forEach(x=>document.getElementById(x).value='');showToast(`✓ Client "${nom}" ajouté.`);
}

// ============================================
// COMPTES CLIENTS (épargne)
// ============================================
function renderComptesClients(filtre=''){
  const q = filtre.toLowerCase();
  document.getElementById('cc-count-label').textContent=`${STATE.comptesClients.length} compte${STATE.comptesClients.length>1?'s':''} — épargne bijoux`;
  const ccFiltres = STATE.comptesClients.filter(cc => { if(!q) return true; const clCC=STATE.clients.find(c=>c.nom===cc.client); return cc.client.toLowerCase().includes(q)||(clCC?.tel||'').includes(q); });
  document.getElementById('cc-list').innerHTML = ccFiltres.length===0
    ? '<div style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px">Aucun compte ouvert</div>'
    : ccFiltres.map(cc=>{
    return`<div style="padding:16px 20px;border-bottom:0.5px solid var(--border-light)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:38px;height:38px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0">${ini(cc.client)}</div>
          <div>
            <div style="font-size:14px;font-weight:600">${cc.client}</div>
            <div style="font-size:12px;color:var(--text-secondary)">Ouvert le ${fmtDate(cc.dateOuverture)} · ${cc.mouvements.length} dépôt${cc.mouvements.length>1?'s':''}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:700;color:var(--success-text)">${fmt(cc.solde)}</div>
          <div style="font-size:11px;color:var(--text-tertiary)">solde disponible</div>
        </div>
      </div>
      <div style="margin-bottom:12px;background:var(--bg-secondary);border-radius:var(--radius-md);padding:10px 12px">
        ${cc.mouvements.slice().reverse().slice(0,5).map(m=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:0.5px solid var(--border-light)"><span style="color:var(--text-secondary)">${fmtDate(m.date)} — ${m.note}</span><span style="color:var(--success-text);font-weight:500">+${fmt(m.montant)}</span></div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small btn-primary" onclick="openDepotCC('${cc.id}')">+ Dépôt</button>
        <button class="btn small" style="background:var(--success-bg);color:var(--success-text);border-color:transparent" onclick="cloturerCC('${cc.id}')">✓ Clôturer &amp; convertir</button>
        <button class="btn small btn-danger" onclick="supprimerCC('${cc.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}
function creerCompteClient(){
  const client=document.getElementById('cc-client').value,date=document.getElementById('cc-date').value,depot=parseInt(document.getElementById('cc-depot-init').value)||0;
  if(!client||!date||depot<=0){showToast('⚠ Client, date et dépôt initial sont obligatoires.');return;}
  const id=nextId('CC','cc');
  STATE.comptesClients.push({id,client,dateOuverture:date,solde:depot,actif:true,mouvements:[{date,type:'depot',montant:depot,note:'Ouverture compte'}]});
  save();closeModal('modal-add-compte-client');renderComptesClients();renderDashboard();showToast(`✓ Compte ${id} créé pour ${client}.`);
}
function openDepotCC(id){document.getElementById('depot-cc-id').value=id;document.getElementById('depot-cc-date').value=today();document.getElementById('depot-cc-montant').value='';document.getElementById('depot-cc-note').value='';document.getElementById('modal-depot-cc').classList.add('show');}
function ajouterDepotCC(){
  const id=document.getElementById('depot-cc-id').value,date=document.getElementById('depot-cc-date').value,montant=parseInt(document.getElementById('depot-cc-montant').value)||0,note=document.getElementById('depot-cc-note').value||'Dépôt';
  if(!date||montant<=0){showToast('⚠ Date et montant obligatoires.');return;}
  const cc=STATE.comptesClients.find(c=>c.id===id);if(!cc)return;
  cc.solde+=montant;cc.mouvements.push({date,type:'depot',montant,note});
  save();closeModal('modal-depot-cc');renderComptesClients();renderDashboard();showToast(`✓ Dépôt de ${fmt(montant)} ajouté.`);
}
function cloturerCC(id){
  const cc=STATE.comptesClients.find(c=>c.id===id);if(!cc)return;
  if(!confirm(`Clôturer le compte de ${cc.client} et créer une vente de ${fmt(cc.solde)} ?`))return;
  const vid=nextId('V','v');
  STATE.ventes.unshift({id:vid,date:today(),client:cc.client,description:'Clôture compte épargne — solde encaissé',local:0,importe:0,carat:'18k',montant:cc.solde,acompte:cc.solde,restant:0});
  cc.actif=false;save();renderComptesClients();renderJournal();showToast(`✓ Compte clôturé — vente ${vid} créée.`);
}
function supprimerCC(id){if(!confirm('Supprimer ce compte ?'))return;STATE.comptesClients=STATE.comptesClients.filter(c=>c.id!==id);save();renderComptesClients();showToast('Compte supprimé.');}

// ============================================
// BIJOUX EN ARRHES
// ============================================
function remplirPrixBijouArr(){
  const sel=document.getElementById('ba-article');const opt=sel.options[sel.selectedIndex];
  if(opt?.dataset.prix){document.getElementById('ba-prix').value=opt.dataset.prix;calcBijouArrRestant();}
}
function calcBijouArrRestant(){
  const p=parseFloat(document.getElementById('ba-prix')?.value)||0,a=parseFloat(document.getElementById('ba-arrhes')?.value)||0;
  const el=document.getElementById('ba-restant-disp');if(!el)return;
  const r=Math.max(0,p-a);el.value=p>0?(r===0?'Soldé ✓':fmt(r)):'—';el.style.color=r===0&&p>0?'var(--success-text)':r>0?'var(--warning-text)':'';
}
function renderBijouxArr(){
  const enCours=STATE.bijouxArr.filter(b=>b.statut==='en_cours');const soldes=STATE.bijouxArr.filter(b=>b.statut==='solde');
  document.getElementById('ba-count-label').textContent=`${enCours.length} en cours · ${soldes.length} soldé${soldes.length>1?'s':''}`;
  document.getElementById('ba-list').innerHTML=STATE.bijouxArr.length===0?'<div style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px">Aucune réservation</div>':
  STATE.bijouxArr.map(ba=>{
    const ec=ba.statut==='en_cours';const pct=Math.min(100,Math.round((ba.arrhesVerse/ba.prixTotal)*100));const overdue=ec&&ba.dateEcheance<today();
    return`<div style="padding:16px 20px;border-bottom:0.5px solid var(--border-light)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-weight:500">${ba.client}</span>
            <span class="stock-badge ${ec?(overdue?'stock-out':'stock-low'):'stock-ok'}">${ec?(overdue?'Échéance dépassée':'En cours'):'Soldé'}</span>
            <span class="ref-code">#${ba.id}</span>
          </div>
          <div style="font-size:13px;color:var(--text-secondary)">${ba.article}</div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">Réservé le ${fmtDate(ba.date)} · Échéance : ${fmtDate(ba.dateEcheance)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:16px;font-weight:600">${fmt(ba.prixTotal)}</div>
          <div style="font-size:12px;color:var(--success-text)">Arrhes : ${fmt(ba.arrhesVerse)}</div>
          ${ba.restantDu>0?`<div style="font-size:12px;color:var(--warning-text)">Restant : ${fmt(ba.restantDu)}</div>`:''}
        </div>
      </div>
      <div class="bar-track" style="height:8px;margin-bottom:10px"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:10px">
        ${ba.mouvements.map(m=>`<span style="margin-right:12px">${fmtDate(m.date)} : +${fmt(m.montant)} — ${m.note}</span>`).join('')}
      </div>
      ${ec?`<div style="display:flex;gap:8px"><button class="btn small btn-primary" onclick="openPaiementArr('${ba.id}')">+ Paiement</button><button class="btn small" onclick="retournerStockArr('${ba.id}')">⟲ Retour stock</button></div>`:'<span style="font-size:12px;color:var(--success-text)">✓ Entièrement soldé</span>'}
    </div>`;
  }).join('');
}
function enregistrerBijouArr(){
  const date=document.getElementById('ba-date').value,client=document.getElementById('ba-client').value,ref=document.getElementById('ba-article').value,prix=parseInt(document.getElementById('ba-prix').value)||0,arrhes=parseInt(document.getElementById('ba-arrhes').value)||0,echeance=document.getElementById('ba-echeance').value;
  if(!date||!client||!ref||prix<=0||arrhes<=0||!echeance){showToast('⚠ Tous les champs sont obligatoires.');return;}
  if(arrhes>prix){showToast('⚠ Les arrhes ne peuvent pas dépasser le prix.');return;}
  if(echeance<=date){showToast('⚠ L\'échéance doit être après la date de réservation.');return;}
  const stock=STATE.stock.find(i=>i.ref===ref);const articleLabel=stock?`${ref} — ${stock.nom}`:ref;
  const id=nextId('BA','ba');
  STATE.bijouxArr.unshift({id,date,client,article:articleLabel,prixTotal:prix,arrhesVerse:arrhes,restantDu:prix-arrhes,dateEcheance:echeance,statut:'en_cours',mouvements:[{date,montant:arrhes,note:'Arrhes initiales'}]});
  save();closeModal('modal-add-bijou-arr');renderBijouxArr();renderDashboard();showToast(`✓ Réservation ${id} créée.`);
}
function openPaiementArr(id){document.getElementById('paiement-arr-id').value=id;document.getElementById('paiement-arr-date').value=today();document.getElementById('paiement-arr-montant').value='';document.getElementById('paiement-arr-note').value='';document.getElementById('modal-paiement-arr').classList.add('show');}
function enregistrerPaiementArr(){
  const id=document.getElementById('paiement-arr-id').value,date=document.getElementById('paiement-arr-date').value,montant=parseInt(document.getElementById('paiement-arr-montant').value)||0,note=document.getElementById('paiement-arr-note').value||'Paiement';
  if(!date||montant<=0){showToast('⚠ Date et montant obligatoires.');return;}
  const ba=STATE.bijouxArr.find(b=>b.id===id);if(!ba)return;
  if(montant>ba.restantDu){showToast(`⚠ Montant supérieur au restant dû (${fmt(ba.restantDu)})`);return;}
  ba.arrhesVerse+=montant;ba.restantDu-=montant;ba.mouvements.push({date,montant,note});
  if(ba.restantDu===0){ba.statut='solde';showToast(`✓ Bijou entièrement soldé ! Paiement de ${fmt(montant)} enregistré.`);}
  else{showToast(`✓ Paiement de ${fmt(montant)} enregistré. Restant : ${fmt(ba.restantDu)}`);}
  save();closeModal('modal-paiement-arr');renderBijouxArr();renderDashboard();
}
function retournerStockArr(id){
  const ba=STATE.bijouxArr.find(b=>b.id===id);if(!ba)return;
  if(!confirm(`Retourner le bijou en stock ? Les arrhes versées (${fmt(ba.arrhesVerse)}) seront considérées comme perdues par le client.`))return;
  const ref=ba.article.split(' — ')[0];const stock=STATE.stock.find(i=>i.ref===ref);if(stock)stock.qty+=1;
  ba.statut='retour_stock';save();renderBijouxArr();renderStocks();renderDashboard();showToast('Bijou retourné en stock.');
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

  document.getElementById('achats-clients-body').innerHTML=[...STATE.achatsClients].sort((a,b)=>b.date.localeCompare(a.date)).map(a=>{
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
      <td><span class="role-pill role-${a.saisiPar}">${a.saisiPar}</span></td>
      <td>${btnSuppr}</td>
    </tr>`;
  }).join('');
}

function enregistrerAchatClient(){
  const date   = document.getElementById('ac-date').value;
  const client = document.getElementById('ac-client').value;
  const desc   = document.getElementById('ac-description').value.trim();
  const carat  = document.getElementById('ac-carat').value;
  const poids  = parseFloat(document.getElementById('ac-poids').value)||0;
  const prix   = parseInt(document.getElementById('ac-prix').value)||0;
  const note      = document.getElementById('ac-note').value.trim();
  const typeBijou = document.getElementById('ac-type-bijou')?.value||'';
  if(!date||!client||!desc||!carat||poids<=0||prix<=0){
    showToast('⚠ Tous les champs obligatoires doivent être remplis.');return;
  }
  const fileEl = document.getElementById('ac-photo');
  const file   = fileEl?.files?.[0];
  if (file) {
    // Lire la photo en base64 puis enregistrer
    const reader = new FileReader();
    reader.onload = function(e) {
      _sauvegarderReprise(date,client,desc,carat,typeBijou,poids,prix,note, e.target.result);
    };
    reader.readAsDataURL(file);
  } else {
    _sauvegarderReprise(date,client,desc,carat,typeBijou,poids,prix,note,null);
  }
}

function _sauvegarderReprise(date,client,desc,carat,typeBijou,poids,prix,note,photo){
  const id=nextId('AC','ac');
  STATE.achatsClients.unshift({
    id, date, client, description:desc, carat, typeBijou, poids,
    prixPropose:prix, note, photo: photo||null,
    saisiPar:STATE.currentUser?.role||'admin'
  });
  save();
  closeModal('modal-add-achat-client');
  // Reset champs
  ['ac-description','ac-note'].forEach(x=>document.getElementById(x).value='');
  document.getElementById('ac-photo').value='';
  document.getElementById('ac-photo-preview').style.display='none';
  renderAchatsClients();renderDashboard();
  showToast(`✓ Reprise ${id} enregistrée — ${fmt(prix)}`);
}

function supprimerAchatClient(id){
  if(!isAdmin()){showToast('⛔ Seul l\'administrateur peut supprimer.');return;}
  if(!confirm('Supprimer ce rachat ?'))return;
  STATE.achatsClients=STATE.achatsClients.filter(a=>a.id!==id);
  save();renderAchatsClients();showToast('Reprise supprimée.');
}

// ============================================
// EXPORT & RAPPORT
// ============================================
function downloadFile(f,c,t='text/plain'){const b=new Blob(['\uFEFF'+c],{type:t+';charset=utf-8;'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=f;a.click();URL.revokeObjectURL(u);}

function exporterRapport(){
  const now=new Date();
  const caM       =STATE.ventes.filter(v=>isMois(v.date)).reduce((s,v)=>s+(v.montant||0),0);
  const encaisseTotal=STATE.ventes.reduce((s,v)=>s+(v.acompte||0),0);
  const decTotal  =STATE.decaissements.reduce((s,d)=>s+(d.montant||0),0);
  const soldeNet  =encaisseTotal-decTotal;
  const rachatTotal=STATE.achatsClients.reduce((s,a)=>s+(a.prixPropose||0),0);
  const content=`RAPPORT DE GESTION — MARJAN BIJOUTERIE
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
  downloadFile('rapport_marjan_'+today()+'.txt',content);
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
}

function exporterHistorique() {
  const header = ['Date', 'Heure', 'Utilisateur', 'Rôle', 'Action'];
  const rows = STATE.connexions.map(c => [fmtDate(c.date), c.heure, c.nom, ROLES[c.role]?.label || c.role, c.action]);
  const csv = [header, ...rows].map(r => r.map(x => `"${x}"`).join(',')).join('\n');
  downloadFile('historique_connexions_marjan_' + today() + '.csv', csv, 'text/csv');
  showToast('✓ Historique exporté.');
}

function viderHistorique() {
  if (!isAdmin()) { showToast('⛔ Action réservée à l\'administrateur.'); return; }
  if (!confirm('Vider tout l\'historique des connexions ? Cette action est irréversible.')) return;
  STATE.connexions = [];
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

  // Mettre à jour tous les pickers clients ouverts
  ['v-client','edit-v-client','cc-client','ba-client','ac-client'].forEach(selId => {
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
function renderGestionComptes() {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  document.getElementById('gc-count-label').textContent=`${STATE.users.length} compte${STATE.users.length>1?'s':''} utilisateur${STATE.users.length>1?'s':''}`;
  document.getElementById('users-body').innerHTML=STATE.users.map(u=>{
    const role=ROLES[u.role]||{label:u.role,color:'#888',bg:'#eee'};
    const isSelf=STATE.currentUser?.id===u.id;
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;border-radius:50%;background:${role.bg};color:${role.color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${ini(u.nom)}</div>
        <div><div style="font-size:13px;font-weight:500">${u.nom}</div>${isSelf?'<span style="font-size:10px;color:var(--success-text);font-weight:500">Vous</span>':''}</div>
      </div></td>
      <td><span class="ref-code">${u.login}</span></td>
      <td><span class="role-pill role-${u.role}">${role.label}</span></td>
      <td><span class="stock-badge ${u.actif?'stock-ok':'stock-out'}">${u.actif?'Actif':'Inactif'}</span></td>
      <td style="font-size:12px;color:var(--text-secondary)">${u.dateCreation||'—'}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn small" onclick="ouvrirEditUser('${u.id}')">✎ Modifier</button>
        ${!isSelf?`<button class="btn small" onclick="toggleUserActif('${u.id}')" style="${u.actif?'color:var(--warning-text)':'color:var(--success-text)'}">${u.actif?'Désactiver':'Activer'}</button>`:''}
        ${!isSelf&&u.id!=='U-001'?`<button class="btn small btn-danger" onclick="supprimerUser('${u.id}')">✕</button>`:''}
      </div></td>
    </tr>`;
  }).join('');
}

function prepUserModal(u=null) {
  document.getElementById('u-edit-id').value  = u?u.id:'';
  document.getElementById('u-nom').value      = u?u.nom:'';
  document.getElementById('u-login').value    = u?u.login:'';
  document.getElementById('u-password').value = '';
  document.getElementById('u-role').value     = u?u.role:'vendeur';
  document.getElementById('modal-user-title').textContent = u?`Modifier — ${u.nom}`:'Nouveau compte';
  document.getElementById('btn-save-user').textContent    = u?'Sauvegarder':'Créer le compte';
}

function ouvrirEditUser(id) {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  const u=STATE.users.find(x=>x.id===id); if(!u)return;
  prepUserModal(u);
  document.getElementById('modal-add-user').classList.add('show');
}

function creerUtilisateur() {
  if (!isAdmin()) { showToast('⛔ Accès réservé à l\'administrateur.'); return; }
  const nom   = document.getElementById('u-nom').value.trim();
  const login = document.getElementById('u-login').value.trim().toLowerCase();
  const pass  = document.getElementById('u-password').value;
  const pass2 = document.getElementById('u-password2').value;
  const role  = document.getElementById('u-role').value;
  if (!nom||!login||!pass) { showToast('⚠ Nom, login et mot de passe sont obligatoires.'); return; }
  if (pass !== pass2)      { showToast('⚠ Les mots de passe ne correspondent pas.'); return; }
  if (pass.length < 6)     { showToast('⚠ Mot de passe trop court (6 caractères minimum).'); return; }
  if (STATE.users.find(u => u.login === login)) { showToast('⚠ Ce login existe déjà.'); return; }
  STATE.counters.u = (STATE.counters.u || 3) + 1;
  STATE.users.push({
    id: 'U-' + String(STATE.counters.u).padStart(3,'0'),
    nom, login, password: pass, role, actif: true
  });
  save();
  renderGestionComptes();
  closeModal('modal-add-user');
  ['u-nom','u-login','u-password','u-password2'].forEach(id => document.getElementById(id).value = '');
  showToast(`✓ Compte "${nom}" créé avec succès.`);
}

function sauvegarderUtilisateur() {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  const editId  =document.getElementById('u-edit-id').value;
  const nom     =document.getElementById('u-nom').value.trim();
  const login   =document.getElementById('u-login').value.trim();
  const password=document.getElementById('u-password').value;
  const role    =document.getElementById('u-role').value;
  if(!nom||!login){showToast('⚠ Nom et identifiant obligatoires.');return;}
  if(!editId&&!password){showToast('⚠ Mot de passe obligatoire.');return;}
  if(password&&password.length<6){showToast('⚠ Mot de passe trop court (min 6 caractères).');return;}
  if(STATE.users.find(u=>u.login===login&&u.id!==editId)){showToast('⚠ Identifiant déjà utilisé.');return;}
  if(editId) {
    const u=STATE.users.find(x=>x.id===editId); if(!u)return;
    u.nom=nom;u.login=login;u.role=role;if(password)u.password=password;
    save();closeModal('modal-add-user');renderGestionComptes();showToast(`✓ Compte "${nom}" mis à jour.`);
  } else {
    STATE.counters.u=(STATE.counters.u||4)+1;
    const id='U-'+String(STATE.counters.u).padStart(3,'0');
    STATE.users.push({id,nom,login,password,role,actif:true,dateCreation:today()});
    save();closeModal('modal-add-user');renderGestionComptes();showToast(`✓ Compte "${nom}" créé.`);
  }
}

function toggleUserActif(id) {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  const u=STATE.users.find(x=>x.id===id);if(!u)return;
  u.actif=!u.actif;save();renderGestionComptes();
  showToast(`Compte "${u.nom}" ${u.actif?'activé':'désactivé'}.`);
}

function supprimerUser(id) {
  if(!isAdmin()){showToast('⛔ Admin uniquement.');return;}
  const u=STATE.users.find(x=>x.id===id);
  if(!u||id==='U-001'){showToast('⚠ Impossible de supprimer l\'admin principal.');return;}
  if(!confirm(`Supprimer "${u.nom}" ?`))return;
  STATE.users=STATE.users.filter(x=>x.id!==id);save();renderGestionComptes();
  showToast(`Compte "${u.nom}" supprimé.`);
}

// ============================================
// FACTURE PDF
// ============================================


function fmtDateLong(d){ if(!d)return'—'; return new Date(d+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
function genNumFacture(ventId){ return 'FAC-'+ventId; }
function afficherFacture(id) {
  calculerCumuls();
  const v=STATE.ventes.find(x=>x.id===id); if(!v)return;
  const c=getCarat(v.carat);
  const numFac=genNumFacture(v.id);
  const caratLabel=c?`${c.label} (${c.purete})`:v.carat?.toUpperCase()||'—';
  const typeBijouLabel=(v.typeBijou&&TYPES_BIJOUX.find(t=>t.code===v.typeBijou)?.label)||'';
  const cl=STATE.clients.find(x=>x.nom===v.client)||{};
  const restant=v.restant||0;
  const now=new Date();
  document.getElementById('facture-content').innerHTML=`
<div class="facture" id="facture-print-zone">
  <div class="facture-header">
    <div class="facture-logo-zone">
      <div class="facture-logo-icon">💎</div>
      <div>
        <div class="facture-shop-name">MARJAN BIJOUTERIE</div>
        <div class="facture-shop-info">Vente et création de bijoux — Or, Argent, Diamants</div>
        <div class="facture-shop-info">Dakar, Sénégal</div>
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
      <div class="facture-partie-nom">Marjan Bijouterie</div>
      <div class="facture-partie-info">Spécialiste bijoux or et argent</div>
      <div class="facture-partie-info">Dakar, Sénégal</div>
      <div class="facture-partie-info">Gérant : ${STATE.currentUser?.nom||'—'}</div>
    </div>
    <div class="facture-partie">
      <div class="facture-partie-label">CLIENT</div>
      <div class="facture-partie-nom">${v.client}</div>
      ${cl.tel?`<div class="facture-partie-info">Tél : ${cl.tel}</div>`:''}
      ${cl.email?`<div class="facture-partie-info">Email : ${cl.email}</div>`:''}
      ${cl.adresse?`<div class="facture-partie-info">Adresse : ${cl.adresse}</div>`:''}
    </div>
  </div>
  <div class="facture-sep"></div>
  <div class="facture-section-title">DÉTAIL DE LA PRESTATION</div>
  <table class="facture-table">
    <thead><tr><th>Description</th><th>Carat / Qualité</th><th style="text-align:center">Or local (g)</th><th style="text-align:center">Or importé (g)</th><th style="text-align:right">Montant</th></tr></thead>
    <tbody>
      <tr>
        <td>${v.description}</td>
        <td>${caratLabel}${typeBijouLabel?' · '+typeBijouLabel:''}</td>
        <td style="text-align:center">${(parseFloat(v.local)||0)>0?fmtG(v.local):'—'}</td>
        <td style="text-align:center">${(parseFloat(v.importe)||0)>0?fmtG(v.importe):'—'}</td>
        <td style="text-align:right;font-weight:600">${fmt(v.montant)}</td>
      </tr>
    </tbody>
  </table>
  <div class="facture-sep"></div>
  <div class="facture-totaux">
    <div class="facture-total-row"><span>Montant total</span><strong>${fmt(v.montant)}</strong></div>
    <div class="facture-total-row"><span>Acompte versé</span><span>${fmt(v.acompte||0)}</span></div>
    <div class="facture-total-row facture-total-final ${restant>0?'restant-due':'solde-ok'}">
      <span>${restant>0?'Restant dû':'Statut paiement'}</span>
      <strong>${restant>0?fmt(restant):'✓ SOLDÉ'}</strong>
    </div>
  </div>
  <div class="facture-sep"></div>
  <div class="facture-footer">
    <div class="facture-merci">Merci pour votre confiance</div>
    <div class="facture-conditions">Cette facture fait foi de paiement. Les bijoux vendus ne sont ni repris ni échangés sauf défaut de fabrication. Poids et titres garantis.</div>
    <div class="facture-footer-ref">Réf. : ${numFac} — ${fmtDate(v.date)}</div>
  </div>
</div>`;
  document.getElementById('modal-facture').classList.add('show');
}

function imprimerFacture() {
  const zone=document.getElementById('facture-print-zone');
  const win=window.open('','_blank','width=800,height=1000');
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Facture</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#111;background:#fff;padding:20px}
.facture{max-width:720px;margin:0 auto}.facture-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px}
.facture-logo-zone{display:flex;align-items:center;gap:14px}.facture-logo-icon{font-size:40px;line-height:1}
.facture-shop-name{font-size:20px;font-weight:700;letter-spacing:1px}.facture-shop-info{font-size:12px;color:#666;margin-top:2px}
.facture-num-zone{text-align:right}.facture-num-label{font-size:10px;font-weight:700;letter-spacing:2px;color:#888;text-transform:uppercase}
.facture-num{font-size:22px;font-weight:700;margin:4px 0}.facture-num-date{font-size:11px;color:#666}
.facture-parties{display:flex;gap:24px;margin:20px 0}.facture-partie{flex:1;background:#f7f6f3;border-radius:8px;padding:14px}
.facture-partie-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin-bottom:6px}
.facture-partie-nom{font-size:15px;font-weight:700;margin-bottom:4px}.facture-partie-info{font-size:12px;color:#555;margin-top:2px}
.facture-sep{border-top:1.5px solid #e0e0e0;margin:18px 0}.facture-section-title{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin-bottom:10px}
.facture-table{width:100%;border-collapse:collapse;font-size:13px}
.facture-table th{background:#1a1916;color:#fff;padding:9px 12px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
.facture-table td{padding:10px 12px;border-bottom:1px solid #f0f0f0}
.facture-totaux{display:flex;flex-direction:column;align-items:flex-end;gap:6px;margin:12px 0}
.facture-total-row{display:flex;justify-content:space-between;width:300px;font-size:14px;padding:5px 0;border-bottom:1px solid #f0f0f0}
.facture-total-final{font-size:16px;font-weight:700;padding:8px 0;border-top:2px solid #1a1916;border-bottom:none}
.restant-due{color:#a32d2d}.solde-ok{color:#3b6d11}
.facture-footer{margin-top:24px;text-align:center}.facture-merci{font-size:15px;font-weight:600;margin-bottom:10px}
.facture-conditions{font-size:11px;color:#888;line-height:1.6;margin-bottom:8px}.facture-footer-ref{font-size:11px;color:#aaa;margin-top:6px}
@media print{body{padding:10px}.facture{max-width:100%}}</style></head><body>${zone.outerHTML}</body></html>`);
  win.document.close();
  setTimeout(()=>{win.focus();win.print();win.close();},500);
}

// ============================================
// RAPPORT JOURNALIER
// ============================================
function renderRapportJour(){ renderRapportJournalier(); }
function renderRapportJournalier() {
  const date = document.getElementById('rapport-date-picker')?.value || today();
  const dLabel = fmtDateLong(date);
  document.getElementById('rapport-date-label').textContent = dLabel;

  const ventesJ   = STATE.ventes.filter(v=>v.date===date);
  const achatsJ   = STATE.achatsClients.filter(a=>a.date===date);
  const decaissJ  = STATE.decaissements.filter(d=>d.date===date);
  const sortiesJ  = STATE.sorties.filter(s=>s.date===date);
  const connJ     = STATE.connexions.filter(c=>c.date===date);

  const tV = ventesJ.reduce((s,v)=>s+(v.montant||0),0);
  const tE = ventesJ.reduce((s,v)=>s+(v.acompte||0),0);
  const tD = decaissJ.reduce((s,d)=>s+(d.montant||0),0);
  const sNet = tE - tD;

  // Métriques
  document.getElementById('rj-ventes').textContent   = fmt(tV);
  document.getElementById('rj-ventes-nb').textContent= ventesJ.length+' vente'+(ventesJ.length>1?'s':'');
  document.getElementById('rj-encaisse').textContent  = fmt(tE);
  document.getElementById('rj-decaiss').textContent   = fmt(tD);
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
  renderRapportJournalier();
}

function imprimerRapportJournalier() {
  const date=document.getElementById('rapport-date-picker')?.value||today();
  const content=document.getElementById('rapport-journalier-content')?.innerHTML||'';
  const win=window.open('','_blank','width=900,height=1100');
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport journalier ${fmtDate(date)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#111;background:#fff;padding:20px}
h1{font-size:18px;margin-bottom:4px}.rpt-head{margin-bottom:18px;padding-bottom:10px;border-bottom:2px solid #1a1916}
.metrics-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
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
.cat-badge{background:#fcebeb;color:#a32d2d}@media print{body{padding:8px}}</style></head><body>
<div class="rpt-head"><h1>Rapport journalier — Marjan Bijouterie</h1><div style="font-size:12px;color:#666">${fmtDateLong(date)} · Imprimé le ${new Date().toLocaleString('fr-FR')}</div></div>
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
})();
