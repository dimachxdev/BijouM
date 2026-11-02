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
    // Le corps de l'erreur porte la cause ; le code HTTP seul ne dit rien.
    // « Appel refusé (404) » a coûté une recherche entière le 2026-10-27,
    // alors que PostgreSQL écrivait « function … does not exist » juste
    // à côté — la migration n'était simplement pas appliquée.
    // Même règle que `_erreurRpc()` dans js/supabase.js.
    if (!r.ok) {
      var e = {};
      try { e = await r.json(); } catch (_) { /* corps vide ou illisible */ }
      var msg = e.message || e.erreur || e.msg || '';
      if (r.status === 404 && /does not exist|not find/i.test(msg)) {
        msg = 'Cette fonction n\'existe pas en base : la migration n\'a pas été appliquée.';
      }
      throw new Error(msg ? 'Appel refusé : ' + msg : 'Appel refusé (' + r.status + ').');
    }
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
      corps.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);padding:24px">'
                      + 'Aucune boutique.</td></tr>';
    } else {
      corps.innerHTML = boutiques.map(function (b) {
        var s = statut(b);
        return '<tr>'
          + '<td><strong>' + esc(b.nom) + '</strong></td>'
          + '<td>' + (b.proprietaire_login
              ? esc(b.proprietaire_nom || '') + '<br><span class="ref-code">' + esc(b.proprietaire_login) + '</span>'
              : '<span class="metric-badge badge-danger">Sans propriétaire</span>') + '</td>'
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
          + (b.actif ? 'Suspendre' : 'Réactiver') + '</button>'
          // Supprimer n'apparaît que sur une boutique déjà suspendue. Ce n'est
          // pas une politesse d'affichage : la fonction SQL refuse de toute
          // façon tant qu'elle est active. Le bouton suit la règle, il ne la
          // porte pas.
          + (b.actif ? '' :
              '<button class="btn small btn-danger" data-suppr="' + esc(b.id) + '"'
              + ' data-slug="' + esc(b.slug) + '" data-nom="' + esc(b.nom) + '"'
              + ' title="Supprimer définitivement">🗑</button>')
          + '</div></td>'
          + '</tr>';
      }).join('');
    }

    $('op-total').textContent = boutiques.length
      + ' boutique' + (boutiques.length > 1 ? 's' : '')
      + ' · ' + boutiques.filter(function (b) { return b.actif; }).length + ' active(s)';

    // Ces deux boutons sont recrees a chaque rendu et n'ont pas d'identifiant
    // a desactiver : c'est le verrou qui les couvre, par la regle CSS sur
    // `body[data-occupe]`. Les handlers passent donc par `verrouille()`, comme
    // ceux de l'en-tete.
    Array.prototype.forEach.call(corps.querySelectorAll('button[data-org]'), function (btn) {
      btn.onclick = verrouille('bascule-boutique', function () {
        return basculer(btn.dataset.org, btn.dataset.actif === '1');
      });
    });

    Array.prototype.forEach.call(corps.querySelectorAll('button[data-suppr]'), function (btn) {
      btn.onclick = verrouille('supprimer-boutique', function () {
        return supprimerBoutique(btn.dataset.suppr, btn.dataset.slug, btn.dataset.nom);
      });
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
      // Apres la liste, pas avant : si les sauvegardes sont illisibles, la
      // console doit quand meme s'ouvrir.
      chargerSauvegardes();
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
    // Sans propriétaire, le remplacement de mot de passe n'a pas de cible.
    $('e-mdp').disabled = !b.proprietaire_login;
    $('op-btn-mdp-proprio').disabled = !b.proprietaire_login;
    $('e-proprio-login').innerHTML = b.proprietaire_login
      ? esc(b.proprietaire_nom || '') + ' — identifiant <strong>' + esc(b.proprietaire_login) + '</strong>'
      : '<span style="color:var(--danger-text)">Cette boutique n\'a aucune propriétaire : personne ne peut y entrer.</span>';
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

      // Ce mot de passe est passé par vous : elle devra le remplacer à sa
      // prochaine connexion.
      try { await rpc('exiger_changement_mdp', { p_org_id: id }); } catch (e) { /* non bloquant */ }

      $('e-mdp').value = '';
      message('✓ Mot de passe remplacé pour ' + d.nom + '. Elle se connecte avec « ' + d.login
            + ' » et devra en choisir un autre à sa prochaine connexion.');
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

  /**
   * Supprime définitivement une boutique et tout son historique.
   *
   * Tout ce qui compte se passe dans `supprimer_boutique()` côté SQL : rôle
   * opérateur, code retapé, boutique déjà suspendue, ni épargne de cliente
   * ni créance en cours. Ce qui suit ne fait que demander le code et relayer
   * — si cette fonction disparaissait, rien ne serait moins protégé.
   *
   * Deux temps : le SQL efface les données et renvoie les comptes rattachés,
   * puis `membres-admin` les retire de l'authentification. Les identités et
   * les sessions ne vivent pas dans une table ordinaire.
   */
  async function supprimerBoutique(orgId, slug, nom) {
    var saisi = prompt(
      'Supprimer « ' + nom + ' » DÉFINITIVEMENT.\n\n'
      + 'Ventes, clientes, stock, caisse et comptes épargne seront effacés.\n'
      + 'Il n\'y a aucune sauvegarde : rien ne reviendra.\n\n'
      + 'Tapez le code de la boutique pour confirmer : ' + slug);
    if (saisi === null) return;

    try {
      var d = await rpc('supprimer_boutique', { p_org_id: orgId, p_slug: saisi });

      // Les comptes de connexion, second temps. Un échec ici ne remet pas la
      // boutique : elle est déjà partie. On le dit plutôt que de le taire.
      var retires = 0;
      if (d && d.comptes && d.comptes.length) {
        try {
          var r = await fetch(SUPABASE_URL + '/functions/v1/membres-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json',
                       'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + jeton },
            body: JSON.stringify({ action: 'supprimer_comptes', user_ids: d.comptes })
          });
          var j = await r.json().catch(function () { return {}; });
          // Un refus serveur renvoie un corps JSON avec un statut d'erreur.
          // Se contenter de `j.retires || 0` affichait « 0 compte(s) retiré(s) »
          // sur un echec franc — une panne deguisee en succes. Vecu le
          // 2026-10-31 : la fonction deployee ne connaissait pas encore
          // l'action, la boutique est partie, les comptes sont restes, et
          // l'ecran a dit que tout allait bien.
          if (!r.ok || j.ok === false) {
            await rafraichir();
            message('Boutique supprimee, mais ses comptes de connexion subsistent : '
                  + (j.erreur || ('refus du serveur, code ' + r.status)) + ' '
                  + 'Retirez-les depuis Authentication -> Users.', true);
            return;
          }
          retires = j.retires || 0;
        } catch (e) {
          await rafraichir();
          message('Boutique supprimée, mais ses comptes de connexion subsistent. '
                + 'Retirez-les depuis Authentication → Users.', true);
          return;
        }
      }

      await rafraichir();
      message('✓ « ' + d.nom + ' » supprimée — ' + (d.ventes_supprimees || 0)
            + ' vente(s), ' + retires + ' compte(s) retiré(s).');
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

  /**
   * Le verrou, pose a la frontiere des handlers et nulle part ailleurs.
   *
   * `rpc()` ci-dessus sert indifferemment aux lectures (la liste des
   * boutiques) et aux ecritures : le verrouiller figerait `rafraichir()`,
   * appele juste apres chaque ecriture. On enveloppe donc le GESTE, qui est
   * aussi la bonne granularite — `creer()` enchaine une Edge Function puis un
   * rafraichissement, et `Verrou.requete` n'est pas reentrante.
   *
   * Pas de cle de geste ici : creer une boutique deux fois echoue sur le code
   * deja pris, et remplacer un mot de passe par la meme valeur laisse le meme
   * etat. Le verrou sert a empecher deux creations concurrentes, dont la
   * seconde laisserait une boutique sans proprietaire.
   */
  function verrouille(nom, fn) {
    return function () {
      var args = arguments;
      var ceci = this;
      return Verrou.geste(nom, function () { return fn.apply(ceci, args); })
        .catch(function (e) {
          if (Verrou.estOccupe(e)) return;
          message(e && e.message ? e.message : 'Operation echouee.', true);
        });
    };
  }

  // ------------------------------------------------- sauvegardes et structure
  /**
   * Le bandeau qui previent, et le resume qui dit de quand date le filet.
   *
   * La question a poser en premier le jour ou quelque chose a disparu n'est pas
   * « comment restaurer », c'est « de quand date la derniere sauvegarde ».
   * D'ou cet ordre a l'ecran : l'alerte, puis la date, puis les boutons.
   */
  function octets(n) {
    if (n < 1024) return n + ' o';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' Ko';
    return (n / 1048576).toFixed(1) + ' Mo';
  }

  function jourHeure(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return fmtDate(iso) + ' à ' + ('0' + d.getHours()).slice(-2)
         + 'h' + ('0' + d.getMinutes()).slice(-2);
  }

  async function chargerSauvegardes() {
    var resume  = $('op-sauvegardes-resume');
    var bandeau = $('op-alerte-structure');
    if (!resume) return;

    try {
      var s = await rpc('sauvegardes_recentes', {});
      var liste = (s && s.sauvegardes) || [];

      if (!liste.length) {
        resume.innerHTML = '<strong style="color:var(--danger-text)">'
          + 'Aucune sauvegarde.</strong> Le travail planifié n\'a encore jamais '
          + 'tourné, ou le projet dormait.';
      } else {
        var d = liste[0];
        // Au-dela de 48 h, l'instantane ne reflete plus la journee de travail :
        // sur l'offre gratuite, un projet en veille n'execute aucun cron.
        var heures = (Date.now() - new Date(d.faite_le).getTime()) / 3600000;
        var vieux  = heures > 48;
        resume.innerHTML =
          '<div style="font-size:15px">Dernière sauvegarde : <strong'
          + (vieux ? ' style="color:var(--danger-text)"' : '') + '>'
          + esc(jourHeure(d.faite_le)) + '</strong>'
          + (vieux ? ' — plus de 48 h, le projet a probablement dormi' : '')
          + '</div>'
          + '<div class="page-sub">' + d.nb_lignes + ' lignes · '
          + d.nb_tables + ' tables · ' + octets(d.octets)
          + ' · ' + liste.length + ' conservée(s) sur 14</div>';
      }
    } catch (e) {
      resume.textContent = 'Sauvegardes illisibles : ' + e.message;
    }

    // Le journal de structure. Une suppression de TABLE est l'evenement qui
    // justifie tout ce dispositif : elle passe en rouge, les autres en gris.
    try {
      var j = await rpc('journal_structure', { p_limite: 20 });
      var lignes = (j && j.lignes) || [];
      var tables = lignes.filter(function (l) { return l.objet_type === 'table'; });

      if (!tables.length) { bandeau.style.display = 'none'; return; }

      var t = tables[0];
      bandeau.style.display = '';
      bandeau.innerHTML =
        '<div style="background:var(--danger-bg);color:var(--danger-text);'
        + 'border:1px solid currentColor;border-radius:var(--radius-md);'
        + 'padding:12px 14px;margin-bottom:12px">'
        + '<div style="font-weight:700;font-size:15px">⚠ '
        + tables.length + ' suppression(s) de table enregistrée(s)</div>'
        + '<div style="margin-top:6px">La plus récente : <strong>'
        + esc(t.objet) + '</strong>, le ' + esc(jourHeure(t.survenu_le))
        + ', par <strong>' + esc(t.acteur) + '</strong>.</div>'
        + '<div style="margin-top:6px">Comparez la base à la dernière '
        + 'sauvegarde avant toute autre action — des lignes ont pu être '
        + 'supprimées volontairement, et restaurer par-dessus ferait un '
        + 'deuxième dégât.</div>'
        + '</div>';
    } catch (e) {
      // Le journal n'est pas l'essentiel : son absence ne doit pas masquer le
      // resume des sauvegardes, qui lui est vital.
      console.warn('journal_structure :', e.message);
    }
  }

  async function sauverMaintenant() {
    var r = await rpc('sauvegarder_maintenant', {});
    if (!r || r.ok === false) throw new Error(r && r.erreur ? r.erreur : 'Refus du serveur.');
    await chargerSauvegardes();
    message('✓ Sauvegarde prise — ' + r.lignes + ' lignes, ' + octets(r.octets) + '.');
  }

  async function comparerALaBase() {
    var cible = $('op-comparaison');
    var r = await rpc('comparer_sauvegarde', {});
    if (!r || r.ok === false) throw new Error(r && r.erreur ? r.erreur : 'Refus du serveur.');

    var ecarts = (r.tables || []).filter(function (t) { return t.etat !== 'identique'; });
    var lignes = ecarts.map(function (t) {
      var grave = t.etat === 'TABLE DISPARUE' || t.etat === 'des lignes manquent';
      return '<tr><td>' + esc(t.table) + '</td>'
           + '<td style="text-align:right">' + t.dans_sauvegarde + '</td>'
           + '<td style="text-align:right">'
           + (t.dans_la_base === null ? '—' : t.dans_la_base) + '</td>'
           + '<td' + (grave ? ' style="color:var(--danger-text);font-weight:600"' : '')
           + '>' + esc(t.etat) + '</td></tr>';
    }).join('');

    cible.innerHTML =
      '<div class="page-sub" style="margin-bottom:8px">Sauvegarde n°' + r.sauvegarde
      + ' du ' + esc(jourHeure(r.faite_le)) + ' — ' + esc(r.avis) + '</div>'
      + (ecarts.length
          ? '<div class="table-wrap"><table><thead><tr><th>Table</th>'
            + '<th style="text-align:right">Sauvegarde</th>'
            + '<th style="text-align:right">Base</th><th>Etat</th></tr></thead>'
            + '<tbody>' + lignes + '</tbody></table></div>'
          : '');
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('op-btn-sauver').onclick   = verrouille('sauvegarde', sauverMaintenant);
    $('op-btn-comparer').onclick = verrouille('comparaison', comparerALaBase);
    $('op-btn-login').onclick     = verrouille('connexion-op', connexion);
    $('op-btn-logout').onclick    = function () { deconnexion(); };
    $('op-btn-refresh').onclick   = rafraichir;
    $('op-btn-nouvelle').onclick  = basculerFormulaire;
    $('op-btn-creer').onclick     = verrouille('creer-boutique', creer);
    $('op-btn-enregistrer').onclick = verrouille('editer-boutique', enregistrerEdition);
    $('op-btn-mdp-proprio').onclick = verrouille('mdp-proprietaire', remplacerMotDePasseProprio);
    // La touche Entree passe par le MEME chemin verrouille que le bouton.
    // L'y oublier aurait laisse une porte ouverte a cote de la porte fermee.
    $('op-pass').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('op-btn-login').onclick();
    });
    reprendreSession();
  });
})();
