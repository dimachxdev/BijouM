/**
 * KAYOR — Couche Supabase
 */

const SUPABASE_URL = 'https://yflvtquowzvghwxyvuah.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3EBGFxeT8B8cys54IZj3Nw_ZTS-4ZR1';

const _supa = {
  headers: {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer':        'return=representation'
  },
  async select(table, filters) {
    let url = SUPABASE_URL + '/rest/v1/' + table + '?select=*';
    if (filters) url += '&' + filters;
    const r = await fetch(url, { headers: this.headers });
    if (!r.ok) { const t = await r.text(); throw new Error('SELECT ' + table + ': ' + r.status + ' ' + t); }
    return r.json();
  },
  async upsert(table, data) {
    const rows = Array.isArray(data) ? data : [data];
    const body = JSON.stringify(rows);
    console.log('SUPABASE UPSERT', table, rows.length, 'lignes');
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: Object.assign({}, this.headers, { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
      body: body
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('SUPABASE ERREUR upsert ' + table + ' (' + r.status + '):', t);
      console.error('Body envoyé:', body.substring(0, 500));
      throw new Error(table + ': ' + r.status + ' — ' + t);
    }
    const result = await r.json();
    console.log('SUPABASE OK', table, '->', result.length || 0, 'lignes');
    return result;
  },
  async deleteRow(table, id) {
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE', headers: this.headers
    });
    if (!r.ok) throw new Error('DELETE ' + table + ': ' + r.status);
    return true;
  }
};

