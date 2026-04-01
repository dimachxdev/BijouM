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
  achats:        loadLS('marjan_achats',     INITIAL_ACHATS),
  comptesClients:loadLS('marjan_cc',         INITIAL_COMPTES_CLIENTS),
  bijouxArr:     loadLS('marjan_ba',         INITIAL_BIJOUX_ARR),
  connexions:    loadLS('marjan_connexions', INITIAL_CONNEXIONS),
  counters: loadLS('marjan_counters', { v:16, s:3, d:6, a:5, cc:3, ba:3, cl:10, u:4, cn:8 }),
};

function loadLS(k, fb) { try { const s=localStorage.getItem(k); return s?JSON.parse(s):fb; } catch { return fb; } }
function save() {
  const keyMap = {users:'users',ventes:'ventes',clients:'clients',stock:'stock',sorties:'sorties',decaissements:'decaiss',achats:'achats',comptesClients:'cc',bijouxArr:'ba',connexions:'connexions',counters:'counters'};
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

function doLogin() {
  const login = document.getElementById('login-user').value.trim();
  const pass  = document.getElementById('login-pass').value;
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
  if(id==='achats')        renderAchats();
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
  // Pré-remplissage
  if(id==='modal-nouvelle-vente')   prepNouvelleVente();
  if(id==='modal-add-produit')      { peuplerSelect('p-carat'); }
  if(id==='modal-add-sortie')       prepSortie();
  if(id==='modal-add-achat')        { peuplerSelect('a-carat'); document.getElementById('a-date').value=today(); }
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
  const sel=document.getElementById(id); if(!sel)return;
  const groupes=[
    {label:'Or jaune',types:['or']},{label:'Or blanc',types:['or-blanc']},
    {label:'Or rose',types:['or-rose']},{label:'Argent',types:['argent']},
    {label:'Plaqué / Fantaisie',types:['plaque','fantaisie']},
  ];
  sel.innerHTML='<option value="">— Choisir —</option>';
  groupes.forEach(g=>{
    const items=CARATS_LIST.filter(c=>g.types.includes(c.type));
    if(!items.length)return;
    const og=document.createElement('optgroup'); og.label=g.label;
    items.forEach(c=>{const o=document.createElement('option');o.value=c.code;o.textContent=c.label;if(c.code===selected)o.selected=true;og.appendChild(o);});
    sel.appendChild(og);
  });
}

function peuplerClientSelect(id, selected='') {
  const sel=document.getElementById(id); if(!sel)return;
  sel.innerHTML='<option value="">— Sélectionner un client —</option>';
  STATE.clients.forEach(c=>{const o=document.createElement('option');o.value=c.nom;o.textContent=c.nom;if(c.nom===selected)o.selected=true;sel.appendChild(o);});
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
  badge.innerHTML=`<span class="carat-dot" style="background:${c.couleur}"></span><span class="carat-code">${c.code.toUpperCase()}</span><span class="carat-purete">${c.purete}</span><span class="carat-desc">${c.desc}</span>`;
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
  const totalMois=ventesMois.reduce((s,v)=>s+(v.montant||0),0);
  const totalRestants=STATE.ventes.reduce((s,v)=>s+(v.restant||0),0);
  const nbRestants=STATE.ventes.filter(v=>(v.restant||0)>0).length;
  const decMois=STATE.decaissements.filter(d=>isMois(d.date));
  const totalDecMois=decMois.reduce((s,d)=>s+(d.montant||0),0);
  const arrhesEnCours=STATE.bijouxArr.filter(b=>b.statut==='en_cours');
  const totalArrhes=arrhesEnCours.reduce((s,b)=>s+(b.restantDu||0),0);

  document.getElementById('metric-ca').textContent=fmt(totalMois);
  document.getElementById('metric-ca-nb').textContent=ventesMois.length+' vente'+(ventesMois.length>1?'s':'');
  document.getElementById('metric-restants').textContent=fmt(totalRestants);
  document.getElementById('metric-nb-restants').textContent=nbRestants+' client'+(nbRestants>1?'s':'');
  document.getElementById('metric-decaiss').textContent=fmt(totalDecMois);
  document.getElementById('metric-nb-decaiss').textContent=decMois.length+' opération'+(decMois.length>1?'s':'');
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
  ccActive.map(cc=>{const pct=Math.min(100,Math.round((cc.solde/cc.objectif)*100));return`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="font-weight:500">${cc.client}</span><span style="color:var(--text-secondary)">${fmt(cc.solde)} / ${fmt(cc.objectif)}</span></div><div class="bar-track" style="height:10px"><div class="bar-fill" style="width:${pct}%"></div></div><div style="font-size:11px;color:var(--text-tertiary);margin-top:3px">${cc.objetCible} — ${pct}% atteint</div></div>`;}).join('');

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
    if(q&&!v.client.toLowerCase().includes(q)&&!v.description.toLowerCase().includes(q))return false;
    if(fc&&v.carat!==fc)return false;
    if(ft==='local'&&!(parseFloat(v.local)||0))return false;
    if(ft==='importe'&&!(parseFloat(v.importe)||0))return false;
    if(fr==='solde'&&(v.restant||0)>0)return false;
    if(fr==='en-cours'&&!(v.restant||0))return false;
    return true;
  });

  const tCumul=STATE.ventes.reduce((s,v)=>s+(v.montant||0),0);
  const tRest=STATE.ventes.reduce((s,v)=>s+(v.restant||0),0);
  const tLoc=STATE.ventes.reduce((s,v)=>s+(parseFloat(v.local)||0),0);
  const tImp=STATE.ventes.reduce((s,v)=>s+(parseFloat(v.importe)||0),0);
  document.getElementById('journal-count-label').textContent=`${STATE.ventes.length} ventes · ${ventes.length} affichées`;
  document.getElementById('montant-cumul').textContent=fmt(tCumul);
  document.getElementById('total-restants').textContent=fmt(tRest);
  document.getElementById('poids-local-total').textContent=tLoc.toFixed(2)+'g';
  document.getElementById('poids-importe-total').textContent=tImp.toFixed(2)+'g';

  const sorted=[...STATE.ventes].sort((a,b)=>a.date.localeCompare(b.date));
  let rc=0; const cmap={};sorted.forEach(v=>{rc+=(v.montant||0);cmap[v.id]=rc;});

  document.getElementById('journal-body').innerHTML=ventes.map(v=>{
    const c=getCarat(v.carat);
    const dot=c?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.couleur};margin-right:4px;vertical-align:middle"></span>`:'';
    const rb=(v.restant||0)>0?`<span class="stock-badge stock-low">${fmt(v.restant)}</span>`:`<span class="stock-badge stock-ok">Soldé</span>`;
    return`<tr>
      <td style="white-space:nowrap;font-size:12px;color:var(--text-secondary)">${fmtDate(v.date)}</td>
      <td><div style="display:flex;align-items:center;gap:7px"><div style="width:28px;height:28px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${ini(v.client)}</div><span>${v.client}</span></div></td>
      <td style="font-size:12px;color:var(--text-secondary)">${v.description}</td>
      <td style="text-align:center">${(parseFloat(v.local)||0)>0?`<span class="badge-local">${fmtG(v.local)}</span>`:'<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td style="text-align:center">${(parseFloat(v.importe)||0)>0?`<span class="badge-importe">${fmtG(v.importe)}</span>`:'<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td><span class="carat-pill">${dot}${(v.carat||'—').toUpperCase()}</span></td>
      <td style="font-weight:500;white-space:nowrap">${fmt(v.montant)}</td>
      <td style="color:var(--text-secondary)">${(v.acompte||0)>0?fmt(v.acompte):'<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td>${rb}</td>
      <td style="font-size:12px;color:var(--text-secondary)">${fmt(cmap[v.id]||0)}</td>
      <td><div style="display:flex;gap:4px"><button class="btn small" onclick="ouvrirEditVente('${v.id}')">✎</button><button class="btn small btn-danger" onclick="supprimerVente('${v.id}')">✕</button></div></td>
      <td><button class="btn small" onclick="afficherTicket('${v.id}')" title="Imprimer ticket" style="font-size:14px">🖨</button></td>
    </tr>`;
  }).join('');
}
['journal-search','filtre-carat','filtre-type','filtre-restant'].forEach(id=>{document.getElementById(id)?.addEventListener('input',renderJournal);});

