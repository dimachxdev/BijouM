/**
 * MARJAN BIJOUTERIE v4 — Données complètes
 * Ajouts : Historique connexions
 */

// ============================================
// COMPTES UTILISATEURS & RÔLES
// ============================================
const ROLES = {
  admin:        { label: 'Administrateur',    color: '#534ab7', bg: '#eeedfe' },
  gestionnaire: { label: 'Gestionnaire Stock',color: '#0f6e56', bg: '#e1f5ee' },
  vendeur:      { label: 'Vendeur',           color: '#854f0b', bg: '#faeeda' },
};

const INITIAL_USERS = [
  { id:'U-001', nom:'Administrateur Principal', login:'admin',   password:'admin123',   role:'admin',         actif:true },
  { id:'U-002', nom:'Gestionnaire Stock',        login:'stock',   password:'stock123',   role:'gestionnaire',  actif:true },
  { id:'U-003', nom:'Vendeur',                   login:'vendeur', password:'vendeur123', role:'vendeur',       actif:true },
];

// Permissions par rôle
const PERM_MAP = {
  admin:        ['all','journal','stocks','achats','sorties','decaissements','clients','compte_client','bijou_arr','historique','parametres'],
  gestionnaire: ['journal','stocks','achats','clients','compte_client','bijou_arr'],
  vendeur:      ['journal','clients','compte_client','bijou_arr'],
};

// ============================================
// HISTORIQUE DES CONNEXIONS (initial vide)
// ============================================
const INITIAL_CONNEXIONS = [
  { id:'CN-001', userId:'U-001', nom:'Administrateur Principal', role:'admin',         date:'2026-03-28', heure:'08:14', action:'connexion',    ip:'192.168.1.10' },
  { id:'CN-002', userId:'U-003', nom:'Vendeur',                   role:'vendeur',        date:'2026-03-28', heure:'08:32', action:'connexion',    ip:'192.168.1.12' },
  { id:'CN-003', userId:'U-003', nom:'Vendeur',                   role:'vendeur',        date:'2026-03-28', heure:'18:01', action:'déconnexion',  ip:'192.168.1.12' },
  { id:'CN-004', userId:'U-002', nom:'Gestionnaire Stock',        role:'gestionnaire',   date:'2026-03-29', heure:'09:05', action:'connexion',    ip:'192.168.1.11' },
  { id:'CN-005', userId:'U-001', nom:'Administrateur Principal', role:'admin',          date:'2026-03-29', heure:'09:20', action:'connexion',    ip:'192.168.1.10' },
  { id:'CN-006', userId:'U-002', nom:'Gestionnaire Stock',        role:'gestionnaire',   date:'2026-03-29', heure:'17:45', action:'déconnexion',  ip:'192.168.1.11' },
  { id:'CN-007', userId:'U-001', nom:'Administrateur Principal', role:'admin',          date:'2026-04-01', heure:'07:58', action:'connexion',    ip:'192.168.1.10' },
];

// ============================================
// CARATS
// ============================================
const CARATS_LIST = [
  { code:'24k',       label:'24k — Or pur',         purete:'999/1000', couleur:'#FFD700', type:'or',        desc:'Or pur. Lingots, pièces de collection.' },
  { code:'22k',       label:'22k — Or jaune pur',    purete:'916/1000', couleur:'#FFC800', type:'or',        desc:'Très pur. Bijoux africains et indiens traditionnels.' },
  { code:'21k',       label:'21k — Or jaune',        purete:'875/1000', couleur:'#FFBF00', type:'or',        desc:'Bijoux du Moyen-Orient, bagues et colliers.' },
  { code:'18k',       label:'18k — Or jaune 750',    purete:'750/1000', couleur:'#FFB347', type:'or',        desc:'Standard international. Alliances, colliers, bracelets.' },
  { code:'16k',       label:'16k — Or jaune',        purete:'666/1000', couleur:'#FFA500', type:'or',        desc:'Bijoux intermédiaires, bagues et pendentifs.' },
  { code:'14k',       label:'14k — Or jaune 585',    purete:'585/1000', couleur:'#FF9500', type:'or',        desc:'Populaire. Bijoux fantaisie et quotidiens.' },
  { code:'10k',       label:'10k — Or jaune',        purete:'417/1000', couleur:'#FF8C00', type:'or',        desc:'Bijoux tendance, accessoires mode.' },
  { code:'9k',        label:'9k — Or jaune',         purete:'375/1000', couleur:'#FF7F00', type:'or',        desc:'Minimum légal. Bijoux d\'entrée de gamme.' },
  { code:'18k-blanc', label:'18k — Or blanc',        purete:'750/1000', couleur:'#C8C8C8', type:'or-blanc',  desc:'Bagues serties de diamants, bijoux modernes.' },
  { code:'14k-blanc', label:'14k — Or blanc',        purete:'585/1000', couleur:'#B8B8B8', type:'or-blanc',  desc:'Boucles d\'oreilles, pendentifs courants.' },
  { code:'18k-rose',  label:'18k — Or rose',         purete:'750/1000', couleur:'#E8A090', type:'or-rose',   desc:'Bagues de fiançailles, bijoux romantiques.' },
  { code:'14k-rose',  label:'14k — Or rose',         purete:'585/1000', couleur:'#D4907A', type:'or-rose',   desc:'Bracelets, colliers, boucles d\'oreilles.' },
  { code:'925',       label:'925 — Argent sterling', purete:'925/1000', couleur:'#B0C0C8', type:'argent',    desc:'Standard argent. Toutes catégories.' },
  { code:'800',       label:'800 — Argent 800',       purete:'800/1000', couleur:'#A0B0B8', type:'argent',    desc:'Bijoux africains, couverts, décoratifs.' },
  { code:'plaque-or', label:'Plaqué or',             purete:'plaqué',   couleur:'#F0C040', type:'plaque',    desc:'Accessoires mode, fantaisie, prix accessible.' },
  { code:'fantaisie', label:'Fantaisie',             purete:'—',        couleur:'#A0A0A0', type:'fantaisie', desc:'Sans métal précieux. Bijoux de mode.' },
];

