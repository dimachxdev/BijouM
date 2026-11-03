/**
 * KAYOR — Portail Client
 * ---------------------------------------------------------------------------
 * Connexion : téléphone + code PIN à 4 chiffres.
 *
 * Le portail n'accède plus aux tables. Auparavant il téléchargeait la fiche
 * cliente avec la clé publiable puis comparait le PIN dans le navigateur :
 * n'importe qui pouvait lire tous les codes, et 4 chiffres se forcent en
 * quelques secondes. Désormais il ne peut appeler que quatre fonctions
 * serveur, qui vérifient le PIN en bcrypt, bloquent après 5 échecs et
 * délivrent un jeton de session à durée limitée.
 */

const SUPA_URL = 'https://yflvtquowzvghwxyvuah.supabase.co';
const SUPA_KEY = 'sb_publishable_3EBGFxeT8B8cys54IZj3Nw_ZTS-4ZR1';

// Le jeton vit dans sessionStorage, pas localStorage : le portail est souvent
// ouvert depuis une tablette de boutique ou un téléphone prêté. La session
// disparaît à la fermeture de l'onglet.
const CLE_JETON = 'kayor_portail_token';
// La liste des accès suit le jeton : sans elle, un rechargement de page
// ferait perdre la possibilité de passer à l'autre bijouterie sans se
// reconnecter. Même durée de vie, même stockage.
const CLE_ACCES = 'kayor_portail_acces';

var JETON     = null;
var CLIENT    = null;
var BOUTIQUE  = null;   // { nom, code, telephone } — celle de la session en cours
var ACCES     = [];     // une entrée par bijouterie où le code a concordé
var COMPTES   = [];
var COMMANDES = [];
var DERNIER_DEPOT = null;

// ─── Utilitaires ───────────────────────────────────────────

function fmt(n){ return Number(n||0).toLocaleString('fr-FR') + ' FCFA'; }
function fmtDate(d){ if(!d) return '—'; var p=String(d).split('-'); return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:d; }
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

function openModal(id){  document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }

function erreurLogin(msg){
  var e = document.getElementById('login-error');
  e.textContent = msg || '';
  e.style.display = msg ? 'block' : 'none';
}

// ─── Appels serveur ────────────────────────────────────────

/**
 * Seule porte d'entrée du portail : les quatre fonctions autorisées.
 * Tout accès direct aux tables est refusé par PostgreSQL depuis que RLS est
 * actif — le portail n'a volontairement aucun privilège de lecture.
 */
