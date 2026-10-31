/**
 * KAYOR — encodeur QR, sans dependance
 * ---------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 *
 * La regle 6 du projet : aucune page ne charge quoi que ce soit en dehors de
 * son propre domaine. Un `qrcode.js` pris sur un CDN executerait du code
 * tiers dans la page ou vit le jeton de session. On encode donc ici.
 *
 * CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS
 *
 * Mode OCTET uniquement, correction d'erreurs niveau M (~15 % de la surface
 * peut etre abimee et le code reste lisible), versions 1 a 10 choisies
 * automatiquement — soit 213 caracteres au maximum. C'est tres au-dela d'une
 * URL de vitrine. Pas de mode numerique ni alphanumerique : ils seraient plus
 * compacts pour certains contenus, et inutiles ici.
 *
 * Le niveau M plutot que L n'est pas un detail : ce code est IMPRIME, sur du
 * papier qui se plie, se tache et passe par des imprimantes bon marche.
 *
 * COMMENT LE VERIFIER
 *
 * Un encodeur QR faux produit une image parfaitement plausible qui ne scanne
 * pas. Relire ce fichier ne prouve donc rien : la seule verification qui
 * compte est de scanner le resultat avec un vrai telephone.
 *
 * Reference : ISO/IEC 18004. Les tables ci-dessous en sont tirees.
 */
