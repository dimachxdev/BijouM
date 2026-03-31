/**
 * MARJAN BIJOUTERIE — Application v2
 * Journal des ventes : Date, Client, Description, Local, Importé, Carat,
 * Montant, Acompte, Restant, Montant Cumulé
 */

// ============================================
// STATE
// ============================================
const STATE = {
  ventes:  loadLS('marjan_ventes',  INITIAL_VENTES),
  clients: loadLS('marjan_clients', INITIAL_CLIENTS),
  stock:   loadLS('marjan_stock',   INITIAL_STOCK),
  venteCounter: parseInt(localStorage.getItem('marjan_vcnt') || String(INITIAL_VENTES.length + 1)),
  clientCounter: parseInt(localStorage.getItem('marjan_ccnt') || String(INITIAL_CLIENTS.length + 1)),
};

function loadLS(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
}

function save() {
  localStorage.setItem('marjan_ventes',  JSON.stringify(STATE.ventes));
  localStorage.setItem('marjan_clients', JSON.stringify(STATE.clients));
  localStorage.setItem('marjan_stock',   JSON.stringify(STATE.stock));
  localStorage.setItem('marjan_vcnt',    String(STATE.venteCounter));
  localStorage.setItem('marjan_ccnt',    String(STATE.clientCounter));
}

// ============================================
// HELPERS
// ============================================
function fmt(n) { return Number(n || 0).toLocaleString('fr-FR') + ' F'; }
function fmtG(n) { return n ? Number(n).toFixed(2).replace('.00','') + ' g' : '—'; }
function initiales(nom) { return nom.trim().split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }
function today() { return new Date().toISOString().split('T')[0]; }

function isToday(dateStr) {
  return dateStr === today();
}
function isSameMois(dateStr) {
  const d = new Date(dateStr), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function getCarat(code) { return CARATS_LIST.find(c => c.code === code); }

function statutStock(item) {
  if (item.qty === 0)         return { label:'Rupture',   cls:'stock-out' };
  if (item.qty <= item.seuil) return { label:'Stock bas', cls:'stock-low' };
  return                             { label:'En stock',  cls:'stock-ok'  };
}

function tierLabel(total) {
  if (total >= 1000000) return { label:'Platine', cls:'tier-platine' };
  if (total >= 500000)  return { label:'Or',      cls:'tier-gold'    };
  return                       { label:'Argent',  cls:'tier-silver'  };
}

// ============================================
// MONTANT CUMULÉ — calculé dynamiquement
// ============================================
function calculerCumuls() {
  const sorted = [...STATE.ventes].sort((a,b) => a.date.localeCompare(b.date));
  let cumul = 0;
  sorted.forEach(v => { cumul += (v.montant || 0); v._cumul = cumul; });
  // Ré-indexer par id
  const map = {};
  sorted.forEach(v => { map[v.id] = v._cumul; });
  STATE.ventes.forEach(v => { v._cumul = map[v.id] || 0; });
}

// ============================================
// NAVIGATION
// ============================================
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.section).classList.add('active');
    renderSection(btn.dataset.section);
  });
});
function renderSection(id) {
  if (id === 'dashboard') renderDashboard();
  if (id === 'journal')   renderJournal();
  if (id === 'stocks')    renderStocks();
  if (id === 'clients')   renderClients();
}

// ============================================
// MODALS
// ============================================
function openModal(id) {
  if (id === 'modal-nouvelle-vente') prepNouvelleVente();
  if (id === 'modal-add-produit')    prepAddProduit();
  document.getElementById(id).classList.add('show');
}
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
document.querySelectorAll('.modal-backdrop').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.show').forEach(m => m.classList.remove('show'));
});

