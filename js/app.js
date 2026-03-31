/**
 * MARJAN BIJOUTERIE — Application principale
 * Gestion des stocks, ventes, clients et tableau de bord
 */

// ============================================
// STATE — données en mémoire + localStorage
// ============================================

const STATE = {
  stock:   loadFromStorage('marjan_stock',   INITIAL_STOCK),
  clients: loadFromStorage('marjan_clients', INITIAL_CLIENTS),
  ventes:  loadFromStorage('marjan_ventes',  INITIAL_VENTES),
  venteCounter: parseInt(localStorage.getItem('marjan_vente_counter') || '832'),
  clientCounter: parseInt(localStorage.getItem('marjan_client_counter') || (INITIAL_CLIENTS.length + 1)),
};

function loadFromStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem('marjan_stock',   JSON.stringify(STATE.stock));
  localStorage.setItem('marjan_clients', JSON.stringify(STATE.clients));
  localStorage.setItem('marjan_ventes',  JSON.stringify(STATE.ventes));
  localStorage.setItem('marjan_vente_counter',  String(STATE.venteCounter));
  localStorage.setItem('marjan_client_counter', String(STATE.clientCounter));
}

// ============================================
// NAVIGATION
// ============================================

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const section = btn.dataset.section;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(section).classList.add('active');
    renderSection(section);
  });
});

function renderSection(id) {
  switch (id) {
    case 'dashboard': renderDashboard(); break;
    case 'stocks':    renderStocks();    break;
    case 'ventes':    renderVentes();    break;
    case 'clients':   renderClients();   break;
  }
}

// ============================================
// MODALS
// ============================================

