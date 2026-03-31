/**
 * MARJAN BIJOUTERIE — Données v2
 * Intègre le format complet du Journal des Ventes :
 * Date, Client, Description, Local(g), Importé(g), Carat, Montant, Acompte, Restant, Cumul
 */

// ============================================
// LISTE DES CARATS — avec description du type de bijou
// ============================================
const CARATS_LIST = [
  // Or jaune classique
  { code: '24k',   label: '24k — Or pur',             purete: '999/1000', couleur: '#FFD700', type: 'or', desc: 'Or pur 24 carats. Utilisé pour les lingots, pièces de collection.' },
  { code: '22k',   label: '22k — Or jaune pur',        purete: '916/1000', couleur: '#FFC800', type: 'or', desc: 'Très pur. Bracelets, colliers et bijoux indiens/africains traditionnels.' },
  { code: '21k',   label: '21k — Or jaune',            purete: '875/1000', couleur: '#FFBF00', type: 'or', desc: 'Or 21 carats. Bijoux du Moyen-Orient, bagues et colliers.' },
  { code: '18k',   label: '18k — Or jaune 750',        purete: '750/1000', couleur: '#FFB347', type: 'or', desc: 'Standard international. Alliances, bagues, colliers, bracelets haut de gamme.' },
  { code: '16k',   label: '16k — Or jaune',            purete: '666/1000', couleur: '#FFA500', type: 'or', desc: 'Or 16 carats. Bijoux intermédiaires, bagues et pendentifs.' },
  { code: '14k',   label: '14k — Or jaune 585',        purete: '585/1000', couleur: '#FF9500', type: 'or', desc: 'Populaire en Europe et Amérique. Bijoux fantaisie et quotidiens.' },
  { code: '10k',   label: '10k — Or jaune',            purete: '417/1000', couleur: '#FF8C00', type: 'or', desc: 'Or 10 carats. Bijoux tendance, accessoires mode.' },
  { code: '9k',    label: '9k — Or jaune',             purete: '375/1000', couleur: '#FF7F00', type: 'or', desc: 'Minimum légal dans plusieurs pays. Bijoux d\'entrée de gamme.' },
  // Or blanc
  { code: '18k-blanc',  label: '18k — Or blanc',       purete: '750/1000', couleur: '#E8E8E8', type: 'or-blanc', desc: 'Or blanc 18k. Bagues, alliances sertie de diamants, bijoux modernes.' },
  { code: '14k-blanc',  label: '14k — Or blanc',       purete: '585/1000', couleur: '#D8D8D8', type: 'or-blanc', desc: 'Or blanc 14k. Bijoux courants, boucles d\'oreilles, pendentifs.' },
  // Or rose
  { code: '18k-rose',   label: '18k — Or rose',        purete: '750/1000', couleur: '#E8A090', type: 'or-rose', desc: 'Or rose 18k. Bagues de fiançailles, bijoux romantiques et tendance.' },
  { code: '14k-rose',   label: '14k — Or rose',        purete: '585/1000', couleur: '#D4907A', type: 'or-rose', desc: 'Or rose 14k. Bracelets, colliers, boucles d\'oreilles.' },
  // Argent
  { code: '925',   label: '925 — Argent sterling',     purete: '925/1000', couleur: '#C0C0C0', type: 'argent', desc: 'Argent sterling standard. Toutes catégories de bijoux.' },
  { code: '800',   label: '800 — Argent 800',          purete: '800/1000', couleur: '#B0B0B0', type: 'argent', desc: 'Argent 800. Couverts, objets décoratifs, bijoux africains.' },
  // Plaqué / Fantaisie
  { code: 'plaque-or', label: 'Plaqué or',             purete: 'plaqué',   couleur: '#F0C040', type: 'plaque', desc: 'Bijou plaqué or. Accessoires mode, fantaisie, prix accessible.' },
  { code: 'fantaisie',  label: 'Fantaisie',            purete: '—',        couleur: '#A0A0A0', type: 'fantaisie', desc: 'Bijou fantaisie sans métal précieux. Accessoires et bijoux de mode.' },
];

