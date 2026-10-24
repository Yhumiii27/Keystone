# Livraison 9 — lot « classe d’estimation des budgets et des offres » (R-188)

Statut : construit sur la branche `r188-estimate-class` (depuis `8071f96`) le 24 oct. 2026, à la demande du responsable produit
(24 oct. 2026). Sources : `docs/dig-prodi/ANALYSE-DIG-PRODI.md` (§ 3, entonnoir de précision ; lot D-6 ; constat C-8),
`docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md` (R-188), `docs/dig-prodi/CDC-DIG-PRODI-v4.0-draft.md` (±50 % au cadrage,
+10 % / −5 % au modèle financier), demande d’Arche **K-03** (`REQUESTS.md` : classes `E50` / `E30` / `E10` et fourchette sur les
réponses, une offre ferme est `E10`) et `docs/delivery-9/notes-r186-catalogue.md` (prix catalogue indicatif = classe E50).

## 1. Règles (`src/domain/estimate-class.ts`, tests à côté)

| Classe | Borne basse | Borne haute | Écart (haut − bas) | Source |
|---|---|---|---|---|
| `E50` | −50 % | +50 % | 100 % du montant | DIG-PRODI phase 1 (cadrage, prix catalogue) |
| `E30` | −30 % | +30 % | 60 % | DIG-PRODI phase 2, APS (devis budgétaire) |
| `E10` | −5 % | +10 % | 15 % | DIG-PRODI phase 2, APD (BL1, BAC), modèle financier DAF |

Les bornes sont identiques à celles d’Arche (`src/domain/budget.ts`, `CLASS_RANGE`) : les deux outils parlent la même langue.

- `estimateRange(montant, classe)` → bas / central / haut (arrondis au dixième de k€) ; `uncertaintyGap` = haut − bas.
- `meetsEstimateClass(c, requise)` : précision au moins égale (E10 satisfait E30).
- **Classe proposée au gel d’une version** (`stageEstimateClass`) : Initiative → E50, APS → E30, APD et au-delà → E10 (BL1 est
  gelée en fin d’APD, L-2). La personne qui gèle la version peut en choisir une autre.
- **Classe d’un budget de travail sans version courante** (`workingEstimateClass`) : Initiative → E50, APS et APD → E30 (la précision
  +10/−5 % s’obtient au gel de BL1 en fin d’APD) ; à partir d’Études, un budget sans référence courante est **non classé**
  (Keystone n’affiche pas une précision que personne n’a énoncée).
- **Classe du budget d’un projet** (`budgetEstimate`) : celle de sa référence courante ; sinon celle de son étape. Une référence
  courante non classée reste « non classée » (pas de repli sur l’étape).
- **Offre ferme ⇒ E10** (`offerClassError(nature, classe, chiffrée)`) pour R-187 : natures `qualification` / `indicatif` /
  `devis` / `offre_ferme` (K-03) ; `offre_ferme` exige E10 ; une réponse chiffrée d’une autre nature exige une classe ; une
  qualification sans montant n’en demande pas. Messages anglais déjà traduits en français (`d9-estimate-class.json`).

## 2. Schéma

- Version de budget = **référence (baseline) BL0, BL1, BL2…** (table `baselines`, `bac_keur`). Nouvelle colonne
  `baselines.estimate_class` (texte, nullable, contrôle `in ('E50','E30','E10')`) : migration générée
  **`drizzle/0047_baseline_estimate_class.sql`**.
- **Reprise** : migration personnalisée **`drizzle/0048_baseline_estimate_class_backfill.sql`** (ne remplit qu’une classe nulle,
  rejouable), même règle que `legacyBaselineClass` :
  - BLn avec n ≥ 1 → **E10** (BL1 gelée en fin d’APD ; les suivantes re-basent un budget approuvé) ;
  - BL0 → **E30** (estimation de proposition, précision APS), **E50** si le projet est encore à l’Initiative ;
  - autre code → null (non classé).
- Le type `EstimateClass` est déclaré dans `src/server/db/codes.ts` (le schéma n’importe pas `src/domain`).
- Aucune vue `pub_` ne change (voir § 6).

## 3. Écritures (droits inchangés)

- **Plan › « Fixer la référence »** (`setBaselineAction`) et **Planning › « Nouvelle référence »** (`rebaselineSchedule`) : nouveau champ
  « Classe d’estimation » (liste E50 / E30 / E10, préréglée sur `stageEstimateClass` de l’étape du projet). Mêmes droits que le gel
  d’une référence (directeur et chef de projet pour le Plan ; droit d’édition du Planning pour « Nouvelle référence »). Entrée validée côté
  serveur (`parseEstimateClassInput` : vide = classe de l’étape ; autre valeur que E50/E30/E10 → « Classe d’estimation inconnue »).