function prepNouvelleVente(){peuplerSelect('v-carat');peuplerClientSelect('v-client');document.getElementById('v-date').value=today();['v-description','v-local','v-importe','v-montant','v-acompte'].forEach(id=>document.getElementById(id).value='');document.getElementById('v-restant-disp').value='—';document.getElementById('v-carat-badge').style.display='none';}

function enregistrerVente(){
  const date=document.getElementById('v-date').value,client=document.getElementById('v-client').value,desc=document.getElementById('v-description').value.trim(),local=parseFloat(document.getElementById('v-local').value)||0,importe=parseFloat(document.getElementById('v-importe').value)||0,carat=document.getElementById('v-carat').value,montant=parseInt(document.getElementById('v-montant').value)||0,acompte=parseInt(document.getElementById('v-acompte').value)||0;
  if(!date||!client||!desc||!carat||montant<=0){showToast('⚠ Tous les champs obligatoires doivent être remplis.');return;}
  if(acompte>montant){showToast('⚠ L\'acompte ne peut pas dépasser le montant.');return;}
  const id=nextId('V','v');
  STATE.ventes.unshift({id,date,client,description:desc,local,importe,carat,montant,acompte,restant:montant-acompte});
  save();closeModal('modal-nouvelle-vente');renderJournal();renderDashboard();showToast(`✓ Vente ${id} — ${fmt(montant)}`);
}