// ============================================
// DONNÉES INITIALES — Journal des Ventes
// ============================================
const INITIAL_VENTES = [
  {
    id: 'V-0001', date: '2026-02-02',
    client: 'Awa Ndiaye',
    description: 'Achat + reprise vice en or',
    local: 0.5, importe: 0, carat: '18k',
    montant: 185000, acompte: 100000, restant: 85000
  },
  {
    id: 'V-0002', date: '2026-02-05',
    client: 'Fatou Ndiaye',
    description: 'Fabrication bague diamant solitaire',
    local: 0, importe: 2.1, carat: '18k-blanc',
    montant: 320000, acompte: 320000, restant: 0
  },
  {
    id: 'V-0003', date: '2026-02-10',
    client: 'Ibrahima Sow',
    description: 'Achat bracelet argent 925',
    local: 12, importe: 0, carat: '925',
    montant: 48000, acompte: 48000, restant: 0
  },
  {
    id: 'V-0004', date: '2026-02-14',
    client: 'Marie-Claire Fall',
    description: 'Boucles d\'oreilles or jaune 18k',
    local: 0, importe: 1.8, carat: '18k',
    montant: 95000, acompte: 50000, restant: 45000
  },
  {
    id: 'V-0005', date: '2026-02-18',
    client: 'Oumar Ba',
    description: 'Réparation montre + bracelet plaqué or',
    local: 0, importe: 0, carat: 'plaque-or',
    montant: 25000, acompte: 25000, restant: 0
  },
  {
    id: 'V-0006', date: '2026-02-20',
    client: 'Rokhaya Dièye',
    description: 'Alliance or blanc 18k — paire',
    local: 0, importe: 4.5, carat: '18k-blanc',
    montant: 380000, acompte: 200000, restant: 180000
  },
  {
    id: 'V-0007', date: '2026-02-25',
    client: 'Aminata Diallo',
    description: 'Collier or 22k traditionnel',
    local: 8.2, importe: 0, carat: '22k',
    montant: 420000, acompte: 420000, restant: 0
  },
  {
    id: 'V-0008', date: '2026-03-03',
    client: 'Moussa Traoré',
    description: 'Chevalière or jaune 18k homme',
    local: 0, importe: 3.2, carat: '18k',
    montant: 185000, acompte: 100000, restant: 85000
  },
  {
    id: 'V-0009', date: '2026-03-07',
    client: 'Aïssatou Camara',
    description: 'Pendentif cœur or rose 18k',
    local: 0, importe: 1.4, carat: '18k-rose',
    montant: 95000, acompte: 95000, restant: 0
  },
  {
    id: 'V-0010', date: '2026-03-12',
    client: 'Fatou Ndiaye',
    description: 'Bracelet jonc argent sterling 925',
    local: 18, importe: 0, carat: '925',
    montant: 32000, acompte: 32000, restant: 0
  },
  {
    id: 'V-0011', date: '2026-03-15',
    client: 'Aminata Diallo',
    description: 'Réparation chaîne or 18k + nettoyage',
    local: 0.3, importe: 0, carat: '18k',
    montant: 15000, acompte: 15000, restant: 0
  },
  {
    id: 'V-0012', date: '2026-03-18',
    client: 'Rokhaya Dièye',
    description: 'Parure mariée complète or 21k',
    local: 0, importe: 22, carat: '21k',
    montant: 850000, acompte: 500000, restant: 350000
  },
  {
    id: 'V-0013', date: '2026-03-22',
    client: 'Ibrahima Sow',
    description: 'Bague argent 925 homme gravée',
    local: 9, importe: 0, carat: '925',
    montant: 28000, acompte: 28000, restant: 0
  },
  {
    id: 'V-0014', date: '2026-03-28',
    client: 'Marie-Claire Fall',
    description: 'Acompte collier or 22k — solde restant',
    local: 0, importe: 0, carat: '22k',
    montant: 45000, acompte: 45000, restant: 0
  },
  {
    id: 'V-0015', date: '2026-03-31',
    client: 'Awa Ndiaye',
    description: 'Bracelet or rose 14k fantaisie',
    local: 0, importe: 1.1, carat: '14k-rose',
    montant: 68000, acompte: 30000, restant: 38000
  },
];

