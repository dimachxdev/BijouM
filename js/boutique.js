/**
 * KAYOR — vitrine publique d'une boutique
 * ---------------------------------------------------------------------------
 * La page qu'une cliente ouvre en scannant le code imprimé sur sa facture.
 *
 * C'EST LA SEULE PAGE DU PROJET QU'OUVRENT DES INCONNUS. Deux conséquences :
 *
 *   — Rien de ce qui vient de la base ne touche `innerHTML`. Tout passe par
 *     `textContent`, qui ne peut rien interpréter — plus sûr encore qu'un
 *     `esc()` qu'on peut oublier d'appeler. Le nom, le slogan, les horaires
 *     sont saisis par la bijoutière ; une balise s'exécuterait sinon chez
 *     chacune de ses clientes. Les seuls `innerHTML` de ce fichier reçoivent
 *     des icônes constantes, écrites ici.
 *
 *   — Aucun lien n'est construit à partir d'une URL saisie, sauf `maps_url`
 *     et `site_web`, dont la base garantit qu'elles commencent par https
 *     (migrations 028 et 029). Les réseaux sont stockés en PSEUDOS et
 *     l'adresse est fabriquée ici : une URL saisie pourrait porter
 *     `javascript:`, qu'`esc()` laisse passer puisque ce n'est pas du HTML.
 *
 * Elle n'interroge aucune table : `boutique_publique()` est la seule porte,
 * et elle énumère ses champs à la main. Ni `plan`, ni `expire_le`, ni
 * `actif`, ni NINEA, ni RCCM n'en sortent.
 */

var SUPA_URL = 'https://yflvtquowzvghwxyvuah.supabase.co';
var SUPA_KEY = 'sb_publishable_3EBGFxeT8B8cys54IZj3Nw_ZTS-4ZR1';

function $(id) { return document.getElementById(id); }

/** Affiche un bloc et son contenu, ou le laisse caché si la valeur est vide. */
function remplir(idCarte, idTexte, valeur) {
  // La fonction SQL renvoie '' et non null pour les réseaux : on traite les
  // deux comme une absence.
  if (!valeur || !String(valeur).trim()) return false;
  $(idTexte).textContent = valeur;          // textContent : jamais innerHTML
  if (idCarte) $(idCarte).hidden = false;
  return true;
}

/**
 * Les cinq pastilles rondes, sous le slogan.
 *
 * `base` sert à fabriquer l'adresse depuis un pseudo ; `url` indique que le
 * champ porte déjà une adresse complète, contrainte en https par la base.
 */