function ouvrirEditVente(id){
  const v=STATE.ventes.find(x=>x.id===id);if(!v)return;
  peuplerSelect('edit-v-carat',v.carat);peuplerClientSelect('edit-v-client',v.client);
  document.getElementById('edit-v-id').value=id;document.getElementById('edit-v-id-label').textContent='#'+id;
  document.getElementById('edit-v-date').value=v.date;document.getElementById('edit-v-description').value=v.description;
  document.getElementById('edit-v-local').value=v.local||'';document.getElementById('edit-v-importe').value=v.importe||'';
  document.getElementById('edit-v-montant').value=v.montant||'';document.getElementById('edit-v-acompte').value=v.acompte||'';
  calcRestant('edit-v-montant','edit-v-acompte','edit-v-restant-disp');afficherInfoCarat('edit-v-carat','edit-v-carat-badge');
  document.getElementById('modal-edit-vente').classList.add('show');
}

function sauvegarderVente(){
  const id=document.getElementById('edit-v-id').value;const v=STATE.ventes.find(x=>x.id===id);if(!v)return;
  Object.assign(v,{date:document.getElementById('edit-v-date').value,client:document.getElementById('edit-v-client').value,description:document.getElementById('edit-v-description').value.trim(),local:parseFloat(document.getElementById('edit-v-local').value)||0,importe:parseFloat(document.getElementById('edit-v-importe').value)||0,carat:document.getElementById('edit-v-carat').value,montant:parseInt(document.getElementById('edit-v-montant').value)||0,acompte:parseInt(document.getElementById('edit-v-acompte').value)||0});
  v.restant=v.montant-v.acompte;save();closeModal('modal-edit-vente');renderJournal();renderDashboard();showToast('✓ Vente modifiée.');
}

