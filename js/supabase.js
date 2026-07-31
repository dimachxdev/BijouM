/**
 * KAYOR — Couche Supabase
 * Architecture : App → Supabase → Realtime → App
 */

const SUPABASE_URL = 'https://yflvtquowzvghwxyvuah.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3EBGFxeT8B8cys54IZj3Nw_ZTS-4ZR1';

const H = {
  'Content-Type':  'application/json',
  'apikey':        SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Prefer':        'return=representation'
};

// ============================================
// API DE BASE
// ============================================
const _supa = {
  async select(table, filters) {
    var url = SUPABASE_URL + '/rest/v1/' + table + '?select=*';
    if (filters) url += '&' + filters;
    var r = await fetch(url, { headers: H });
    if (!r.ok) throw new Error('SELECT ' + table + ': ' + r.status + ' ' + await r.text());
    return r.json();
  },
  async upsert(table, data) {
    var rows = Array.isArray(data) ? data : [data];
    var r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
      method:  'POST',
      headers: Object.assign({}, H, { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
      body:    JSON.stringify(rows)
    });
    if (!r.ok) {
      var txt = await r.text();
      console.error('UPSERT ' + table + ' (' + r.status + '):', txt);
      throw new Error(table + ': ' + r.status + ' — ' + txt);
    }
    return r.json();
  },
  async delete(table, filter) {
    var r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + filter, {
      method: 'DELETE', headers: H
    });
    if (!r.ok) throw new Error('DELETE ' + table + ': ' + r.status);
    return true;
  },
  async deleteRow(table, id) {
    // Détecter si la clé primaire est 'ref' (stock) ou 'id'
    var pkField = (table === 'stock') ? 'ref' : 'id';
    var r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + pkField + '=eq.' + encodeURIComponent(id), {
      method: 'DELETE', headers: H
    });
    if (!r.ok) {
      var txt = await r.text();
      throw new Error('DELETE ' + table + ' (' + r.status + '): ' + txt);
    }
    return true;
  }
};

// ============================================
// CHARGEMENT INITIAL
// ============================================
async function chargerDonnees() {
  showLoadingOverlay(true);
  try {
    var res = await Promise.all([
      _supa.select('utilisateurs'),
      _supa.select('clients'),
      _supa.select('ventes',          'order=date.desc'),
      _supa.select('stock'),
      _supa.select('sorties',         'order=date.desc'),
      _supa.select('decaissements',   'order=date.desc'),
      _supa.select('comptes_clients'),
      _supa.select('mouvements_cc',   'order=id.asc'),
      _supa.select('reprises',        'order=date.desc'),
      _supa.select('bijoux_arrhes'),
      _supa.select('mouvements_arrhes'),
      _supa.select('connexions',      'order=id.desc&limit=100'),
      _supa.select('compteurs')
    ]);

    var utilisateurs=res[0], clients=res[1], ventes=res[2], stock=res[3],
        sorties=res[4], decaissements=res[5], comptes=res[6], mouvements=res[7],
        reprises=res[8], arrhes=res[9], mvtArrhes=res[10], connexions=res[11],
        compteurs=res[12];

    // Injecter mouvements dans comptes
    comptes.forEach(function(cc) {
      cc.mouvements = mouvements
        .filter(function(m){ return m.compte_id === cc.id; })
        .map(function(m){ return { date:m.date, type:m.type, montant:m.montant, note:m.note }; });
    });
    arrhes.forEach(function(a) {
      a.mouvements = mvtArrhes
        .filter(function(m){ return m.arrhes_id === a.id; })
        .map(function(m){ return { date:m.date, montant:m.montant, note:m.note }; });
    });

    // Compteurs
    var countersObj = {};
    compteurs.forEach(function(c){ countersObj[c.cle] = c.valeur; });

    // Mettre STATE à jour
    if (utilisateurs.length) STATE.users = utilisateurs;
    STATE.clients        = clients;
    STATE.ventes         = ventes.map(mapVente);
    STATE.stock          = stock.map(mapStock);
    STATE.sorties        = sorties.map(mapSortie);
    STATE.decaissements  = decaissements.map(mapDecaiss);
    STATE.achatsClients  = reprises.map(mapReprise);
    STATE.comptesClients = comptes.map(mapCompte);
    STATE.bijouxArr      = arrhes;
    STATE.connexions     = connexions;
    if (Object.keys(countersObj).length) STATE.counters = countersObj;

    // Sync localStorage
    save();
    console.log('Supabase chargé — Ventes:', STATE.ventes.length, 'Stock:', STATE.stock.length);
  } catch(e) {
    console.error('Erreur chargement:', e);
    showToast('Erreur connexion Supabase: ' + e.message);
  } finally {
    showLoadingOverlay(false);
  }
}

