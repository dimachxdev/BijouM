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
    // Mapper les comptes clients (snake_case → camelCase)
    STATE.comptesClients = comptes.map(function(cc) {
      return {
        id:            cc.id,
        client:        cc.client,
        dateOuverture: cc.date_ouverture || cc.dateOuverture || null,
        solde:         cc.solde || 0,
        actif:         cc.actif !== false,
        mouvements:    cc.mouvements || []
      };
    });
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
    // Colonnes de base (toujours présentes)
    var row = {
      id:v.id, date:v.date, client:v.client||null,
      description:v.description||null, type_bijou:v.typeBijou||null,
      carat:v.carat||null, poids:v.poids||0,
      local:v.local||0, importe:v.importe||0,
      paiement:v.paiement||null,
      montant:v.montant||0, acompte:v.acompte||0, restant:v.restant||0
    };
    // Colonnes optionnelles — ajoutées seulement si elles ont une valeur
    if (v.numFacture)      row.num_facture      = v.numFacture;
    if (v.compteClientId)  row.compte_client_id = v.compteClientId;
    if (v.noteComplement)  row.note_complement  = v.noteComplement;
    await _supa.upsert('ventes', row);
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
    // Sauvegarder le compte
    await _supa.upsert('comptes_clients', {
      id:cc.id, client:cc.client,
      date_ouverture:cc.dateOuverture||null,
      solde:cc.solde||0,
      actif:cc.actif!==false
    });
    // Sauvegarder les mouvements — DELETE puis INSERT pour éviter doublons
    if (cc.mouvements && cc.mouvements.length) {
      // Supprimer les anciens mouvements de ce compte
      await fetch(SUPABASE_URL+'/rest/v1/mouvements_cc?compte_id=eq.'+encodeURIComponent(cc.id), {
        method:'DELETE', headers:H
      });
      // Réinsérer tous les mouvements
      await _supa.upsert('mouvements_cc', cc.mouvements.map(function(m,i) {
        return {
          compte_id:cc.id,
          date:m.date,
          type:m.type,
          montant:m.montant,
          note:m.note||null
        };
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

// ============================================
// SUPABASE REALTIME — Synchronisation temps réel
// ============================================

var _realtimeSocket = null;
var _realtimeChannels = {};
var _realtimeConnected = false;

// Tables à écouter en temps réel
var REALTIME_TABLES = [
  'ventes', 'stock', 'sorties', 'clients',
  'decaissements', 'comptes_clients', 'mouvements_cc',
  'reprises', 'bijoux_arrhes', 'compteurs'
];

function startRealtime() {
  if (_realtimeSocket) return; // déjà connecté

  var wsUrl = SUPABASE_URL.replace('https://', 'wss://') + '/realtime/v1/websocket?apikey=' + SUPABASE_KEY + '&vsn=1.0.0';

  _realtimeSocket = new WebSocket(wsUrl);

  _realtimeSocket.onopen = function() {
    _realtimeConnected = true;
    console.log('Supabase Realtime connecté');
    showRealtimeStatus(true);

    // S'abonner à chaque table
    REALTIME_TABLES.forEach(function(table) {
      subscribeTable(table);
    });
  };

  _realtimeSocket.onmessage = function(event) {
    try {
      var msg = JSON.parse(event.data);

      // Heartbeat — répondre pour maintenir la connexion
      if (msg.event === 'heartbeat') {
        _realtimeSocket.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref:null }));
        return;
      }

      // Changement de données
      if (msg.event === 'INSERT' || msg.event === 'UPDATE' || msg.event === 'DELETE') {
        var table = msg.topic ? msg.topic.replace('realtime:public:', '') : '';
        var record = msg.payload && msg.payload.record;
        var old = msg.payload && msg.payload.old_record;

        console.log('Realtime:', msg.event, table, record);
        handleRealtimeChange(msg.event, table, record, old);
      }
    } catch(e) {
      // ignore parse errors
    }
  };

  _realtimeSocket.onclose = function() {
    _realtimeConnected = false;
    _realtimeSocket = null;
    showRealtimeStatus(false);
    console.log('Realtime déconnecté — reconnexion dans 3s');
    // Reconnexion automatique
    setTimeout(startRealtime, 3000);
  };

  _realtimeSocket.onerror = function(e) {
    console.error('Realtime erreur:', e);
  };
}

function subscribeTable(table) {
  if (!_realtimeSocket || _realtimeSocket.readyState !== WebSocket.OPEN) return;
  var ref = Date.now() + '_' + table;
  _realtimeSocket.send(JSON.stringify({
    topic: 'realtime:public:' + table,
    event: 'phx_join',
    payload: { config: { broadcast: { self: false }, presence: { key: '' } } },
    ref: ref
  }));
}

function handleRealtimeChange(event, table, record, old) {
  if (!record && event !== 'DELETE') return;

  switch(table) {
    case 'ventes':
      if (event === 'INSERT') {
        var v = mapVente(record);
        if (!STATE.ventes.find(function(x){return x.id===v.id;}))
          STATE.ventes.unshift(v);
      } else if (event === 'UPDATE') {
        var v2 = mapVente(record);
        var idx = STATE.ventes.findIndex(function(x){return x.id===v2.id;});
        if (idx>=0) STATE.ventes[idx] = v2;
      } else if (event === 'DELETE') {
        STATE.ventes = STATE.ventes.filter(function(x){return x.id!==(old&&old.id);});
      }
      renderJournal(); renderDashboard();
      break;

    case 'stock':
      var s = mapStock(record);
      var si = STATE.stock.findIndex(function(x){return x.ref===s.ref;});
      if (event === 'DELETE') {
        STATE.stock = STATE.stock.filter(function(x){return x.ref!==(old&&old.ref);});
      } else if (si>=0) {
        STATE.stock[si] = s;
      } else {
        STATE.stock.unshift(s);
      }
      renderStocks(); renderDashboard();
      break;

    case 'clients':
      var cl = record;
      var cli = STATE.clients.findIndex(function(x){return x.id===cl.id;});
      if (event === 'DELETE') {
        STATE.clients = STATE.clients.filter(function(x){return x.id!==(old&&old.id);});
      } else if (cli>=0) {
        STATE.clients[cli] = cl;
      } else {
        STATE.clients.unshift(cl);
      }
      if (document.getElementById('section-clients') &&
          document.getElementById('section-clients').style.display !== 'none')
        renderClients();
      break;

    case 'sorties':
      var sr = mapSortie(record);
      var sri = STATE.sorties.findIndex(function(x){return x.id===sr.id;});
      if (event === 'DELETE') {
        STATE.sorties = STATE.sorties.filter(function(x){return x.id!==(old&&old.id);});
      } else if (sri>=0) {
        STATE.sorties[sri] = sr;
      } else {
        STATE.sorties.unshift(sr);
      }
      renderSorties();
      break;

    case 'decaissements':
      var d = mapDecaissement(record);
      var di = STATE.decaissements.findIndex(function(x){return x.id===d.id;});
      if (event === 'DELETE') {
        STATE.decaissements = STATE.decaissements.filter(function(x){return x.id!==(old&&old.id);});
      } else if (di>=0) {
        STATE.decaissements[di] = d;
      } else {
        STATE.decaissements.unshift(d);
      }
      renderDecaissements(); renderDashboard();
      break;

    case 'comptes_clients':
      var cc = mapCompte(record);
      var cci = STATE.comptesClients.findIndex(function(x){return x.id===cc.id;});
      if (event === 'DELETE') {
        STATE.comptesClients = STATE.comptesClients.filter(function(x){return x.id!==(old&&old.id);});
      } else if (cci>=0) {
        // Conserver les mouvements existants
        cc.mouvements = STATE.comptesClients[cci].mouvements || [];
        STATE.comptesClients[cci] = cc;
      } else {
        cc.mouvements = [];
        STATE.comptesClients.unshift(cc);
      }
      renderComptesClients();
      break;

    case 'mouvements_cc':
      // Recharger les mouvements du compte concerné
      if (record && record.compte_id) {
        var ccIdx = STATE.comptesClients.findIndex(function(x){return x.id===record.compte_id;});
        if (ccIdx>=0) {
          _supa.select('mouvements_cc', 'compte_id=eq.'+encodeURIComponent(record.compte_id)+'&order=id.asc')
            .then(function(mvts) {
              STATE.comptesClients[ccIdx].mouvements = mvts.map(function(m){
                return {date:m.date, type:m.type, montant:m.montant, note:m.note};
              });
              renderComptesClients();
            });
        }
      }
      break;

    case 'reprises':
      var r = mapReprise(record);
      var ri = STATE.achatsClients.findIndex(function(x){return x.id===r.id;});
      if (event === 'DELETE') {
        STATE.achatsClients = STATE.achatsClients.filter(function(x){return x.id!==(old&&old.id);});
      } else if (ri>=0) {
        STATE.achatsClients[ri] = r;
      } else {
        STATE.achatsClients.unshift(r);
      }
      renderAchatsClients();
      break;

    case 'bijoux_arrhes':
      var ba = record;
      var bai = STATE.bijouxArr.findIndex(function(x){return x.id===ba.id;});
      if (event === 'DELETE') {
        STATE.bijouxArr = STATE.bijouxArr.filter(function(x){return x.id!==(old&&old.id);});
      } else if (bai>=0) {
        ba.mouvements = STATE.bijouxArr[bai].mouvements || [];
        STATE.bijouxArr[bai] = ba;
      } else {
        ba.mouvements = [];
        STATE.bijouxArr.unshift(ba);
      }
      renderBijouxArr(); renderDashboard();
      break;

    case 'compteurs':
      if (record) STATE.counters[record.cle] = record.valeur;
      break;
  }
}

// Fonctions de mapping (snake_case → camelCase)
function mapVente(v) {
  return { id:v.id, date:v.date, client:v.client, description:v.description,
    typeBijou:v.type_bijou, carat:v.carat, poids:v.poids||0,
    local:v.local||0, importe:v.importe||0, paiement:v.paiement,
    montant:v.montant, acompte:v.acompte, restant:v.restant,
    numFacture:v.num_facture, compteClientId:v.compte_client_id,
    noteComplement:v.note_complement };
}
function mapStock(s) {
  return { ref:s.ref, nom:s.nom, typeBijou:s.type_bijou, carat:s.carat,
    provenance:s.provenance, type:s.type, poids:s.poids||0,
    poidsTotalG:s.poids_total_g||0, qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50 };
}
function mapSortie(s) {
  return { id:s.id, date:s.date, typeBijou:s.type_bijou, carat:s.carat,
    poids:s.poids||0, nbArticles:s.nb_articles||0,
    motif:s.motif, commentaire:s.commentaire, validePar:s.valide_par };
}
function mapDecaissement(d) {
  return { id:d.id, date:d.date, categorie:d.categorie,
    description:d.description, montant:d.montant, saisiPar:d.saisi_par };
}
function mapCompte(cc) {
  return { id:cc.id, client:cc.client,
    dateOuverture:cc.date_ouverture||null,
    solde:cc.solde||0, actif:cc.actif!==false, mouvements:[] };
}
function mapReprise(r) {
  return { id:r.id, date:r.date, client:r.client, description:r.description,
    typeBijou:r.type_bijou, carat:r.carat, poids:r.poids||0,
    local:r.local||0, importe:r.importe||0, prixPropose:r.prix||0,
    note:r.note, photo:r.photo };
}

// Indicateur visuel de connexion temps réel
function showRealtimeStatus(connected) {
  var el = document.getElementById('realtime-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'realtime-status';
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;padding:6px 12px;' +
      'border-radius:20px;font-size:11px;font-weight:600;z-index:999;' +
      'display:flex;align-items:center;gap:6px;transition:all 0.3s;';
    document.body.appendChild(el);
  }
  if (connected) {
    el.style.background = 'rgba(76,175,80,0.15)';
    el.style.color = '#4caf50';
    el.style.border = '1px solid rgba(76,175,80,0.3)';
    el.innerHTML = '<span style="width:7px;height:7px;background:#4caf50;border-radius:50%;display:inline-block"></span> Temps réel';
    // Masquer après 3s
    setTimeout(function(){ el.style.opacity='0.4'; }, 3000);
  } else {
    el.style.background = 'rgba(244,67,54,0.15)';
    el.style.color = '#f44336';
    el.style.border = '1px solid rgba(244,67,54,0.3)';
    el.style.opacity = '1';
    el.innerHTML = '<span style="width:7px;height:7px;background:#f44336;border-radius:50%;display:inline-block"></span> Reconnexion...';
  }
}