// ============================================
// CLIENTS
// ============================================
const INITIAL_CLIENTS = [
  { id:'CL-001', nom:'Aminata Diallo',    tel:'77 123 45 67', email:'aminata@mail.com',  adresse:'Plateau, Dakar' },
  { id:'CL-002', nom:'Fatou Ndiaye',      tel:'76 234 56 78', email:'fatou@mail.com',    adresse:'Medina, Dakar' },
  { id:'CL-003', nom:'Ibrahima Sow',      tel:'70 345 67 89', email:'',                  adresse:'Thiès' },
  { id:'CL-004', nom:'Marie-Claire Fall', tel:'78 456 78 90', email:'mclaire@mail.com',  adresse:'Fann, Dakar' },
  { id:'CL-005', nom:'Oumar Ba',          tel:'77 567 89 01', email:'',                  adresse:'Pikine' },
  { id:'CL-006', nom:'Rokhaya Dièye',     tel:'76 678 90 12', email:'rokhaya@mail.com',  adresse:'Almadies, Dakar' },
  { id:'CL-007', nom:'Moussa Traoré',     tel:'77 789 01 23', email:'',                  adresse:'Rufisque' },
  { id:'CL-008', nom:'Aïssatou Camara',   tel:'70 890 12 34', email:'aissatou@mail.com', adresse:'Liberté 6, Dakar' },
  { id:'CL-009', nom:'Awa Ndiaye',        tel:'77 901 23 45', email:'',                  adresse:'Grand Yoff, Dakar' },
];

// ============================================
// VENTES (Journal)
// ============================================
const INITIAL_VENTES = [
  { id:'V-0001', date:'2026-02-02', client:'Awa Ndiaye',        description:'Achat + reprise vice en or',         local:0.5, importe:0,   carat:'18k',       montant:185000, acompte:100000, restant:85000 },
  { id:'V-0002', date:'2026-02-05', client:'Fatou Ndiaye',      description:'Fabrication bague diamant solitaire', local:0,   importe:2.1, carat:'18k-blanc', montant:320000, acompte:320000, restant:0 },
  { id:'V-0003', date:'2026-02-10', client:'Ibrahima Sow',      description:'Achat bracelet argent 925',           local:12,  importe:0,   carat:'925',       montant:48000,  acompte:48000,  restant:0 },
  { id:'V-0004', date:'2026-02-14', client:'Marie-Claire Fall', description:'Boucles d\'oreilles or jaune 18k',    local:0,   importe:1.8, carat:'18k',       montant:95000,  acompte:50000,  restant:45000 },
  { id:'V-0005', date:'2026-02-18', client:'Oumar Ba',          description:'Réparation montre + bracelet plaqué', local:0,   importe:0,   carat:'plaque-or', montant:25000,  acompte:25000,  restant:0 },
  { id:'V-0006', date:'2026-02-20', client:'Rokhaya Dièye',     description:'Alliance or blanc 18k — paire',       local:0,   importe:4.5, carat:'18k-blanc', montant:380000, acompte:200000, restant:180000 },
  { id:'V-0007', date:'2026-02-25', client:'Aminata Diallo',    description:'Collier or 22k traditionnel',         local:8.2, importe:0,   carat:'22k',       montant:420000, acompte:420000, restant:0 },
  { id:'V-0008', date:'2026-03-03', client:'Moussa Traoré',     description:'Chevalière or jaune 18k homme',       local:0,   importe:3.2, carat:'18k',       montant:185000, acompte:100000, restant:85000 },
  { id:'V-0009', date:'2026-03-07', client:'Aïssatou Camara',   description:'Pendentif cœur or rose 18k',          local:0,   importe:1.4, carat:'18k-rose',  montant:95000,  acompte:95000,  restant:0 },
  { id:'V-0010', date:'2026-03-15', client:'Aminata Diallo',    description:'Réparation chaîne or 18k',            local:0.3, importe:0,   carat:'18k',       montant:15000,  acompte:15000,  restant:0 },
  { id:'V-0011', date:'2026-03-18', client:'Rokhaya Dièye',     description:'Parure mariée complète or 21k',       local:0,   importe:22,  carat:'21k',       montant:850000, acompte:500000, restant:350000 },
  { id:'V-0012', date:'2026-03-28', client:'Awa Ndiaye',        description:'Bracelet or rose 14k',                local:0,   importe:1.1, carat:'14k-rose',  montant:68000,  acompte:30000,  restant:38000 },
];