// ============================================
// FONCTIONS D'ÉCRITURE (App → Supabase)
// ============================================
async function dbSaveVente(v) {
  var row = {
    id:v.id, date:v.date, client:v.client||null,
    description:v.description||null, type_bijou:v.typeBijou||null,
    carat:v.carat||null, poids:v.poids||0,
    local:v.local||0, importe:v.importe||0,
    paiement:v.paiement||null,
    montant:v.montant||0, acompte:v.acompte||0, restant:v.restant||0
  };
  if (v.numFacture)     row.num_facture      = v.numFacture;
  if (v.compteClientId) row.compte_client_id = v.compteClientId;
  if (v.noteComplement) row.note_complement  = v.noteComplement;
  await _supa.upsert('ventes', row);
  await dbSaveCounters(['v','fac']);
}

async function dbDeleteVente(id) {
  await _supa.delete('ventes', 'id=eq.' + encodeURIComponent(id));
}

async function dbSaveStock(items) {
  if (!items || !items.length) return;
  await _supa.upsert('stock', (Array.isArray(items)?items:[items]).map(function(s){
    return { ref:s.ref, nom:s.nom, type_bijou:s.typeBijou||null,
      carat:s.carat||null, provenance:s.provenance||null, type:s.type||'autre',
      poids:s.poids||0, poids_total_g:s.poidsTotalG||0,
      qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50 };
  }));
  await dbSaveCounters(['stk']);
}

async function dbSaveClient(c) {
  await _supa.upsert('clients', {
    id:c.id, nom:c.nom, tel:c.tel||null, email:c.email||null, adresse:c.adresse||null
  });
  await dbSaveCounters(['cl']);
}

async function dbSaveCompteClient(cc) {
  await _supa.upsert('comptes_clients', {
    id:cc.id, client:cc.client,
    date_ouverture:cc.dateOuverture||null,
    solde:cc.solde||0, actif:cc.actif!==false
  });
  // Mouvements : supprimer puis réinsérer
  if (cc.mouvements && cc.mouvements.length) {
    await _supa.delete('mouvements_cc', 'compte_id=eq.' + encodeURIComponent(cc.id));
    await _supa.upsert('mouvements_cc', cc.mouvements.map(function(m){
      return { compte_id:cc.id, date:m.date, type:m.type, montant:m.montant, note:m.note||null };
    }));
  }
  await dbSaveCounters(['cc']);
}

async function dbSaveSortie(s) {
  await _supa.upsert('sorties', {
    id:s.id, date:s.date, type_bijou:s.typeBijou||null, carat:s.carat||null,
    poids:s.poids||0, nb_articles:s.nbArticles||0,
    motif:s.motif||null, commentaire:s.commentaire||null, valide_par:s.validePar||'admin'
  });
  await dbSaveCounters(['s']);
}

async function dbSaveDecaissement(d) {
  await _supa.upsert('decaissements', {
    id:d.id, date:d.date, categorie:d.categorie||null,
    description:d.description||null, montant:d.montant||0, saisi_par:d.saisiPar||null
  });
  await dbSaveCounters(['d']);
}

async function dbSaveReprise(r) {
  await _supa.upsert('reprises', {
    id:r.id, date:r.date, client:r.client||null,
    description:r.description||null, type_bijou:r.typeBijou||null,
    carat:r.carat||null, poids:r.poids||0,
    local:r.local||0, importe:r.importe||0,
    prix:r.prixPropose||0, note:r.note||null, photo:r.photo||null
  });
  await dbSaveCounters(['ac']);
}

async function dbSaveBijouArr(ba) {
  await _supa.upsert('bijoux_arrhes', {
    id:ba.id, date:ba.date, client:ba.client||null,
    article:ba.article||null, description:ba.description||null,
    prix_total:ba.prixTotal||0, arrhes_verse:ba.arrhesVerse||0,
    restant_du:ba.restantDu||0, date_echeance:ba.dateEcheance||null,
    statut:ba.statut||'en_cours'
  });
  if (ba.mouvements && ba.mouvements.length) {
    await _supa.delete('mouvements_arrhes', 'arrhes_id=eq.' + encodeURIComponent(ba.id));
    await _supa.upsert('mouvements_arrhes', ba.mouvements.map(function(m){
      return { arrhes_id:ba.id, date:m.date, montant:m.montant, note:m.note||null };
    }));
  }
  await dbSaveCounters(['ba']);
}

async function dbSaveConnexion(c) {
  await _supa.upsert('connexions', {
    id:c.id, user_id:c.userId||null, nom:c.nom,
    role:c.role, date:c.date, heure:c.heure, action:c.action
  });
  await dbSaveCounters(['cn']);
}

async function dbSaveCounters(cles) {
  if (!cles || !cles.length) return;
  await _supa.upsert('compteurs', cles.map(function(k){
    return { cle:k, valeur:STATE.counters[k]||0 };
  }));
}

// ============================================
// WRAPPER : écrire dans STATE + Supabase + toast erreur
// ============================================
async function db(label, fn) {
  try {
    await fn();
  } catch(e) {
    console.error('DB [' + label + ']:', e);
    showToast('Erreur: ' + e.message);
    throw e;
  }
}