- La référence **proposée par une demande de modification** (`createProposedBaseline`) prend la classe de l’étape (E10 dès l’APD).
- Audit : la ligne d’audit de la référence porte `after: { estimateClass }` (texte de `change` inchangé, lu par d’autres tests et
  écrans).
- Pas de modification de la classe d’une référence déjà gelée (une version gelée ne change pas) ; pas de blocage d’un jalon sur la
  classe (D-6 « un jalon refuse un budget de classe insuffisante » relève du CAPEX dans Arche ; à proposer si le responsable produit
  le veut aussi pour BL1).

## 4. Écrans

- **Budget & coûts › Performance** : nouvelle tuile **« Fourchette d’estimation »** juste après « Budget (BAC) » : bas – haut du BAC
  (`4,56 M€ – 5,28 M€` pour HLT-026), sous-ligne « E10 — ferme (+10 % / −5 %) · BL1 » (code de la référence courante) ou
  « … · Budget de travail » (classe de l’étape) ; « — » et « Non classé » (couleur d’alerte) sans classe.
- **Budget & coûts sans données de coûts** (projets du pipeline) : au-dessus de « Aucune donnée de coûts pour ce projet pour l’instant », tuiles
  « Budget (BAC) » (« Budget actuel ») et « Fourchette d’estimation » — c’est là qu’apparaissent les classes E50 / E30.
- Dialogues « Fixer la référence » et « Nouvelle référence » : champ « Classe d’estimation ».

## 5. Indicateur « Écart d’incertitude »

- **Vue d’ensemble du portefeuille** (`/portfolio/overview`, rôles qui voient déjà le budget total ; jamais le client, renvoyé à
  l’accueil par `getScreenAccess`) : 7ᵉ tuile après les six du prototype, **Σ (haut − bas)** des budgets des projets en exécution
  (même population et même filtre de zone que la vue), sous-ligne « Tous les budgets en classe E10 » ou « n hors classe E10 »
  (E50, E30 ou non classé), en alerte dans ce dernier cas : un projet en exécution a passé l’APD, dont la précision attendue est
  +10/−5 %. L’accueil du directeur (4 premières tuiles) ne change pas.
- Démonstration : 1,47 M€ (HLT-026 4 800, NDC-031 2 100, RCF-019 1 350, ERP-202 960, MSR-012 620 k€ à E10 = 1 474,5 k€),
  « 1 hors classe E10 » (PRS-038, approvisionnements, sans référence).

## 6. Offres et partage

- **Pas de module d’offres** (P6 non validée). Lieux examinés : `offer_quotes` (devis fournisseurs du profil de coûts : des prix
  reçus, pas une estimation), montant de base du contrat (prix signé) et avenants (prix contractuels soumis à signature) — aucune
  classe ne s’y applique. Seul le validateur `offerClassError` est livré pour R-187.
- **Aucune colonne `pub_` ajoutée** : la classe et la fourchette des réponses (`classe_estimation`, `montant_bas_keur`,
  `montant_central_keur`, `montant_haut_keur`) iront dans `pub_reponses_besoins`, que R-187 créera.

## 7. Démonstration et valeurs affichées

- Graine : `classifySeedBaselines` (`src/server/db/seed/chapter4.ts`) applique la règle de reprise : HLT-026 BL0 → E30, BL1 → E10,
  BL2 (proposée, CR-009) → E10 ; BL1 de NDC-031, RCF-019, ERP-202, MSR-012, WSA-044 → E10. Projets du pipeline sans référence :
  EWA-051 et FTU-052 (Initiative) → E50 ; RBR-048 (APS) et CER-047 (APD) → E30 ; PRS-038 et ALP-021 → non classés.
- Valeurs affichées modifiées : tuile ajoutée sur Budget (Performance et état vide) et sur la Vue d’ensemble ; aucune valeur
  existante ne change. Test mis à jour : `src/server/dal/portfolio.test.ts` (7ᵉ tuile, commentaire R-188).

## 8. Reste pour R-187

- Stocker la classe et la fourchette sur chaque réponse chiffrée, refuser une offre ferme hors E10 avec `offerClassError`,
  publier `classe_estimation` et les trois montants dans `pub_reponses_besoins` (K-03).
- La réponse indicative issue du catalogue part en E50 (prix indicatif de `pub_catalogue_machines`, R-186).
