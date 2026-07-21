/**
 * KAYOR — Couche Supabase
 * Remplace localStorage par des appels API Supabase
 *
 * CONFIGURATION : Remplacer les deux lignes ci-dessous
 */

const SUPABASE_URL = 'VOTRE_URL_ICI';       // ex: https://xxxx.supabase.co
const SUPABASE_KEY = 'VOTRE_CLE_ANON_ICI';  // commence par eyJhbGci...

const _supa = {
  headers: {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer':        'return=representation'
  },
  async select(table, filters) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
    if (filters) url += '&' + filters;
    const r = await fetch(url, { headers: this.headers });
    if (!r.ok) throw new Error(`SELECT ${table}: ${r.status}`);
    return r.json();
  },
  async upsert(table, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...this.headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(Array.isArray(data) ? data : [data])
    });
    if (!r.ok) throw new Error(`UPSERT ${table}: ${r.status} ${await r.text()}`);
    return r.json();
  },
  async deleteRow(table, id) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: this.headers
    });
    if (!r.ok) throw new Error(`DELETE ${table}: ${r.status}`);
    return true;
  }
};

async function chargerDonnees() {
  showLoadingOverlay(true);
  try {
    const [utilisateurs, clients, ventes, stock, sorties, decaissements,
           comptes, mouvements, reprises, arrhes, mvtArrhes, connexions, compteurs] =
      await Promise.all([
        _supa.select('utilisateurs'),
        _supa.select('clients'),
        _supa.select('ventes', 'order=date.desc'),
        _supa.select('stock'),
        _supa.select('sorties', 'order=date.desc'),
        _supa.select('decaissements', 'order=date.desc'),
        _supa.select('comptes_clients'),
        _supa.select('mouvements_cc', 'order=id.asc'),
        _supa.select('reprises', 'order=date.desc'),
        _supa.select('bijoux_arrhes'),
        _supa.select('mouvements_arrhes'),
        _supa.select('connexions', 'order=id.desc'),
        _supa.select('compteurs')
      ]);

    comptes.forEach(cc => {
      cc.mouvements = mouvements.filter(m => m.compte_id === cc.id)
        .map(m => ({ date: m.date, type: m.type, montant: m.montant, note: m.note }));
    });
    arrhes.forEach(a => {
      a.mouvements = mvtArrhes.filter(m => m.arrhes_id === a.id)
        .map(m => ({ date: m.date, montant: m.montant, note: m.note }));
    });

    const countersObj = {};
    compteurs.forEach(c => { countersObj[c.cle] = c.valeur; });

    STATE.users          = utilisateurs;
    STATE.clients        = clients;
    STATE.ventes         = ventes.map(v => ({
      id:v.id, date:v.date, client:v.client, description:v.description,
      typeBijou:v.type_bijou, carat:v.carat, poids:v.poids||0,
      local:v.local||0, importe:v.importe||0, paiement:v.paiement,
      montant:v.montant, acompte:v.acompte, restant:v.restant,
      numFacture:v.num_facture, compteClientId:v.compte_client_id,
      noteComplement:v.note_complement
    }));
    STATE.stock          = stock.map(s => ({
      ref:s.ref, nom:s.nom, typeBijou:s.type_bijou, carat:s.carat,
      provenance:s.provenance, type:s.type, poids:s.poids||0,
      poidsTotalG:s.poids_total_g||0, qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50
    }));
    STATE.sorties        = sorties.map(s => ({
      id:s.id, date:s.date, typeBijou:s.type_bijou, carat:s.carat,
      poids:s.poids||0, nbArticles:s.nb_articles||0,
      motif:s.motif, commentaire:s.commentaire, validePar:s.valide_par
    }));
    STATE.decaissements  = decaissements.map(d => ({
      id:d.id, date:d.date, categorie:d.categorie,
      description:d.description, montant:d.montant, saisiPar:d.saisi_par
    }));
    STATE.achatsClients  = reprises.map(r => ({
      id:r.id, date:r.date, client:r.client, description:r.description,
      typeBijou:r.type_bijou, carat:r.carat, poids:r.poids||0,
      local:r.local||0, importe:r.importe||0,
      prixPropose:r.prix||0, note:r.note, photo:r.photo
    }));
    STATE.comptesClients = comptes;
    STATE.bijouxArr      = arrhes;
    STATE.connexions     = connexions;
    STATE.counters       = countersObj;

    console.log('Donnees Supabase chargees');
  } catch(err) {
    console.error('Erreur Supabase:', err);
    showToast('Erreur connexion: ' + err.message);
  } finally {
    showLoadingOverlay(false);
  }
}

async function saveVente(v) {
  await _supa.upsert('ventes', {
    id:v.id, date:v.date, client:v.client, description:v.description,
    type_bijou:v.typeBijou||null, carat:v.carat||null, poids:v.poids||0,
    local:v.local||0, importe:v.importe||0, paiement:v.paiement,
    montant:v.montant, acompte:v.acompte, restant:v.restant,
    num_facture:v.numFacture||null, compte_client_id:v.compteClientId||null,
    note_complement:v.noteComplement||null
  });
  await saveCompteurs(['v','fac']);
}