var CERCLES = [
  { cle: 'whatsapp', nom: 'WhatsApp', tel: true,
    icone: '<path d="M13.6 2.33A7.94 7.94 0 0 0 8 0a7.94 7.94 0 0 0-6.88 11.9L0 16l4.2-1.1A7.9 7.9 0 0 0 8 15.9 7.94 7.94 0 0 0 13.6 2.33zM8 14.56a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.5.65.67-2.43-.16-.25A6.6 6.6 0 1 1 8 14.56zm3.62-4.94c-.2-.1-1.17-.58-1.35-.64-.18-.07-.31-.1-.44.1-.13.2-.5.64-.62.77-.11.13-.23.15-.43.05a5.4 5.4 0 0 1-1.59-.98 6 6 0 0 1-1.1-1.37c-.11-.2-.01-.3.09-.4.09-.09.2-.23.3-.35.1-.12.13-.2.2-.33.06-.14.03-.25-.02-.35-.05-.1-.44-1.07-.6-1.46-.16-.38-.32-.33-.44-.34h-.37c-.13 0-.33.05-.5.25-.18.2-.67.65-.67 1.59 0 .93.68 1.84.78 1.96.1.13 1.35 2.06 3.26 2.89.46.2.81.31 1.09.4.46.15.87.13 1.2.08.37-.06 1.14-.47 1.3-.92.16-.45.16-.84.11-.92-.05-.08-.18-.13-.38-.23z"/>' },
  { cle: 'instagram', nom: 'Instagram', base: 'https://www.instagram.com/',
    icone: '<path d="M8 1.4c2.1 0 2.4 0 3.2.05.8.04 1.2.17 1.5.28.4.15.6.32.9.62.3.3.47.5.62.9.1.3.24.7.28 1.5.04.8.05 1.1.05 3.2s0 2.4-.05 3.2c-.04.8-.17 1.2-.28 1.5-.15.4-.32.6-.62.9-.3.3-.5.47-.9.62-.3.1-.7.24-1.5.28-.8.04-1.1.05-3.2.05s-2.4 0-3.2-.05c-.8-.04-1.2-.17-1.5-.28a2.5 2.5 0 0 1-.9-.62 2.5 2.5 0 0 1-.62-.9c-.1-.3-.24-.7-.28-1.5C1.4 10.4 1.4 10.1 1.4 8s0-2.4.05-3.2c.04-.8.17-1.2.28-1.5.15-.4.32-.6.62-.9.3-.3.5-.47.9-.62.3-.1.7-.24 1.5-.28C5.6 1.4 5.9 1.4 8 1.4zM8 0C5.8 0 5.6 0 4.7.05c-.9.04-1.5.18-2 .39-.5.2-1 .48-1.4.9-.42.4-.7.9-.9 1.4-.2.5-.35 1.1-.39 2C0 5.6 0 5.8 0 8s0 2.4.05 3.3c.04.9.18 1.5.39 2 .2.5.48 1 .9 1.4.4.42.9.7 1.4.9.5.2 1.1.35 2 .39.9.05 1.1.05 3.3.05s2.4 0 3.3-.05c.9-.04 1.5-.18 2-.39.5-.2 1-.48 1.4-.9.42-.4.7-.9.9-1.4.2-.5.35-1.1.39-2 .05-.9.05-1.1.05-3.3s0-2.4-.05-3.3c-.04-.9-.18-1.5-.39-2a3.9 3.9 0 0 0-.9-1.4 3.9 3.9 0 0 0-1.4-.9c-.5-.2-1.1-.35-2-.39C10.4 0 10.2 0 8 0zm0 3.9a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2zm0 6.8a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4zm5.2-7a1 1 0 1 1-1.9 0 1 1 0 0 1 1.9 0z"/>' },
  { cle: 'facebook', nom: 'Facebook', base: 'https://www.facebook.com/',
    icone: '<path d="M16 8a8 8 0 1 0-9.25 7.9v-5.6H4.72V8H6.75V6.24c0-2 1.19-3.1 3.02-3.1.87 0 1.79.15 1.79.15v1.97h-1.01c-.99 0-1.3.62-1.3 1.25V8h2.22l-.36 2.3H9.25v5.6A8 8 0 0 0 16 8z"/>' },
  { cle: 'tiktok', nom: 'TikTok', base: 'https://www.tiktok.com/@',
    icone: '<path d="M11.1 0h-2.2v10.9a2 2 0 1 1-1.6-2v-2.2a4.2 4.2 0 1 0 3.8 4.2V5.3c.8.6 1.8.9 2.9.9V4a3 3 0 0 1-2.9-3z"/>' },
  { cle: 'site_web', nom: 'Site internet', classe: 'site', url: true,
    icone: '<path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm5.5 5h-2.1a12.4 12.4 0 0 0-1.1-3.2A6.5 6.5 0 0 1 13.5 5zM8 1.6c.6.9 1.1 2 1.4 3.4H6.6C6.9 3.6 7.4 2.5 8 1.6zM1.7 10a6.5 6.5 0 0 1 0-4h2.4a14.6 14.6 0 0 0 0 4H1.7zm.8 1.5h2.1c.3 1.2.6 2.3 1.1 3.2a6.5 6.5 0 0 1-3.2-3.2zm2.1-6.5H2.5a6.5 6.5 0 0 1 3.2-3.2A12.4 12.4 0 0 0 4.6 5zM8 14.4c-.6-.9-1.1-2-1.4-3.4h2.8c-.3 1.4-.8 2.5-1.4 3.4zm1.7-4.9H6.3a13.1 13.1 0 0 1 0-4h3.4a13.1 13.1 0 0 1 0 4zm.6 5.2c.5-.9.8-2 1.1-3.2h2.1a6.5 6.5 0 0 1-3.2 3.2zm1.4-4.7a14.6 14.6 0 0 0 0-4h2.4a6.5 6.5 0 0 1 0 4h-2.4z"/>' }
];