// ============================================
// TOAST
// ============================================
function showToast(msg, dur=2800) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ============================================
// PEUPLER SELECTS CARATS
// ============================================
function peuplerCaratSelect(selectId, selected='') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const groupes = [
    { label: 'Or jaune', types: ['or'] },
    { label: 'Or blanc', types: ['or-blanc'] },
    { label: 'Or rose',  types: ['or-rose'] },
    { label: 'Argent',   types: ['argent'] },
    { label: 'Plaqué / Fantaisie', types: ['plaque','fantaisie'] },
  ];
  sel.innerHTML = '<option value="">— Choisir —</option>';
  groupes.forEach(g => {
    const items = CARATS_LIST.filter(c => g.types.includes(c.type));
    if (!items.length) return;
    const og = document.createElement('optgroup');
    og.label = g.label;
    items.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = c.label;
      if (c.code === selected) opt.selected = true;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
}

function peuplerClientSelect(selectId, selected='') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— Sélectionner un client —</option>';
  STATE.clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.nom;
    opt.textContent = c.nom;
    if (c.nom === selected) opt.selected = true;
    sel.appendChild(opt);
  });
}

function peuplerFiltreCarats() {
  const sel = document.getElementById('filtre-carat');
  if (!sel) return;
  const usedCodes = [...new Set(STATE.ventes.map(v => v.carat).filter(Boolean))];
  sel.innerHTML = '<option value="">Tous les carats</option>';
  CARATS_LIST.filter(c => usedCodes.includes(c.code)).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.code; opt.textContent = c.label.split(' — ')[0];
    sel.appendChild(opt);
  });
}

// ============================================
// AFFICHER INFO CARAT (badge)
// ============================================
function afficherInfoCarat(selectId, badgeId) {
  const code = document.getElementById(selectId).value;
  const badge = document.getElementById(badgeId);
  if (!code || !badge) { if (badge) badge.style.display='none'; return; }
  const c = getCarat(code);
  if (!c) { badge.style.display='none'; return; }
  badge.style.display = 'flex';
  badge.innerHTML = `
    <span class="carat-dot" style="background:${c.couleur}"></span>
    <span class="carat-code">${c.code.toUpperCase()}</span>
    <span class="carat-purete">${c.purete}</span>
    <span class="carat-desc">${c.desc}</span>
  `;
}

// ============================================
// CALCUL RESTANT
// ============================================
function calculerRestant(montantId, acompteId, displayId) {
  const m = parseFloat(document.getElementById(montantId).value) || 0;
  const a = parseFloat(document.getElementById(acompteId).value) || 0;
  const r = Math.max(0, m - a);
  const el = document.getElementById(displayId);
  el.value = m > 0 ? (r === 0 ? 'Soldé ✓' : fmt(r)) : '—';
  el.style.color = r === 0 && m > 0 ? 'var(--success-text)' : (r > 0 ? 'var(--warning-text)' : '');
}