// ============================================
// REALTIME — WebSocket Supabase
// ============================================
var _ws = null;
var _wsAlive = false;

function startRealtime() {
  if (_ws && _ws.readyState === WebSocket.OPEN) return;
  var url = SUPABASE_URL.replace('https://', 'wss://')
    + '/realtime/v1/websocket?apikey=' + SUPABASE_KEY + '&vsn=1.0.0';
  _ws = new WebSocket(url);

  _ws.onopen = function() {
    _wsAlive = true;
    showRealtimeIndicator(true);
    // S'abonner à toutes les tables
    ['ventes','stock','clients','sorties','decaissements',
     'comptes_clients','mouvements_cc','reprises','bijoux_arrhes','compteurs']
    .forEach(function(t) {
      _ws.send(JSON.stringify({
        topic:   'realtime:public:' + t,
        event:   'phx_join',
        payload: { config: { broadcast:{self:false} } },
        ref:     t
      }));
    });
  };

  _ws.onmessage = function(e) {
    try {
      var msg = JSON.parse(e.data);
      // Heartbeat
      if (msg.event === 'heartbeat') {
        _ws.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref:null }));
        return;
      }
      if (msg.event==='INSERT'||msg.event==='UPDATE'||msg.event==='DELETE') {
        var table = (msg.topic||'').replace('realtime:public:','');
        onRealtimeChange(msg.event, table, msg.payload&&msg.payload.record, msg.payload&&msg.payload.old_record);
      }
    } catch(_){}
  };

  _ws.onclose = function() {
    _wsAlive = false;
    _ws = null;
    showRealtimeIndicator(false);
    setTimeout(startRealtime, 3000); // reconnexion auto
  };

  _ws.onerror = function(e){ console.error('WS error:', e); };
}

function stopRealtime() {
  if (_ws) { _ws.onclose=null; _ws.close(); _ws=null; }
}

function onRealtimeChange(event, table, record, old) {
  if (!record && event!=='DELETE') return;
  var id = record&&(record.id||record.ref||record.cle);

  switch(table) {
    case 'ventes':
      applyChange(STATE.ventes, event, mapVente(record||{}), old&&old.id, 'id');
      renderJournal(); renderDashboard(); break;

    case 'stock':
      applyChange(STATE.stock, event, mapStock(record||{}), old&&old.ref, 'ref');
      renderStocks(); renderDashboard(); break;

    case 'clients':
      applyChange(STATE.clients, event, record, old&&old.id, 'id');
      break;

    case 'sorties':
      applyChange(STATE.sorties, event, mapSortie(record||{}), old&&old.id, 'id');
      renderSorties(); break;

    case 'decaissements':
      applyChange(STATE.decaissements, event, mapDecaiss(record||{}), old&&old.id, 'id');
      renderDecaissements(); renderDashboard(); break;

    case 'comptes_clients':
      var cc = mapCompte(record||{});
      var idx = STATE.comptesClients.findIndex(function(x){return x.id===cc.id;});
      if (event==='DELETE') {
        STATE.comptesClients = STATE.comptesClients.filter(function(x){return x.id!==(old&&old.id);});
      } else if (idx>=0) {
        cc.mouvements = STATE.comptesClients[idx].mouvements||[];
        STATE.comptesClients[idx] = cc;
      } else {
        cc.mouvements = [];
        STATE.comptesClients.unshift(cc);
      }
      renderComptesClients(); break;

    case 'mouvements_cc':
      if (record&&record.compte_id) {
        _supa.select('mouvements_cc','compte_id=eq.'+encodeURIComponent(record.compte_id)+'&order=id.asc')
          .then(function(mvts){
            var ci=STATE.comptesClients.findIndex(function(x){return x.id===record.compte_id;});
            if(ci>=0){
              STATE.comptesClients[ci].mouvements=mvts.map(function(m){
                return{date:m.date,type:m.type,montant:m.montant,note:m.note};
              });
              renderComptesClients();
            }
          });
      }
      break;

    case 'reprises':
      applyChange(STATE.achatsClients, event, mapReprise(record||{}), old&&old.id, 'id');
      renderAchatsClients(); break;

    case 'bijoux_arrhes':
      var ba = record||{};
      var bai = STATE.bijouxArr.findIndex(function(x){return x.id===ba.id;});
      if (event==='DELETE') {
        STATE.bijouxArr=STATE.bijouxArr.filter(function(x){return x.id!==(old&&old.id);});
      } else if(bai>=0) {
        ba.mouvements=STATE.bijouxArr[bai].mouvements||[];
        STATE.bijouxArr[bai]=ba;
      } else {
        ba.mouvements=[];
        STATE.bijouxArr.unshift(ba);
      }
      renderBijouxArr(); renderDashboard(); break;

    case 'compteurs':
      if(record) STATE.counters[record.cle]=record.valeur; break;
  }
  save(); // sync localStorage
}