function construire(b) {
  // Le titre et la description de la page portent le nom de la BOUTIQUE.
  // C'est ce qui apparaît dans l'onglet et dans un partage WhatsApp.
  document.title = b.nom || 'Boutique';
  var desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', [b.nom, b.slogan].filter(Boolean).join(' — '));

  $('v-nom').textContent = b.nom || '';
  if (b.slogan && b.slogan.trim()) {
    $('v-slogan').textContent = b.slogan;
    $('v-slogan').hidden = false;
  }

  // ── Couverture et logo ─────────────────────────────────────────────────
  // Les deux images sont des data URI déposées par la boutique, pas des URL
  // distantes : la règle 6 tient, la page ne contacte aucun autre domaine.
  if (b.couverture) {
    var couv = $('v-couverture');
    couv.classList.remove('vide');
    // `style.backgroundImage` et non innerHTML : une data URI va dans une
    // propriété CSS, jamais dans du balisage.
    couv.style.backgroundImage = 'url("' + b.couverture.replace(/"/g, '%22') + '")';
  }

  var rond = $('v-logo');
  if (b.logo) {
    var img = new Image();
    img.src = b.logo;
    img.alt = b.nom || '';
    rond.appendChild(img);
  } else {
    // Sans logo, l'initiale — jamais la marque du logiciel. Un repli vers
    // notre identité est pire qu'un champ vide : le vide se voit et se
    // remplit, le repli se confond avec un choix de la boutique.
    rond.classList.add('initiale');
    rond.textContent = (b.nom || '?').trim().charAt(0).toUpperCase();
  }

  // ── Les pastilles rondes, juste sous le slogan ──────────────────────────
  var cercles = $('v-cercles');
  CERCLES.forEach(function (c) {
    var v = (b[c.cle] || '').toString().trim();
    if (!v) return;
    var a = document.createElement('a');
    a.className = 'cercle ' + (c.classe || c.cle);
    if (c.tel)      a.href = 'https://wa.me/' + encodeURIComponent(v);
    else if (c.url) a.href = v;                       // https garanti par la base
    else            a.href = c.base + encodeURIComponent(v);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    // Pas de libellé visible : le nom va dans aria-label et dans l'infobulle,
    // pour qui n'a pas l'image ou ne reconnaît pas le pictogramme.
    a.setAttribute('aria-label', c.nom);
    a.title = c.nom;
    a.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' + c.icone + '</svg>';
    cercles.appendChild(a);
  });

  // ── Les boutons à libellé, en dessous ───────────────────────────────────
  // WhatsApp et le site sont déjà dans les pastilles : ne restent ici que
  // les gestes qui n'ont pas de marque reconnaissable.
  var actions = [];
  if (b.telephone) {
    // Le numéro affichable peut contenir des espaces ; le lien tel: n'en veut pas.
    actions.push({ href: 'tel:' + String(b.telephone).replace(/[^0-9+]/g, ''),
                   texte: 'Appeler', classe: 'or teinte' });
  }
  if (b.maps_url) {
    actions.push({ href: b.maps_url, texte: 'Itinéraire',
                   classe: 'maps teinte', externe: true });
  }
  if (b.email) actions.push({ href: 'mailto:' + b.email, texte: 'Écrire' });

  var zone = $('v-actions');
  actions.forEach(function (a) {
    var el = document.createElement('a');
    el.className = 'bouton' + (a.classe ? ' ' + a.classe : '');
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
  carteGoogle(b);

  $('v-pied').textContent = b.nom || '';
  $('chargement').hidden = true;
  $('vitrine').hidden = false;
}

/**
 * La carte Google, en bas de la fiche.
 *
 * SEULE EXCEPTION DU PROJET A LA REGLE 6. Decidee le 2026-11-02, apres que
 * l'alternative sans tiers — un plan d'acces en image televersee — a ete
 * proposee et ecartee. Ce qui la rend acceptable ICI et nulle part ailleurs :
 * `boutique.html` ne porte AUCUN jeton. Ni session Supabase, ni JWT, ni
 * localStorage. Le danger que la regle vise — du code tiers qui lit le jeton
 * de session — n'a pas de prise sur cette page.
 *
 * `index.html`, `operateur.html` et `client.html` en portent. La regle 6 y
 * reste entiere, et cette exception ne s'invoque pas pour en ouvrir une autre.
 *
 * Deux attenuations, pas decoratives :
 *
 *   loading="lazy"                 l'iframe ne part qu'une fois la carte
 *                                  atteinte. La plupart des visiteuses
 *                                  s'arretent aux horaires et ne declenchent
 *                                  donc jamais l'appel a Google.
 *   referrerpolicy="no-referrer"   Google ne sait pas de quelle boutique on
 *                                  vient — il voit une visite, pas un profil.
 *
 * Pas d'adresse en texte dans la requete : une adresse approximative pose
 * l'epingle au mauvais endroit, ce qui est pire que pas de carte. Sans
 * coordonnees, pas de carte — le bouton « Itineraire » reste le chemin.
 */
function carteGoogle(b) {
  var lat = parseFloat(b.lat), lng = parseFloat(b.lng);
  if (!isFinite(lat) || !isFinite(lng)) return;

  var cadre = document.createElement('iframe');
  cadre.className = 'map-cadre';
  cadre.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng)
            + '&z=17&output=embed';
  cadre.loading = 'lazy';
  cadre.referrerPolicy = 'no-referrer';
  cadre.setAttribute('allowfullscreen', '');
  cadre.title = 'Carte de ' + (b.nom || 'la boutique');
  $('c-adresse').appendChild(cadre);
  $('c-adresse').hidden = false;
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