// ============================================
// DONNÉES INITIALES — Clients
// ============================================
const INITIAL_CLIENTS = [
  { id: 'CL-001', nom: 'Aminata Diallo',    tel: '77 123 45 67', email: 'aminata@mail.com',  adresse: 'Plateau, Dakar' },
  { id: 'CL-002', nom: 'Fatou Ndiaye',      tel: '76 234 56 78', email: 'fatou@mail.com',    adresse: 'Medina, Dakar' },
  { id: 'CL-003', nom: 'Ibrahima Sow',      tel: '70 345 67 89', email: '',                   adresse: 'Thiès' },
  { id: 'CL-004', nom: 'Marie-Claire Fall', tel: '78 456 78 90', email: 'mclaire@mail.com',  adresse: 'Fann, Dakar' },
  { id: 'CL-005', nom: 'Oumar Ba',          tel: '77 567 89 01', email: '',                   adresse: 'Pikine' },
  { id: 'CL-006', nom: 'Rokhaya Dièye',     tel: '76 678 90 12', email: 'rokhaya@mail.com',  adresse: 'Almadies, Dakar' },
  { id: 'CL-007', nom: 'Moussa Traoré',     tel: '77 789 01 23', email: '',                   adresse: 'Rufisque' },
  { id: 'CL-008', nom: 'Aïssatou Camara',   tel: '70 890 12 34', email: 'aissatou@mail.com', adresse: 'Liberté 6, Dakar' },
  { id: 'CL-009', nom: 'Awa Ndiaye',        tel: '77 901 23 45', email: '',                   adresse: 'Grand Yoff, Dakar' },
];

// ============================================
// DONNÉES INITIALES — Stock
// ============================================
const INITIAL_STOCK = [
  { ref: 'BJX-0001', nom: 'Collier or 22k traditionnel',    carat: '22k',       type: 'importe', poids: 8.5,  qty: 3,  prix: 420000, seuil: 2 },
  { ref: 'BJX-0002', nom: 'Bague diamant or blanc 18k',     carat: '18k-blanc', type: 'importe', poids: 2.1,  qty: 2,  prix: 320000, seuil: 2 },
  { ref: 'BJX-0003', nom: 'Bracelet argent 925',            carat: '925',       type: 'local',   poids: 12,   qty: 8,  prix: 48000,  seuil: 5 },
  { ref: 'BJX-0004', nom: 'Boucles d\'oreilles or 18k',     carat: '18k',       type: 'importe', poids: 1.8,  qty: 5,  prix: 95000,  seuil: 3 },
  { ref: 'BJX-0005', nom: 'Alliance or blanc 18k',          carat: '18k-blanc', type: 'importe', poids: 2.2,  qty: 0,  prix: 190000, seuil: 2 },
  { ref: 'BJX-0006', nom: 'Pendentif cœur or rose 18k',     carat: '18k-rose',  type: 'importe', poids: 1.4,  qty: 4,  prix: 95000,  seuil: 3 },
  { ref: 'BJX-0007', nom: 'Chevalière or 18k homme',        carat: '18k',       type: 'importe', poids: 3.2,  qty: 3,  prix: 185000, seuil: 2 },
  { ref: 'BJX-0008', nom: 'Bracelet jonc argent 925',       carat: '925',       type: 'local',   poids: 18,   qty: 6,  prix: 32000,  seuil: 4 },
  { ref: 'BJX-0009', nom: 'Parure mariée or 21k',           carat: '21k',       type: 'importe', poids: 22,   qty: 1,  prix: 850000, seuil: 1 },
  { ref: 'BJX-0010', nom: 'Collier or 18k classique',       carat: '18k',       type: 'importe', poids: 5.5,  qty: 4,  prix: 285000, seuil: 2 },
  { ref: 'BJX-0011', nom: 'Bracelet or rose 14k',           carat: '14k-rose',  type: 'importe', poids: 1.1,  qty: 3,  prix: 68000,  seuil: 2 },
  { ref: 'BJX-0012', nom: 'Bague argent 925 gravée',        carat: '925',       type: 'local',   poids: 9,    qty: 7,  prix: 28000,  seuil: 4 },
];