function applyChange(arr, event, item, oldId, key) {
  if (event==='DELETE') {
    var i=arr.findIndex(function(x){return x[key]===oldId;});
    if(i>=0) arr.splice(i,1);
  } else {
    var j=arr.findIndex(function(x){return x[key]===item[key];});
    if(j>=0) arr[j]=item; else arr.unshift(item);
  }
}

// ============================================
// FONCTIONS DE MAPPING snake_case → camelCase
// ============================================
function mapVente(v) {
  return { id:v.id, date:v.date, client:v.client, description:v.description,
    typeBijou:v.type_bijou, carat:v.carat, poids:v.poids||0,
    local:v.local||0, importe:v.importe||0, paiement:v.paiement,
    montant:v.montant||0, acompte:v.acompte||0, restant:v.restant||0,
    numFacture:v.num_facture, compteClientId:v.compte_client_id,
    noteComplement:v.note_complement };
}
function mapStock(s) {
  return { ref:s.ref, nom:s.nom, typeBijou:s.type_bijou, carat:s.carat,
    provenance:s.provenance, type:s.type, poids:s.poids||0,
    poidsTotalG:s.poids_total_g||0, qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50 };
}
function mapSortie(s) {
  return { id:s.id, date:s.date, typeBijou:s.type_bijou||s.typeBijou,
    carat:s.carat, poids:s.poids||0, nbArticles:s.nb_articles||s.nbArticles||0,
    motif:s.motif, commentaire:s.commentaire, validePar:s.valide_par||s.validePar };
}
function mapDecaiss(d) {
  return { id:d.id, date:d.date, categorie:d.categorie,
    description:d.description, montant:d.montant||0, saisiPar:d.saisi_par||d.saisiPar };
}
function mapCompte(cc) {
  return { id:cc.id, client:cc.client,
    dateOuverture:cc.date_ouverture||cc.dateOuverture||null,
    solde:cc.solde||0, actif:cc.actif!==false, mouvements:cc.mouvements||[] };
}
function mapReprise(r) {
  return { id:r.id, date:r.date, client:r.client, description:r.description,
    typeBijou:r.type_bijou||r.typeBijou, carat:r.carat, poids:r.poids||0,
    local:r.local||0, importe:r.importe||0, prixPropose:r.prix||r.prixPropose||0,
    note:r.note, photo:r.photo };
}

// ============================================
// INDICATEUR TEMPS RÉEL
// ============================================
function showRealtimeIndicator(on) {
  var el = document.getElementById('rt-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rt-indicator';
    el.style.cssText = 'position:fixed;bottom:14px;right:14px;padding:5px 11px;' +
      'border-radius:20px;font-size:11px;font-weight:600;z-index:9998;' +
      'display:flex;align-items:center;gap:5px;transition:opacity 0.5s;';
    document.body.appendChild(el);
  }
  var dot = '<span style="width:7px;height:7px;border-radius:50%;display:inline-block;background:';
  if (on) {
    el.style.cssText += 'background:rgba(76,175,80,0.12);color:#4caf50;border:1px solid rgba(76,175,80,0.3);';
    el.innerHTML = dot + '#4caf50"></span> Temps réel';
    setTimeout(function(){ el.style.opacity='0.5'; }, 3000);
  } else {
    el.style.opacity='1';
    el.style.cssText += 'background:rgba(244,67,54,0.12);color:#f44336;border:1px solid rgba(244,67,54,0.3);';
    el.innerHTML = dot + '#f44336"></span> Reconnexion...';
  }
}

// ============================================
// OVERLAY CHARGEMENT
// ============================================
function showLoadingOverlay(show) {
  var el = document.getElementById('supa-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'supa-loading';
    el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(26,25,22,0.9);z-index:9999;' +
      'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px';
    el.innerHTML = '<div style="width:44px;height:44px;border:3px solid rgba(201,168,76,0.3);' +
      'border-top-color:#C9A84C;border-radius:50%;animation:ks 0.8s linear infinite"></div>' +
      '<div style="color:#C9A84C;font-size:13px;letter-spacing:2px">Chargement KAYOR</div>' +
      '<style>@keyframes ks{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(el);
  }
  el.style.display = show ? 'flex' : 'none';
}

// ============================================
// CYCLE COMPLET : ÉCRITURE → LECTURE → AFFICHAGE
// ============================================

// Fonction centrale : écrit dans Supabase, relit, met à jour STATE, render
async function supaWriteReadRender(table, data, mapFn, stateKey, renderFn, idField) {
  idField = idField || 'id';
  try {
    // 1. ÉCRITURE
    await _supa.upsert(table, Array.isArray(data) ? data : [data]);

    // 2. LECTURE (relire depuis Supabase)
    var filter = Array.isArray(data)
      ? idField + '=in.(' + data.map(function(d){ return d[idField]; }).join(',') + ')'
      : idField + '=eq.' + encodeURIComponent(data[idField]);
    var rows = await _supa.select(table, filter);

    // 3. MISE À JOUR STATE
    rows.forEach(function(row) {
      var mapped = mapFn ? mapFn(row) : row;
      var arr = STATE[stateKey];
      var idx = arr.findIndex(function(x){ return x[idField] === mapped[idField]; });
      if (idx >= 0) {
        arr[idx] = mapped;
      } else {
        arr.unshift(mapped);
      }
    });

    // 4. AFFICHAGE
    if (renderFn) renderFn();

    return rows;
  } catch(err) {
    console.error('supaWriteReadRender erreur [' + table + ']:', err);
    showToast('Erreur: ' + err.message);
    throw err;
  }
}