function openModal(id) {
  document.getElementById(id).classList.add('show');
  if (id === 'modal-nouvelle-vente') populateVenteSelects();
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

document.querySelectorAll('.modal-backdrop').forEach(m => {
  m.addEventListener('click', e => {
    if (e.target === m) m.classList.remove('show');
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.show').forEach(m => m.classList.remove('show'));
  }
});

// ============================================
// TOAST
// ============================================

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ============================================
// HELPERS
// ============================================

function fmt(n) {
  return Number(n).toLocaleString('fr-FR') + ' F';
}

function initiales(nom) {
  return nom.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

function tierLabel(totalAchats) {
  if (totalAchats >= 1000000) return { label: 'Platine', cls: 'tier-platine' };
  if (totalAchats >= 500000)  return { label: 'Or',      cls: 'tier-gold'    };
  return                             { label: 'Argent',  cls: 'tier-silver'  };
}

function statutStock(item) {
  if (item.qty === 0)           return { label: 'Rupture',   cls: 'stock-out' };
  if (item.qty <= item.seuil)   return { label: 'Stock bas', cls: 'stock-low' };
  return                               { label: 'En stock',  cls: 'stock-ok'  };
}

function formatDatetime(isoStr) {
  const d = new Date(isoStr);
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

function isToday(isoStr) {
  const d = new Date(isoStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
      && d.getMonth()    === now.getMonth()
      && d.getDate()     === now.getDate();
}

// ============================================
// DASHBOARD
// ============================================

function renderDashboard() {
  // Date
  const now = new Date();
  document.getElementById('dashboard-date').textContent =
    now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Stock metrics
  const totalArticles = STATE.stock.reduce((sum, i) => sum + i.qty, 0);
  const basCnt = STATE.stock.filter(i => i.qty > 0 && i.qty <= i.seuil).length;
  const ruptureCnt = STATE.stock.filter(i => i.qty === 0).length;
  document.getElementById('metric-stock').textContent = totalArticles;
  document.getElementById('metric-stock-bas').textContent =
    basCnt + ruptureCnt > 0
      ? `${basCnt} bas · ${ruptureCnt} rupture`
      : 'Tout en stock';

  // Client count
  document.getElementById('metric-clients').textContent = STATE.clients.length;

  // Ventes du jour
  const ventesJour = STATE.ventes.filter(v => isToday(v.datetime));
  const totalJour = ventesJour.reduce((s, v) => s + v.montant, 0);
  document.getElementById('metric-ventes-jour').textContent = fmt(totalJour);
  document.getElementById('metric-nb-ventes').textContent = ventesJour.length + ' vente' + (ventesJour.length > 1 ? 's' : '');

  // Sparkline
  const sl = document.getElementById('sparkline');
  sl.innerHTML = WEEKLY_DATA.map((d, i) =>
    `<div class="spark-bar ${i === WEEKLY_DATA.length - 1 ? 'highlight' : ''}"
          style="height:${d.valeur}%"
          title="${d.jour}: ${fmt(d.montant)}"></div>`
  ).join('');
  document.getElementById('spark-labels').innerHTML =
    WEEKLY_DATA.map(d => `<span>${d.jour}</span>`).join('');

  // Top produits
  document.getElementById('top-products').innerHTML = TOP_PRODUITS.map((p, i) => `
    <div class="top-product-row">
      <span class="top-rank">${i + 1}</span>
      <span class="top-name">${p.nom}</span>
      <span class="top-amount">${fmt(p.montant)}</span>
      <span class="top-pct">${p.pct}%</span>
    </div>
  `).join('');

  // Barre catégories
  document.getElementById('bar-categories').innerHTML = CATEGORIES_DATA.map(c => `
    <div class="bar-row">
      <span class="bar-label">${c.cat}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${c.pct}%"></div></div>
      <span class="bar-val">${fmt(c.montant)}</span>
    </div>
  `).join('');
}

// ============================================
// STOCKS
// ============================================

function renderStocks(filter = '') {
  const q = filter.toLowerCase();
  const data = STATE.stock.filter(i =>
    i.nom.toLowerCase().includes(q) ||
    i.ref.toLowerCase().includes(q) ||
    i.cat.toLowerCase().includes(q)
  );

  const total = STATE.stock.reduce((s, i) => s + i.qty, 0);
  document.getElementById('stock-count-label').textContent =
    `${STATE.stock.length} références · ${total} unités en stock`;

  document.getElementById('stock-body').innerHTML = data.map(item => {
    const st = statutStock(item);
    const valeur = item.qty * item.prix;
    return `
      <tr>
        <td><span class="ref-code">${item.ref}</span></td>
        <td>${item.nom}</td>
        <td>${item.cat}</td>
        <td><strong>${item.qty}</strong></td>
        <td>${fmt(item.prix)}</td>
        <td>${fmt(valeur)}</td>
        <td><span class="stock-badge ${st.cls}">${st.label}</span></td>
        <td>
          <button class="btn small" onclick="ajusterStock('${item.ref}')">Ajuster</button>
          <button class="btn btn-danger small" onclick="supprimerProduit('${item.ref}')">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('stock-search').addEventListener('input', function () {
  renderStocks(this.value);
});

function ajouterProduit() {
  const ref   = document.getElementById('p-ref').value.trim();
  const nom   = document.getElementById('p-nom').value.trim();
  const cat   = document.getElementById('p-cat').value;
  const qty   = parseInt(document.getElementById('p-qty').value)   || 0;
  const prix  = parseInt(document.getElementById('p-prix').value)  || 0;
  const seuil = parseInt(document.getElementById('p-seuil').value) || 5;

  if (!ref || !nom) { showToast('⚠ Référence et désignation sont obligatoires.'); return; }
  if (STATE.stock.find(i => i.ref === ref)) { showToast('⚠ Cette référence existe déjà.'); return; }

  STATE.stock.unshift({ ref, nom, cat, qty, prix, seuil });
  saveState();
  renderStocks();
  closeModal('modal-add-produit');
  ['p-ref','p-nom','p-qty','p-prix','p-seuil'].forEach(id => document.getElementById(id).value = '');
  showToast('✓ Article ajouté avec succès.');
}

function supprimerProduit(ref) {
  if (!confirm(`Supprimer l'article ${ref} ?`)) return;
  STATE.stock = STATE.stock.filter(i => i.ref !== ref);
  saveState();
  renderStocks();
  showToast('Article supprimé.');
}

function ajusterStock(ref) {
  const item = STATE.stock.find(i => i.ref === ref);
  if (!item) return;
  const newQty = prompt(`Nouvelle quantité pour "${item.nom}" (actuel: ${item.qty}) :`, item.qty);
  if (newQty === null) return;
  const qty = parseInt(newQty);
  if (isNaN(qty) || qty < 0) { showToast('⚠ Quantité invalide.'); return; }
  item.qty = qty;
  saveState();
  renderStocks();
  showToast(`✓ Stock mis à jour : ${qty} unité(s).`);
}

// ============================================
// VENTES
// ============================================

function renderVentes() {
  const ventesJour = STATE.ventes.filter(v => isToday(v.datetime));
  const totalJour = ventesJour.reduce((s, v) => s + v.montant, 0);
  const panier = ventesJour.length > 0 ? Math.round(totalJour / ventesJour.length) : 0;

  document.getElementById('vente-total-jour').textContent  = fmt(totalJour);
  document.getElementById('vente-nb-jour').textContent     = ventesJour.length;
  document.getElementById('vente-panier-moyen').textContent = fmt(panier);

  document.getElementById('ventes-body').innerHTML = STATE.ventes.slice(0, 50).map(v => `
    <tr>
      <td><span class="ref-code">#${v.id}</span></td>
      <td>${v.article}</td>
      <td>${v.client}</td>
      <td><strong>${fmt(v.montant)}</strong></td>
      <td>${v.paiement}</td>
      <td>${formatDatetime(v.datetime)}</td>
    </tr>
  `).join('');
}

function populateVenteSelects() {
  // Articles disponibles
  const sel = document.getElementById('v-article');
  sel.innerHTML = STATE.stock.filter(i => i.qty > 0).map(i =>
    `<option value="${i.nom}">${i.nom} — ${fmt(i.prix)}</option>`
  ).join('');

  // Clients
  const selC = document.getElementById('v-client');
  selC.innerHTML = '<option value="Client anonyme">Client anonyme</option>' +
    STATE.clients.map(c => `<option value="${c.nom}">${c.nom}</option>`).join('');

  // Auto-remplir montant selon article sélectionné
  sel.addEventListener('change', function () {
    const item = STATE.stock.find(i => i.nom === this.value);
    if (item) {
      const qty = parseInt(document.getElementById('v-qty').value) || 1;
      document.getElementById('v-montant').value = item.prix * qty;
    }
  });
  document.getElementById('v-qty').addEventListener('input', function () {
    const item = STATE.stock.find(i => i.nom === sel.value);
    if (item) document.getElementById('v-montant').value = item.prix * (parseInt(this.value) || 1);
  });

  // Déclencher une fois
  sel.dispatchEvent(new Event('change'));
}

function enregistrerVente() {
  const article  = document.getElementById('v-article').value;
  const client   = document.getElementById('v-client').value || 'Client anonyme';
  const paiement = document.getElementById('v-paiement').value;
  const montant  = parseInt(document.getElementById('v-montant').value);

  if (!article || !montant || montant <= 0) { showToast('⚠ Veuillez remplir tous les champs.'); return; }

  // Décrémenter le stock
  const qty = parseInt(document.getElementById('v-qty').value) || 1;
  const stockItem = STATE.stock.find(i => i.nom === article);
  if (stockItem) {
    if (stockItem.qty < qty) { showToast('⚠ Quantité insuffisante en stock.'); return; }
    stockItem.qty -= qty;
  }

  // Mettre à jour les achats du client
  const clientObj = STATE.clients.find(c => c.nom === client);
  if (clientObj) {
    clientObj.totalAchats += montant;
    clientObj.nbVisites   += 1;
    clientObj.derniereVisite = new Date().toISOString().split('T')[0];
  }

  STATE.venteCounter++;
  const vente = {
    id: `V-${STATE.venteCounter.toString().padStart(4,'0')}`,
    article: qty > 1 ? `${article} x${qty}` : article,
    client,
    montant,
    paiement,
    datetime: new Date().toISOString(),
  };

  STATE.ventes.unshift(vente);
  saveState();
  renderVentes();
  closeModal('modal-nouvelle-vente');
  document.getElementById('v-montant').value = '';
  showToast(`✓ Vente #${vente.id} enregistrée — ${fmt(montant)}`);
}

function exporterVentes() {
  const header = ['N° Vente', 'Article', 'Client', 'Montant (F CFA)', 'Paiement', 'Date & Heure'];
  const rows = STATE.ventes.map(v => [
    v.id, v.article, v.client, v.montant, v.paiement, formatDatetime(v.datetime)
  ]);
  const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  downloadFile('ventes_marjan_' + new Date().toISOString().split('T')[0] + '.csv', csv, 'text/csv');
  showToast('✓ Export CSV téléchargé.');
}

// ============================================
// CLIENTS
// ============================================

function renderClients(filter = '') {
  const q = filter.toLowerCase();
  const data = STATE.clients.filter(c =>
    c.nom.toLowerCase().includes(q) ||
    c.tel.includes(q) ||
    (c.email && c.email.toLowerCase().includes(q))
  );

  document.getElementById('clients-count-label').textContent =
    `${STATE.clients.length} clients enregistrés`;

  document.getElementById('clients-body').innerHTML = data.map(c => {
    const tier = tierLabel(c.totalAchats);
    const derniere = c.derniereVisite === new Date().toISOString().split('T')[0]
      ? "Aujourd'hui"
      : new Date(c.derniereVisite).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    return `
      <tr>
        <td>
          <div class="client-cell">
            <div class="client-avatar">${initiales(c.nom)}</div>
            ${c.nom}
          </div>
        </td>
        <td>${c.tel}</td>
        <td><strong>${fmt(c.totalAchats)}</strong></td>
        <td>${c.nbVisites}</td>
        <td><span class="tier-badge ${tier.cls}">${tier.label}</span></td>
        <td>${derniere}</td>
      </tr>
    `;
  }).join('');

  // Barres fidélité
  const platine = STATE.clients.filter(c => c.totalAchats >= 1000000).length;
  const or      = STATE.clients.filter(c => c.totalAchats >= 500000 && c.totalAchats < 1000000).length;
  const argent  = STATE.clients.filter(c => c.totalAchats < 500000).length;
  const total   = STATE.clients.length || 1;
  document.getElementById('bar-fidelite').innerHTML = [
    { label: 'Platine', count: platine, pct: Math.round(platine/total*100) },
    { label: 'Or',      count: or,      pct: Math.round(or/total*100)      },
    { label: 'Argent',  count: argent,  pct: Math.round(argent/total*100)  },
  ].map(r => `
    <div class="bar-row">
      <span class="bar-label">${r.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${r.pct}%"></div></div>
      <span class="bar-val">${r.count} client${r.count > 1 ? 's' : ''}</span>
    </div>
  `).join('');
}

document.getElementById('client-search').addEventListener('input', function () {
  renderClients(this.value);
});

function ajouterClient() {
  const nom     = document.getElementById('c-nom').value.trim();
  const tel     = document.getElementById('c-tel').value.trim();
  const email   = document.getElementById('c-email').value.trim();
  const adresse = document.getElementById('c-adresse').value.trim();

  if (!nom || !tel) { showToast('⚠ Nom et téléphone sont obligatoires.'); return; }
  if (STATE.clients.find(c => c.tel === tel)) { showToast('⚠ Ce numéro existe déjà.'); return; }

  STATE.clientCounter++;
  STATE.clients.unshift({
    id: `CL-${STATE.clientCounter.toString().padStart(3, '0')}`,
    nom, tel, email, adresse: adresse || '',
    totalAchats: 0, nbVisites: 0,
    derniereVisite: new Date().toISOString().split('T')[0],
  });
  saveState();
  renderClients();
  closeModal('modal-add-client');
  ['c-nom','c-tel','c-email','c-adresse'].forEach(id => document.getElementById(id).value = '');
  showToast(`✓ Client "${nom}" ajouté.`);
}

// ============================================
// EXPORT / RAPPORT
// ============================================

function downloadFile(filename, content, type = 'text/plain') {
  const blob = new Blob(['\uFEFF' + content], { type: type + ';charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exporterRapport() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const totalStock = STATE.stock.reduce((s, i) => s + i.qty * i.prix, 0);
  const ventesJour = STATE.ventes.filter(v => isToday(v.datetime));
  const totalJour  = ventesJour.reduce((s, v) => s + v.montant, 0);

  const content = `RAPPORT DE GESTION — MARJAN BIJOUTERIE
Date : ${dateStr}
${'='.repeat(50)}

STOCKS
------
Références : ${STATE.stock.length}
Unités totales : ${STATE.stock.reduce((s,i) => s + i.qty, 0)}
Articles en rupture : ${STATE.stock.filter(i => i.qty === 0).length}
Valeur totale du stock : ${fmt(totalStock)}

VENTES DU JOUR
--------------
Nombre de ventes : ${ventesJour.length}
Chiffre d'affaires : ${fmt(totalJour)}

CLIENTS
-------
Total clients : ${STATE.clients.length}
Clients Platine (≥1 000 000 F) : ${STATE.clients.filter(c => c.totalAchats >= 1000000).length}
Clients Or (≥500 000 F) : ${STATE.clients.filter(c => c.totalAchats >= 500000 && c.totalAchats < 1000000).length}
Clients Argent (<500 000 F) : ${STATE.clients.filter(c => c.totalAchats < 500000).length}

${'='.repeat(50)}
Rapport généré automatiquement par le système Marjan Bijouterie
`;
  downloadFile('rapport_marjan_' + now.toISOString().split('T')[0] + '.txt', content);
  showToast('✓ Rapport exporté.');
}

// ============================================
// INIT
// ============================================

(function init() {
  renderDashboard();
  // Pré-charger les autres sections silencieusement
  renderStocks();
  renderVentes();
  renderClients();
  // Revenir au dashboard visuellement
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('dashboard').classList.add('active');
})();