function supprimerVente(id){if(!confirm(`Supprimer la vente ${id} ?`))return;STATE.ventes=STATE.ventes.filter(v=>v.id!==id);save();renderJournal();renderDashboard();showToast('Vente supprimée.');}

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
  const data=STATE.clients.filter(c=>c.nom.toLowerCase().includes(q)||c.tel.includes(q));
  document.getElementById('clients-count-label').textContent=`${STATE.clients.length} clients`;
  const stats={};STATE.ventes.forEach(v=>{if(!stats[v.client])stats[v.client]={total:0,restant:0,nb:0,derniere:''};stats[v.client].total+=(v.montant||0);stats[v.client].restant+=(v.restant||0);stats[v.client].nb+=1;if(!stats[v.client].derniere||v.date>stats[v.client].derniere)stats[v.client].derniere=v.date;});
  document.getElementById('clients-body').innerHTML=data.map(c=>{const s=stats[c.nom]||{total:0,restant:0,nb:0,derniere:''};const t=tier(s.total);const d=s.derniere===today()?"Aujourd'hui":s.derniere?fmtDate(s.derniere):'—';return`<tr><td><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${ini(c.nom)}</div><div><div style="font-size:13px;font-weight:500">${c.nom}</div><div style="font-size:11px;color:var(--text-tertiary)">${c.tel}</div></div></div></td><td>${c.tel}</td><td><strong>${fmt(s.total)}</strong></td><td>${s.restant>0?`<span class="stock-badge stock-low">${fmt(s.restant)}</span>`:'<span style="color:var(--success-text);font-size:12px">Soldé</span>'}</td><td>${s.nb}</td><td><span class="tier-badge ${t.cls}">${t.label}</span></td><td style="font-size:12px;color:var(--text-secondary)">${d}</td></tr>`;}).join('');
}
document.getElementById('client-search')?.addEventListener('input',function(){renderClients(this.value);});
function ajouterClient(){
  const nom=document.getElementById('c-nom').value.trim(),tel=document.getElementById('c-tel').value.trim(),email=document.getElementById('c-email').value.trim(),adresse=document.getElementById('c-adresse').value.trim();
  if(!nom||!tel){showToast('⚠ Nom et téléphone obligatoires.');return;}
  if(STATE.clients.find(c=>c.tel===tel)){showToast('⚠ Ce numéro existe déjà.');return;}
  const id=nextId('CL','cl');STATE.clients.unshift({id,nom,tel,email,adresse});save();renderClients();closeModal('modal-add-client');['c-nom','c-tel','c-email','c-adresse'].forEach(x=>document.getElementById(x).value='');showToast(`✓ Client "${nom}" ajouté.`);
}

