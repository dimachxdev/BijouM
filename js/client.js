/**
 * KAYOR — Portail Client
 * Authentification : Téléphone + Code PIN
 * Email reçu       : EmailJS
 */

// ── Helpers LocalStorage ──────────────────────────────────────────
function loadLS(k, fb) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fb; } catch { return fb; } }
function saveLS(k, v)  { localStorage.setItem(k, JSON.stringify(v)); }

// ── État ──────────────────────────────────────────────────────────
let CL_STATE = {
  clients:        loadLS('marjan_users_cl',    []),   // clients avec PIN
  comptesClients: loadLS('marjan_cc',          []),
  bijouxArr:      loadLS('marjan_ba',          []),
  emailjsConfig:  loadLS('marjan_emailjs',     {}),
  currentClient:  null,
  currentDepot:   { compteId: null, montant: 0, note: '' },
  lastRecu:       null,
};

function reloadState() {
  // Lire les données fraîches depuis localStorage (partagé avec l'app admin)
  const allClients = loadLS('marjan_clients', []);
  // Clients enrichis avec PIN (stockés séparément)
  const clientsPins = loadLS('marjan_clients_pin', {});
  CL_STATE.clients = allClients.map(c => ({ ...c, pin: clientsPins[c.id] || null }));
  CL_STATE.comptesClients = loadLS('marjan_cc', []);
  CL_STATE.bijouxArr      = loadLS('marjan_ba', []);
  CL_STATE.emailjsConfig  = loadLS('marjan_emailjs', {});
}

// ── Formatage ─────────────────────────────────────────────────────
function fmt(n) { return Number(n||0).toLocaleString('fr-FR') + ' F'; }
function fmtDate(d) { if (!d) return '—'; const [y,m,j] = d.split('-'); return `${j}/${m}/${y}`; }
function today()    { return new Date().toISOString().split('T')[0]; }
function prenom(nom){ return (nom||'').split(' ')[0]; }

// ── Toast ─────────────────────────────────────────────────────────
function showClientToast(msg) {
  const t = document.getElementById('client-toast');
  t.textContent = msg;
  t.style.transform = 'translateX(-50%) translateY(0)';
  setTimeout(() => { t.style.transform = 'translateX(-50%) translateY(80px)'; }, 3000);
}

// ══════════════════════════════════════════════════════════════════
// AUTHENTIFICATION
// ══════════════════════════════════════════════════════════════════
(function initPinInputs() {
  const pins = ['pin1','pin2','pin3','pin4'];
  pins.forEach((id, i) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      el.value = el.value.replace(/\D/g, '').slice(0,1);
      if (el.value && i < 3) document.getElementById(pins[i+1]).focus();
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !el.value && i > 0) document.getElementById(pins[i-1]).focus();
      if (e.key === 'Enter') doClientLogin();
    });
  });
  document.getElementById('cl-tel').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pin1').focus();
  });
})();

function getPinValue() {
  return ['pin1','pin2','pin3','pin4'].map(id => document.getElementById(id).value).join('');
}

function doClientLogin() {
  reloadState();
  const tel = document.getElementById('cl-tel').value.replace(/\s/g,'');
  const pin = getPinValue();
  const err = document.getElementById('login-error');
  err.style.display = 'none';

  if (!tel) { err.textContent = 'Entrez votre numéro de téléphone.'; err.style.display = ''; return; }
  if (pin.length < 4) { err.textContent = 'Entrez votre code PIN complet (4 chiffres).'; err.style.display = ''; return; }

  const client = CL_STATE.clients.find(c => c.tel.replace(/\s/g,'') === tel);
  if (!client) { err.textContent = 'Numéro de téléphone non trouvé.'; err.style.display = ''; return; }
  if (!client.pin) { err.textContent = 'Aucun code PIN défini. Contactez la boutique.'; err.style.display = ''; return; }
  if (client.pin !== pin) { err.textContent = 'Code PIN incorrect.'; err.style.display = ''; return; }

  CL_STATE.currentClient = client;
  afficherDashboard();
}

