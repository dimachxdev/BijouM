/**
 * KAYOR — Console opérateur du service
 *
 * L'opérateur n'est membre d'aucune boutique : `Auth.chargerProfil()` le
 * déconnecterait faute de ligne dans `membres`. Cette page a donc sa propre
 * session, volontairement minimale, et ne parle à la base que par les trois
 * fonctions réservées — `boutiques_du_service`, `creer_boutique`,
 * `basculer_boutique`. Chacune revérifie `app.est_operateur()` côté serveur :
 * rien ici ne protège quoi que ce soit, tout est décidé par PostgreSQL.
 */
(function () {
  'use strict';

  var CLE_SESSION = 'kayor_operateur_session';
  var jeton = null;
  var boutiques = [];

  // ---------------------------------------------------------------- outils
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(d) {
    if (!d) return '—';
    var t = new Date(d);
    return isNaN(t) ? '—' : t.toLocaleDateString('fr-FR');
  }

  function message(texte, erreur) {
    var el = $('op-message');
    el.textContent = texte;
    el.style.display = texte ? 'block' : 'none';
    el.className = erreur ? 'login-error' : 'login-ok';
    el.style.display = texte ? 'block' : 'none';
  }

  function enTetes() {
    return {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + (jeton || SUPABASE_KEY),
      'Content-Type':  'application/json'
    };
  }

  /** Appelle une fonction réservée et renvoie son objet JSON. */
  async function rpc(nom, corps) {
    var r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + nom, {
      method: 'POST', headers: enTetes(), body: JSON.stringify(corps || {})
    });
    if (r.status === 401 || r.status === 403) {
      deconnexion('Session expirée. Reconnectez-vous.');
      throw new Error('Session expirée.');
    }
    if (!r.ok) throw new Error('Appel refusé (' + r.status + ').');
    var d = await r.json();
    if (d && d.ok === false) throw new Error(d.erreur || 'Opération refusée.');
    return d;
  }

  // ------------------------------------------------------------- connexion
  async function connexion() {
    var email = $('op-email').value.trim().toLowerCase();
    var mdp   = $('op-pass').value;
    if (!email || !mdp) { erreurLogin('Renseignez votre email et votre mot de passe.'); return; }

    var btn = $('op-btn-login');
    btn.disabled = true; btn.textContent = 'Connexion…';
    try {
      var r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
        method:  'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email, password: mdp })
      });
      var d = await r.json().catch(function () { return {}; });
      // Message générique : ne pas révéler si l'adresse existe.
      if (!r.ok || !d.access_token) throw new Error('Identifiant ou mot de passe incorrect.');

      jeton = d.access_token;
      try {
        sessionStorage.setItem(CLE_SESSION, JSON.stringify({
          jeton: jeton, email: email,
          expire: Date.now() + (d.expires_in || 3600) * 1000
        }));
      } catch (e) { /* navigation privée : la session vivra le temps de l'onglet */ }

      await ouvrirConsole(email);
    } catch (e) {
      erreurLogin(e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Se connecter';
    }
  }

  function erreurLogin(texte) {
    var el = $('op-login-error');
    el.textContent = texte;
    el.style.display = texte ? 'block' : 'none';
  }

  /** Affiche la console — mais seulement si le serveur reconnaît un opérateur. */
  async function ouvrirConsole(email) {
    var d;
    try {
      d = await rpc('boutiques_du_service');
    } catch (e) {
      // `boutiques_du_service` répond « Réservé à l'opérateur » aux autres
      // comptes : on referme la session plutôt que d'afficher une page vide.
      deconnexion(e.message);
      return;
    }
    boutiques = d.boutiques || [];
    $('op-login').style.display = 'none';
    $('op-console').style.display = 'block';
    $('op-identite').textContent = email || '';
    rendre();
  }

  function deconnexion(texte) {
    jeton = null; boutiques = [];
    try { sessionStorage.removeItem(CLE_SESSION); } catch (e) {}
    // Vider le tableau : la liste des boutiques ne doit pas survivre dans le
    // DOM derrière l'écran de connexion.
    $('op-tbody').innerHTML = '';
    $('op-total').textContent = '';
    $('op-identite').textContent = '';
    $('op-message').style.display = 'none';
    $('op-console').style.display = 'none';
    $('op-login').style.display = 'flex';
    $('op-pass').value = '';
    erreurLogin(texte || '');
  }

  // --------------------------------------------------------------- tableau
  /** Statut affiché : suspendue > expirée > essai > actif. */
  function statut(b) {
    if (!b.actif) return { texte: 'Suspendue', classe: 'badge-danger' };
    if (b.expire_le && b.expire_le < new Date().toISOString().slice(0, 10)) {
      return { texte: 'Expirée le ' + fmtDate(b.expire_le), classe: 'badge-danger' };
    }
    if (b.expire_le) return { texte: 'Essai jusqu\'au ' + fmtDate(b.expire_le), classe: 'badge-warn' };
    return { texte: 'Active', classe: 'badge-success' };
  }

  function rendre() {
    var corps = $('op-tbody');
    if (!boutiques.length) {
      corps.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:24px">'
                      + 'Aucune boutique.</td></tr>';
    } else {
      corps.innerHTML = boutiques.map(function (b) {
        var s = statut(b);
        return '<tr>'
          + '<td><strong>' + esc(b.nom) + '</strong></td>'
          + '<td><span class="ref-code">' + esc(b.slug) + '</span></td>'
          + '<td>' + esc(b.plan || '—') + '</td>'
          + '<td><span class="metric-badge ' + s.classe + '">' + esc(s.texte) + '</span></td>'
          + '<td>' + (b.nb_membres || 0) + '</td>'
          + '<td>' + (b.nb_ventes || 0) + '</td>'
          + '<td>' + fmtDate(b.derniere_vente) + '</td>'
          + '<td><button class="btn small ' + (b.actif ? 'btn-danger' : '') + '" '
          + 'data-org="' + esc(b.id) + '" data-actif="' + (b.actif ? '0' : '1') + '">'
          + (b.actif ? 'Suspendre' : 'Réactiver') + '</button></td>'
          + '</tr>';
      }).join('');
    }

    $('op-total').textContent = boutiques.length
      + ' boutique' + (boutiques.length > 1 ? 's' : '')
      + ' · ' + boutiques.filter(function (b) { return b.actif; }).length + ' active(s)';

    Array.prototype.forEach.call(corps.querySelectorAll('button[data-org]'), function (btn) {
      btn.onclick = function () { basculer(btn.dataset.org, btn.dataset.actif === '1'); };
    });
  }

  async function rafraichir() {
    try {
      var d = await rpc('boutiques_du_service');
      boutiques = d.boutiques || [];
      rendre();
      message('');
    } catch (e) { message(e.message, true); }
  }

  // ------------------------------------------------------------- bascule
  /**
   * Suspendre ne supprime rien : `app.org_active()` bascule la boutique en
   * lecture seule, son historique reste consultable.
   */
  async function basculer(orgId, versActif) {
    var b = boutiques.filter(function (x) { return x.id === orgId; })[0] || {};
    var question = versActif
      ? 'Réactiver « ' + b.nom + ' » ? Son équipe pourra de nouveau saisir.'
      : 'Suspendre « ' + b.nom + ' » ?\n\nSon équipe passera en lecture seule : '
        + 'plus aucune vente ni saisie possible. Aucune donnée n\'est supprimée.';
    if (!confirm(question)) return;
    try {
      await rpc('basculer_boutique', { p_org_id: orgId, p_actif: versActif });
      await rafraichir();
      message('✓ « ' + b.nom + ' » ' + (versActif ? 'réactivée.' : 'suspendue.'));
    } catch (e) { message(e.message, true); }
  }

  // --------------------------------------------------- nouvelle boutique
  function basculerFormulaire() {
    var f = $('op-form-creation');
    var ouvert = f.style.display !== 'none';
    f.style.display = ouvert ? 'none' : 'block';
    $('op-btn-nouvelle').textContent = ouvert ? '+ Nouvelle boutique' : 'Annuler';
    if (!ouvert) $('c-nom').focus();
  }

  async function creer() {
    var nom   = $('c-nom').value.trim();
    var slug  = $('c-slug').value.trim().toUpperCase();
    var email = $('c-email').value.trim().toLowerCase();
    var nomP  = $('c-nom-proprio').value.trim();
    var plan  = $('c-plan').value;
    var jours = parseInt($('c-jours').value, 10);
    if (isNaN(jours) || jours < 0) jours = 0;

    if (!nom || !slug || !email || !nomP) {
      message('Nom, code, nom et email de la propriétaire sont obligatoires.', true); return;
    }
    if (!/^[A-Z0-9]{2,6}$/.test(slug)) {
      message('Le code boutique doit faire 2 à 6 lettres majuscules ou chiffres.', true); return;
    }

    var btn = $('op-btn-creer');
    btn.disabled = true; btn.textContent = 'Création…';
    try {
      var d = await rpc('creer_boutique', {
        p_nom: nom, p_slug: slug,
        p_email_proprietaire: email, p_nom_proprietaire: nomP,
        p_plan: plan, p_jours_essai: jours
      });
      ['c-nom', 'c-slug', 'c-email', 'c-nom-proprio'].forEach(function (id) { $(id).value = ''; });
      basculerFormulaire();
      await rafraichir();   // efface le bandeau : le message vient donc après
      // Pas d'email automatique : la propriétaire s'inscrit elle-même depuis
      // l'écran de connexion, bouton « J'ai une invitation ».
      message('✓ « ' + nom + ' » créée (code ' + d.slug + '). Invitation posée pour '
            + d.invitation_envoyee_a + ' — elle doit s\'inscrire avec cette adresse '
            + 'via « J\'ai une invitation » sur l\'écran de connexion.');
    } catch (e) {
      message(e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = '✓ Créer la boutique';
    }
  }

  // ------------------------------------------------------------- démarrage
  function reprendreSession() {
    var brut = null;
    try { brut = sessionStorage.getItem(CLE_SESSION); } catch (e) {}
    if (!brut) return;
    try {
      var s = JSON.parse(brut);
      if (!s.jeton || (s.expire && s.expire < Date.now())) {
        sessionStorage.removeItem(CLE_SESSION); return;
      }
      jeton = s.jeton;
      ouvrirConsole(s.email);
    } catch (e) {
      try { sessionStorage.removeItem(CLE_SESSION); } catch (x) {}
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('op-btn-login').onclick     = connexion;
    $('op-btn-logout').onclick    = function () { deconnexion(); };
    $('op-btn-refresh').onclick   = rafraichir;
    $('op-btn-nouvelle').onclick  = basculerFormulaire;
    $('op-btn-creer').onclick     = creer;
    $('op-pass').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') connexion();
    });
    reprendreSession();
  });
})();