// ============================================
// STOCK
// ============================================
const INITIAL_STOCK = [
  { ref:'BJX-0001', nom:'Collier or 22k traditionnel',  carat:'22k',       type:'importe', poids:8.5,  qty:3, prix:420000, seuil:2 },
  { ref:'BJX-0002', nom:'Bague diamant or blanc 18k',   carat:'18k-blanc', type:'importe', poids:2.1,  qty:2, prix:320000, seuil:2 },
  { ref:'BJX-0003', nom:'Bracelet argent 925',          carat:'925',       type:'local',   poids:12,   qty:8, prix:48000,  seuil:5 },
  { ref:'BJX-0004', nom:'Boucles d\'oreilles or 18k',   carat:'18k',       type:'importe', poids:1.8,  qty:5, prix:95000,  seuil:3 },
  { ref:'BJX-0005', nom:'Alliance or blanc 18k',        carat:'18k-blanc', type:'importe', poids:2.2,  qty:0, prix:190000, seuil:2 },
  { ref:'BJX-0006', nom:'Pendentif cœur or rose 18k',   carat:'18k-rose',  type:'importe', poids:1.4,  qty:4, prix:95000,  seuil:3 },
  { ref:'BJX-0007', nom:'Chevalière or 18k homme',      carat:'18k',       type:'importe', poids:3.2,  qty:3, prix:185000, seuil:2 },
  { ref:'BJX-0008', nom:'Bracelet jonc argent 925',     carat:'925',       type:'local',   poids:18,   qty:6, prix:32000,  seuil:4 },
  { ref:'BJX-0009', nom:'Parure mariée or 21k',         carat:'21k',       type:'importe', poids:22,   qty:1, prix:850000, seuil:1 },
  { ref:'BJX-0010', nom:'Collier or 18k classique',     carat:'18k',       type:'importe', poids:5.5,  qty:4, prix:285000, seuil:2 },
  { ref:'BJX-0011', nom:'Bracelet or rose 14k',         carat:'14k-rose',  type:'importe', poids:1.1,  qty:3, prix:68000,  seuil:2 },
  { ref:'BJX-0012', nom:'Bague argent 925 gravée',      carat:'925',       type:'local',   poids:9,    qty:7, prix:28000,  seuil:4 },
];

// ============================================
// SORTIES DE STOCK
// ============================================
const INITIAL_SORTIES = [
  { id:'S-0001', date:'2026-02-15', ref:'BJX-0003', article:'Bracelet argent 925',       qty:2, motif:'Don association',         commentaire:'', validePar:'admin' },
  { id:'S-0002', date:'2026-03-01', ref:'BJX-0007', article:'Chevalière or 18k homme',   qty:1, motif:'Casse / défaut fabrication', commentaire:'', validePar:'admin' },
];

// ============================================
// DÉCAISSEMENTS
// ============================================
const CATEGORIES_DECAISSEMENT = [
  'Dépenses fournisseurs / achats',
  'Salaires et charges',
  'Loyer',
  'Électricité / Eau',
  'Transport et livraison',
  'Entretien et réparations',
  'Remboursement client',
  'Frais divers',
];

