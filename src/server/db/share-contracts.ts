// Columns of Keystone's pub_ views published in delivery 9 (migration 0038_share_followup; docs/delivery-9/notes-share-views.md),
// in order: the contracts the readers (Crucible, Arche, Matrix) rely on. A column is never removed, renamed or moved; new ones go
// at the end. Checked by src/server/db/share-views.test.ts (PGlite) and scripts/db-check.ts (also on PostgreSQL, --postgres).
export const SHARE_VIEW_COLUMNS: Record<string, string[]> = {
  pub_jalons: ['projet_code', 'jalon_id', 'nom', 'position', 'mois_reference', 'mois_prevu', 'statut', 'activite_code', 'date_fin_activite', 'maj_le'],
  pub_projets: [
    'code', 'numero', 'code_analytique', 'nature', 'nom', 'client_id', 'client', 'client_code3', 'phase_code', 'phase', 'imputable', 'chef_projet_matricule',
    'chef_projet_nom', 'ville', 'pays', 'fournisseurs', 'maj_le', 'capex_code', 'besoin_ref',
  ],
  pub_livrables: ['project_code', 'number', 'title', 'status', 'type', 'accepte_le', 'maj_le'],
  pub_jalons_projets: ['projet_code', 'jalon_code', 'prevu_le', 'reference_le', 'reel_le', 'maj_le'],
  pub_avancement_projets: [
    'projet_code', 'date_situation', 'avancement_physique_pct', 'spi', 'fin_prevue_le', 'montant_contrat_keur', 'montant_avenants_keur', 'facture_keur', 'maj_le',
  ],
  pub_avenants: ['projet_code', 'numero', 'objet', 'montant_keur', 'delai_jours', 'statut', 'signe_le', 'maj_le'],
  pub_reserves: ['projet_code', 'numero', 'categorie', 'origine', 'statut', 'responsable', 'ouverte_le', 'levee_le', 'maj_le'],
};


/**
 * Arche's open question P-05 / AC-2: a column name that would carry an internal cost, a rate, an actual cost, a CPI, an EAC, a
 * budget or a margin — none may appear in pub_avancement_projets (nor in the table behind it).
 */
export const INTERNAL_MONEY_COLUMN = /(cout|cost|taux|rate|reel|actual|cpi|eac|budget|bac|marge|margin|ac_keur)/i;