var QR = (function () {
  'use strict';

  // --- Corps de Galois GF(256), polynome primitif 0x11D ---------------------
  // Reed-Solomon calcule dans ce corps : les multiplications deviennent des
  // additions de logarithmes, d'ou les deux tables.
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /**
   * Polynome generateur de degre `n` : le produit des (x + alpha^i) pour
   * i de 0 a n-1. Ses racines sont alpha^0 .. alpha^(n-1), et c'est ce qui
   * rend tous les syndromes nuls chez le lecteur.
   *
   * Les coefficients sont ranges du degre le plus FORT au plus faible. En
   * multipliant par (x + alpha^i), le tableau gagne une case EN FIN : le
   * terme decale d'un degre reste donc a l'indice j, et c'est le produit par
   * alpha^i qui passe en j+1. Inverser les deux donne le polynome
   * reciproque — une correction d'apparence normale qu'aucun lecteur
   * n'accepte. Verifie par syndromes, pas par relecture.
   */
  function generateur(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var suivant = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        suivant[j]     ^= g[j];
        suivant[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = suivant;
    }
    return g;
  }

  /** Les `n` codets de correction d'un bloc de donnees. */
  function correction(donnees, n) {
    var g = generateur(n);
    var reste = new Array(donnees.length + n).fill(0);
    for (var i = 0; i < donnees.length; i++) reste[i] = donnees[i];
    for (var k = 0; k < donnees.length; k++) {
      var tete = reste[k];
      if (tete === 0) continue;
      for (var j = 0; j < g.length; j++) reste[k + j] ^= mul(g[j], tete);
    }
    return reste.slice(donnees.length);
  }

  // --- Tables du niveau M, versions 1 a 10 ---------------------------------
  // [codets de correction par bloc, nb blocs groupe 1, codets de donnees par
  //  bloc du groupe 1, nb blocs groupe 2, codets par bloc du groupe 2]
  var BLOCS_M = {
    1:  [10, 1, 16, 0,  0],
    2:  [16, 1, 28, 0,  0],
    3:  [26, 1, 44, 0,  0],
    4:  [18, 2, 32, 0,  0],
    5:  [24, 2, 43, 0,  0],
    6:  [16, 4, 27, 0,  0],
    7:  [18, 4, 31, 0,  0],
    8:  [22, 2, 38, 2, 39],
    9:  [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44]
  };

  /** Caracteres au maximum, en mode octet, niveau M. */
  var CAPACITE_M = { 1:14, 2:26, 3:42, 4:62, 5:84, 6:106, 7:122, 8:152, 9:180, 10:213 };

  /** Centres des motifs d'alignement, par version. */
  var ALIGNEMENT = {
    1: [], 2: [6,18], 3: [6,22], 4: [6,26], 5: [6,30],
    6: [6,34], 7: [6,22,38], 8: [6,24,42], 9: [6,26,46], 10: [6,28,50]
  };

  // --- Encodage des donnees -------------------------------------------------

  /** UTF-8 : une cliente peut s'appeler « Fatou Ndiaye-Mbaye ». */
  function octets(texte) {
    var sortie = [];
    for (var i = 0; i < texte.length; i++) {
      var c = texte.charCodeAt(i);
      if (c < 0x80) sortie.push(c);
      else if (c < 0x800) sortie.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else if (c < 0xD800 || c >= 0xE000) {
        sortie.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      } else {
        // Paire de substitution : un seul caractere sur deux unites.
        i++;
        var p = 0x10000 + (((c & 0x3FF) << 10) | (texte.charCodeAt(i) & 0x3FF));
        sortie.push(0xF0 | (p >> 18), 0x80 | ((p >> 12) & 0x3F),
                    0x80 | ((p >> 6) & 0x3F), 0x80 | (p & 0x3F));
      }
    }
    return sortie;
  }

  function versionPour(nbOctets) {
    for (var v = 1; v <= 10; v++) if (nbOctets <= CAPACITE_M[v]) return v;
    return 0;
  }

  /** Flux binaire : mode, longueur, donnees, terminaison, remplissage. */
  function codetsDonnees(donnees, version) {
    var t = BLOCS_M[version];
    var totalDonnees = t[1] * t[2] + t[3] * t[4];
    var bits = [];
    function pousser(valeur, nb) {
      for (var i = nb - 1; i >= 0; i--) bits.push((valeur >> i) & 1);
    }

    pousser(0x4, 4);                                   // mode octet
    pousser(donnees.length, version < 10 ? 8 : 16);    // compteur
    for (var i = 0; i < donnees.length; i++) pousser(donnees[i], 8);

    // Terminaison : jusqu'a quatre zeros, sans deborder.
    var reste = totalDonnees * 8 - bits.length;
    pousser(0, Math.min(4, reste));
    while (bits.length % 8 !== 0) bits.push(0);

    var codets = [];
    for (var b = 0; b < bits.length; b += 8) {
      var o = 0;
      for (var k = 0; k < 8; k++) o = (o << 1) | bits[b + k];
      codets.push(o);
    }
    // Remplissage normalise, en alternance.
    var bourrage = [0xEC, 0x11], n = 0;
    while (codets.length < totalDonnees) codets.push(bourrage[n++ % 2]);
    return codets;
  }

  /** Decoupe en blocs, correction par bloc, puis entrelacement. */
  function codetsFinaux(donnees, version) {
    var t = BLOCS_M[version], nbEC = t[0];
    var blocs = [], ecs = [], pos = 0, i, j;

    for (i = 0; i < t[1]; i++) { blocs.push(donnees.slice(pos, pos + t[2])); pos += t[2]; }
    for (i = 0; i < t[3]; i++) { blocs.push(donnees.slice(pos, pos + t[4])); pos += t[4]; }
    for (i = 0; i < blocs.length; i++) ecs.push(correction(blocs[i], nbEC));

    // Entrelacement : premier codet de chaque bloc, puis deuxieme, etc. C'est
    // ce qui disperse un dommage localise sur tous les blocs, au lieu d'en
    // detruire un seul au-dela du reparable.
    var sortie = [], maxD = Math.max(t[2], t[4]);
    for (i = 0; i < maxD; i++) {
      for (j = 0; j < blocs.length; j++) if (i < blocs[j].length) sortie.push(blocs[j][i]);
    }
    for (i = 0; i < nbEC; i++) {
      for (j = 0; j < ecs.length; j++) sortie.push(ecs[j][i]);
    }
    return sortie;
  }

  // --- La matrice -----------------------------------------------------------

  function motifPosition(m, reserve, ligne, colonne) {
    for (var i = -1; i <= 7; i++) {
      for (var j = -1; j <= 7; j++) {
        var r = ligne + i, c = colonne + j;
        if (r < 0 || c < 0 || r >= m.length || c >= m.length) continue;
        var bord = (i >= 0 && i <= 6 && (j === 0 || j === 6))
                || (j >= 0 && j <= 6 && (i === 0 || i === 6));
        var coeur = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        m[r][c] = (bord || coeur) ? 1 : 0;
        reserve[r][c] = 1;
      }
    }
  }

  function motifAlignement(m, reserve, ligne, colonne) {
    for (var i = -2; i <= 2; i++) {
      for (var j = -2; j <= 2; j++) {
        m[ligne + i][colonne + j] =
          (Math.abs(i) === 2 || Math.abs(j) === 2 || (i === 0 && j === 0)) ? 1 : 0;
        reserve[ligne + i][colonne + j] = 1;
      }
    }
  }

  /** BCH : correction des 15 bits de format et des 18 bits de version. */
  function bch(valeur, generateur, longueur) {
    var reste = valeur;
    while (Math.floor(Math.log2(reste)) >= longueur) {
      reste ^= generateur << (Math.floor(Math.log2(reste)) - longueur);
    }
    return reste;
  }

  function poserFormat(m, masque) {
    // Niveau M = 0b00, suivi des trois bits de masque.
    var donnees = (0 << 3) | masque;
    var bits = ((donnees << 10) | bch(donnees << 10, 0x537, 10)) ^ 0x5412;
    var n = m.length, i;

    for (i = 0; i <= 5; i++)  m[8][i] = (bits >> i) & 1;
    m[8][7] = (bits >> 6) & 1;
    m[8][8] = (bits >> 7) & 1;
    m[7][8] = (bits >> 8) & 1;
    for (i = 9; i <= 14; i++) m[14 - i][8] = (bits >> i) & 1;

    for (i = 0; i <= 7; i++)  m[n - 1 - i][8] = (bits >> i) & 1;
    for (i = 8; i <= 14; i++) m[8][n - 15 + i] = (bits >> i) & 1;

    m[n - 8][8] = 1;   // module sombre, toujours
  }

  function poserVersion(m, version) {
    if (version < 7) return;
    var bits = (version << 12) | bch(version << 12, 0x1F25, 12);
    var n = m.length;
    for (var i = 0; i < 18; i++) {
      var b = (bits >> i) & 1;
      m[Math.floor(i / 3)][n - 11 + (i % 3)] = b;
      m[n - 11 + (i % 3)][Math.floor(i / 3)] = b;
    }
  }

  var MASQUES = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i)    { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
    function (i, j) { return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0; },
    function (i, j) { return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0; }
  ];

  /**
   * Penalite d'un masque. Le but : eviter qu'un motif dans les donnees
   * ressemble aux reperes de position, et eviter les grandes plages unies
   * qui desorientent le decodeur.
   */
  function penalite(m) {
    var n = m.length, score = 0, i, j, k;

    // 1 — suites de 5 modules identiques ou plus.
    for (i = 0; i < n; i++) {
      for (var sens = 0; sens < 2; sens++) {
        var precedent = -1, suite = 0;
        for (j = 0; j < n; j++) {
          var v = sens === 0 ? m[i][j] : m[j][i];
          if (v === precedent) { suite++; }
          else { if (suite >= 5) score += 3 + (suite - 5); precedent = v; suite = 1; }
        }
        if (suite >= 5) score += 3 + (suite - 5);
      }
    }

    // 2 — carres 2x2 d'une seule couleur.
    for (i = 0; i < n - 1; i++) {
      for (j = 0; j < n - 1; j++) {
        var a = m[i][j];
        if (a === m[i][j + 1] && a === m[i + 1][j] && a === m[i + 1][j + 1]) score += 3;
      }
    }

    // 3 — le motif 1011101 entoure de quatre clairs : il imite un repere.
    var motifs = [[1,0,1,1,1,0,1,0,0,0,0], [0,0,0,0,1,0,1,1,1,0,1]];
    for (i = 0; i < n; i++) {
      for (j = 0; j <= n - 11; j++) {
        for (k = 0; k < 2; k++) {
          var okL = true, okC = true;
          for (var p = 0; p < 11; p++) {
            if (m[i][j + p] !== motifs[k][p]) okL = false;
            if (m[j + p][i] !== motifs[k][p]) okC = false;
          }
          if (okL) score += 40;
          if (okC) score += 40;
        }
      }
    }

    // 4 — ecart a 50 % de modules sombres.
    var sombres = 0;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (m[i][j]) sombres++;
    var ecart = Math.abs((sombres * 100) / (n * n) - 50);
    score += Math.floor(ecart / 5) * 10;

    return score;
  }

  function construire(texte) {
    var donnees = octets(texte);
    var version = versionPour(donnees.length);
    if (!version) {
      throw new Error('Texte trop long pour un QR code (' + donnees.length
                    + ' octets, maximum ' + CAPACITE_M[10] + ').');
    }

    var n = 17 + 4 * version, i, j;
    var m = [], reserve = [];
    for (i = 0; i < n; i++) {
      m.push(new Array(n).fill(0));
      reserve.push(new Array(n).fill(0));
    }

    motifPosition(m, reserve, 0, 0);
    motifPosition(m, reserve, n - 7, 0);
    motifPosition(m, reserve, 0, n - 7);

    var centres = ALIGNEMENT[version];
    for (i = 0; i < centres.length; i++) {
      for (j = 0; j < centres.length; j++) {
        // Les trois coins sont deja occupes par les reperes de position.
        if ((i === 0 && j === 0) || (i === 0 && j === centres.length - 1)
         || (i === centres.length - 1 && j === 0)) continue;
        motifAlignement(m, reserve, centres[i], centres[j]);
      }
    }

    for (i = 8; i < n - 8; i++) {           // synchronisation
      m[6][i] = m[i][6] = (i % 2 === 0) ? 1 : 0;
      reserve[6][i] = reserve[i][6] = 1;
    }

    // Zones reservees au format et a la version : marquees avant la pose des
    // donnees, remplies apres le choix du masque.
    for (i = 0; i <= 8; i++) { reserve[8][i] = 1; reserve[i][8] = 1; }
    for (i = 0; i < 8; i++)  { reserve[8][n - 1 - i] = 1; reserve[n - 1 - i][8] = 1; }
    if (version >= 7) {
      for (i = 0; i < 6; i++) {
        for (j = 0; j < 3; j++) { reserve[i][n - 11 + j] = 1; reserve[n - 11 + j][i] = 1; }
      }
    }

    // Pose en zigzag : colonnes par paires depuis la droite, en sautant la
    // colonne 6 qui porte la synchronisation.
    var codets = codetsFinaux(codetsDonnees(donnees, version), version);
    var bit = 0, total = codets.length * 8, montant = true;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (var pas = 0; pas < n; pas++) {
        var ligne = montant ? n - 1 - pas : pas;
        for (var d = 0; d < 2; d++) {
          var c = col - d;
          if (reserve[ligne][c]) continue;
          var v = 0;
          if (bit < total) v = (codets[bit >> 3] >> (7 - (bit & 7))) & 1;
          m[ligne][c] = v;
          bit++;
        }
      }
      montant = !montant;
    }

    // Choix du masque : on les essaie tous et on garde le moins penalise.
    var meilleur = null, meilleurScore = Infinity;
    for (var k = 0; k < 8; k++) {
      var essai = m.map(function (l) { return l.slice(); });
      for (i = 0; i < n; i++) {
        for (j = 0; j < n; j++) {
          if (!reserve[i][j] && MASQUES[k](i, j)) essai[i][j] ^= 1;
        }
      }
      poserFormat(essai, k);
      poserVersion(essai, version);
      var s = penalite(essai);
      if (s < meilleurScore) { meilleurScore = s; meilleur = essai; }
    }
    return meilleur;
  }

  /**
   * Le QR en SVG. Vectoriel et non bitmap : net a l'impression quelle que
   * soit la resolution, et quelques kilo-octets plutot qu'une image en
   * base64 dans le document.
   *
   * `marge` est la zone de silence : sans elle, un lecteur ne trouve pas les
   * bords du code. Quatre modules est le minimum de la norme.
   */
  function svg(texte, options) {
    options = options || {};
    var taille = options.taille || 120;
    var marge  = options.marge === undefined ? 4 : options.marge;
    var m = construire(texte);
    var n = m.length, cote = n + marge * 2;

    // Un seul chemin pour tous les modules sombres : bien plus leger que
    // des centaines de rectangles, et plus rapide a tracer.
    var d = '';
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        if (m[i][j]) d += 'M' + (j + marge) + ' ' + (i + marge) + 'h1v1h-1z';
      }
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + taille + '" height="' + taille
         + '" viewBox="0 0 ' + cote + ' ' + cote + '" shape-rendering="crispEdges">'
         + '<rect width="' + cote + '" height="' + cote + '" fill="#fff"/>'
         + '<path d="' + d + '" fill="#000"/></svg>';
  }

  return { svg: svg, matrice: construire };
})();