const INITIAL_DECAISSEMENTS = [
  { id:'D-0001', date:'2026-02-10', categorie:'Loyer',                      description:'Loyer boutique — Février 2026', montant:150000, saisiPar:'admin' },
  { id:'D-0002', date:'2026-02-28', categorie:'Salaires et charges',        description:'Salaires employés — Février',   montant:280000, saisiPar:'admin' },
  { id:'D-0003', date:'2026-03-05', categorie:'Dépenses fournisseurs / achats', description:'Achat matériaux soudure',  montant:45000,  saisiPar:'admin' },
  { id:'D-0004', date:'2026-03-10', categorie:'Électricité / Eau',          description:'Facture électricité — Mars',    montant:28000,  saisiPar:'admin' },
  { id:'D-0005', date:'2026-03-15', categorie:'Transport et livraison',     description:'Livraison commande client',     montant:5000,   saisiPar:'vendeur' },
];

// ============================================
// ACHATS
// ============================================
const INITIAL_ACHATS = [
  { id:'A-0001', date:'2026-01-20', fournisseur:'Diallo Orpaillage',   description:'Lot or brut 22k',          carat:'22k',       poids:45,  prixUnitaire:28000, montantTotal:1260000, saisiPar:'admin' },
  { id:'A-0002', date:'2026-02-03', fournisseur:'Bijoux Import Dakar', description:'Parures or blanc 18k x3',  carat:'18k-blanc', poids:6.6, prixUnitaire:52000, montantTotal:343200,  saisiPar:'gestionnaire' },
  { id:'A-0003', date:'2026-02-18', fournisseur:'Diallo Orpaillage',   description:'Or local brut 18k',        carat:'18k',       poids:20,  prixUnitaire:30000, montantTotal:600000,  saisiPar:'admin' },
  { id:'A-0004', date:'2026-03-08', fournisseur:'Argent Pro Sénégal',  description:'Argent 925 — barres 500g', carat:'925',       poids:500, prixUnitaire:1200,  montantTotal:600000,  saisiPar:'gestionnaire' },
];

// ============================================
// COMPTES CLIENTS (épargne)
// ============================================
const INITIAL_COMPTES_CLIENTS = [
  { id:'CC-001', client:'Aminata Diallo', dateOuverture:'2026-01-15', solde:250000, objectif:420000, objetCible:'Collier or 22k traditionnel (BJX-0001)', actif:true,
    mouvements:[{date:'2026-01-15',type:'depot',montant:100000,note:'Ouverture compte'},{date:'2026-02-01',type:'depot',montant:100000,note:'Dépôt mensuel'},{date:'2026-03-01',type:'depot',montant:50000,note:'Dépôt mensuel'}] },
  { id:'CC-002', client:'Fatou Ndiaye',   dateOuverture:'2026-02-01', solde:180000, objectif:320000, objetCible:'Bague diamant or blanc 18k (BJX-0002)',  actif:true,
    mouvements:[{date:'2026-02-01',type:'depot',montant:100000,note:'Ouverture compte'},{date:'2026-03-01',type:'depot',montant:80000,note:'Dépôt mensuel'}] },
];

// ============================================
// BIJOUX EN ARRHES
// ============================================
const INITIAL_BIJOUX_ARR = [
  { id:'BA-0001', date:'2026-03-10', client:'Rokhaya Dièye',     article:'BJX-0009 — Parure mariée or 21k',       prixTotal:850000, arrhesVerse:200000, restantDu:650000, dateEcheance:'2026-04-10', statut:'en_cours',
    mouvements:[{date:'2026-03-10',montant:200000,note:'Arrhes initiales'}] },
  { id:'BA-0002', date:'2026-02-20', client:'Marie-Claire Fall', article:'BJX-0002 — Bague diamant or blanc 18k', prixTotal:320000, arrhesVerse:320000, restantDu:0,      dateEcheance:'2026-03-20', statut:'solde',
    mouvements:[{date:'2026-02-20',montant:150000,note:'Arrhes initiales'},{date:'2026-03-15',montant:170000,note:'Solde final'}] },
];

// ============================================
// ACHATS DEPUIS CLIENTS (rachat bijoux)
// ============================================
const INITIAL_ACHATS_CLIENTS = [
  { id:'AC-0001', date:'2026-02-12', client:'Ibrahima Sow',    description:'Rachat bracelet or 18k usagé', carat:'18k', poids:4.2, prixPropose:95000,  saisiPar:'admin' },
  { id:'AC-0002', date:'2026-03-05', client:'Oumar Ba',         description:'Rachat bague or 22k',          carat:'22k', poids:2.8, prixPropose:72000,  saisiPar:'admin' },
];