// Variante DELETE : supprime, relit la liste, met à jour STATE, render
async function supaDeleteReadRender(table, id, stateKey, renderFn, idField) {
  idField = idField || 'id';
  try {
    await _supa.deleteRow(table, id);
    STATE[stateKey] = STATE[stateKey].filter(function(x){ return x[idField] !== id; });
    if (renderFn) renderFn();
  } catch(err) {
    console.error('supaDeleteReadRender erreur [' + table + ']:', err);
    showToast('Erreur suppression: ' + err.message);
    throw err;
  }
}

// ── Fonctions spécialisées par entité ─────────────────────────────────────

async function syncVente(v) {
  var row = {
    id:v.id, date:v.date, client:v.client||null, description:v.description||null,
    type_bijou:v.typeBijou||null, carat:v.carat||null, poids:v.poids||0,
    local:v.local||0, importe:v.importe||0, paiement:v.paiement||null,
    montant:v.montant||0, acompte:v.acompte||0, restant:v.restant||0
  };
  if (v.numFacture)     row.num_facture      = v.numFacture;
  if (v.compteClientId) row.compte_client_id = v.compteClientId;
  if (v.noteComplement) row.note_complement  = v.noteComplement;
  return supaWriteReadRender('ventes', row, mapVente, 'ventes',
    function(){ renderJournal(); renderDashboard(); });
}

async function syncStock(items) {
  if (!items || !items.length) return;
  var rows = items.map(function(s) {
    return { ref:s.ref, nom:s.nom, type_bijou:s.typeBijou||null, carat:s.carat||null,
      provenance:s.provenance||null, type:s.type||'autre',
      poids:s.poids||0, poids_total_g:s.poidsTotalG||0,
      qty:s.qty||0, prix:s.prix||0, seuil:s.seuil||50 };
  });
  // Upsert batch
  await _db('syncStock', async function() {
    await _supa.upsert('stock', rows);
    // Relire depuis Supabase
    var refs = items.map(function(s){ return s.ref; });
    var fresh = await _supa.select('stock', 'ref=in.(' + refs.join(',') + ')');
    fresh.forEach(function(row) {
      var mapped = mapStock(row);
      var idx = STATE.stock.findIndex(function(x){ return x.ref === mapped.ref; });
      if (idx >= 0) STATE.stock[idx] = mapped;
      else STATE.stock.unshift(mapped);
    });
    renderStocks(); renderDashboard();
    await saveCompteurs(['stk']);
  });
}

async function syncSortie(s) {
  var row = { id:s.id, date:s.date, type_bijou:s.typeBijou||null, carat:s.carat||null,
    poids:s.poids||0, nb_articles:s.nbArticles||0,
    motif:s.motif||null, commentaire:s.commentaire||null, valide_par:s.validePar||'admin' };
  return supaWriteReadRender('sorties', row, mapSortie, 'sorties',
    function(){ renderSorties(); });
}

async function syncClient(c) {
  return supaWriteReadRender('clients',
    { id:c.id, nom:c.nom, tel:c.tel||null, email:c.email||null, adresse:c.adresse||null },
    function(row){ return row; }, 'clients',
    function(){ renderClients(); });
}

async function syncCompteClient(cc) {
  await _db('syncCompteClient', async function() {
    // Écrire le compte
    await _supa.upsert('comptes_clients', {
      id:cc.id, client:cc.client, date_ouverture:cc.dateOuverture||null,
      solde:cc.solde||0, actif:cc.actif!==false
    });
    // Écrire les mouvements (delete + insert)
    if (cc.mouvements && cc.mouvements.length) {
      await fetch(SUPABASE_URL+'/rest/v1/mouvements_cc?compte_id=eq.'+encodeURIComponent(cc.id), {
        method:'DELETE', headers:H
      });
      await _supa.upsert('mouvements_cc', cc.mouvements.map(function(m) {
        return { compte_id:cc.id, date:m.date, type:m.type, montant:m.montant, note:m.note||null };
      }));
    }
    // Relire depuis Supabase
    var freshCC = await _supa.select('comptes_clients', 'id=eq.'+encodeURIComponent(cc.id));
    var freshMVT = await _supa.select('mouvements_cc', 'compte_id=eq.'+encodeURIComponent(cc.id)+'&order=id.asc');
    if (freshCC.length) {
      var mapped = mapCompte(freshCC[0]);
      mapped.mouvements = freshMVT.map(function(m){
        return { date:m.date, type:m.type, montant:m.montant, note:m.note };
      });
      var idx = STATE.comptesClients.findIndex(function(x){ return x.id === cc.id; });
      if (idx >= 0) STATE.comptesClients[idx] = mapped;
      else STATE.comptesClients.unshift(mapped);
    }
    renderComptesClients();
    await saveCompteurs(['cc']);
  });
}

