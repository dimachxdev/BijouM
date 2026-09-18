/**
 * MARJAN BIJOUTERIE v4 — Données complètes
 * Ajouts : Historique connexions
 */

// ============================================
// COMPTES UTILISATEURS & RÔLES
// ============================================
const ROLES = {
  proprietaire: { label: 'Propriétaire',      color: '#8a6d1f', bg: '#f7efd8' },
  admin:        { label: 'Administrateur',    color: '#534ab7', bg: '#eeedfe' },
  gestionnaire: { label: 'Gestionnaire Stock',color: '#0f6e56', bg: '#e1f5ee' },
  vendeur:      { label: 'Vendeur',           color: '#854f0b', bg: '#faeeda' },
};

// Les comptes de démonstration (admin/admin123…) ont été supprimés : ils
// étaient livrés en clair dans ce fichier, donc connus de quiconque a vu le
// code. L'identité est désormais gérée par Supabase Auth — voir
// migrations/004_migration_comptes.sql et 005_invitations.sql.

// Permissions par rôle
const PERM_MAP = {
  proprietaire: ['all','journal','stocks','sorties','decaissements','clients','compte_client','bijou_arr','historique','comptes_users','rapport_jour'],
  admin:        ['all','journal','stocks','sorties','decaissements','clients','compte_client','bijou_arr','historique','comptes_users','rapport_jour'],
  // `rapport_jour` retiré aux deux : il affiche le solde de caisse et le
  // détail des décaissements, réservés aux administrateurs.
  // `achats_clients` ouvert au vendeur : le serveur l'autorisait déjà à
  // enregistrer une reprise, seul l'onglet le masquait.
  gestionnaire: ['journal','stocks','achats_clients','clients','compte_client','bijou_arr'],
  vendeur:      ['journal','achats_clients','clients','compte_client','bijou_arr'],
};

// ============================================
// HISTORIQUE DES CONNEXIONS (initial vide)
// ============================================
const INITIAL_CONNEXIONS = [];

// ============================================
// CARATS
// ============================================
const CARATS_LIST = [
  { code:'14k-local',   label:'14 carats - Local',   purete:'585/1000', couleur:'#FF9500', origine:'local'   },
  { code:'18k-local',   label:'18 carats - Local',   purete:'750/1000', couleur:'#FFB347', origine:'local'   },
  { code:'21k-local',   label:'21 carats - Local',   purete:'875/1000', couleur:'#FFC800', origine:'local'   },
  { code:'22k-local',   label:'22 carats - Local',   purete:'916/1000', couleur:'#FFD000', origine:'local'   },
  { code:'24k-local',   label:'24 carats - Local',   purete:'999/1000', couleur:'#FFD700', origine:'local'   },
  { code:'14k-importe', label:'14 carats - Importe',  purete:'585/1000', couleur:'#E8943A', origine:'importe' },
  { code:'18k-importe', label:'18 carats - Importe',  purete:'750/1000', couleur:'#FFA500', origine:'importe' },
  { code:'21k-importe', label:'21 carats - Importe',  purete:'875/1000', couleur:'#FFC000', origine:'importe' },
  { code:'22k-importe', label:'22 carats - Importe',  purete:'916/1000', couleur:'#FFCA00', origine:'importe' },
  { code:'24k-importe', label:'24 carats - Importe',  purete:'999/1000', couleur:'#FFD700', origine:'importe' },
];

// ============================================
// TYPES DE BIJOUX
// ============================================


const TYPES_BIJOUX = [
  { code:'or',          label:'Or',              hasOr: true  },
  { code:'raika',       label:'Raika',           hasOr: true  },
  { code:'extra',       label:'Extra',           hasOr: true  },
  { code:'argent',      label:'Argent',          hasOr: false },
  { code:'ndiakhass',   label:'Ndiakhass',       hasOr: false },
  { code:'argent-or',   label:'Argent Or',       hasOr: true  },
  { code:'pierre',      label:'Pierre precieuse',hasOr: false },
  { code:'argent-dore', label:'Argent dore',     hasOr: false },
  { code:'marcasite',   label:'Marcasite',       hasOr: false },
];

// Types qui permettent de choisir local/importe/carat
const TYPES_AVEC_OR = ['or','raika','extra','argent-or'];

// ============================================
// CLIENTS
// ============================================
const INITIAL_CLIENTS = [];

// ============================================
// VENTES (Journal)
// ============================================
const INITIAL_VENTES = [];

// ============================================
// STOCK
// ============================================
const INITIAL_STOCK = [];

// ============================================
// SORTIES DE STOCK
// ============================================
const INITIAL_SORTIES = [];

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

const INITIAL_DECAISSEMENTS = [];

// ============================================
// COMPTES CLIENTS (épargne)
// ============================================
const INITIAL_COMPTES_CLIENTS = [];

// ============================================
// BIJOUX EN ARRHES
// ============================================
const INITIAL_BIJOUX_ARR = [];

// ============================================
// ACHATS DEPUIS CLIENTS (rachat bijoux)
// ============================================
const INITIAL_ACHATS_CLIENTS = [];
