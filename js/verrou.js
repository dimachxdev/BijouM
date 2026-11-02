console.log('KAYOR · verrou.js', '2026-11-02a');
/**
 * KAYOR — Verrou d'ecriture et cle de geste
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Constate le 2026-11-02 : sur une connexion lente, rien ne signale qu'une
 * requete est partie. La personne reclique. Deux ventes, deux depots, deux
 * decaissements, et le stock deduit deux fois.
 *
 * Neuf handlers sur une trentaine desactivaient leur bouton. Ceux qui
 * touchent l'argent ne le faisaient pas. Et le motif se recopiait dans
 * chaque fonction, ce qui garantissait qu'un geste ecrit demain l'oublierait
 * — exactement le piege que le § 3 nomme pour les cartes de liste : une
 * regle recopiee est une regle qui divergera.
 *
 * D'OU UN SEUL POINT, ET NON VINGT-CINQ
 *
 *   Verrou.geste(nom, fn)    enveloppe UN GESTE complet (un handler).
 *   Verrou.requete(nom, fn)  enveloppe UNE ECRITURE (couche Supabase).
 *
 * `requete` passe sans rien verrouiller quand elle est appelee DEPUIS un
 * geste : une vente enchaine la reservation du numero, l'ecriture, puis la
 * deduction de stock. Ces trois-la appartiennent au meme geste et ne doivent
 * pas se bloquer entre elles.
 *
 * Hors geste, `requete` prend le verrou pour son propre compte. C'est la
 * ceinture : un handler qui n'aurait pas ete adapte reste protege, sans une
 * ligne de plus chez lui.
 *
 * ON REFUSE, ON NE MET PAS EN FILE
 *
 * Mettre en file ferait les deux ventes, l'une apres l'autre. Le second
 * appel est donc REJETE, et la personne le voit.
 *
 * LES LECTURES NE SONT JAMAIS BLOQUEES
 *
 * `chargerDonnees()` tourne juste apres chaque ecriture. La bloquer figerait
 * l'application a la premiere vente.
 *
 * ET SURTOUT : CE VERROU NE PROTEGE RIEN
 *
 * Le navigateur ne decide d'aucune autorisation (regle d'or), et il ne
 * decide pas non plus de l'unicite. Un bouton grise arrete le deuxieme clic
 * d'une rafale. Il n'arrete ni le rechargement de page, ni l'abandon a 15 s
 * du portail cliente sur un depot deja ecrit, ni deux postes.
 *
 * Le vrai verrou est la CLE DE GESTE ci-dessous, avec la table `gestes`
 * (migrations 032 et 033) : la cle part avec l'ecriture, et PostgreSQL rend
 * le resultat garde au lieu d'ecrire une seconde fois. Tout le reste de ce
 * fichier est du confort d'affichage, et doit etre lu comme tel.
 */