async function syncDecaissement(d) {
  var row = { id:d.id, date:d.date, categorie:d.categorie||null,
    description:d.description||null, montant:d.montant||0, saisi_par:d.saisiPar||null };
  return supaWriteReadRender('decaissements', row, mapDecaissement, 'decaissements',
    function(){ renderDecaissements(); renderDashboard(); });
}

async function syncReprise(r) {
  var row = { id:r.id, date:r.date, client:r.client||null, description:r.description||null,
    type_bijou:r.typeBijou||null, carat:r.carat||null, poids:r.poids||0,
    local:r.local||0, importe:r.importe||0, prix:r.prixPropose||0,
    note:r.note||null, photo:r.photo||null };
  return supaWriteReadRender('reprises', row, mapReprise, 'achatsClients',
    function(){ renderAchatsClients(); renderDashboard(); });
}

async function syncBijouArr(ba) {
  await _db('syncBijouArr', async function() {
    await _supa.upsert('bijoux_arrhes', {
      id:ba.id, date:ba.date, client:ba.client||null,
      article:ba.article||null, description:ba.description||null,
      prix_total:ba.prixTotal||0, arrhes_verse:ba.arrhesVerse||0,
      restant_du:ba.restantDu||0, date_echeance:ba.dateEcheance||null,
      statut:ba.statut||'en_cours'
    });
    if (ba.mouvements && ba.mouvements.length) {
      await _supa.upsert('mouvements_arrhes', ba.mouvements.map(function(m){
        return { arrhes_id:ba.id, date:m.date, montant:m.montant, note:m.note||null };
      }));
    }
    // Relire
    var fresh = await _supa.select('bijoux_arrhes', 'id=eq.'+encodeURIComponent(ba.id));
    if (fresh.length) {
      var mapped = fresh[0];
      mapped.mouvements = ba.mouvements || [];
      var idx = STATE.bijouxArr.findIndex(function(x){ return x.id === ba.id; });
      if (idx >= 0) STATE.bijouxArr[idx] = mapped;
      else STATE.bijouxArr.unshift(mapped);
    }
    renderBijouxArr(); renderDashboard();
    await saveCompteurs(['ba']);
  });
}

// ============================================
// ÉCRITURE + RELECTURE DEPUIS SUPABASE
// Pattern : App → Supabase → App
// ============================================

async function _writeAndRefresh(table, data, refreshFn) {
  try {
    await _supa.upsert(table, Array.isArray(data) ? data : [data]);
    // Relire depuis Supabase pour avoir les données à jour
    if (refreshFn) await refreshFn();
  } catch(err) {
    console.error('Erreur write+refresh ['+table+']:', err);
    showToast('Erreur: ' + err.message);
  }
}

// Relire et mettre à jour STATE pour chaque entité
async function reloadVentes() {
  var rows = await _supa.select('ventes', 'order=date.desc');
  STATE.ventes = rows.map(mapVente);
  renderJournal(); renderDashboard();
}
async function reloadStock() {
  var rows = await _supa.select('stock');
  STATE.stock = rows.map(mapStock);
  renderStocks(); renderDashboard();
}
async function reloadClients() {
  var rows = await _supa.select('clients');
  STATE.clients = rows;
  if(typeof renderClients==='function') renderClients();
}
async function reloadSorties() {
  var rows = await _supa.select('sorties', 'order=date.desc');
  STATE.sorties = rows.map(mapSortie);
  renderSorties();
}
async function reloadDecaissements() {
  var rows = await _supa.select('decaissements', 'order=date.desc');
  STATE.decaissements = rows.map(mapDecaissement);
  renderDecaissements(); renderDashboard();
}
async function reloadComptes() {
  var ccs = await _supa.select('comptes_clients');
  var mvts = await _supa.select('mouvements_cc', 'order=id.asc');
  STATE.comptesClients = ccs.map(function(cc) {
    return Object.assign(mapCompte(cc), {
      mouvements: mvts.filter(function(m){return m.compte_id===cc.id;})
        .map(function(m){return {date:m.date,type:m.type,montant:m.montant,note:m.note};})
    });
  });
  renderComptesClients();
}
async function reloadReprises() {
  var rows = await _supa.select('reprises', 'order=date.desc');
  STATE.achatsClients = rows.map(mapReprise);
  renderAchatsClients();
}
async function reloadArrhes() {
  var rows = await _supa.select('bijoux_arrhes');
  var mvts = await _supa.select('mouvements_arrhes');
  STATE.bijouxArr = rows.map(function(ba) {
    return Object.assign({}, ba, {
      mouvements: mvts.filter(function(m){return m.arrhes_id===ba.id;})
        .map(function(m){return {date:m.date,montant:m.montant,note:m.note};})
    });
  });
  renderBijouxArr(); renderDashboard();
}
async function reloadCompteurs() {
  var rows = await _supa.select('compteurs');
  rows.forEach(function(r){ STATE.counters[r.cle]=r.valeur; });
}

