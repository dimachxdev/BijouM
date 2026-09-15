/**
 * KAYOR — Authentification (Supabase Auth)
 * ---------------------------------------------------------------------------
 * Remplace la comparaison de mots de passe en clair côté navigateur.
 *
 * Avant :
 *   STATE.users.find(u => u.login === login && u.password === pass)
 *   -> mots de passe lisibles dans localStorage et dans la table utilisateurs,
 *      rôle modifiable depuis la console (STATE.currentUser.role = 'admin').
 *
 * Après :
 *   Supabase Auth renvoie un JWT signé. L'organisation et le rôle sont lus
 *   depuis la table `membres` et surtout REVÉRIFIÉS par PostgreSQL à chaque
 *   requête via les policies RLS. Forcer son rôle dans la console ne change
 *   plus rien : c'est le serveur qui tranche.
 *
 * À charger APRÈS security.js et AVANT app.js.
 */

(function (global) {
  'use strict';

  var URL_BASE = global.SUPABASE_URL || 'https://yflvtquowzvghwxyvuah.supabase.co';
  var ANON_KEY = global.SUPABASE_KEY || 'sb_publishable_3EBGFxeT8B8cys54IZj3Nw_ZTS-4ZR1';

  var CLE_SESSION = 'kayor_session';
  var MARGE_REFRESH_MS = 60 * 1000;   // rafraîchir 1 min avant expiration

  var session = null;   // { access_token, refresh_token, expires_at, user }
  var profil  = null;   // { user_id, organisation_id, nom, role, org_slug, org_nom }
  var timerRefresh = null;

  // =========================================================================
  // PERSISTANCE
  // =========================================================================
  function lireSession() {
    try {
      var s = localStorage.getItem(CLE_SESSION);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  function ecrireSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(CLE_SESSION, JSON.stringify(s));
      else   localStorage.removeItem(CLE_SESSION);
    } catch (e) { /* mode privé : la session reste en mémoire */ }
  }

  // =========================================================================
  // REQUÊTES
  // =========================================================================
  function fetchTimeout(url, opts, ms) {
    var ctrl = new AbortController();
    var tid  = setTimeout(function () { ctrl.abort(); }, ms || 15000);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
      .finally(function () { clearTimeout(tid); });
  }

  function enTetesAnon() {
    return { 'Content-Type': 'application/json', 'apikey': ANON_KEY };
  }

  /** En-têtes authentifiés — à utiliser pour tous les appels /rest/v1. */
  function enTetes() {
    var h = { 'Content-Type': 'application/json', 'apikey': ANON_KEY };
    if (session && session.access_token) {
      h['Authorization'] = 'Bearer ' + session.access_token;
    }
    return h;
  }

  // =========================================================================
  // CONNEXION
  // =========================================================================
  async function connexion(email, motDePasse) {
    var r = await fetchTimeout(URL_BASE + '/auth/v1/token?grant_type=password', {
      method:  'POST',
      headers: enTetesAnon(),
      body:    JSON.stringify({ email: String(email || '').trim().toLowerCase(), password: motDePasse })
    });

    var data = await r.json().catch(function () { return {}; });

    if (!r.ok) {
      // Message volontairement générique : ne pas révéler si l'email existe.
      throw new Error(
        data.error_description === 'Email not confirmed'
          ? 'Compte non confirmé. Vérifiez votre boîte mail.'
          : 'Identifiant ou mot de passe incorrect.'
      );
    }

    ecrireSession({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Date.now() + (data.expires_in || 3600) * 1000,
      user:          data.user
    });

    await chargerProfil();
    programmerRefresh();
    return profil;
  }

  // =========================================================================
  // PROFIL (organisation + rôle)
  // =========================================================================
  async function chargerProfil() {
    if (!session) { profil = null; return null; }

    var url = URL_BASE + '/rest/v1/membres'
            + '?select=user_id,organisation_id,nom,role,actif,organisations(slug,nom,plan,actif,expire_le)'
            + '&actif=eq.true&limit=1';

    var r = await fetchTimeout(url, { headers: enTetes() });
    if (!r.ok) throw new Error('Profil inaccessible (' + r.status + ').');

    var rows = await r.json();
    if (!rows.length) {
      await deconnexion();
      throw new Error('Ce compte n\'est rattaché à aucune boutique. Contactez votre administrateur.');
    }

    var m   = rows[0];
    var org = m.organisations || {};

    if (org.actif === false) {
      await deconnexion();
      throw new Error('Cette boutique est suspendue.');
    }
    if (org.expire_le && org.expire_le < new Date().toISOString().slice(0, 10)) {
      await deconnexion();
      throw new Error('L\'abonnement de cette boutique a expiré.');
    }

    profil = {
      user_id:         m.user_id,
      organisation_id: m.organisation_id,
      nom:             m.nom,
      role:            m.role,
      org_slug:        org.slug,
      org_nom:         org.nom,
      org_plan:        org.plan
    };
    return profil;
  }

  // =========================================================================
  // RAFRAÎCHISSEMENT DU JETON
  // =========================================================================
  async function rafraichir() {
    var s = session || lireSession();
    if (!s || !s.refresh_token) return null;

    var r = await fetchTimeout(URL_BASE + '/auth/v1/token?grant_type=refresh_token', {
      method:  'POST',
      headers: enTetesAnon(),
      body:    JSON.stringify({ refresh_token: s.refresh_token })
    });

    if (!r.ok) { await deconnexion(); return null; }

    var data = await r.json();
    ecrireSession({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Date.now() + (data.expires_in || 3600) * 1000,
      user:          data.user || s.user
    });
    programmerRefresh();
    return session;
  }

  function programmerRefresh() {
    if (timerRefresh) clearTimeout(timerRefresh);
    if (!session) return;
    var delai = Math.max(5000, session.expires_at - Date.now() - MARGE_REFRESH_MS);
    timerRefresh = setTimeout(function () { rafraichir(); }, delai);
  }

  /** Restaure une session au chargement de la page. */
  async function restaurer() {
    var s = lireSession();
    if (!s) return null;
    session = s;

    if (Date.now() >= s.expires_at - MARGE_REFRESH_MS) {
      if (!await rafraichir()) return null;
    }
    try {
      await chargerProfil();
      programmerRefresh();
      return profil;
    } catch (e) {
      await deconnexion();
      return null;
    }
  }

  // =========================================================================
  // DÉCONNEXION
  // =========================================================================
  async function deconnexion() {
    if (timerRefresh) { clearTimeout(timerRefresh); timerRefresh = null; }
    if (session && session.access_token) {
      try {
        await fetchTimeout(URL_BASE + '/auth/v1/logout', {
          method: 'POST', headers: enTetes()
        }, 5000);
      } catch (e) { /* le jeton expirera de lui-même */ }
    }
    ecrireSession(null);
    profil = null;
  }

  // =========================================================================
  // CHANGEMENT DE MOT DE PASSE
  // =========================================================================
  async function changerMotDePasse(nouveau) {
    if (!session) throw new Error('Non connecté.');
    if (!nouveau || nouveau.length < 12) {
      throw new Error('Le mot de passe doit faire au moins 12 caractères.');
    }
    var r = await fetchTimeout(URL_BASE + '/auth/v1/user', {
      method:  'PUT',
      headers: enTetes(),
      body:    JSON.stringify({ password: nouveau })
    });
    if (!r.ok) throw new Error('Changement refusé (' + r.status + ').');
    return true;
  }

  // =========================================================================
  // API PUBLIQUE
  // =========================================================================
  // Note : ces accesseurs servent à l'affichage (masquer un bouton, etc.).
  // Ils ne protègent rien par eux-mêmes — l'autorisation réelle est appliquée
  // par les policies RLS dans PostgreSQL.
  global.Auth = {
    connexion:         connexion,
    deconnexion:       deconnexion,
    restaurer:         restaurer,
    rafraichir:        rafraichir,
    chargerProfil:     chargerProfil,
    changerMotDePasse: changerMotDePasse,
    enTetes:           enTetes,
    profil:            function () { return profil; },
    connecte:          function () { return !!(session && profil); },
    role:              function () { return profil ? profil.role : null; },
    orgId:             function () { return profil ? profil.organisation_id : null; },
    orgSlug:           function () { return profil ? profil.org_slug : null; },
    estAdmin:          function () { return !!profil && (profil.role === 'admin' || profil.role === 'proprietaire'); },
    aRole:             function () {
      if (!profil) return false;
      return Array.prototype.indexOf.call(arguments, profil.role) !== -1;
    }
  };

})(window);