var Verrou = (function () {

  // Nom du geste en cours, ou null. Un seul a la fois.
  var geste     = null;
  // Nom d'une ecriture prise hors geste (handler non adapte).
  var seule     = null;
  // Cle du geste en cours : la couche Supabase la lit, les handlers l'ignorent.
  var cleActive = null;
  // Empreinte du geste en cours, notee seulement s'il aboutit. Voir
  // `confirmerRepetition()`.
  var empreinteActive = null;
  // Cles en attente, par nom de geste. Voir `cleDe()`.
  var CLES      = {};

  // Memoire des gestes ABOUTIS recemment, pour la fenetre de confirmation.
  var MEMOIRE   = 'kayor_gestes_recents';
  var FENETRE   = 180000;   // 3 minutes
  // Chien de garde : voir `armer()`.
  var chien     = null;
  var CHIEN_MS  = 60000;

  /**
   * Erreur distincte, pour que l'appelant sache que RIEN n'est parti — a ne
   * pas confondre avec un refus du serveur, qui lui veut dire que quelque
   * chose a ete tente.
   */
  function Occupe(enCours) {
    this.name    = 'Occupe';
    this.occupe  = true;
    this.enCours = enCours;
    this.message = 'Une operation est deja en cours. Patientez un instant.';
  }
  Occupe.prototype = Object.create(Error.prototype);

  function avertir(msg) {
    if (typeof Verrou.avertir === 'function') { Verrou.avertir(msg); return; }
    // Chaque page a son propre afficheur : showToast dans l'application et le
    // portail, message() dans la console operateur.
    if (typeof showToast === 'function') { showToast(msg); return; }
    if (typeof message   === 'function') { message(msg, true); return; }
    console.warn('KAYOR · ' + msg);
  }

  function uuid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) { /* contexte non securise */ }
    // Repli pour un ancien appareil ou http://localhost. La cle est un
    // identifiant de geste, jamais un secret : elle ne donne acces a rien et
    // le serveur reverifie les droits a chaque appel.
    var h = '0123456789abcdef', s = '';
    for (var i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) { s += '-'; continue; }
      if (i === 14) { s += '4'; continue; }
      var r = Math.floor(Math.random() * 16);
      s += h[(i === 19) ? ((r & 0x3) | 0x8) : r];
    }
    return s;
  }

  /**
   * Le chien de garde ne protege pas les donnees : il protege la personne
   * devant l'ecran.
   *
   * Les ecritures de l'application partent en `fetch` nu, sans delai
   * d'abandon : elles aboutissent ou pendent. Une requete qui pend
   * indefiniment laisserait le verrou ferme et l'application inutilisable
   * jusqu'au rechargement. On relache donc au bout d'une minute.
   *
   * La requete, elle, continue peut-etre. C'est exactement pour ce cas que
   * la cle de geste existe : si la personne refait le geste, le serveur rend
   * le resultat du premier au lieu d'ecrire une seconde fois. Et la cle
   * survit a cet echec (voir `geste()`), donc le reessai est reconnu.
   */
  function armer(nom) {
    document.body.setAttribute('data-occupe', nom);
    chien = setTimeout(function () {
      var bloque = geste || seule;
      geste = null; seule = null; cleActive = null;
      document.body.removeAttribute('data-occupe');
      chien = null;
      avertir('« ' + bloque + ' » ne repond pas depuis une minute. '
            + 'Verifiez dans la liste avant de refaire le geste.');
    }, CHIEN_MS);
  }

  function desarmer() {
    if (chien) { clearTimeout(chien); chien = null; }
    if (!geste && !seule) document.body.removeAttribute('data-occupe');
  }

  // ── Memoire des gestes aboutis ───────────────────────────────────────────
  //
  // Elle passe par `localStorage` et non par une variable, pour couvrir le cas
  // que rien d'autre ne couvre : enregistrer, RECHARGER la page, et refaire le
  // meme geste en croyant que le premier n'a pas pris. Apres un rechargement,
  // le verrou est neuf et la cle oubliee — seule cette memoire reste.
  //
  // Elle est par appareil et par navigateur : deux postes ne se previennent
  // pas l'un l'autre. C'est du confort d'affichage, comme tout ce fichier.

  function lire() {
    try {
      var o = JSON.parse(localStorage.getItem(MEMOIRE) || '{}');
      var limite = Date.now() - FENETRE, propre = {}, k;
      for (k in o) if (o[k] > limite) propre[k] = o[k];
      return propre;
    } catch (e) { return {}; }   // navigation privee, stockage bloque, JSON casse
  }

  function ecrire(o) {
    try { localStorage.setItem(MEMOIRE, JSON.stringify(o)); } catch (e) {}
  }

  function noter(signature) {
    var o = lire();
    o[signature] = Date.now();
    ecrire(o);
  }

  function ilYA(ms) {
    var s = Math.round(ms / 1000);
    if (s < 90) return s + ' secondes';
    return Math.round(s / 60) + ' minutes';
  }

  return {
    Occupe: Occupe,

    /** Nom de ce qui tourne, ou null. Utile a un rendu, jamais a une decision. */
    enCours: function () { return geste || seule; },

    /**
     * La cle du geste en cours. Lue par la couche Supabase, qui la joint a
     * chaque ecriture. Nulle hors geste : l'ecriture part alors sans cle et
     * le serveur l'accepte, comme avant la migration 032.
     */
    cleCourante: function () { return cleActive; },

    /**
     * La cle d'un geste, creee au premier appel et GARDEE jusqu'a ce que le
     * geste aboutisse.
     *
     * C'est le coeur du dispositif, et le point ou l'on peut tout casser en
     * croyant simplifier :
     *
     *   — une cle neuve a chaque tentative rendrait le reessai invisible du
     *     serveur, donc redonnerait exactement le double-enregistrement que
     *     tout ceci ferme ;
     *   — une cle gardee apres un geste abouti ferait prendre le geste
     *     SUIVANT pour un rejeu du precedent, et il serait refuse.
     *
     * D'ou : gardee sur echec, oubliee sur succes (voir `geste()`).
     *
     * `nom` doit donc designer le geste ET sa cible — « paiement:V-0042 »,
     * pas « paiement ». Sinon l'echec d'un versement sur une vente ferait
     * passer le versement suivant, sur une AUTRE vente, pour son rejeu.
     */
    cleDe: function (nom) {
      if (!CLES[nom]) CLES[nom] = uuid();
      return CLES[nom];
    },

    /**
     * Jeter la cle en attente. A appeler a l'OUVERTURE d'une fenetre de
     * saisie : ce qui s'y ouvre est un geste neuf, meme si le precedent a
     * echoue et que la personne a renonce.
     */
    oublier: function (nom) { delete CLES[nom]; },

    /**
     * LE TROISIEME CRAN : demander confirmation quand le MEME geste, avec le
     * MEME contenu, vient d'aboutir.
     *
     * Les deux premiers crans ne couvrent pas ce cas, et c'est important de
     * voir pourquoi :
     *
     *   — le verrou arrete le second clic d'une rafale, pendant que le
     *     premier est en vol ;
     *   — la cle de geste fait reconnaitre au serveur un REESSAI du meme
     *     geste, tant qu'il n'a pas abouti.
     *
     * Mais des que le premier aboutit, sa cle est oubliee — c'est voulu,
     * sinon le geste suivant passerait pour son rejeu. Un second geste
     * identique trois secondes plus tard est donc, pour le serveur, un geste
     * parfaitement legitime. Et il l'est parfois : une cliente peut vraiment
     * deposer deux fois 10 000 le meme jour.
     *
     * C'est pourquoi on DEMANDE au lieu de refuser. Seul un humain sait si
     * c'est un vrai second bijou ou un clic de trop.
     *
     * CE QUI DECLENCHE : meme geste ET meme contenu. Pas « deux ventes a la
     * suite » — une bijouterie en fait toute la journee, et une confirmation
     * qui s'affiche sans raison s'apprend a cliquer sans la lire. Ce serait
     * pire que rien : elle passerait aussi le jour ou elle avait raison.
     *
     * OU L'APPELER : apres toutes les validations, juste avant la premiere
     * ecriture — exactement la ou la fonction serveur reserve sa cle
     * (migration 033). Au-dessus, on ferait confirmer des gestes qui vont
     * etre refuses de toute facon.
     *
     * `empreinte` est LUE PAR UN HUMAIN dans la fenetre : elle doit decrire
     * le geste en clair (« bracelet · 4 g · 4 articles · Autre »), pas porter
     * un condense. C'est elle qui permet de reconnaitre, ou non, ce qu'on a
     * deja fait.
     *
     * Rend `false` quand la personne renonce : le handler s'arrete, et RIEN
     * n'est parti.
     */
    confirmerRepetition: function (nom, empreinte) {
      var signature = nom + ' | ' + empreinte;
      var quand = lire()[signature];

      if (!quand) {                     // rien de semblable recemment
        empreinteActive = signature;    // sera note si le geste aboutit
        return true;
      }

      var accepte = window.confirm(
        'Vous venez d’enregistrer exactement la même chose il y a '
        + ilYA(Date.now() - quand) + ' :\n\n'
        + '     ' + empreinte + '\n\n'
        + 'S’agit-il d’un SECOND enregistrement, bien réel ?\n\n'
        + 'OK  =  enregistrer une deuxième fois\n'
        + 'Annuler  =  ne rien faire');

      // En cas de renoncement, rien n'est ecrit : on n'horodate pas, sinon on
      // rallongerait la fenetre de confirmation pour un geste qui n'a pas eu
      // lieu.
      empreinteActive = accepte ? signature : null;
      return accepte;
    },

    /** Une cle isolee, pour un geste qui n'a pas de fenetre a lui. */
    cle: uuid,

    /**
     * Retenir le geste qui vient d'aboutir, pour que le MEME, avec le MEME
     * contenu, fasse apparaitre la fenetre de confirmation.
     *
     * `geste()` l'appelle tout seul. Le portail cliente, lui, n'a pas de
     * handler enveloppe (`confirmerDepot` orchestre son propre affichage) :
     * il doit donc l'appeler a la main, et seulement une fois le depot
     * confirme par le serveur.
     */
    retenir: function () {
      if (empreinteActive) { noter(empreinteActive); empreinteActive = null; }
    },

    /**
     * Enveloppe un geste complet. A utiliser dans les handlers.
     * Rejette avec `Occupe` si un autre geste tourne.
     */
    geste: function (nom, fn) {
      if (geste || seule) return Promise.reject(new Occupe(geste || seule));
      geste           = nom;
      cleActive       = this.cleDe(nom);
      empreinteActive = null;
      armer(nom);
      return Promise.resolve()
        .then(fn)
        .then(function (v) {
          // Abouti : le geste suivant portera une cle neuve. Sur rejet, cette
          // ligne est sautee et la cle survit — c'est voulu.
          delete CLES[nom];
          // Et on retient ce qui vient d'etre enregistre, pour que le MEME
          // geste, avec le MEME contenu, fasse apparaitre une confirmation.
          // Retenu seulement ici : un geste qui echoue ne doit pas declencher
          // de confirmation au reessai, la cle s'en charge deja.
          if (empreinteActive) { noter(empreinteActive); empreinteActive = null; }
          return v;
        })
        .finally(function () {
          geste = null; cleActive = null; empreinteActive = null; desarmer();
        });
    },

    /**
     * Enveloppe une ecriture. Appelee depuis la couche Supabase, pour toutes
     * les ecritures et pour elles seules.
     *
     * Transparente a l'interieur d'un geste : les appels enchaines d'un meme
     * geste ne se bloquent pas entre eux.
     *
     * ELLE N'EST PAS REENTRANTE, ET ELLE NE PEUT PAS L'ETRE.
     *
     * `geste` et `requete` ont deux portes distinctes : un deuxieme clic
     * repasse par `geste`, qui le refuse, tandis que les appels internes
     * passent par `requete`, qui les laisse filer. C'est cette separation
     * qui rend la reentrance possible — et elle n'existe pas entre deux
     * `requete`, qui franchissent la meme porte. Un drapeau « je suis dedans »
     * laisserait passer le deuxieme clic aussi bien que l'appel imbrique.
     *
     * DONC : une fonction qui fait PLUS D'UNE ecriture doit etre enveloppee
     * dans un `geste`, jamais dans une `requete`. C'est le cas de tous les
     * handlers d'argent de `js/app.js`, et c'est pour cela que la couche
     * Supabase n'appelle jamais une ecriture depuis l'interieur d'une autre.
     */
    requete: function (nom, fn) {
      if (geste) return Promise.resolve().then(fn);
      if (seule) return Promise.reject(new Occupe(seule));
      seule = nom;
      armer(nom);
      return Promise.resolve()
        .then(fn)
        .finally(function () { seule = null; desarmer(); });
    },

    /**
     * Pour un handler : dire ce qu'il faut a la personne et ne pas aller
     * plus loin. Rend `true` quand l'erreur etait un refus du verrou, donc
     * quand RIEN n'est parti.
     */
    estOccupe: function (e) {
      if (e && e.occupe) { avertir(e.message); return true; }
      return false;
    }
  };
})();