// ============================================
// DASHBOARD
// ============================================
function renderDashboard() {
  const now = new Date();
  document.getElementById('dashboard-date').textContent =
    now.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  calculerCumuls();

  const ventesJour = STATE.ventes.filter(v => isToday(v.date));
  const ventesMois = STATE.ventes.filter(v => isSameMois(v.date));
  const totalJour  = ventesJour.reduce((s,v) => s+(v.montant||0), 0);
  const totalMois  = ventesMois.reduce((s,v) => s+(v.montant||0), 0);
  const totalRestants = STATE.ventes.reduce((s,v) => s+(v.restant||0), 0);
  const nbRestants = STATE.ventes.filter(v => (v.restant||0) > 0).length;

  document.getElementById('metric-ca').textContent = fmt(totalMois);
  document.getElementById('metric-ca-nb').textContent = ventesMois.length + ' vente' + (ventesMois.length>1?'s':'');
  document.getElementById('metric-ventes-jour').textContent = fmt(totalJour);
  document.getElementById('metric-nb-ventes').textContent = ventesJour.length + ' vente' + (ventesJour.length>1?'s':'');
  document.getElementById('metric-restants').textContent = fmt(totalRestants);
  document.getElementById('metric-nb-restants').textContent = nbRestants + ' client' + (nbRestants>1?'s':'');
  document.getElementById('metric-clients').textContent = STATE.clients.length;

  // Sparkline 7 jours
  const days = Array.from({length:7}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate()-6+i);
    return d.toISOString().split('T')[0];
  });
  const dayTotals = days.map(d => STATE.ventes.filter(v=>v.date===d).reduce((s,v)=>s+(v.montant||0),0));
  const maxVal = Math.max(...dayTotals, 1);
  document.getElementById('sparkline').innerHTML = dayTotals.map((v,i) =>
    `<div class="spark-bar ${i===6?'highlight':''}" style="height:${Math.max(8, Math.round(v/maxVal*100))}%" title="${fmtDate(days[i])}: ${fmt(v)}"></div>`
  ).join('');
  document.getElementById('spark-labels').innerHTML = days.map(d =>
    `<span>${new Date(d+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'short'}).slice(0,3)}</span>`
  ).join('');

  // Bar carats
  const caratMap = {};
  STATE.ventes.forEach(v => {
    if (!v.carat) return;
    caratMap[v.carat] = (caratMap[v.carat]||0) + (v.montant||0);
  });
  const caratSorted = Object.entries(caratMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const caratMax = Math.max(...caratSorted.map(c=>c[1]),1);
  document.getElementById('bar-carats').innerHTML = caratSorted.map(([code,val]) => {
    const c = getCarat(code);
    return `<div class="bar-row">
      <span class="bar-label" style="display:flex;align-items:center;gap:5px">
        <span style="width:10px;height:10px;border-radius:50%;background:${c?c.couleur:'#ccc'};display:inline-block;flex-shrink:0"></span>
        ${code.toUpperCase()}
      </span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(val/caratMax*100)}%"></div></div>
      <span class="bar-val">${fmt(val)}</span>
    </div>`;
  }).join('');

  // Bar local vs importé
  const poidsLocal = STATE.ventes.reduce((s,v)=>s+(parseFloat(v.local)||0),0);
  const poidsImporte = STATE.ventes.reduce((s,v)=>s+(parseFloat(v.importe)||0),0);
  const poidsMax = Math.max(poidsLocal, poidsImporte, 0.1);
  document.getElementById('bar-origine').innerHTML = [
    { label:'Or local',   val:poidsLocal,   pct:Math.round(poidsLocal/poidsMax*100) },
    { label:'Or importé', val:poidsImporte, pct:Math.round(poidsImporte/poidsMax*100) },
  ].map(r => `<div class="bar-row">
    <span class="bar-label">${r.label}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${r.pct}%"></div></div>
    <span class="bar-val">${r.val.toFixed(2)} g</span>
  </div>`).join('');

  // Ventes récentes
  const recentes = [...STATE.ventes].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  document.getElementById('dash-ventes-recentes').innerHTML = recentes.map(v => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:0.5px solid var(--border-light)">
      <div style="width:34px;height:34px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0">${initiales(v.client)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v.client}</div>
        <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v.description}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:13px;font-weight:500">${fmt(v.montant)}</div>
        <div style="font-size:11px;color:var(--text-tertiary)">${fmtDate(v.date)}</div>
      </div>
    </div>
  `).join('');
}

// ============================================
// JOURNAL DES VENTES
// ============================================
function getVentesFiltrees() {
  const q      = (document.getElementById('journal-search')?.value||'').toLowerCase();
  const carat  = document.getElementById('filtre-carat')?.value || '';
  const type   = document.getElementById('filtre-type')?.value || '';
  const statut = document.getElementById('filtre-restant')?.value || '';

  return [...STATE.ventes]
    .sort((a,b) => b.date.localeCompare(a.date))
    .filter(v => {
      if (q && !v.client.toLowerCase().includes(q) && !v.description.toLowerCase().includes(q)) return false;
      if (carat && v.carat !== carat) return false;
      if (type === 'local'    && !(parseFloat(v.local)||0  > 0)) return false;
      if (type === 'importe'  && !(parseFloat(v.importe)||0 > 0)) return false;
      if (statut === 'solde'    && (v.restant||0) > 0) return false;
      if (statut === 'en-cours' && !(v.restant||0 > 0)) return false;
      return true;
    });
}

function renderJournal() {
  calculerCumuls();
  peuplerFiltreCarats();

  const ventes = getVentesFiltrees();
  const totalCumul    = STATE.ventes.reduce((s,v)=>s+(v.montant||0),0);
  const totalRestants = STATE.ventes.reduce((s,v)=>s+(v.restant||0),0);
  const totalLocal    = STATE.ventes.reduce((s,v)=>s+(parseFloat(v.local)||0),0);
  const totalImporte  = STATE.ventes.reduce((s,v)=>s+(parseFloat(v.importe)||0),0);

  document.getElementById('journal-count-label').textContent =
    `${STATE.ventes.length} vente${STATE.ventes.length>1?'s':''} · ${ventes.length} affichée${ventes.length>1?'s':''}`;
  document.getElementById('montant-cumul').textContent = fmt(totalCumul);
  document.getElementById('total-restants').textContent = fmt(totalRestants);
  document.getElementById('poids-local-total').textContent = totalLocal.toFixed(2) + ' g';
  document.getElementById('poids-importe-total').textContent = totalImporte.toFixed(2) + ' g';

  // Remettre à jour le cumul courant par ordre chronologique
  const sorted = [...STATE.ventes].sort((a,b)=>a.date.localeCompare(b.date));
  let runCumul = 0;
  const cumulMap = {};
  sorted.forEach(v => { runCumul += (v.montant||0); cumulMap[v.id] = runCumul; });

  document.getElementById('journal-body').innerHTML = ventes.map(v => {
    const c = getCarat(v.carat);
    const restant = v.restant || 0;
    const caratDot = c ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.couleur};margin-right:4px;vertical-align:middle"></span>` : '';
    const restantBadge = restant > 0
      ? `<span class="stock-badge stock-low">${fmt(restant)}</span>`
      : `<span class="stock-badge stock-ok">Soldé</span>`;

    return `<tr>
      <td style="white-space:nowrap;color:var(--text-secondary);font-size:12px">${fmtDate(v.date)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:7px">
          <div style="width:28px;height:28px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${initiales(v.client)}</div>
          <span style="font-size:13px">${v.client}</span>
        </div>
      </td>
      <td style="font-size:13px;color:var(--text-secondary)">${v.description}</td>
      <td style="text-align:center;font-size:13px">${(parseFloat(v.local)||0)>0 ? '<span class="badge-local">'+fmtG(v.local)+'</span>' : '<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td style="text-align:center;font-size:13px">${(parseFloat(v.importe)||0)>0 ? '<span class="badge-importe">'+fmtG(v.importe)+'</span>' : '<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td><span class="carat-pill">${caratDot}${v.carat ? v.carat.toUpperCase() : '—'}</span></td>
      <td style="font-weight:500;white-space:nowrap">${fmt(v.montant)}</td>
      <td style="color:var(--text-secondary);white-space:nowrap">${(v.acompte||0)>0 ? fmt(v.acompte) : '<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td>${restantBadge}</td>
      <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap">${fmt(cumulMap[v.id]||0)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn small" onclick="ouvrirEditVente('${v.id}')">✎</button>
          <button class="btn small btn-danger" onclick="supprimerVente('${v.id}')">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// Filtres journal
['journal-search','filtre-carat','filtre-type','filtre-restant'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', renderJournal);
});

// ============================================
// NOUVELLE VENTE
// ============================================
function prepNouvelleVente() {
  peuplerCaratSelect('v-carat');
  peuplerClientSelect('v-client');
  document.getElementById('v-date').value = today();
  ['v-description','v-local','v-importe','v-montant','v-acompte'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('v-restant-display').value = '—';
  document.getElementById('carat-info-badge').style.display = 'none';
}

function enregistrerVente() {
  const date    = document.getElementById('v-date').value;
  const client  = document.getElementById('v-client').value;
  const desc    = document.getElementById('v-description').value.trim();
  const local   = parseFloat(document.getElementById('v-local').value) || 0;
  const importe = parseFloat(document.getElementById('v-importe').value) || 0;
  const carat   = document.getElementById('v-carat').value;
  const montant = parseInt(document.getElementById('v-montant').value) || 0;
  const acompte = parseInt(document.getElementById('v-acompte').value) || 0;

  if (!date)    { showToast('⚠ La date est obligatoire.'); return; }
  if (!client)  { showToast('⚠ Veuillez sélectionner un client.'); return; }
  if (!desc)    { showToast('⚠ La description est obligatoire.'); return; }
  if (!carat)   { showToast('⚠ Veuillez choisir un carat.'); return; }
  if (montant <= 0) { showToast('⚠ Le montant doit être supérieur à 0.'); return; }
  if (acompte > montant) { showToast('⚠ L\'acompte ne peut pas dépasser le montant.'); return; }

  STATE.venteCounter++;
  const vente = {
    id: 'V-' + String(STATE.venteCounter).padStart(4,'0'),
    date, client, description: desc,
    local, importe, carat, montant,
    acompte, restant: montant - acompte,
  };

  // Mettre à jour le client
  const cl = STATE.clients.find(c => c.nom === client);
  if (cl) {
    cl.totalAchats = (cl.totalAchats||0) + montant;
    cl.nbVentes = (cl.nbVentes||0) + 1;
    cl.derniereVisite = date;
  }

  STATE.ventes.unshift(vente);
  save();
  closeModal('modal-nouvelle-vente');
  renderJournal();
  renderDashboard();
  showToast(`✓ Vente ${vente.id} enregistrée — ${fmt(montant)}`);
}

// ============================================
// MODIFIER VENTE
// ============================================
function ouvrirEditVente(id) {
  const v = STATE.ventes.find(x => x.id === id);
  if (!v) return;
  peuplerCaratSelect('edit-v-carat', v.carat);
  peuplerClientSelect('edit-v-client', v.client);
  document.getElementById('edit-v-id').value = id;
  document.getElementById('edit-v-id-label').textContent = '#' + id;
  document.getElementById('edit-v-date').value = v.date;
  document.getElementById('edit-v-description').value = v.description;
  document.getElementById('edit-v-local').value = v.local || '';
  document.getElementById('edit-v-importe').value = v.importe || '';
  document.getElementById('edit-v-montant').value = v.montant || '';
  document.getElementById('edit-v-acompte').value = v.acompte || '';
  calculerRestant('edit-v-montant','edit-v-acompte','edit-v-restant-display');
  afficherInfoCarat('edit-v-carat','edit-carat-badge');
  document.getElementById('modal-edit-vente').classList.add('show');
}

function sauvegarderModifVente() {
  const id      = document.getElementById('edit-v-id').value;
  const date    = document.getElementById('edit-v-date').value;
  const client  = document.getElementById('edit-v-client').value;
  const desc    = document.getElementById('edit-v-description').value.trim();
  const local   = parseFloat(document.getElementById('edit-v-local').value) || 0;
  const importe = parseFloat(document.getElementById('edit-v-importe').value) || 0;
  const carat   = document.getElementById('edit-v-carat').value;
  const montant = parseInt(document.getElementById('edit-v-montant').value) || 0;
  const acompte = parseInt(document.getElementById('edit-v-acompte').value) || 0;

  if (!date||!client||!desc||!carat||montant<=0) { showToast('⚠ Tous les champs obligatoires doivent être remplis.'); return; }

  const v = STATE.ventes.find(x => x.id === id);
  if (!v) return;
  Object.assign(v, { date, client, description:desc, local, importe, carat, montant, acompte, restant: montant - acompte });
  save();
  closeModal('modal-edit-vente');
  renderJournal();
  renderDashboard();
  showToast('✓ Vente modifiée.');
}

function supprimerVente(id) {
  if (!confirm(`Supprimer la vente ${id} ?`)) return;
  STATE.ventes = STATE.ventes.filter(v => v.id !== id);
  save();
  renderJournal();
  renderDashboard();
  showToast('Vente supprimée.');
}

// ============================================
// EXPORT CSV JOURNAL
// ============================================
function exporterJournalCSV() {
  calculerCumuls();
  const sorted = [...STATE.ventes].sort((a,b)=>a.date.localeCompare(b.date));
  let cumul = 0;
  const header = ['Date','Nom et Prenom','Description','Local (g)','Importe (g)','Carat','Montant','Accompte','Restant','Montant Cumul'];
  const rows = sorted.map(v => {
    cumul += (v.montant||0);
    return [
      fmtDate(v.date), v.client, v.description,
      v.local||'', v.importe||'', v.carat||'',
      v.montant||'', v.acompte||'', v.restant||'', cumul
    ];
  });
  const csv = [header,...rows].map(r => r.map(c=>`"${c}"`).join(',')).join('\n');
  downloadFile('journal_ventes_marjan_' + today() + '.csv', csv, 'text/csv');
  showToast('✓ Export CSV téléchargé.');
}

// ============================================
// STOCKS
// ============================================
function prepAddProduit() {
  peuplerCaratSelect('p-carat');
}

function renderStocks(filter='') {
  const q = filter.toLowerCase();
  const data = STATE.stock.filter(i =>
    i.nom.toLowerCase().includes(q) ||
    i.ref.toLowerCase().includes(q) ||
    (i.carat||'').toLowerCase().includes(q)
  );
  const total = STATE.stock.reduce((s,i)=>s+i.qty,0);
  document.getElementById('stock-count-label').textContent =
    `${STATE.stock.length} références · ${total} unités`;

  document.getElementById('stock-body').innerHTML = data.map(item => {
    const st = statutStock(item);
    const c  = getCarat(item.carat);
    const caratDot = c ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.couleur};margin-right:4px;vertical-align:middle"></span>` : '';
    const typeLabel = { local:'Local', importe:'Importé', mixte:'Mixte', argent:'Argent', autre:'Autre' }[item.type] || item.type || '—';
    return `<tr>
      <td><span class="ref-code">${item.ref}</span></td>
      <td>${item.nom}</td>
      <td><span class="carat-pill">${caratDot}${(item.carat||'—').toUpperCase()}</span></td>
      <td><span style="font-size:12px;color:var(--text-secondary)">${typeLabel}</span></td>
      <td style="text-align:center">${item.poids ? item.poids+'g' : '—'}</td>
      <td><strong>${item.qty}</strong></td>
      <td>${fmt(item.prix)}</td>
      <td>${fmt(item.qty * item.prix)}</td>
      <td><span class="stock-badge ${st.cls}">${st.label}</span></td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn small" onclick="ajusterStock('${item.ref}')">Ajuster</button>
          <button class="btn small btn-danger" onclick="supprimerProduit('${item.ref}')">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('stock-search').addEventListener('input', function(){ renderStocks(this.value); });

function ajouterProduit() {
  const ref   = document.getElementById('p-ref').value.trim();
  const nom   = document.getElementById('p-nom').value.trim();
  const carat = document.getElementById('p-carat').value;
  const type  = document.getElementById('p-type').value;
  const poids = parseFloat(document.getElementById('p-poids').value) || 0;
  const qty   = parseInt(document.getElementById('p-qty').value) || 0;
  const prix  = parseInt(document.getElementById('p-prix').value) || 0;
  const seuil = parseInt(document.getElementById('p-seuil').value) || 5;

  if (!ref||!nom) { showToast('⚠ Référence et désignation sont obligatoires.'); return; }
  if (STATE.stock.find(i=>i.ref===ref)) { showToast('⚠ Cette référence existe déjà.'); return; }

  STATE.stock.unshift({ ref, nom, carat, type, poids, qty, prix, seuil });
  save(); renderStocks(); closeModal('modal-add-produit');
  ['p-ref','p-nom','p-poids','p-qty','p-prix','p-seuil'].forEach(id => document.getElementById(id).value='');
  showToast('✓ Article ajouté.');
}

function ajusterStock(ref) {
  const item = STATE.stock.find(i=>i.ref===ref);
  if (!item) return;
  const n = prompt(`Quantité pour "${item.nom}" (actuel: ${item.qty}):`, item.qty);
  if (n===null) return;
  const qty = parseInt(n);
  if (isNaN(qty)||qty<0) { showToast('⚠ Quantité invalide.'); return; }
  item.qty = qty; save(); renderStocks();
  showToast(`✓ Stock ajusté : ${qty} unité(s).`);
}

function supprimerProduit(ref) {
  if (!confirm(`Supprimer l'article ${ref} ?`)) return;
  STATE.stock = STATE.stock.filter(i=>i.ref!==ref);
  save(); renderStocks(); showToast('Article supprimé.');
}