// ── Fonctions de sauvegarde avec rechargement ──────────────────────────────
async function saveVente(v) {
  await _writeAndRefresh('ventes', {
    id:v.id, date:v.date, client:v.client||null,
    description:v.description||null, type_bijou:v.typeBijou||null,
    carat:v.carat||null, poids:v.poids||0,
    local:v.local||0, importe:v.importe||0, paiement:v.paiement||null,
    montant:v.montant||0, acompte:v.acompte||0, restant:v.restant||0,
    ...(v.numFacture      && {num_facture:      v.numFacture}),
    ...(v.compteClientId  && {compte_client_id: v.compteClientId}),
    ...(v.noteComplement  && {note_complement:  v.noteComplement})
  }, async function() {
    await reloadVentes();
    await saveCompteurs(['v','fac']);
  });
}

async function saveStock(s) {
  await _writeAndRefresh('stock', {
    ref:s.ref, nom:s.nom, type_bijou:s.typeBijou||null,
    carat:s.carat||null, provenance:s.provenance||null,
    type:s.type||'autre', poids:s.poids||0,
    poids_total_g:s.poidsTotalG||0, qty:s.qty||0,
    prix:s.prix||0, seuil:s.seuil||50
  }, async function() {
    await reloadStock();
    await saveCompteurs(['stk']);
  });
}

async function saveStockBatch(items) {
  if (!items || !items.length) return;
  await _writeAndRefresh('stock', items.map(function(s) {
    return {
      ref:s.ref, nom:s.nom, type_bijou:s.typeBijou||null,
      carat:s.carat||null, provenance:s.provenance||null,
      type:s.type||'autre', poids:s.poids||0,
      poids_total_g:s.poidsTotalG||0, qty:s.qty||0,
      prix:s.prix||0, seuil:s.seuil||50
    };
  }), reloadStock);
}

async function saveClient(c) {
  await _writeAndRefresh('clients', {
    id:c.id, nom:c.nom, tel:c.tel||null,
    email:c.email||null, adresse:c.adresse||null
  }, async function() {
    await reloadClients();
    await saveCompteurs(['cl']);
  });
}

async function saveCompteClient(cc) {
  await _writeAndRefresh('comptes_clients', {
    id:cc.id, client:cc.client,
    date_ouverture:cc.dateOuverture||null,
    solde:cc.solde||0, actif:cc.actif!==false
  }, null);
  // Mouvements : supprimer et réinsérer
  if (cc.mouvements && cc.mouvements.length) {
    try {
      await fetch(SUPABASE_URL+'/rest/v1/mouvements_cc?compte_id=eq.'+encodeURIComponent(cc.id),
        { method:'DELETE', headers:H });
      await _supa.upsert('mouvements_cc', cc.mouvements.map(function(m){
        return {compte_id:cc.id,date:m.date,type:m.type,montant:m.montant,note:m.note||null};
      }));
    } catch(e) { console.error('mouvements_cc:', e); }
  }
  await reloadComptes();
  await saveCompteurs(['cc']);
}

async function saveSortie(s) {
  await _writeAndRefresh('sorties', {
    id:s.id, date:s.date, type_bijou:s.typeBijou||null,
    carat:s.carat||null, poids:s.poids||0,
    nb_articles:s.nbArticles||0, motif:s.motif||null,
    commentaire:s.commentaire||null, valide_par:s.validePar||'admin'
  }, async function() {
    await reloadSorties();
    await saveCompteurs(['s']);
  });
}

async function saveDecaissement(d) {
  await _writeAndRefresh('decaissements', {
    id:d.id, date:d.date, categorie:d.categorie||null,
    description:d.description||null, montant:d.montant||0,
    saisi_par:d.saisiPar||null
  }, async function() {
    await reloadDecaissements();
    await saveCompteurs(['d']);
  });
}

async function saveReprise(r) {
  await _writeAndRefresh('reprises', {
    id:r.id, date:r.date, client:r.client||null,
    description:r.description||null, type_bijou:r.typeBijou||null,
    carat:r.carat||null, poids:r.poids||0,
    local:r.local||0, importe:r.importe||0,
    prix:r.prixPropose||0, note:r.note||null, photo:r.photo||null
  }, async function() {
    await reloadReprises();
    await saveCompteurs(['ac']);
  });
}