async function chargerDonnees() {
  showLoadingOverlay(true);
  try {
    var resultats = await Promise.all([
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

    var utilisateurs = resultats[0];
    var clients      = resultats[1];
    var ventes       = resultats[2];
    var stock        = resultats[3];
    var sorties      = resultats[4];
    var decaissements= resultats[5];
    var comptes      = resultats[6];
    var mouvements   = resultats[7];
    var reprises     = resultats[8];
    var arrhes       = resultats[9];
    var mvtArrhes    = resultats[10];
    var connexions   = resultats[11];
    var compteurs    = resultats[12];

    comptes.forEach(function(cc) {
      cc.mouvements = mouvements.filter(function(m) { return m.compte_id === cc.id; })
        .map(function(m) { return { date: m.date, type: m.type, montant: m.montant, note: m.note }; });
    });
    arrhes.forEach(function(a) {
      a.mouvements = mvtArrhes.filter(function(m) { return m.arrhes_id === a.id; })
        .map(function(m) { return { date: m.date, montant: m.montant, note: m.note }; });
    });

    var countersObj = {};
    compteurs.forEach(function(c) { countersObj[c.cle] = c.valeur; });

    STATE.users = utilisateurs.length ? utilisateurs : STATE.users;
    STATE.clients = clients;
    STATE.ventes = ventes.map(function(v) {
      return { id:v.id, date:v.date, client:v.client, description:v.description,
        typeBijou:v.type_bijou, carat:v.carat, poids:v.poids||0,
        local:v.local||0, importe:v.importe||0, paiement:v.paiement,
        montant:v.montant, acompte:v.acompte, restant:v.restant,
        numFacture:v.num_facture, compteClientId:v.compte_client_id,
        noteComplement:v.note_complement };
    });
    STATE.stock = stock.map(function(s) {
      return { ref:s.ref, nom:s.nom, typeBijou:s.type_bijou, carat:s.carat,
        provenance:s.provenance, type:s.type, poids:s.poids||0,
        poidsTotalG:s.poids_total_g||0, qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50 };
    });
    STATE.sorties = sorties.map(function(s) {
      return { id:s.id, date:s.date, typeBijou:s.type_bijou, carat:s.carat,
        poids:s.poids||0, nbArticles:s.nb_articles||0,
        motif:s.motif, commentaire:s.commentaire, validePar:s.valide_par };
    });
    STATE.decaissements = decaissements.map(function(d) {
      return { id:d.id, date:d.date, categorie:d.categorie,
        description:d.description, montant:d.montant, saisiPar:d.saisi_par };
    });
    STATE.achatsClients = reprises.map(function(r) {
      return { id:r.id, date:r.date, client:r.client, description:r.description,
        typeBijou:r.type_bijou, carat:r.carat, poids:r.poids||0,
        local:r.local||0, importe:r.importe||0, prixPropose:r.prix||0,
        note:r.note, photo:r.photo };
    });
    STATE.comptesClients = comptes;
    STATE.bijouxArr      = arrhes;
    STATE.connexions     = connexions;
    if (Object.keys(countersObj).length) STATE.counters = countersObj;

    console.log('Supabase OK — Ventes:', STATE.ventes.length, 'Clients:', STATE.clients.length);
  } catch(err) {
    console.error('Erreur chargement Supabase:', err);
    showToast('Erreur connexion Supabase: ' + err.message);
  } finally {
    showLoadingOverlay(false);
  }
}

async function _db(label, fn) {
  try { await fn(); }
  catch(err) { console.error('DB erreur [' + label + ']:', err); showToast('⚠ Sync erreur: ' + err.message); }
}

async function saveVente(v) {
  await _db('saveVente', async function() {
    await _supa.upsert('ventes', {
      id:v.id, date:v.date, client:v.client, description:v.description,
      type_bijou:v.typeBijou||null, carat:v.carat||null, poids:v.poids||0,
      local:v.local||0, importe:v.importe||0, paiement:v.paiement,
      montant:v.montant, acompte:v.acompte, restant:v.restant,
      num_facture:v.numFacture||null, compte_client_id:v.compteClientId||null,
      note_complement:v.noteComplement||null
    });
    await saveCompteurs(['v','fac']);
  });
}

async function saveStock(s) {
  await _db('saveStock', async function() {
    await _supa.upsert('stock', {
      ref:s.ref, nom:s.nom, type_bijou:s.typeBijou||null, carat:s.carat||null,
      provenance:s.provenance||null, type:s.type||'autre',
      poids:s.poids||0, poids_total_g:s.poidsTotalG||0,
      qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50
    });
    await saveCompteurs(['stk']);
  });
}

async function saveStockBatch(items) {
  if (!items || !items.length) return;
  await _db('saveStockBatch', async function() {
    await _supa.upsert('stock', items.map(function(s) {
      return { ref:s.ref, nom:s.nom, type_bijou:s.typeBijou||null, carat:s.carat||null,
        provenance:s.provenance||null, type:s.type||'autre',
        poids:s.poids||0, poids_total_g:s.poidsTotalG||0,
        qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50 };
    }));
  });
}

async function saveClient(c) {
  await _db('saveClient', async function() {
    await _supa.upsert('clients', {
      id:c.id, nom:c.nom, tel:c.tel||null, email:c.email||null, adresse:c.adresse||null
    });
    await saveCompteurs(['cl']);
  });
}

async function saveCompteClient(cc) {
  await _db('saveCompteClient', async function() {
    await _supa.upsert('comptes_clients', {
      id:cc.id, client:cc.client, date_ouverture:cc.dateOuverture||null,
      solde:cc.solde||0, actif:cc.actif!==false
    });
    if (cc.mouvements && cc.mouvements.length) {
      await _supa.upsert('mouvements_cc', cc.mouvements.map(function(m) {
        return { compte_id:cc.id, date:m.date, type:m.type, montant:m.montant, note:m.note||null };
      }));
    }
    await saveCompteurs(['cc']);
  });
}

async function saveSortie(s) {
  await _db('saveSortie', async function() {
    await _supa.upsert('sorties', {
      id:s.id, date:s.date, type_bijou:s.typeBijou||null, carat:s.carat||null,
      poids:s.poids||0, nb_articles:s.nbArticles||0,
      motif:s.motif||null, commentaire:s.commentaire||null, valide_par:s.validePar||'admin'
    });
    await saveCompteurs(['s']);
  });
}

async function saveDecaissement(d) {
  await _db('saveDecaissement', async function() {
    await _supa.upsert('decaissements', {
      id:d.id, date:d.date, categorie:d.categorie||null,
      description:d.description||null, montant:d.montant||0, saisi_par:d.saisiPar||null
    });
    await saveCompteurs(['d']);
  });
}

async function saveReprise(r) {
  await _db('saveReprise', async function() {
    await _supa.upsert('reprises', {
      id:r.id, date:r.date, client:r.client||null, description:r.description||null,
      type_bijou:r.typeBijou||null, carat:r.carat||null, poids:r.poids||0,
      local:r.local||0, importe:r.importe||0,
      prix:r.prixPropose||0, note:r.note||null, photo:r.photo||null
    });
    await saveCompteurs(['ac']);
  });
}

async function saveBijouArr(ba) {
  await _db('saveBijouArr', async function() {
    await _supa.upsert('bijoux_arrhes', {
      id:ba.id, date:ba.date, client:ba.client||null,
      article:ba.article||null, description:ba.description||null,
      prix_total:ba.prixTotal||0, arrhes_verse:ba.arrhesVerse||0,
      restant_du:ba.restantDu||0, date_echeance:ba.dateEcheance||null,
      statut:ba.statut||'en_cours'
    });
    if (ba.mouvements && ba.mouvements.length) {
      await _supa.upsert('mouvements_arrhes', ba.mouvements.map(function(m) {
        return { arrhes_id:ba.id, date:m.date, montant:m.montant, note:m.note||null };
      }));
    }
    await saveCompteurs(['ba']);
  });
}

async function saveConnexion(c) {
  await _db('saveConnexion', async function() {
    await _supa.upsert('connexions', {
      id:c.id, user_id:c.userId, nom:c.nom,
      role:c.role, date:c.date, heure:c.heure, action:c.action
    });
    await saveCompteurs(['cn']);
  });
}

async function saveCompteurs(cles) {
  if (!cles || !cles.length) return;
  await _supa.upsert('compteurs', cles.map(function(k) {
    return { cle:k, valeur:STATE.counters[k]||0 };
  }));
}

async function nextIdSupa(prefix, key) {
  STATE.counters[key] = (STATE.counters[key]||0) + 1;
  await saveCompteurs([key]);
  return prefix + '-' + String(STATE.counters[key]).padStart(4,'0');
}

function showLoadingOverlay(show) {
  var el = document.getElementById('supa-loading');
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