// ============================================
// CLIENTS
// ============================================
function renderClients(filter='') {
  const q = filter.toLowerCase();
  const data = STATE.clients.filter(c =>
    c.nom.toLowerCase().includes(q) || c.tel.includes(q)
  );
  document.getElementById('clients-count-label').textContent = `${STATE.clients.length} clients`;

  // Calculer stats depuis les ventes
  const statsClient = {};
  STATE.ventes.forEach(v => {
    if (!statsClient[v.client]) statsClient[v.client] = { total:0, restant:0, nb:0, derniere:'' };
    statsClient[v.client].total   += (v.montant||0);
    statsClient[v.client].restant += (v.restant||0);
    statsClient[v.client].nb      += 1;
    if (!statsClient[v.client].derniere || v.date > statsClient[v.client].derniere)
      statsClient[v.client].derniere = v.date;
  });

  document.getElementById('clients-body').innerHTML = data.map(c => {
    const st = statsClient[c.nom] || { total:0, restant:0, nb:0, derniere:'—' };
    const tier = tierLabel(st.total);
    const derniere = st.derniere === today() ? "Aujourd'hui" :
      (st.derniere && st.derniere !== '—' ? fmtDate(st.derniere) : '—');
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;border-radius:50%;background:var(--info-bg);color:var(--info-text);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0">${initiales(c.nom)}</div>
          <div><div style="font-size:13px;font-weight:500">${c.nom}</div><div style="font-size:11px;color:var(--text-tertiary)">${c.tel}</div></div>
        </div>
      </td>
      <td>${c.tel}</td>
      <td><strong>${fmt(st.total)}</strong></td>
      <td>${st.restant > 0 ? '<span class="stock-badge stock-low">'+fmt(st.restant)+'</span>' : '<span style="color:var(--success-text);font-size:12px">Soldé</span>'}</td>
      <td>${st.nb}</td>
      <td><span class="tier-badge ${tier.cls}">${tier.label}</span></td>
      <td style="font-size:12px;color:var(--text-secondary)">${derniere}</td>
    </tr>`;
  }).join('');

  // Bar fidélité
  const platine = STATE.clients.filter(c=>(statsClient[c.nom]?.total||0)>=1000000).length;
  const or      = STATE.clients.filter(c=>(statsClient[c.nom]?.total||0)>=500000&&(statsClient[c.nom]?.total||0)<1000000).length;
  const argent  = STATE.clients.filter(c=>(statsClient[c.nom]?.total||0)<500000).length;
  const tot = STATE.clients.length || 1;
  document.getElementById('bar-fidelite').innerHTML = [
    { label:'Platine (≥1 000 000 F)', count:platine, pct:Math.round(platine/tot*100) },
    { label:'Or (≥500 000 F)',         count:or,      pct:Math.round(or/tot*100)      },
    { label:'Argent (<500 000 F)',      count:argent,  pct:Math.round(argent/tot*100)  },
  ].map(r=>`<div class="bar-row">
    <span class="bar-label">${r.label}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${r.pct}%"></div></div>
    <span class="bar-val">${r.count} client${r.count>1?'s':''}</span>
  </div>`).join('');
}

document.getElementById('client-search').addEventListener('input', function(){ renderClients(this.value); });

function ajouterClient() {
  const nom     = document.getElementById('c-nom').value.trim();
  const tel     = document.getElementById('c-tel').value.trim();
  const email   = document.getElementById('c-email').value.trim();
  const adresse = document.getElementById('c-adresse').value.trim();

  if (!nom||!tel) { showToast('⚠ Nom et téléphone sont obligatoires.'); return; }
  if (STATE.clients.find(c=>c.tel===tel)) { showToast('⚠ Ce numéro de téléphone existe déjà.'); return; }

  STATE.clientCounter++;
  STATE.clients.unshift({
    id: 'CL-' + String(STATE.clientCounter).padStart(3,'0'),
    nom, tel, email, adresse,
  });
  save(); renderClients(); closeModal('modal-add-client');
  ['c-nom','c-tel','c-email','c-adresse'].forEach(id=>document.getElementById(id).value='');
  showToast(`✓ Client "${nom}" ajouté.`);
}

// ============================================
// EXPORT RAPPORT
// ============================================
function downloadFile(filename, content, type='text/plain') {
  const blob = new Blob(['\uFEFF'+content], {type:type+';charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}

function exporterRapport() {
  const now = new Date();
  const totalCumul    = STATE.ventes.reduce((s,v)=>s+(v.montant||0),0);
  const totalRestants = STATE.ventes.reduce((s,v)=>s+(v.restant||0),0);
  const ventesMois    = STATE.ventes.filter(v=>isSameMois(v.date));
  const content = `RAPPORT DE GESTION — MARJAN BIJOUTERIE
Date : ${now.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
${'='.repeat(55)}

JOURNAL DES VENTES
------------------
Nombre de ventes total : ${STATE.ventes.length}
Ventes ce mois         : ${ventesMois.length}
Montant cumulé total   : ${fmt(totalCumul)}
Total restants dus     : ${fmt(totalRestants)}
Poids or local total   : ${STATE.ventes.reduce((s,v)=>s+(parseFloat(v.local)||0),0).toFixed(2)} g
Poids or importé total : ${STATE.ventes.reduce((s,v)=>s+(parseFloat(v.importe)||0),0).toFixed(2)} g

STOCKS
------
Références en stock : ${STATE.stock.length}
Articles en rupture : ${STATE.stock.filter(i=>i.qty===0).length}
Valeur totale stock : ${fmt(STATE.stock.reduce((s,i)=>s+(i.qty*i.prix),0))}

CLIENTS
-------
Total clients : ${STATE.clients.length}

${'='.repeat(55)}
Rapport généré le ${now.toLocaleString('fr-FR')}
`;
  downloadFile('rapport_marjan_'+today()+'.txt', content);
  showToast('✓ Rapport exporté.');
}

// ============================================
// INIT
// ============================================
(function init() {
  // Pré-calculer stats clients depuis ventes
  STATE.clients.forEach(c => {
    const ventesClient = STATE.ventes.filter(v=>v.client===c.nom);
    c.totalAchats = ventesClient.reduce((s,v)=>s+(v.montant||0),0);
    c.nbVentes    = ventesClient.length;
    c.derniereVisite = ventesClient.length
      ? ventesClient.sort((a,b)=>b.date.localeCompare(a.date))[0].date
      : '';
  });

  calculerCumuls();
  renderDashboard();
  renderStocks();
  renderClients();

  // Revenir dashboard
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('dashboard').classList.add('active');
})();