// ============================================
// COMPTES CLIENTS (épargne)
// ============================================
function renderComptesClients(){
  document.getElementById('cc-count-label').textContent=`${STATE.comptesClients.length} compte${STATE.comptesClients.length>1?'s':`'`} — épargne bijoux`;
  document.getElementById('cc-list').innerHTML=STATE.comptesClients.length===0?'<div style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px">Aucun compte ouvert</div>':
  STATE.comptesClients.map(cc=>{
    const pct=Math.min(100,Math.round((cc.solde/cc.objectif)*100));
    const restePct=100-pct;
    return`<div style="padding:16px 20px;border-bottom:0.5px solid var(--border-light)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600">${ini(cc.client)}</div>
          <div><div style="font-size:14px;font-weight:500">${cc.client}</div><div style="font-size:12px;color:var(--text-secondary)">${cc.objetCible}</div></div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:600">${fmt(cc.solde)}</div>
          <div style="font-size:12px;color:var(--text-secondary)">sur ${fmt(cc.objectif)}</div>
        </div>
      </div>
      <div class="bar-track" style="height:10px;margin-bottom:6px"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-tertiary);margin-bottom:12px"><span>${pct}% atteint — ouvert le ${fmtDate(cc.dateOuverture)}</span><span>Reste : ${fmt(cc.objectif-cc.solde)}</span></div>
      <div style="margin-bottom:10px">
        ${cc.mouvements.map(m=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:0.5px solid var(--border-light)"><span style="color:var(--text-secondary)">${fmtDate(m.date)} — ${m.note}</span><span style="color:var(--success-text);font-weight:500">+${fmt(m.montant)}</span></div>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn small btn-primary" onclick="openDepotCC('${cc.id}')">+ Dépôt</button>
        ${pct>=100?`<button class="btn small" onclick="cloturerCC('${cc.id}')">Clôturer & convertir en vente</button>`:''}
        <button class="btn small btn-danger" onclick="supprimerCC('${cc.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}
function creerCompteClient(){
  const client=document.getElementById('cc-client').value,date=document.getElementById('cc-date').value,objectifNom=document.getElementById('cc-objectif-nom').value.trim(),objectif=parseInt(document.getElementById('cc-objectif').value)||0,depot=parseInt(document.getElementById('cc-depot-init').value)||0;
  if(!client||!date||!objectifNom||objectif<=0||depot<=0){showToast('⚠ Tous les champs sont obligatoires.');return;}
  if(depot>objectif){showToast('⚠ Le dépôt initial ne peut pas dépasser l\'objectif.');return;}
  const id=nextId('CC','cc');
  STATE.comptesClients.push({id,client,dateOuverture:date,solde:depot,objectif,objetCible:objectifNom,actif:true,mouvements:[{date,type:'depot',montant:depot,note:'Ouverture compte'}]});
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
  STATE.ventes.unshift({id:vid,date:today(),client:cc.client,description:'Achat bijou — solde compte épargne : '+cc.objetCible,local:0,importe:0,carat:'18k',montant:cc.solde,acompte:cc.solde,restant:0});
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
// EXPORT & RAPPORT
// ============================================
function downloadFile(f,c,t='text/plain'){const b=new Blob(['\uFEFF'+c],{type:t+';charset=utf-8;'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=f;a.click();URL.revokeObjectURL(u);}

function exporterRapport(){
  const now=new Date();
  const caM=STATE.ventes.filter(v=>isMois(v.date)).reduce((s,v)=>s+(v.montant||0),0);
  const decM=STATE.decaissements.filter(d=>isMois(d.date)).reduce((s,d)=>s+(d.montant||0),0);
  const content=`RAPPORT MARJAN BIJOUTERIE — ${now.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}\n${'='.repeat(60)}\n\nVENTES\nCA mois : ${fmt(caM)} · Total restants : ${fmt(STATE.ventes.reduce((s,v)=>s+(v.restant||0),0))}\n\nSTOCK\nRéférences : ${STATE.stock.length} · Ruptures : ${STATE.stock.filter(i=>i.qty===0).length}\n\nDÉCAISSEMENTS\nDécaissé ce mois : ${fmt(decM)} · Solde net : ${fmt(caM-decM)}\n\nACHATS\nTotal acheté : ${fmt(STATE.achats.reduce((s,a)=>s+(a.montantTotal||0),0))}\n\nBIJOUX EN ARRHES\nEn cours : ${STATE.bijouxArr.filter(b=>b.statut==='en_cours').length} · Restant dû total : ${fmt(STATE.bijouxArr.filter(b=>b.statut==='en_cours').reduce((s,b)=>s+(b.restantDu||0),0))}\n\nCLIENTS\nTotal : ${STATE.clients.length}\n\n${'='.repeat(60)}\nGénéré le ${now.toLocaleString('fr-FR')}`;
  downloadFile('rapport_marjan_'+today()+'.txt',content);showToast('✓ Rapport exporté.');
}

// ============================================
// TICKET DE VENTE — Impression PDF
// ============================================
function afficherTicket(id) {
  calculerCumuls();
  const v = STATE.ventes.find(x => x.id === id);
  if (!v) return;
  const c = getCarat(v.carat);
  const caratLabel = c ? `${v.carat.toUpperCase()} — ${c.purete}` : (v.carat || '—').toUpperCase();
  const restant = v.restant || 0;
  const now = new Date();

  document.getElementById('ticket-content').innerHTML = `
    <div class="ticket-body">
      <div class="ticket-header">
        <div class="ticket-logo">💎</div>
        <div class="ticket-shop">MARJAN BIJOUTERIE</div>
        <div class="ticket-shop-sub">Vente de bijoux — Dakar, Sénégal</div>
        <div class="ticket-divider"></div>
      </div>

      <div class="ticket-meta">
        <div class="ticket-meta-row"><span>N° Vente</span><span class="ticket-id">${v.id}</span></div>
        <div class="ticket-meta-row"><span>Date</span><span>${fmtDate(v.date)}</span></div>
        <div class="ticket-meta-row"><span>Imprimé le</span><span>${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span></div>
        <div class="ticket-meta-row"><span>Vendeur</span><span>${STATE.currentUser?.nom || '—'}</span></div>
      </div>

      <div class="ticket-divider"></div>

      <div class="ticket-section-title">CLIENT</div>
      <div class="ticket-client">${v.client}</div>

      <div class="ticket-divider"></div>

      <div class="ticket-section-title">DÉTAIL DE LA VENTE</div>
      <div class="ticket-detail-row"><span>Description</span><span>${v.description}</span></div>
      <div class="ticket-detail-row"><span>Carat</span><span>${caratLabel}</span></div>
      ${(parseFloat(v.local)||0) > 0 ? `<div class="ticket-detail-row"><span>Or local</span><span>${fmtG(v.local)}</span></div>` : ''}
      ${(parseFloat(v.importe)||0) > 0 ? `<div class="ticket-detail-row"><span>Or importé</span><span>${fmtG(v.importe)}</span></div>` : ''}

      <div class="ticket-divider"></div>

      <div class="ticket-section-title">RÈGLEMENT</div>
      <div class="ticket-montant-row"><span>Montant total</span><strong>${fmt(v.montant)}</strong></div>
      <div class="ticket-montant-row"><span>Acompte versé</span><span>${fmt(v.acompte || 0)}</span></div>
      <div class="ticket-montant-row ${restant > 0 ? 'ticket-restant-due' : 'ticket-solde'}">
        <span>${restant > 0 ? 'Restant dû' : 'Statut'}</span>
        <strong>${restant > 0 ? fmt(restant) : '✓ SOLDÉ'}</strong>
      </div>

      <div class="ticket-divider"></div>

      <div class="ticket-footer">
        <div>Merci pour votre confiance</div>
        <div class="ticket-footer-sub">Conservez ce ticket comme preuve d'achat</div>
        <div class="ticket-footer-sub">Marjan Bijouterie — ${now.getFullYear()}</div>
      </div>
    </div>
  `;
  document.getElementById('modal-ticket').classList.add('show');
}

function imprimerTicket() {
  const contenu = document.getElementById('ticket-content').innerHTML;
  const win = window.open('', '_blank', 'width=400,height=700');
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <title>Ticket Marjan Bijouterie</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Courier New', monospace; font-size: 13px; color: #111; background: #fff; padding: 16px; max-width: 320px; margin: 0 auto; }
    .ticket-body { padding: 8px; }
    .ticket-header { text-align: center; margin-bottom: 12px; }
    .ticket-logo { font-size: 28px; margin-bottom: 4px; }
    .ticket-shop { font-size: 16px; font-weight: bold; letter-spacing: 1px; }
    .ticket-shop-sub { font-size: 11px; color: #555; margin-top: 2px; }
    .ticket-divider { border-top: 1px dashed #999; margin: 10px 0; }
    .ticket-meta { margin-bottom: 4px; }
    .ticket-meta-row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
    .ticket-id { font-weight: bold; }
    .ticket-section-title { font-size: 11px; font-weight: bold; letter-spacing: 0.8px; color: #555; text-transform: uppercase; margin-bottom: 6px; }
    .ticket-client { font-size: 15px; font-weight: bold; margin-bottom: 8px; }
    .ticket-detail-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; border-bottom: 1px dotted #eee; }
    .ticket-montant-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; }
    .ticket-restant-due { color: #a32d2d; }
    .ticket-solde { color: #3b6d11; }
    .ticket-footer { text-align: center; font-size: 12px; color: #555; margin-top: 8px; }
    .ticket-footer-sub { font-size: 11px; color: #888; margin-top: 3px; }
    @media print { body { padding: 0; } }
  </style></head><body>${contenu}</body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); win.close(); }, 400);
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
