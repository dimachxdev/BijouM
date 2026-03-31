/**
 * MARJAN BIJOUTERIE — Données initiales
 * Ce fichier contient les données de démarrage de l'application.
 * En production, ces données seront remplacées par celles sauvegardées
 * dans localStorage (chargées automatiquement par app.js).
 */

const INITIAL_STOCK = [
  { ref: 'BJX-0001', nom: 'Collier or 18k', cat: 'Or',         qty: 12, prix: 185000, seuil: 5 },
  { ref: 'BJX-0002', nom: 'Bague diamant solitaire',  cat: 'Diamants',  qty: 4,  prix: 320000, seuil: 5 },
  { ref: 'BJX-0003', nom: 'Bracelet argent 925',      cat: 'Argent',    qty: 24, prix: 24000,  seuil: 8 },
  { ref: 'BJX-0004', nom: 'Boucles d\'oreilles or',   cat: 'Or',        qty: 2,  prix: 95000,  seuil: 5 },
  { ref: 'BJX-0005', nom: 'Montre plaquée or',        cat: 'Montres',   qty: 0,  prix: 75000,  seuil: 3 },
  { ref: 'BJX-0006', nom: 'Pendentif cœur argent',    cat: 'Argent',    qty: 15, prix: 18000,  seuil: 5 },
  { ref: 'BJX-0007', nom: 'Alliance or 18k',          cat: 'Or',        qty: 6,  prix: 250000, seuil: 3 },
  { ref: 'BJX-0008', nom: 'Chaîne or 18k',            cat: 'Or',        qty: 3,  prix: 140000, seuil: 5 },
  { ref: 'BJX-0009', nom: 'Bague argent ornée',       cat: 'Argent',    qty: 18, prix: 15000,  seuil: 6 },
  { ref: 'BJX-0010', nom: 'Bracelet or homme',        cat: 'Or',        qty: 5,  prix: 195000, seuil: 3 },
  { ref: 'BJX-0011', nom: 'Chevalière or 18k',        cat: 'Or',        qty: 7,  prix: 210000, seuil: 3 },
  { ref: 'BJX-0012', nom: 'Collier perles',           cat: 'Accessoires', qty: 9, prix: 35000, seuil: 4 },
  { ref: 'BJX-0013', nom: 'Montre homme classique',   cat: 'Montres',   qty: 4,  prix: 120000, seuil: 2 },
  { ref: 'BJX-0014', nom: 'Parure mariée complète',   cat: 'Or',        qty: 2,  prix: 450000, seuil: 1 },
  { ref: 'BJX-0015', nom: 'Bracelet jonc argent',     cat: 'Argent',    qty: 11, prix: 22000,  seuil: 5 },
];

const INITIAL_CLIENTS = [
  { id: 'CL-001', nom: 'Aminata Diallo',    tel: '77 123 45 67', email: 'aminata@mail.com',    totalAchats: 1250000, nbVisites: 12, derniereVisite: new Date().toISOString().split('T')[0] },
  { id: 'CL-002', nom: 'Fatou Ndiaye',      tel: '76 234 56 78', email: 'fatou@mail.com',       totalAchats: 890000,  nbVisites: 8,  derniereVisite: new Date().toISOString().split('T')[0] },
  { id: 'CL-003', nom: 'Ibrahima Sow',      tel: '70 345 67 89', email: '',                      totalAchats: 430000,  nbVisites: 5,  derniereVisite: new Date().toISOString().split('T')[0] },
  { id: 'CL-004', nom: 'Marie-Claire Fall', tel: '78 456 78 90', email: 'mclaire@mail.com',     totalAchats: 680000,  nbVisites: 7,  derniereVisite: new Date().toISOString().split('T')[0] },
  { id: 'CL-005', nom: 'Oumar Ba',          tel: '77 567 89 01', email: '',                      totalAchats: 215000,  nbVisites: 3,  derniereVisite: new Date().toISOString().split('T')[0] },
  { id: 'CL-006', nom: 'Rokhaya Dièye',     tel: '76 678 90 12', email: 'rokhaya@mail.com',     totalAchats: 1650000, nbVisites: 18, derniereVisite: '2026-03-28' },
  { id: 'CL-007', nom: 'Moussa Traoré',     tel: '77 789 01 23', email: '',                      totalAchats: 540000,  nbVisites: 6,  derniereVisite: '2026-03-25' },
  { id: 'CL-008', nom: 'Aïssatou Camara',   tel: '70 890 12 34', email: 'aissatou@mail.com',    totalAchats: 320000,  nbVisites: 4,  derniereVisite: '2026-03-20' },
];

const INITIAL_VENTES = [
  { id: 'V-0831', article: 'Collier or 18k',           client: 'Aminata Diallo',   montant: 185000, paiement: 'Espèces',      datetime: new Date().toISOString() },
  { id: 'V-0830', article: 'Bague diamant solitaire',  client: 'Fatou Ndiaye',     montant: 320000, paiement: 'Wave',          datetime: new Date(Date.now() - 5400000).toISOString() },
  { id: 'V-0829', article: 'Bracelet argent 925 x2',   client: 'Ibrahima Sow',     montant: 48000,  paiement: 'Espèces',      datetime: new Date(Date.now() - 10800000).toISOString() },
  { id: 'V-0828', article: 'Boucles d\'oreilles or',   client: 'Marie-Claire Fall', montant: 95000, paiement: 'Orange Money', datetime: new Date(Date.now() - 18000000).toISOString() },
  { id: 'V-0827', article: 'Montre homme classique',   client: 'Oumar Ba',         montant: 120000, paiement: 'Espèces',      datetime: new Date(Date.now() - 25200000).toISOString() },
];

// Données du graphique hebdomadaire (7 jours)
const WEEKLY_DATA = [
  { jour: 'Lun', valeur: 40, montant: 1850000 },
  { jour: 'Mar', valeur: 55, montant: 2400000 },
  { jour: 'Mer', valeur: 35, montant: 1600000 },
  { jour: 'Jeu', valeur: 70, montant: 3100000 },
  { jour: 'Ven', valeur: 60, montant: 2750000 },
  { jour: 'Sam', valeur: 85, montant: 3850000 },
  { jour: 'Dim', valeur: 100, montant: 4500000 },
];

const TOP_PRODUITS = [
  { nom: 'Collier or 18k',        montant: 820000,  pct: 17 },
  { nom: 'Bague diamant',         montant: 650000,  pct: 13 },
  { nom: 'Bracelet argent',       montant: 480000,  pct: 10 },
  { nom: 'Boucles d\'oreilles',   montant: 310000,  pct: 6  },
  { nom: 'Montre plaquée or',     montant: 280000,  pct: 6  },
];

const CATEGORIES_DATA = [
  { cat: 'Or',          montant: 1950000, pct: 72 },
  { cat: 'Argent',      montant: 1120000, pct: 48 },
  { cat: 'Diamants',    montant: 890000,  pct: 38 },
  { cat: 'Montres',     montant: 520000,  pct: 22 },
  { cat: 'Accessoires', montant: 340000,  pct: 15 },
];