function doClientLogout() {
  CL_STATE.currentClient = null;
  document.getElementById('page-login').style.display = '';
  document.getElementById('page-dashboard').style.display = 'none';
  document.getElementById('cl-tel').value = '';
  ['pin1','pin2','pin3','pin4'].forEach(id => document.getElementById(id).value = '');
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════
function afficherDashboard() {
  reloadState();
  const c = CL_STATE.currentClient;
  document.getElementById('dash-client-prenom').textContent = prenom(c.nom);
  document.getElementById('page-login').style.display = 'none';
  document.getElementById('page-dashboard').style.display = '';
  renderComptesEpargne();
  renderBijouxArrClient();
}

function renderComptesEpargne() {
  const c = CL_STATE.currentClient;
  const comptes = CL_STATE.comptesClients.filter(cc => cc.client === c.nom && cc.actif !== false);
  const el = document.getElementById('dash-comptes-epargne');
  if (!comptes.length) {
    el.innerHTML = '<div class="no-account-box">Aucun compte épargne ouvert.<br><span style="font-size:12px">Contactez la boutique pour en créer un.</span></div>';
    return;
  }
  el.innerHTML = comptes.map(cc => {
    const pct = cc.objectif > 0 ? Math.min(100, Math.round((cc.solde / cc.objectif) * 100)) : 0;
    const mvts = (cc.mouvements || []).slice().reverse().slice(0, 5);
    return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
          <div>
            <div style="font-size:13px;color:var(--text-secondary)">Compte épargne</div>
            <div style="font-size:12px;color:var(--text-tertiary)">${cc.objetCible || '—'}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:24px;font-weight:800;color:var(--success-text)">${fmt(cc.solde)}</div>
            ${cc.objectif ? `<div style="font-size:12px;color:var(--text-tertiary)">sur ${fmt(cc.objectif)}</div>` : ''}
          </div>
        </div>
        ${cc.objectif ? `
        <div class="progress-wrap"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">${pct}% atteint</div>` : ''}

        ${mvts.length ? `
        <div style="margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-tertiary);margin-bottom:6px">Derniers mouvements</div>
          ${mvts.map(m => `
          <div class="mvt-row">
            <span style="color:var(--text-secondary)">${fmtDate(m.date)} — ${m.note || '—'}</span>
            <span class="mvt-amount ${m.type === 'retrait' ? 'debit' : 'credit'}">${m.type === 'retrait' ? '−' : '+'}${fmt(m.montant)}</span>
          </div>`).join('')}
        </div>` : ''}

        <button class="btn btn-primary" style="width:100%" onclick="ouvrirDepot('${cc.id}')">+ Faire un dépôt</button>
      </div>
    </div>`;
  }).join('');
}

function renderBijouxArrClient() {
  const c = CL_STATE.currentClient;
  const bijoux = CL_STATE.bijouxArr.filter(b => b.client === c.nom);
  const el = document.getElementById('dash-bijoux-arr');
  if (!bijoux.length) {
    el.innerHTML = '<div class="no-account-box" style="padding:20px">Aucune réservation en cours.</div>';
    return;
  }
  el.innerHTML = bijoux.map(b => {
    const ec = b.statut === 'en_cours';
    const pct = Math.min(100, Math.round((b.arrhesVerse / b.prixTotal) * 100));
    const overdue = ec && b.dateEcheance < today();
    return `
    <div class="card" style="margin-bottom:12px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-weight:600;font-size:14px">${b.article}${b.poids ? ` <span style="font-size:12px;color:var(--text-tertiary)">${b.poids}g</span>` : ''}</div>
            <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">Réservé le ${fmtDate(b.date)} · Échéance : ${fmtDate(b.dateEcheance)}</div>
          </div>
          <span class="${ec ? (overdue ? 'badge-encours' : 'badge-encours') : 'badge-solde'}">${ec ? (overdue ? 'Échéance dépassée' : 'En cours') : 'Soldé'}</span>
        </div>
        <div class="progress-wrap"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-tertiary);margin-top:4px">
          <span>Arrhes versées : <strong style="color:var(--success-text)">${fmt(b.arrhesVerse)}</strong></span>
          ${b.restantDu > 0 ? `<span>Restant : <strong style="color:var(--warning-text)">${fmt(b.restantDu)}</strong></span>` : '<span style="color:var(--success-text)">✓ Soldé</span>'}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════
// DÉPÔT
// ══════════════════════════════════════════════════════════════════
function ouvrirDepot(compteId) {
  reloadState();
  const cc = CL_STATE.comptesClients.find(c => c.id === compteId);
  if (!cc) return;
  CL_STATE.currentDepot = { compteId, montant: 0, note: '' };
  document.getElementById('depot-compte-nom').textContent    = cc.client + (cc.objetCible ? ' — ' + cc.objetCible : '');
  document.getElementById('depot-solde-actuel').textContent  = fmt(cc.solde);
  document.getElementById('depot-montant').value             = '';
  document.getElementById('depot-note').value                = '';
  document.getElementById('depot-error').style.display       = 'none';
  document.querySelectorAll('.depot-quick-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('modal-depot').classList.add('show');
}

function closeDepotModal() {
  document.getElementById('modal-depot').classList.remove('show');
}

function setDepotQuick(montant) {
  document.getElementById('depot-montant').value = montant;
  document.querySelectorAll('.depot-quick-btn').forEach(b => {
    b.classList.toggle('selected', parseInt(b.textContent.replace(/\s/g,'')) === montant);
  });
}

function onDepotMontantChange() {
  document.querySelectorAll('.depot-quick-btn').forEach(b => b.classList.remove('selected'));
}

function confirmerDepot() {
  reloadState();
  const montant = parseInt(document.getElementById('depot-montant').value) || 0;
  const note    = document.getElementById('depot-note').value.trim() || 'Dépôt client';
  const err     = document.getElementById('depot-error');

  if (montant <= 0) { err.textContent = 'Entrez un montant valide.'; err.style.display = ''; return; }
  err.style.display = 'none';

  const { compteId } = CL_STATE.currentDepot;
  const cc = CL_STATE.comptesClients.find(c => c.id === compteId);
  if (!cc) return;

  // Enregistrer le mouvement
  const mouvement = { date: today(), type: 'depot', montant, note };
  cc.mouvements.push(mouvement);
  cc.solde += montant;

  // Sauvegarder dans localStorage
  saveLS('marjan_cc', CL_STATE.comptesClients);

  // Préparer le reçu
  CL_STATE.lastRecu = {
    client:       CL_STATE.currentClient,
    compte:       cc,
    montant,
    note,
    nouveauSolde: cc.solde,
    date:         today(),
  };

  closeDepotModal();
  afficherRecu();
  afficherDashboard();
  showClientToast('✓ Dépôt de ' + fmt(montant) + ' enregistré.');
}

// ══════════════════════════════════════════════════════════════════
// REÇU
// ══════════════════════════════════════════════════════════════════
function afficherRecu() {
  const r = CL_STATE.lastRecu;
  const pct = r.compte.objectif > 0 ? Math.min(100, Math.round((r.nouveauSolde / r.compte.objectif) * 100)) : null;

  document.getElementById('recu-content').innerHTML = `
    <div style="text-align:center;padding:16px 0 20px;border-bottom:1px solid var(--border-light);margin-bottom:16px">
      <div style="font-size:22px;font-weight:800;color:var(--accent)">KAYOR</div>
      <div style="font-size:11px;color:var(--text-tertiary)">Reçu de dépôt — Épargne bijoux</div>
    </div>
    <table style="width:100%;font-size:13px;border-collapse:collapse">
      <tr><td style="color:var(--text-secondary);padding:5px 0">Client</td><td style="font-weight:600;text-align:right">${r.client.nom}</td></tr>
      <tr><td style="color:var(--text-secondary);padding:5px 0">Date</td><td style="font-weight:600;text-align:right">${fmtDate(r.date)}</td></tr>
      <tr><td style="color:var(--text-secondary);padding:5px 0">Montant déposé</td><td style="font-weight:700;text-align:right;font-size:16px;color:var(--success-text)">+ ${fmt(r.montant)}</td></tr>
      <tr><td style="color:var(--text-secondary);padding:5px 0">Nouveau solde</td><td style="font-weight:700;text-align:right">${fmt(r.nouveauSolde)}</td></tr>
      ${r.compte.objectif ? `<tr><td style="color:var(--text-secondary);padding:5px 0">Objectif</td><td style="text-align:right">${fmt(r.compte.objectif)} (${pct}% atteint)</td></tr>` : ''}
      <tr><td style="color:var(--text-secondary);padding:5px 0">Note</td><td style="text-align:right">${r.note}</td></tr>
    </table>
    ${r.client.email
      ? `<div style="margin-top:14px;font-size:12px;color:var(--text-tertiary)">Ce reçu sera envoyé à : <strong>${r.client.email}</strong></div>`
      : `<div style="margin-top:14px;font-size:12px;color:var(--warning-text)">Aucun email enregistré. Ajoutez votre email à la boutique pour recevoir vos reçus.</div>`
    }`;

  const btnEmail = document.getElementById('btn-envoyer-email');
  if (btnEmail) btnEmail.style.display = r.client.email ? '' : 'none';

  document.getElementById('modal-recu').classList.add('show');
}

function closeRecuModal() {
  document.getElementById('modal-recu').classList.remove('show');
}

function imprimerRecu() {
  window.print();
}

// ══════════════════════════════════════════════════════════════════
// EMAIL (EmailJS)
// ══════════════════════════════════════════════════════════════════
function envoyerRecuEmail() {
  const cfg = CL_STATE.emailjsConfig;
  const r   = CL_STATE.lastRecu;
  const btn = document.getElementById('btn-envoyer-email');

  if (!cfg.serviceId || !cfg.templateId || !cfg.publicKey) {
    showClientToast('⛔ EmailJS non configuré. Contactez l\'administrateur.');
    return;
  }
  if (!r.client.email) {
    showClientToast('⛔ Aucun email enregistré pour ce client.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Envoi en cours...';

  const pct = r.compte.objectif > 0 ? Math.min(100, Math.round((r.nouveauSolde / r.compte.objectif) * 100)) : null;

  emailjs.init(cfg.publicKey);
  emailjs.send(cfg.serviceId, cfg.templateId, {
    to_email:       r.client.email,
    to_name:        r.client.nom,
    depot_montant:  Number(r.montant).toLocaleString('fr-FR') + ' F CFA',
    nouveau_solde:  Number(r.nouveauSolde).toLocaleString('fr-FR') + ' F CFA',
    objectif:       r.compte.objectif ? Number(r.compte.objectif).toLocaleString('fr-FR') + ' F CFA' : '—',
    progression:    pct !== null ? pct + '%' : '—',
    bijou_cible:    r.compte.objetCible || '—',
    date_depot:     fmtDate(r.date),
    note_depot:     r.note,
  }).then(() => {
    showClientToast('✓ Reçu envoyé à ' + r.client.email);
    btn.textContent = '✓ Envoyé';
  }).catch(err => {
    showClientToast('⛔ Échec envoi email : ' + (err.text || err));
    btn.disabled = false;
    btn.textContent = '✉ Envoyer par email';
  });
}

// ── Fermer modals en cliquant à l'extérieur ───────────────────────
document.querySelectorAll('.modal-backdrop').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); });
});
