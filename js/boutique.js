/**
 * KAYOR — vitrine publique d'une boutique
 * ---------------------------------------------------------------------------
 * La page qu'une cliente ouvre en scannant le code imprime sur sa facture.
 *
 * C'EST LA SEULE PAGE DU PROJET QU'OUVRENT DES INCONNUS. Deux consequences :
 *
 *   — Rien de ce qui vient de la base ne touche `innerHTML`. Tout passe par
 *     `textContent`, qui ne peut rien interpreter — plus sur encore qu'un
 *     `esc()` qu'on peut oublier d'appeler. Le nom, le slogan, les horaires
 *     sont saisis par la bijoutiere ; une balise s'executerait sinon chez
 *     chacune de ses clientes. Le seul `innerHTML` de ce fichier recoit une
 *     icone constante, ecrite ici.
 *
 *   — Aucun lien n'est construit a partir d'une URL saisie, sauf `maps_url`
 *     dont la base garantit qu'elle commence par https (migration 028). Les
 *     reseaux sont stockes en PSEUDOS et l'adresse est fabriquee ici : une
 *     URL saisie pourrait porter `javascript:`, qu'`esc()` laisse passer
 *     puisque ce n'est pas du HTML.
 *
 * Elle n'interroge aucune table : `boutique_publique()` est la seule porte,
 * et elle enumere ses champs a la main. Ni `plan`, ni `expire_le`, ni
 * `actif`, ni NINEA, ni RCCM n'en sortent.
 */

var SUPA_URL = 'https://yflvtquowzvghwxyvuah.supabase.co';
var SUPA_KEY = 'sb_publishable_3EBGFxeT8B8cys54IZj3Nw_ZTS-4ZR1';

function $(id) { return document.getElementById(id); }

/** Affiche un bloc et son contenu, ou le laisse cache si la valeur est vide. */
function remplir(idCarte, idTexte, valeur) {
  // La fonction SQL renvoie '' et non null pour les reseaux : on traite les
  // deux comme une absence.
  if (!valeur || !String(valeur).trim()) return false;
  $(idTexte).textContent = valeur;          // textContent : jamais innerHTML
  if (idCarte) $(idCarte).hidden = false;
  return true;
}

var RESEAUX = {
  instagram: { nom: 'Instagram', base: 'https://www.instagram.com/',
    icone: '<path d="M8 1.4c2.1 0 2.4 0 3.2.05.8.04 1.2.17 1.5.28.4.15.6.32.9.62.3.3.47.5.62.9.1.3.24.7.28 1.5.04.8.05 1.1.05 3.2s0 2.4-.05 3.2c-.04.8-.17 1.2-.28 1.5-.15.4-.32.6-.62.9-.3.3-.5.47-.9.62-.3.1-.7.24-1.5.28-.8.04-1.1.05-3.2.05s-2.4 0-3.2-.05c-.8-.04-1.2-.17-1.5-.28a2.5 2.5 0 0 1-.9-.62 2.5 2.5 0 0 1-.62-.9c-.1-.3-.24-.7-.28-1.5C1.4 10.4 1.4 10.1 1.4 8s0-2.4.05-3.2c.04-.8.17-1.2.28-1.5.15-.4.32-.6.62-.9.3-.3.5-.47.9-.62.3-.1.7-.24 1.5-.28C5.6 1.4 5.9 1.4 8 1.4zM8 0C5.8 0 5.6 0 4.7.05c-.9.04-1.5.18-2 .39-.5.2-1 .48-1.4.9-.42.4-.7.9-.9 1.4-.2.5-.35 1.1-.39 2C0 5.6 0 5.8 0 8s0 2.4.05 3.3c.04.9.18 1.5.39 2 .2.5.48 1 .9 1.4.4.42.9.7 1.4.9.5.2 1.1.35 2 .39.9.05 1.1.05 3.3.05s2.4 0 3.3-.05c.9-.04 1.5-.18 2-.39.5-.2 1-.48 1.4-.9.42-.4.7-.9.9-1.4.2-.5.35-1.1.39-2 .05-.9.05-1.1.05-3.3s0-2.4-.05-3.3c-.04-.9-.18-1.5-.39-2a3.9 3.9 0 0 0-.9-1.4 3.9 3.9 0 0 0-1.4-.9c-.5-.2-1.1-.35-2-.39C10.4 0 10.2 0 8 0zm0 3.9a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2zm0 6.8a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4zm5.2-7a1 1 0 1 1-1.9 0 1 1 0 0 1 1.9 0z"/>' },
  facebook:  { nom: 'Facebook', base: 'https://www.facebook.com/',
    icone: '<path d="M16 8a8 8 0 1 0-9.25 7.9v-5.6H4.72V8H6.75V6.24c0-2 1.19-3.1 3.02-3.1.87 0 1.79.15 1.79.15v1.97h-1.01c-.99 0-1.3.62-1.3 1.25V8h2.22l-.36 2.3H9.25v5.6A8 8 0 0 0 16 8z"/>' },
  tiktok:    { nom: 'TikTok', base: 'https://www.tiktok.com/@',
    icone: '<path d="M11.1 0h-2.2v10.9a2 2 0 1 1-1.6-2v-2.2a4.2 4.2 0 1 0 3.8 4.2V5.3c.8.6 1.8.9 2.9.9V4a3 3 0 0 1-2.9-3z"/>' }
};

