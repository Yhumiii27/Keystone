// Columns of Keystone's pub_ views published or extended in delivery 9 (migrations 0038_share_followup, 0040_share_installed_base,
// 0046_catalogue_share, 0050_capex_needs_share, 0052_internal_client_share;
// docs/delivery-9/notes-share-views.md), in order: the contracts the readers (Crucible, Arche, Matrix) rely on. A column is never removed, renamed or moved; new ones go
// at the end. Checked by src/server/db/share-views.test.ts (PGlite) and scripts/db-check.ts (also on PostgreSQL, --postgres).
export const SHARE_VIEW_COLUMNS: Record<string, string[]> = {
  pub_jalons: ['projet_code', 'jalon_id', 'nom', 'position', 'mois_reference', 'mois_prevu', 'statut', 'activite_code', 'date_fin_activite', 'maj_le'],
  pub_projets: [
    'code', 'numero', 'code_analytique', 'nature', 'nom', 'client_id', 'client', 'client_code3', 'phase_code', 'phase', 'imputable', 'chef_projet_matricule',
    'chef_projet_nom', 'ville', 'pays', 'fournisseurs', 'maj_le', 'capex_code', 'besoin_ref',
    // R-190 (0052_internal_client_share): the client is a group subsidiary, and its code.
    'client_interne', 'filiale_code',
  ],
  pub_livrables: ['project_code', 'number', 'title', 'status', 'type', 'accepte_le', 'maj_le'],
  pub_jalons_projets: ['projet_code', 'jalon_code', 'prevu_le', 'reference_le', 'reel_le', 'maj_le'],
  pub_avancement_projets: [
    'projet_code', 'date_situation', 'avancement_physique_pct', 'spi', 'fin_prevue_le', 'montant_contrat_keur', 'montant_avenants_keur', 'facture_keur', 'maj_le',
  ],
  pub_avenants: ['projet_code', 'numero', 'objet', 'montant_keur', 'delai_jours', 'statut', 'signe_le', 'maj_le'],
  pub_reserves: ['projet_code', 'numero', 'categorie', 'origine', 'statut', 'responsable', 'ouverte_le', 'levee_le', 'maj_le'],
  // D12 v1 (0035_share) + Arche K-07 (R-193, 0040_share_installed_base) at the end.
  pub_parc_machines: [
    'number', 'name', 'client_name', 'site_text', 'project_code', 'warranty_status', 'part_ref', 'fitted_revision', 'type_machine_code', 'livree_le', 'maj_le',
  ],
  // Arche K-01 (R-186, 0046_catalogue_share): the machine catalogue, one row per code and version, drafts never published.
  pub_catalogue_machines: [
    'code', 'version', 'type_code', 'type_libelle', 'variante', 'libelle', 'description', 'options', 'capacite_nominale', 'unite_capacite', 'prix_indicatif_keur',
    'delai_type_semaines', 'statut', 'maj_le',
  ],
  // Arche K-02 / K-03 / K-10 (R-187, 0050_capex_needs_share): Keystone's answers to the subsidiaries' machine needs, one row per answer.
  pub_reponses_besoins: [
    'besoin_ref', 'capex_code', 'numero', 'nature', 'qualification', 'motif', 'classe_estimation', 'montant_central_keur', 'montant_bas_keur', 'montant_haut_keur',
    'delai_semaines', 'valide_jusqu_au', 'document_ref', 'projet_code', 'statut', 'repondu_le', 'maj_le',
  ],
};

/** K-01 column types of pub_catalogue_machines (information_schema data_type), in contract order. */
export const CATALOGUE_VIEW_TYPES: Record<string, string> = {
  code: 'text', version: 'integer', type_code: 'text', type_libelle: 'text', variante: 'text', libelle: 'text', description: 'text', options: 'jsonb',
  capacite_nominale: 'numeric', unite_capacite: 'text', prix_indicatif_keur: 'numeric', delai_type_semaines: 'integer', statut: 'text',
  maj_le: 'timestamp with time zone',
};

/** K-02 column types of pub_reponses_besoins (information_schema data_type), in contract order. */
export const REPONSES_VIEW_TYPES: Record<string, string> = {
  besoin_ref: 'text', capex_code: 'text', numero: 'text', nature: 'text', qualification: 'text', motif: 'text', classe_estimation: 'text',
  montant_central_keur: 'numeric', montant_bas_keur: 'numeric', montant_haut_keur: 'numeric', delai_semaines: 'integer', valide_jusqu_au: 'date', document_ref: 'text',
  projet_code: 'text', statut: 'text', repondu_le: 'timestamp with time zone', maj_le: 'timestamp with time zone',
};

/** Number of Keystone's pub_ views (0035_share: 12, 0038_share_followup: 5, 0046_catalogue_share: 1, 0050_capex_needs_share: 1). */
export const SHARE_VIEW_COUNT = 19;

/**
 * Arche K-11 (R-193): indexes on the source column of `maj_le` for the views whose `maj_le` is one column of a growing table, so
 * an incremental read (`where maj_le > …`) reaches the index through the security_barrier view (docs/delivery-9/notes-share-views.md § 8).
 */
export const SHARE_MAJ_LE_INDEXES: Record<string, { table: string; index: string }> = {
  pub_livrables: { table: 'deliverables', index: 'deliverables_updated_at_idx' },
  pub_reserves: { table: 'punch_items', index: 'punch_items_updated_at_idx' },
  // R-186 (0045_machine_catalogue): Arche K-01 + K-11.
  pub_catalogue_machines: { table: 'machine_catalogue_entries', index: 'machine_catalogue_entries_updated_at_idx' },
  // R-187 (0049_capex_needs): Arche K-02 + K-11.
  pub_reponses_besoins: { table: 'need_answers', index: 'need_answers_updated_at_idx' },
};


/**
 * Arche's open question P-05 / AC-2: a column name that would carry an internal cost, a rate, an actual cost, a CPI, an EAC, a
 * budget or a margin — none may appear in pub_avancement_projets (nor in the table behind it).
 */
export const INTERNAL_MONEY_COLUMN = /(cout|cost|taux|rate|reel|actual|cpi|eac|budget|bac|marge|margin|ac_keur)/i;