async function saveVenteEdit(v) {
  await _supa.upsert('ventes', {
    id:v.id, date:v.date, client:v.client, description:v.description,
    type_bijou:v.typeBijou||null, carat:v.carat||null, poids:v.poids||0,
    local:v.local||0, importe:v.importe||0, paiement:v.paiement,
    montant:v.montant, acompte:v.acompte, restant:v.restant,
    num_facture:v.numFacture||null
  });
}

async function deleteVente(id) {
  await _supa.deleteRow('ventes', id);
}

async function saveStock(s) {
  await _supa.upsert('stock', {
    ref:s.ref, nom:s.nom, type_bijou:s.typeBijou||null, carat:s.carat||null,
    provenance:s.provenance||null, type:s.type||'autre',
    poids:s.poids||0, poids_total_g:s.poidsTotalG||0,
    qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50
  });
  await saveCompteurs(['stk']);
}

async function saveStockBatch(items) {
  if (!items.length) return;
  await _supa.upsert('stock', items.map(s => ({
    ref:s.ref, nom:s.nom, type_bijou:s.typeBijou||null, carat:s.carat||null,
    provenance:s.provenance||null, type:s.type||'autre',
    poids:s.poids||0, poids_total_g:s.poidsTotalG||0,
    qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50
  })));
}

async function saveClient(c) {
  await _supa.upsert('clients', {
    id:c.id, nom:c.nom, tel:c.tel||null, email:c.email||null, adresse:c.adresse||null
  });
  await saveCompteurs(['cl']);
}

async function saveCompteClient(cc) {
  await _supa.upsert('comptes_clients', {
    id:cc.id, client:cc.client, date_ouverture:cc.dateOuverture||null,
    solde:cc.solde||0, actif:cc.actif!==false
  });
  if (cc.mouvements && cc.mouvements.length) {
    await _supa.upsert('mouvements_cc', cc.mouvements.map(m => ({
      compte_id:cc.id, date:m.date, type:m.type, montant:m.montant, note:m.note||null
    })));
  }
  await saveCompteurs(['cc']);
}

async function saveSortie(s) {
  await _supa.upsert('sorties', {
    id:s.id, date:s.date, type_bijou:s.typeBijou||null, carat:s.carat||null,
    poids:s.poids||0, nb_articles:s.nbArticles||0,
    motif:s.motif||null, commentaire:s.commentaire||null, valide_par:s.validePar||'admin'
  });
  await saveCompteurs(['s']);
}

async function saveDecaissement(d) {
  await _supa.upsert('decaissements', {
    id:d.id, date:d.date, categorie:d.categorie||null,
    description:d.description||null, montant:d.montant||0, saisi_par:d.saisiPar||null
  });
  await saveCompteurs(['d']);
}

async function saveReprise(r) {
  await _supa.upsert('reprises', {
    id:r.id, date:r.date, client:r.client||null, description:r.description||null,
    type_bijou:r.typeBijou||null, carat:r.carat||null, poids:r.poids||0,
    local:r.local||0, importe:r.importe||0,
    prix:r.prixPropose||0, note:r.note||null, photo:r.photo||null
  });
  await saveCompteurs(['ac']);
}

async function saveBijouArr(ba) {
  await _supa.upsert('bijoux_arrhes', {
    id:ba.id, date:ba.date, client:ba.client||null,
    article:ba.article||null, description:ba.description||null,
    prix_total:ba.prixTotal||0, arrhes_verse:ba.arrhesVerse||0,
    restant_du:ba.restantDu||0, date_echeance:ba.dateEcheance||null,
    statut:ba.statut||'en_cours'
  });
  if (ba.mouvements && ba.mouvements.length) {
    await _supa.upsert('mouvements_arrhes', ba.mouvements.map(m => ({
      arrhes_id:ba.id, date:m.date, montant:m.montant, note:m.note||null
    })));
  }
  await saveCompteurs(['ba']);
}

async function saveConnexion(c) {
  await _supa.upsert('connexions', {
    id:c.id, user_id:c.userId, nom:c.nom,
    role:c.role, date:c.date, heure:c.heure, action:c.action
  });
  await saveCompteurs(['cn']);
}

async function saveCompteurs(cles) {
  if (!cles || !cles.length) return;
  await _supa.upsert('compteurs', cles.map(k => ({ cle:k, valeur:STATE.counters[k]||0 })));
}

async function nextIdSupa(prefix, key) {
  STATE.counters[key] = (STATE.counters[key]||0)+1;
  await saveCompteurs([key]);
  return prefix+'-'+String(STATE.counters[key]).padStart(4,'0');
}

function showLoadingOverlay(show) {
  let el = document.getElementById('supa-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'supa-loading';
    el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(26,25,22,0.88);z-index:9999;' +
      'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px';
    el.innerHTML = '<div style="width:44px;height:44px;border:3px solid rgba(201,168,76,0.3);' +
      'border-top-color:#C9A84C;border-radius:50%;animation:kayor-spin 0.8s linear infinite"></div>' +
      '<div style="color:#C9A84C;font-size:13px;letter-spacing:2px;text-transform:uppercase">Chargement</div>' +
      '<style>@keyframes kayor-spin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(el);
  }
  el.style.display = show ? 'flex' : 'none';
}