async function rpc(nom, params){
  var ctrl = new AbortController();
  var tid  = setTimeout(function(){ ctrl.abort(); }, 15000);
  try {
    var r = await fetch(SUPA_URL + '/rest/v1/rpc/' + nom, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY
      },
      body: JSON.stringify(params || {}),
      signal: ctrl.signal
    });
    if(!r.ok) throw new Error('Service indisponible (' + r.status + ').');
    return await r.json();
  } catch(e){
    if(e.name === 'AbortError') throw new Error('Le serveur met trop de temps à répondre.');
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

// ─── Navigation ────────────────────────────────────────────

// La liste est ici, et nulle part ailleurs : ajouter une page sans l'y
// inscrire la laisserait visible sous la suivante. C'est arrivé en ajoutant
// `page-boutiques` le 2026-11-03.
var PAGES = ['page-login', 'page-boutiques', 'page-dashboard'];

function showPage(id){
  PAGES.forEach(function(p){
    var el = document.getElementById(p);
    if(el) el.style.display = 'none';
  });
  var el = document.getElementById(id);
  if(!el) return;
  // Valeur explicite : une règle CSS pose display:none, et remettre une chaîne
  // vide laisserait cette règle s'appliquer — la page resterait invisible.
  // Les deux écrans bâtis sur `.login-box` se centrent en flex.
  el.style.display = (id === 'page-dashboard') ? 'block' : 'flex';
}

// ─── Saisie du PIN ─────────────────────────────────────────

function pinNav(el, nextId, prevId, autoSubmit){
  var val = el.value.replace(/\D/g,'');
  el.value = val;
  if(val && nextId){
    document.getElementById(nextId).focus();
  } else if(!val && prevId && window.event && window.event.key === 'Backspace'){
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

// ─── Connexion ─────────────────────────────────────────────

async function doLogin(){
  var tel = document.getElementById('login-tel').value.trim();
  var pin = getPin();
  erreurLogin('');

  if(!tel){ erreurLogin('Veuillez saisir votre numéro de téléphone.'); return; }
  if(pin.length !== 4){ erreurLogin('Veuillez saisir votre code PIN (4 chiffres).'); return; }

  showLoading(true);
  try {
    var res = await rpc('portail_login', { p_tel: tel, p_pin: pin });

    if(!res || !res.ok){
      showLoading(false);
      // Le serveur renvoie le même message pour un numéro inconnu et un PIN
      // faux : distinguer les deux permettrait de savoir qui est cliente.
      erreurLogin((res && res.erreur) || 'Connexion impossible.');
      clearPin();
      document.getElementById('pin-1').focus();
      return;
    }

    // Depuis la migration 037, le serveur ouvre une session PAR bijouterie où
    // le numéro et le code concordent. Il n'en choisit plus une au hasard.
    ACCES = res.acces || [{ token: res.token, boutique: res.boutique, client: res.client }];
    memoriserAcces();

    if(res.plusieurs){
      // On ne charge rien tant qu'elle n'a pas choisi : afficher l'épargne
      // d'une bijouterie qu'elle n'a pas désignée est exactement le défaut
      // qu'on corrige.
      showLoading(false);
      afficherChoixBoutique();
      return;
    }

    utiliserAcces(0);
    await chargerDonnees();
    afficherDashboard();
  } catch(e){
    showLoading(false);
    erreurLogin(e.message || 'Erreur de connexion. Vérifiez votre réseau.');
    console.error(e);
  }
}

async function chargerDonnees(){
  var res = await rpc('portail_donnees', { p_token: JETON });
  if(!res || !res.ok){
    throw new Error((res && res.erreur) || 'Session expirée.');
  }
  CLIENT    = res.client   || CLIENT;
  // La boutique vient du SERVEUR, déduite de la session — jamais de ce que le
  // navigateur croit avoir choisi. Les deux doivent toujours concorder, et
  // c'est le serveur qui fait foi.
  BOUTIQUE  = res.boutique || BOUTIQUE;
  COMPTES   = res.comptes  || [];
  COMMANDES = res.commandes || [];
}

// ─── Plusieurs bijouteries ─────────────────────────────────

function memoriserAcces(){
  try { sessionStorage.setItem(CLE_ACCES, JSON.stringify(ACCES)); } catch(e){}
}

function relireAcces(){
  try { ACCES = JSON.parse(sessionStorage.getItem(CLE_ACCES) || '[]'); }
  catch(e){ ACCES = []; }
}

/** Désigne l'accès à utiliser. Ne décide de rien : le serveur revérifie. */
function utiliserAcces(i){
  var a = ACCES[i];
  if(!a) return;
  JETON    = a.token;
  CLIENT   = a.client;
  BOUTIQUE = a.boutique;
  try { sessionStorage.setItem(CLE_JETON, JETON); } catch(e){ /* navigation privée */ }
}

function afficherChoixBoutique(){
  var cible = document.getElementById('liste-boutiques');
  cible.innerHTML = '';

  // `textContent` et non `innerHTML` : le nom vient de la base, et une
  // bijouterie nommée `<img src=x onerror=…>` s'exécuterait ici (§ 3).
  ACCES.forEach(function(a, i){
    var b = document.createElement('button');
    b.className = 'btn btn-primary';
    b.style.cssText = 'width:100%;margin-bottom:10px;display:block;text-align:left';
    b.textContent = (a.boutique && a.boutique.nom) || 'Bijouterie';
    b.onclick = function(){ basculerVers(i); };
    cible.appendChild(b);
  });

  showPage('page-boutiques');
  showLoading(false);
}

async function basculerVers(i){
  showLoading(true);
  try {
    utiliserAcces(i);
    await chargerDonnees();
    afficherDashboard();
  } catch(e){
    showLoading(false);
    showToast(e.message || 'Impossible d’ouvrir cette bijouterie.');
  }
}

/** Le bouton « ⇄ Changer » de l'en-tête. */
function choisirBoutique(){ afficherChoixBoutique(); }

/**
 * Reprise de session au chargement de la page.
 *
 * Le voile de chargement est visible par défaut dans le CSS : c'est ce code
 * qui doit le retirer, quel que soit le chemin pris. Sortir sans le masquer
 * laissait la page tourner indéfiniment pour toute première visite.
 */
async function reprendreSession(){
  var jeton = null;
  try { jeton = sessionStorage.getItem(CLE_JETON); } catch(e){}

  try {
    if(jeton){
      JETON = jeton;
      // La liste des accès est relue avant les données : c'est elle qui
      // décide si « ⇄ Changer » doit apparaître après un rechargement.
      relireAcces();
      await chargerDonnees();
      afficherDashboard();
      return;
    }
  } catch(e){
    // Jeton expiré ou révoqué : on repart proprement de l'écran de connexion.
    JETON = null; ACCES = [];
    try { sessionStorage.removeItem(CLE_JETON); } catch(_){}
    try { sessionStorage.removeItem(CLE_ACCES); } catch(_){}
  }

  // Le balisage pose display:none sur les deux pages : il faut afficher
  // explicitement l'écran de connexion, sinon la page reste noire.
  showPage('page-login');
  showLoading(false);
}

// ─── Tableau de bord ───────────────────────────────────────

function afficherDashboard(){
  showLoading(false);
  document.getElementById('dash-client-nom').textContent = CLIENT.nom || '';

  // Le nom de la bijouterie, en en-tête. `textContent` : il vient de la base.
  document.getElementById('dash-boutique').textContent =
    (BOUTIQUE && BOUTIQUE.nom) || '';

  // « ⇄ Changer » n'apparaît que s'il y a vraiment ailleurs où aller : un
  // bouton qui ne mène nulle part inquiète sans rien apporter.
  var chg = document.getElementById('btn-changer-boutique');
  if(chg) chg.style.display = (ACCES.length > 1) ? '' : 'none';

  renderComptes();
  renderCommandes();
  showPage('page-dashboard');
}

function renderComptes(){
  var el = document.getElementById('comptes-list');
  if(!COMPTES.length){
    el.innerHTML = '<div class="empty-state"><div class="icon">💰</div><div>Aucun compte épargne</div></div>';
    return;
  }

  el.innerHTML = COMPTES.map(function(cc){
    var mvts = (cc.mouvements || []).slice(0, 5);
    var mvtHtml = mvts.length ? mvts.map(function(m){
      var retrait = (m.type === 'retrait');
      return '<div class="mvt-item">' +
        '<div><div class="mvt-date">' + fmtDate(m.date) + '</div>' +
        '<div class="mvt-note">' + esc(m.note || (retrait ? 'Achat en boutique' : 'Dépôt')) + '</div></div>' +
        '<div class="' + (retrait ? 'mvt-amount retrait' : 'mvt-amount') + '">' +
        (retrait ? '−' : '+') + ' ' + fmt(m.montant) + '</div>' +
      '</div>';
    }).join('') : '<div style="font-size:12px;color:var(--sub);text-align:center;padding:8px">Aucun mouvement</div>';

    return '<div class="cc-card">' +
      '<div class="cc-card-header">' +
        '<div><div class="cc-solde-label">Solde épargne</div>' +
        '<div class="cc-solde">' + fmt(cc.solde) + '</div></div>' +
        '<div>' + (cc.actif ? '<span class="badge badge-green">Actif</span>'
                            : '<span class="badge badge-red">Clôturé</span>') + '</div>' +
      '</div>' +
      '<div class="mvt-list">' + mvtHtml + '</div>' +
      (cc.actif ? '<button class="btn-depot" onclick="ouvrirDepot(\'' + escJs(cc.id) + '\')">+ Effectuer un dépôt</button>' : '') +
    '</div>';
  }).join('');
}

/**
 * Commandes en cours : les ventes dont il reste quelque chose à payer.
 * L'ancienne table `bijoux_arrhes` n'alimente plus rien — le suivi se fait
 * depuis le journal des ventes.
 */
function renderCommandes(){
  var el = document.getElementById('arrhes-list');
  if(!COMMANDES.length){
    el.innerHTML = '<div class="empty-state"><div class="icon">💍</div><div>Aucune commande en cours</div></div>';
    return;
  }

  el.innerHTML = COMMANDES.map(function(v){
    var montant = v.montant || 0;
    var verse   = v.acompte || 0;
    var restant = v.restant || 0;
    var pct = montant > 0 ? Math.min(100, Math.round(verse / montant * 100)) : 0;

    return '<div class="arr-card">' +
      '<div class="arr-article">' + esc(v.description || 'Commande') + '</div>' +
      '<div class="arr-meta">' +
        '<span>📅 ' + fmtDate(v.date) + '</span>' +
        (v.num_facture ? '<span>🧾 ' + esc(v.num_facture) + '</span>' : '') +
        '<span class="badge badge-or">En cours</span>' +
      '</div>' +
      '<div class="amounts-row">' +
        '<div class="amount-box"><div class="val">' + fmt(montant) + '</div><div class="lbl">Prix total</div></div>' +
        '<div class="amount-box"><div class="val">' + fmt(verse) + '</div><div class="lbl">Versé</div></div>' +
        '<div class="amount-box"><div class="val" style="color:#f44336">' + fmt(restant) + '</div><div class="lbl">Restant</div></div>' +
      '</div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="progress-label"><span>' + pct + '% versé</span><span>' + fmt(montant) + '</span></div>' +
    '</div>';
  }).join('');
}

// ─── Dépôt ─────────────────────────────────────────────────

function ouvrirDepot(compteId){
  // Ce qui s'ouvre est un depot NEUF : on jette la cle du precedent, meme
  // s'il a echoue. Voir `confirmerDepot()`.
  Verrou.oublier('depot:' + compteId);
  // Chez qui ce dépôt est versé, lu sur la fenêtre elle-même : c'est le geste
  // où se tromper de bijouterie coûte le plus cher, et le seul écran où la
  // cliente engage de l'argent.
  var bq = document.getElementById('depot-boutique');
  if(bq) bq.textContent = 'Dépôt chez ' + ((BOUTIQUE && BOUTIQUE.nom) || 'votre bijouterie');
  document.getElementById('depot-compte-id').value = compteId;
  document.getElementById('depot-montant').value = '';
  document.getElementById('depot-note').value = '';
  document.querySelectorAll('.qa-btn').forEach(function(b){ b.classList.remove('active'); });
  openModal('modal-depot');
}

function setMontantDepot(val){
  document.getElementById('depot-montant').value = val;
  document.querySelectorAll('.qa-btn').forEach(function(b){
    b.classList.toggle('active', parseInt(b.textContent.replace(/\s/g,''), 10) === val);
  });
}

function clearQA(){
  document.querySelectorAll('.qa-btn').forEach(function(b){ b.classList.remove('active'); });
}

/**
 * LE GESTE LE PLUS EXPOSE AU REJEU DE TOUT LE PRODUIT.
 *
 * `rpc()` ci-dessus ABANDONNE a 15 secondes. Le serveur, lui, finit son
 * travail. La cliente lit « le serveur met trop de temps a repondre », son
 * depot est pourtant enregistre — et elle recommence. Rien dans le navigateur
 * ne peut l'en empecher : les deux tentatives sont a deux minutes d'ecart,
 * peut-etre apres un rechargement de page.
 *
 * D'ou la cle de geste, qui part avec l'appel. Au second passage, la fonction
 * `portail_depot()` reconnait la cle, n'ecrit rien, et rend le resultat du
 * premier depot — le recu affiche alors le bon solde, une seule fois credite.
 *
 * La cle est portee par le compte et survit a l'echec, elle n'est jetee qu'a
 * la reouverture de la fenetre (`ouvrirDepot`) ou apres un depot abouti.
 */
async function confirmerDepot(){
  var compteId = document.getElementById('depot-compte-id').value;
  var montant  = parseInt(document.getElementById('depot-montant').value, 10) || 0;
  var note     = document.getElementById('depot-note').value.trim();

  if(montant < 500){ showToast('Montant minimum : 500 FCFA'); return; }

  var nomGeste = 'depot:' + compteId;
  if(Verrou.enCours()){ showToast('Un dépôt est déjà en cours. Patientez.'); return; }

  // La cliente est celle qui a le moins de moyens de verifier : elle ne voit
  // ni le journal, ni la caisse. Un dépôt identique refait quelques secondes
  // plus tard doit donc lui etre signale avant d'etre ecrit.
  // Rien n'a encore ete affiche ni envoye a ce stade : on peut sortir sans
  // rien defaire.
  if(!Verrou.confirmerRepetition('portail-depot',
      'dépôt de ' + montant.toLocaleString('fr-FR') + ' FCFA sur ' + compteId)) return;

  var cle = Verrou.cleDe(nomGeste);

  showLoading(true);
  closeModal('modal-depot');

  try {
    // Le serveur revérifie le montant et que le compte appartient bien à la
    // cliente connectée : un montant trafiqué côté navigateur ne passe pas.
    var res = await Verrou.requete(nomGeste, function(){
      return rpc('portail_depot', {
        p_token: JETON, p_compte: compteId,
        p_montant: montant, p_note: note || null, p_cle: cle
      });
    });

    if(!res || !res.ok){
      showLoading(false);
      showToast((res && res.erreur) || 'Dépôt refusé.');
      if(res && /session/i.test(res.erreur||'')) doLogout();
      return;
    }

    DERNIER_DEPOT = {
      montant: montant, note: note, date: today(),
      nouveauSolde: res.nouveau_solde
    };
    // Abouti : le prochain depot sur ce compte portera une cle neuve, et ce
    // depot-ci est retenu — un depot identique dans les trois minutes fera
    // apparaitre la fenetre de confirmation.
    Verrou.oublier(nomGeste);
    Verrou.retenir();

    await chargerDonnees();   // on relit le serveur plutôt que de deviner l'état
    renderComptes();
    showLoading(false);
    afficherRecu();
  } catch(e){
    showLoading(false);
    showToast('Erreur dépôt : ' + e.message);
    console.error(e);
  }
}

// ─── Reçu ──────────────────────────────────────────────────

function afficherRecu(){
  if(!DERNIER_DEPOT) return;
  var d = DERNIER_DEPOT;

  var lignes = [
    ['Client',         CLIENT.nom],
    ['Date',           fmtDate(d.date)],
    ['Montant déposé', fmt(d.montant)],
    ['Nouveau solde',  fmt(d.nouveauSolde)]
  ];
  if(d.note) lignes.push(['Note', d.note]);

  document.getElementById('recu-table').innerHTML = lignes.map(function(l){
    return '<tr><td>' + esc(l[0]) + '</td><td>' + esc(l[1]) + '</td></tr>';
  }).join('');

  openModal('modal-recu');
}

// ─── Déconnexion ───────────────────────────────────────────

async function doLogout(){
  var jeton = JETON;
  // Les jetons des AUTRES bijouteries partent aussi : n'invalider que celui
  // en cours laisserait des sessions ouvertes dans le navigateur d'un
  // téléphone prêté, sans que rien ne les montre.
  var autres = ACCES.map(function(a){ return a.token; })
                    .filter(function(t){ return t && t !== jeton; });
  JETON = null; CLIENT = null; BOUTIQUE = null; ACCES = [];
  COMPTES = []; COMMANDES = []; DERNIER_DEPOT = null;
  try { sessionStorage.removeItem(CLE_JETON); } catch(e){}
  try { sessionStorage.removeItem(CLE_ACCES); } catch(e){}

  clearPin();
  document.getElementById('login-tel').value = '';
  erreurLogin('');
  showPage('page-login');

  // Invalide les jetons côté serveur : sans cela ils resteraient valables
  // deux heures. Tous, pas seulement celui qui était affiché — une session
  // ouverte sur l'autre bijouterie est une session ouverte.
  if(jeton) autres.unshift(jeton);
  for(var i = 0; i < autres.length; i++){
    try { await rpc('portail_logout', { p_token: autres[i] }); } catch(e){}
  }
}

document.addEventListener('DOMContentLoaded', reprendreSession);