async function saveBijouArr(ba) {
  await _writeAndRefresh('bijoux_arrhes', {
    id:ba.id, date:ba.date, client:ba.client||null,
    article:ba.article||null, description:ba.description||null,
    prix_total:ba.prixTotal||0, arrhes_verse:ba.arrhesVerse||0,
    restant_du:ba.restantDu||0, date_echeance:ba.dateEcheance||null,
    statut:ba.statut||'en_cours'
  }, null);
  if (ba.mouvements && ba.mouvements.length) {
    try {
      await fetch(SUPABASE_URL+'/rest/v1/mouvements_arrhes?arrhes_id=eq.'+encodeURIComponent(ba.id),
        { method:'DELETE', headers:H });
      await _supa.upsert('mouvements_arrhes', ba.mouvements.map(function(m){
        return {arrhes_id:ba.id,date:m.date,montant:m.montant,note:m.note||null};
      }));
    } catch(e) { console.error('mouvements_arrhes:', e); }
  }
  await reloadArrhes();
  await saveCompteurs(['ba']);
}

async function saveConnexion(c) {
  try {
    await _supa.upsert('connexions', {
      id:c.id, user_id:c.userId||null, nom:c.nom,
      role:c.role, date:c.date, heure:c.heure, action:c.action
    });
    await saveCompteurs(['cn']);
  } catch(e) { console.error('connexion:', e); }
}

async function saveCompteurs(cles) {
  if (!cles || !cles.length) return;
  try {
    await _supa.upsert('compteurs', cles.map(function(k){
      return {cle:k, valeur:STATE.counters[k]||0};
    }));
  } catch(e) { console.error('compteurs:', e); }
}

async function nextIdSupa(prefix, key) {
  STATE.counters[key] = (STATE.counters[key]||0)+1;
  await saveCompteurs([key]);
  return prefix+'-'+String(STATE.counters[key]).padStart(4,'0');
}

// ============================================
// SUPPRESSIONS → Supabase → reload → render
// ============================================
async function deleteVente(id) {
  await _supa.deleteRow('ventes', id);
  await reloadVentes();
}
async function deleteStock(ref) {
  await _supa.deleteRow('stock', ref);
  await reloadStock();
}
async function deleteSortie(id) {
  await _supa.deleteRow('sorties', id);
  await reloadSorties();
}
async function deleteDecaissement(id) {
  await _supa.deleteRow('decaissements', id);
  await reloadDecaissements();
}
async function deleteClient(id) {
  await _supa.deleteRow('clients', id);
  await reloadClients();
}
async function deleteCompteClient(id) {
  // Supprimer les mouvements d'abord
  await fetch(SUPABASE_URL+'/rest/v1/mouvements_cc?compte_id=eq.'+encodeURIComponent(id),
    {method:'DELETE', headers:H});
  await _supa.deleteRow('comptes_clients', id);
  await reloadComptes();
}
async function deleteReprise(id) {
  await _supa.deleteRow('reprises', id);
  await reloadReprises();
}
async function deleteBijouArr(id) {
  await fetch(SUPABASE_URL+'/rest/v1/mouvements_arrhes?arrhes_id=eq.'+encodeURIComponent(id),
    {method:'DELETE', headers:H});
  await _supa.deleteRow('bijoux_arrhes', id);
  await reloadArrhes();
}
async function updateVente(v) {
  await saveVente(v);
}
async function updateCC(cc) {
  await saveCompteClient(cc);
}
async function updateBijouArr(ba) {
  await saveBijouArr(ba);
}
async function updateStock(s) {
  await saveStockBatch([s]);
}

// ============================================
// SUPPRESSIONS AVEC RELECTURE
// ============================================
async function deleteVente(id) {
  try {
    await _supa.deleteRow('ventes', id);
    await reloadVentes();
  } catch(e) { console.error('deleteVente:', e); showToast('Erreur suppression: '+e.message); }
}
async function deleteStock(ref) {
  try {
    await _supa.deleteRow('stock', ref);
    await reloadStock();
  } catch(e) { console.error('deleteStock:', e); }
}
async function deleteDecaissement(id) {
  try {
    await _supa.deleteRow('decaissements', id);
    await reloadDecaissements();
  } catch(e) { console.error('deleteDecaissement:', e); }
}
async function deleteCompteClient(id) {
  try {
    await fetch(SUPABASE_URL+'/rest/v1/mouvements_cc?compte_id=eq.'+encodeURIComponent(id), {method:'DELETE',headers:H});
    await _supa.deleteRow('comptes_clients', id);
    await reloadComptes();
  } catch(e) { console.error('deleteCC:', e); }
}
async function deleteReprise(id) {
  try {
    await _supa.deleteRow('reprises', id);
    await reloadReprises();
  } catch(e) { console.error('deleteReprise:', e); }
}
async function deleteUtilisateur(id) {
  try {
    await _supa.deleteRow('utilisateurs', id);
  } catch(e) { console.error('deleteUser:', e); }
}
async function saveUtilisateur(u) {
  try {
    await _supa.upsert('utilisateurs', {
      id:u.id, nom:u.nom, login:u.login,
      password:u.password, role:u.role, actif:u.actif!==false
    });
  } catch(e) { console.error('saveUser:', e); }
}

async function reloadUtilisateurs() {
  try {
    var rows = await _supa.select('utilisateurs');
    STATE.users = rows;
    if(typeof renderGestionComptes==='function') renderGestionComptes();
  } catch(e) { console.error('reloadUsers:', e); }
}

