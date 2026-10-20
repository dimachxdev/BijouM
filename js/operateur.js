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

  /** Même règle que `app.normaliser_tel()` côté serveur : chiffres seuls, 221 par défaut. */
  function normaliserTel(tel) {
    var v = String(tel || '').replace(/[^0-9]/g, '');
    if (!v) return '';
    if (v.slice(0, 2) === '00') v = v.slice(2);
    if (v.length === 9 && v[0] === '7') v = '221' + v;
    return v;
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
          + '<td><div style="display:flex;gap:4px">'
          + '<button class="btn small" data-edit="' + esc(b.id) + '" title="Modifier">✎</button>'
          + '<button class="btn small ' + (b.actif ? 'btn-danger' : '') + '" '
          + 'data-org="' + esc(b.id) + '" data-actif="' + (b.actif ? '0' : '1') + '">'
          + (b.actif ? 'Suspendre' : 'Réactiver') + '</button></div></td>'
          + '</tr>';
      }).join('');
    }

    $('op-total').textContent = boutiques.length
      + ' boutique' + (boutiques.length > 1 ? 's' : '')
      + ' · ' + boutiques.filter(function (b) { return b.actif; }).length + ' active(s)';

    Array.prototype.forEach.call(corps.querySelectorAll('button[data-org]'), function (btn) {
      btn.onclick = function () { basculer(btn.dataset.org, btn.dataset.actif === '1'); };
    });
    Array.prototype.forEach.call(corps.querySelectorAll('button[data-edit]'), function (btn) {
      btn.onclick = function () { ouvrirEdition(btn.dataset.edit); };
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

  // ------------------------------------------------------------- édition
  /**
   * Corriger une boutique déjà enregistrée : nom, plan, échéance.
   *
   * Le code boutique reste figé — il forme le suffixe des identifiants de
   * toute l'équipe (`amina@kay`). Le changer les déconnecterait d'un coup,
   * sans retour possible. Le champ est affiché, désactivé, pour qu'on voie
   * pourquoi il ne bouge pas.
   */
  function ouvrirEdition(id) {
    var b = boutiques.filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    $('e-id').value     = b.id;
    $('e-nom').value    = b.nom || '';
    $('e-plan').value   = b.plan || 'essai';
    $('e-expire').value = b.expire_le ? String(b.expire_le).slice(0, 10) : '';
    $('e-slug').value   = b.slug || '';
    $('e-mdp').value = '';
    $('e-proprio-login').textContent = b.nb_membres
      ? 'Elle se connecte avec son identifiant habituel.'
      : 'Aucun membre dans cette boutique.';
    $('e-titre').textContent = '« ' + (b.nom || '') + ' »';
    $('e-code').textContent  = 'Code ' + (b.slug || '');
    $('op-form-edition').style.display = 'block';
    $('op-form-creation').style.display = 'none';
    $('op-btn-nouvelle').textContent = '+ Nouvelle boutique';
    $('e-nom').focus();
  }

  function fermerEdition() {
    $('op-form-edition').style.display = 'none';
    message('');
  }

  async function enregistrerEdition() {
    var id     = $('e-id').value;
    var nom    = $('e-nom').value.trim();
    var plan   = $('e-plan').value;
    var expire = $('e-expire').value;

    if (!nom) { message('Le nom ne peut pas être vide.', true); return; }

    var btn = $('op-btn-enregistrer');
    btn.disabled = true; btn.textContent = 'Enregistrement…';
    try {
      // 'sans' retire l'échéance ; une chaîne vide la laisserait inchangée.
      var d = await rpc('modifier_boutique', {
        p_org_id: id, p_nom: nom, p_plan: plan,
        p_expire_le: expire || 'sans'
      });
      fermerEdition();
      await rafraichir();
      message('✓ « ' + d.nom + ' » mise à jour.');
    } catch (e) {
      message(e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = '✓ Enregistrer';
    }
  }

  /**
   * Rendre son accès à une propriétaire qui l'a perdu.
   *
   * Volontairement limité à la propriétaire : son équipe relève d'elle, pas
   * de l'opérateur. Personne ne saute un échelon dans la chaîne.
   */
  async function remplacerMotDePasseProprio() {
    var id  = $('e-id').value;
    var mdp = $('e-mdp').value;
    if (mdp.length < 8) { message('Le mot de passe doit faire au moins 8 caractères.', true); return; }

    var b = boutiques.filter(function (x) { return x.id === id; })[0] || {};
    if (!confirm('Remplacer le mot de passe de la propriétaire de « ' + b.nom + ' » ?\n\n'
               + 'Son accès actuel cessera de fonctionner immédiatement.')) return;

    var btn = $('op-btn-mdp-proprio');
    btn.disabled = true; btn.textContent = 'Enregistrement…';
    try {
      var r = await fetch(SUPABASE_URL + '/functions/v1/membres-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + jeton },
        body: JSON.stringify({ action: 'motdepasse_proprietaire',
                               organisation_id: id, motdepasse: mdp })
      }).catch(function () { throw new Error('Serveur injoignable. Vérifiez votre connexion.'); });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || d.ok === false) throw new Error(d.erreur || 'Opération refusée.');

      $('e-mdp').value = '';
      message('✓ Mot de passe remplacé pour ' + d.nom + '. Elle se connecte avec « ' + d.login + ' ».');
    } catch (e) {
      message(e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = '🔑 Remplacer';
    }
  }

  window.fermerEdition = fermerEdition;

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
    $('op-form-edition').style.display = 'none';
    var f = $('op-form-creation');
    var ouvert = f.style.display !== 'none';
    f.style.display = ouvert ? 'none' : 'block';
    $('op-btn-nouvelle').textContent = ouvert ? '+ Nouvelle boutique' : 'Annuler';
    if (!ouvert) $('c-nom').focus();
  }

  /** Montre l'identifiant complet que la propriétaire devra taper. */
  function majApercuProprio() {
    var id   = ($('c-identifiant').value || '').trim().toLowerCase();
    var slug = ($('c-slug').value || '').trim().toLowerCase();
    $('c-apercu').textContent = (id && slug)
      ? 'Elle se connectera avec « ' + id + '@' + slug + ' »'
      : 'Elle se connectera avec cet identifiant.';
  }

  /** Masqué par défaut : un mot de passe n'a pas à rester lisible à l'écran. */
  function basculerVisibiliteOp(idChamp, bouton) {
    var el = $(idChamp); if (!el) return;
    var cache = el.type === 'password';
    el.type = cache ? 'text' : 'password';
    bouton.textContent = cache ? '🙈' : '👁';
  }

  async function creer() {
    var nom   = $('c-nom').value.trim();
    var slug  = $('c-slug').value.trim().toUpperCase();
    var ident = $('c-identifiant').value.trim().toLowerCase();
    var mdp   = $('c-mdp').value;
    var tel   = normaliserTel($('c-tel').value);
    var nomP  = $('c-nom-proprio').value.trim();
    var plan  = $('c-plan').value;
    var jours = parseInt($('c-jours').value, 10);
    if (isNaN(jours) || jours < 0) jours = 0;

    if (!nom || !slug || !nomP) {
      message('Le nom de la boutique, son code et le nom de la propriétaire sont obligatoires.', true); return;
    }
    if (!/^[A-Z0-9]{2,6}$/.test(slug)) {
      message('Le code boutique doit faire 2 à 6 lettres majuscules ou chiffres.', true); return;
    }
    if (!/^[a-z0-9._-]{2,30}$/.test(ident)) {
      message('Identifiant : 2 à 30 caractères, lettres, chiffres, point ou tiret.', true); return;
    }
    if (mdp.length < 8) {
      message('Le mot de passe doit faire au moins 8 caractères.', true); return;
    }

    var btn = $('op-btn-creer');
    btn.disabled = true; btn.textContent = 'Création…';
    try {
      // Plus d'invitation : la boutique ET le compte de sa propriétaire sont
      // créés d'un bloc par la fonction serveur, qui seule détient la clé de
      // service. Si le compte échoue, la boutique est défaite derrière elle.
      var r = await fetch(SUPABASE_URL + '/functions/v1/membres-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + jeton },
        body: JSON.stringify({ action: 'creer_boutique',
          nom: nom, slug: slug, identifiant: ident, motdepasse: mdp,
          nom_proprietaire: nomP, telephone: tel || '',
          plan: plan, jours_essai: String(jours) })
      }).catch(function () {
        throw new Error('Serveur injoignable. Vérifiez votre connexion.');
      });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || d.ok === false) throw new Error(d.erreur || 'Création refusée.');
      ['c-nom', 'c-slug', 'c-identifiant', 'c-mdp', 'c-tel', 'c-nom-proprio']
        .forEach(function (id) { $(id).value = ''; });
      majApercuProprio();
      basculerFormulaire();
      await rafraichir();   // efface le bandeau : le message vient donc après
      // Rien n'est envoyé : la propriétaire reçoit ses accès de vive voix.
      message('✓ « ' + nom + ' » créée (code ' + d.slug + '). ' + d.nom_proprietaire
            + ' se connecte avec « ' + d.login + ' » et le mot de passe que vous venez de poser.');
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

  window.majApercuProprio = majApercuProprio;
  window.basculerVisibiliteOp = basculerVisibiliteOp;

  document.addEventListener('DOMContentLoaded', function () {
    $('op-btn-login').onclick     = connexion;
    $('op-btn-logout').onclick    = function () { deconnexion(); };
    $('op-btn-refresh').onclick   = rafraichir;
    $('op-btn-nouvelle').onclick  = basculerFormulaire;
    $('op-btn-creer').onclick     = creer;
    $('op-btn-enregistrer').onclick = enregistrerEdition;
    $('op-btn-mdp-proprio').onclick = remplacerMotDePasseProprio;
    $('op-pass').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') connexion();
    });
    reprendreSession();
  });
})();
