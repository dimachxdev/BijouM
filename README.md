# 💎 Marjan Bijouterie — Système de Gestion

Application web complète de gestion pour bijouterie.  
Fonctionne **sans serveur**, directement dans le navigateur.

---

## 📁 Structure des fichiers

```
marjan-bijouterie/
├── index.html          ← Page principale (ouvrir en navigateur)
├── css/
│   └── style.css       ← Feuille de style
├── js/
│   ├── data.js         ← Données initiales
│   └── app.js          ← Logique de l'application
├── assets/
│   └── favicon.svg     ← Icône de l'onglet
└── README.md           ← Ce fichier
```

---

## 🚀 Déploiement

### Option 1 — Utilisation locale (immédiate, sans internet)
1. Télécharger et décompresser le dossier `marjan-bijouterie`
2. Double-cliquer sur `index.html`
3. L'application s'ouvre dans votre navigateur
4. ✅ Toutes les données sont sauvegardées automatiquement

### Option 2 — Hébergement gratuit sur Netlify (recommandé)
1. Créer un compte sur [netlify.com](https://netlify.com)
2. Glisser-déposer le dossier `marjan-bijouterie` dans l'interface Netlify
3. Votre application est en ligne en 1 minute
4. Vous obtenez une URL du type : `https://marjan-bijouterie.netlify.app`

### Option 3 — Hébergement sur GitHub Pages (gratuit)
1. Créer un compte sur [github.com](https://github.com)
2. Créer un nouveau dépôt public
3. Uploader tous les fichiers
4. Aller dans Settings > Pages > Source: main branch
5. URL disponible : `https://votre-nom.github.io/marjan-bijouterie`

### Option 4 — Serveur local avec Python
```bash
# Aller dans le dossier
cd marjan-bijouterie

# Lancer un serveur local (Python 3)
python3 -m http.server 8080

# Ouvrir dans le navigateur
# http://localhost:8080
```

### Option 5 — Serveur WAMP/XAMPP (Windows)
1. Installer [XAMPP](https://www.apachefriends.org/)
2. Copier le dossier dans `C:\xampp\htdocs\`
3. Démarrer Apache
4. Accéder via : `http://localhost/marjan-bijouterie`

---

## 💾 Sauvegarde des données

Les données sont sauvegardées automatiquement dans le **localStorage** du navigateur.  
Elles persistent entre les sessions sur le même appareil.

### Exporter une sauvegarde manuelle
Ouvrir la console du navigateur (F12) et taper :
```javascript
// Exporter toutes les données
const backup = {
  stock:   JSON.parse(localStorage.getItem('marjan_stock')),
  clients: JSON.parse(localStorage.getItem('marjan_clients')),
  ventes:  JSON.parse(localStorage.getItem('marjan_ventes')),
};
console.log(JSON.stringify(backup));
```

### Restaurer une sauvegarde
```javascript
// Coller les données sauvegardées
const backup = { /* coller ici */ };
localStorage.setItem('marjan_stock',   JSON.stringify(backup.stock));
localStorage.setItem('marjan_clients', JSON.stringify(backup.clients));
localStorage.setItem('marjan_ventes',  JSON.stringify(backup.ventes));
location.reload();
```

---

## ✨ Fonctionnalités

| Module | Fonctionnalités |
|---|---|
| **Tableau de bord** | CA mensuel, ventes du jour, graphique 7j, top produits, CA par catégorie |
| **Stocks** | Inventaire complet, recherche, ajout, ajustement quantité, alertes stock bas/rupture |
| **Ventes & Caisse** | Enregistrement vente, décrément automatique du stock, modes de paiement, export CSV |
| **Clients** | Fiche client, niveaux fidélité (Argent/Or/Platine), total achats, historique visites |

---

## 🛠 Personnalisation

### Modifier les données de départ
Éditer le fichier `js/data.js` pour changer le stock initial, les clients et les ventes.

### Modifier les couleurs
Éditer les variables CSS au début de `css/style.css` :
```css
:root {
  --bg-primary: #ffffff;   /* Fond principal */
  --text-primary: #1a1916; /* Texte principal */
  /* ... */
}
```

### Changer le nom de la bijouterie
Dans `index.html`, remplacer "Marjan Bijouterie" par le nom souhaité.

---

## 📱 Compatibilité

- Chrome / Edge / Safari / Firefox (versions récentes)
- Responsive : fonctionne sur tablette (sidebar réduite sur < 900px)
- Pas besoin de connexion internet après chargement initial

---

## 📞 Support

Pour toute question ou amélioration, contacter votre développeur.

---

*Système développé pour Marjan Bijouterie — Version 1.0 — Mars 2026*