function construire(b) {
  // Le titre et la description de la page portent le nom de la BOUTIQUE.
  // C'est ce qui apparait dans l'onglet et dans un partage WhatsApp.
  document.title = b.nom || 'Boutique';
  var desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', [b.nom, b.slogan].filter(Boolean).join(' — '));

  $('v-nom').textContent = b.nom || '';
  if (b.slogan && b.slogan.trim()) {
    $('v-slogan').textContent = b.slogan;
    $('v-slogan').hidden = false;
  }

  if (b.logo) {
    var img = $('v-logo');
    // Le logo est une donnee en base64 deposee par la boutique, pas une URL
    // distante : la regle 6 tient, la page ne contacte aucun autre domaine.
    img.src = b.logo;
    img.alt = b.nom || '';
    img.hidden = false;
  }

  // ── Actions. Chaque lien est fabrique ici, jamais recopie d'une saisie. ──
  var actions = [];
  if (b.whatsapp) {
    actions.push({ href: 'https://wa.me/' + encodeURIComponent(b.whatsapp),
                   texte: 'WhatsApp', or: true });
  }
  if (b.telephone) {
    // Le numero affichable peut contenir des espaces ; le lien tel: n'en veut pas.
    actions.push({ href: 'tel:' + String(b.telephone).replace(/[^0-9+]/g, ''),
                   texte: 'Appeler', or: !b.whatsapp });
  }
  if (b.maps_url) {
    // Seule URL recopiee : la base garantit le schema https (migration 028).
    actions.push({ href: b.maps_url, texte: 'Itinéraire', externe: true });
  }
  if (b.email) actions.push({ href: 'mailto:' + b.email, texte: 'Écrire' });

  var zone = $('v-actions');
  actions.forEach(function (a) {
    var el = document.createElement('a');
    el.className = 'bouton' + (a.or ? ' or' : '');
    el.href = a.href;
    el.textContent = a.texte;
    if (a.externe) { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
    zone.appendChild(el);
  });

  remplir('c-presentation', 'v-presentation', b.presentation);
  remplir('c-horaires',     'v-horaires',     b.horaires);

  if (remplir('c-adresse', 'v-adresse', b.adresse)) {
    if (b.repere) { $('v-repere').textContent = b.repere; $('v-repere').hidden = false; }
  } else if (b.repere) {
    $('v-adresse').textContent = b.repere;
    $('c-adresse').hidden = false;
  }

  // ── Reseaux : l'adresse est construite a partir du pseudo. ──────────────
  var liste = $('v-reseaux'), nb = 0;
  Object.keys(RESEAUX).forEach(function (cle) {
    var pseudo = (b[cle] || '').trim();
    if (!pseudo) return;
    var r = RESEAUX[cle];
    var a = document.createElement('a');
    a.href = r.base + encodeURIComponent(pseudo);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' + r.icone + '</svg>';
    a.appendChild(document.createTextNode(r.nom));
    liste.appendChild(a);
    nb++;
  });
  if (nb) $('c-reseaux').hidden = false;

  $('v-pied').textContent = b.nom || '';
  $('chargement').hidden = true;
  $('vitrine').hidden = false;
}

function echec() {
  $('chargement').hidden = true;
  $('erreur').hidden = false;
}

(function () {
  var slug = new URLSearchParams(location.search).get('b');
  if (!slug) return echec();

  fetch(SUPA_URL + '/rest/v1/rpc/boutique_publique', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY },
    body: JSON.stringify({ p_slug: slug })
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) {
      if (!b || b.ok === false) return echec();
      construire(b);
    })
    .catch(echec);
})();
