# Livraison 9 — module « Expéditions », lot A (R-158)

Statut : construit sur la branche `r158-shipments-a` (depuis `a5cd8c2`) le 25 oct. 2026, d’après le cadrage
`docs/delivery-9/cadrage-r158-expeditions.md` et les **décisions du responsable produit du 25 oct. 2026 (§ 5)**, qui priment
sur la proposition du § 3. Le lot A couvre le profil Logistique, les Incoterms paramétrables, l’Incoterm du contrat et l’écran
projet « Expéditions » (expéditions, transport d’après l’Incoterm, chargements et contenu, contrôle du colisage, blocage du
livrable « Colisage & documents douaniers »). Les documents, la réception sur site et les vues partagées sont le lot B (§ 10).

## 1. Ce qui change

| Pièce | Où | Rôle |
|---|---|---|
| Tables, colonnes | `drizzle/0061_shipments.sql` (générée) | `incoterms` ; `contracts.incoterm_id`, `contracts.incoterm_place` ; `shipments`, `shipment_equipments`, `shipment_steps`, `shipment_loads`, `shipment_items`, `shipment_gap_reasons` |
| Règles pures | `src/domain/incoterms.ts`, `src/domain/shipments.ts`, `src/domain/shipment-input.ts` | Incoterms 2020 et répartition ; statuts, modes, types de chargement ; étapes ; contrôle du colisage ; synthèse SH ; règle du livrable ; formulaires |
| Droits | `src/domain/rights.ts` (`canEditShipments`, `canSeeShipmentValues`, `logisticsReadOnly`, `roleReadOnly`), `src/server/dal/team-guard.ts` (`editsShipments`), `src/server/project-context.ts`, `page-header.tsx` | voir § 8 |
| Profil | `src/config/personas.ts`, `screens.ts` (`RoleKey`), `role-screens.ts`, `src/domain/auth.ts` (priorité, libellé, rôle Entra), `src/server/db/codes.ts` (`D5_SCREEN_ROLES`), `seed/users.ts` (`seedLogisticsUser`) | 10ᵉ profil « Logistique » |
| DAL | `src/server/dal/incoterms.ts`, `src/server/dal/shipments.ts` | lecture, écritures (droits revérifiés, transaction, audit, fil d’activité) |
| Server Functions | `src/features/shipments/actions.ts` ; `saveIncotermAction`, `removeIncotermAction`, `reactivateIncotermAction` (`src/features/admin/actions.ts`) ; `setContractIncotermAction` (`src/features/contract/actions.ts`) | validation, droits, `revalidatePath` |
| Écrans | `/projects/[code]/shipments` (nouveau, 61ᵉ écran) ; carte « Incoterms » de Paramètres ; carte « Incoterm » du Contrat ; Accueil Logistique | |
| Livrable | `setDeliverableAndAdvance` (`projects-register.ts`), `toggleStageDeliverable` (`lifecycle.ts`), `setDeliverableAction` | refus de « Colisage & documents douaniers » |
| Export | `src/server/export/providers/shipments.ts` | expéditions, étapes, contenu, contrôle, synthèse SH |
| Seeds | `seed/shipments.ts` (`seedIncoterms`, `seedDemoShipments`), `seed/reference.ts`, `seed/index.ts` (reprises) | Incoterms dans les **deux** seeds ; démonstration |
| Messages | `src/domain/system-messages.ts` (`incoterm.*`, `contract.incoterm`, `shipment.*`) | audit et fil d’activité en FR / EN (R-184) |
| Traductions | `src/i18n/extra/d9-shipments.json` ; `same-in-french.json` (Air, Dimensions, Incoterms, Multimodal, OK) | |

## 2. Schéma

- **`incoterms`** : `code` (unique, `^[A-Z]{3}$`), `name_en`, `name_fr`, `description_en`, `description_fr`, `modes`
  (`any` | `sea`), `split` (jsonb : partie de chacune des 10 étapes), `standard` (un des 11 Incoterms 2020 des seeds), `active`,
  `position`.
- **`contracts`** : `incoterm_id` (clé étrangère `incoterms`, nulle = non renseigné), `incoterm_place` (lieu convenu, texte saisi).
- **`shipments`** : `project_id` (cascade), `ref` (`EXP-01`… unique par projet), `label`, `status` (contrôle des 7 statuts),
  `mode` (`road` | `sea` | `air` | `multimodal`), `forwarder` (texte : le transitaire est un externe sans accès, décision 8),
  `origin`, `destination`, `etd`, `eta`, **`atd`, `ata`** (dates réelles de départ et d’arrivée — pour le lot B), `note`,
  `packing_validated_at` / `packing_validated_by_person_id`, `created_by_person_id`.
- **`shipment_equipments`** : (expédition, ligne d’équipement R-185), au moins une.
- **`shipment_steps`** : (expédition, étape) → `planned_on`, `actual_on`, `note` ; seulement les étapes du vendeur.
- **`shipment_loads`** : `number` (1, 2… par expédition), `load_type` (`truck`, `c20`, `c40`, `c40hc`, `open_top`, `flat_rack`,
  `out_of_gauge`), `identifier` (n° de conteneur ou immatriculation), `seal`, `gross_kg`, `note`.
- **`shipment_items`** (contenu d’un chargement) : `part_id` (article du catalogue) **ou** `description` (article libre, avec
  `hs_code` et `unit_value_eur` saisis), `quantity` (> 0), `packages`, `length_cm` / `width_cm` / `height_cm` (colis),
  `net_kg`, `gross_kg` (totaux de la ligne), `origin_country` (ISO alpha-2).
- **`shipment_gap_reasons`** : motif d’un écart (`gap_key` = `part:<réf>` ou `item:<id>`), avec l’écart (`delta`) pour lequel
  il a été donné, l’auteur et la date.

Migration unique **0061** (générée, aucune modification à la main). Les Incoterms ne sont pas insérés par une migration : comme
les multiplicateurs de taux (R-178), la seed les écrit (`seedIncoterms`, idempotente : les codes manquants seulement, une ligne
modifiée n’est jamais écrasée), à l’amorçage des deux seeds et en reprise au démarrage d’une base existante (production comme
démonstration). Aucune vue `pub_` n’est créée ni modifiée dans ce lot.

## 3. Incoterms (décision 9)

Les 11 Incoterms 2020 sont créés au départ, avec nom et description en anglais et en français. **Choix sur la langue** : un
Incoterm est une donnée de référence que l’administrateur peut réécrire ou compléter ; ses textes ne passent donc pas par
`t()` (vocabulaire de Keystone) mais sont saisis **dans les deux langues** (colonnes `_en` / `_fr`) et affichés dans la langue
de l’utilisateur (`incotermText`, repli sur l’autre langue si une est vide). Les libellés des étapes, des parties et des modes
sont, eux, le vocabulaire de Keystone (`t()`, `d9-shipments.json`).

Répartition des 10 étapes (V = vendeur = EPC2i, A = acheteur) :

| Incoterm | Modes | Emballage export | Chargement départ | Dédouan. export | Pré-acheminement | Transport principal | Assurance | Déchargement destination | Dédouan. import | Post-acheminement / livraison site | Droits et taxes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EXW | tous | V | A | A | A | A | A | A | A | A | A |
| FCA | tous | V | V | V | V | A | A | A | A | A | A |
| CPT | tous | V | V | V | V | V | A | A | A | A | A |
| CIP | tous | V | V | V | V | V | V | A | A | A | A |
| DAP | tous | V | V | V | V | V | V | A | A | V | A |
| DPU | tous | V | V | V | V | V | V | V | A | V | A |
| DDP | tous | V | V | V | V | V | V | A | V | V | V |
| FAS | mer / fluvial | V | V | V | V | A | A | A | A | A | A |
| FOB | mer / fluvial | V | V | V | V | A | A | A | A | A | A |
| CFR | mer / fluvial | V | V | V | V | V | A | A | A | A | A |
| CIF | mer / fluvial | V | V | V | V | V | V | A | A | A | A |

Conventions retenues : l’emballage export est toujours au vendeur ; sous FCA / FAS / FOB le vendeur charge chez lui et
achemine jusqu’au lieu convenu (pré-acheminement) ; « assurance » = la partie qui porte le risque pendant le transport
principal (obligation du vendeur seulement en CIF / CIP) ; « déchargement à destination » = au lieu convenu de destination
(au vendeur seulement en DPU) ; « post-acheminement » = de l’arrivée au site (au vendeur sous les règles D).

**Écran** : Paramètres › carte « Incoterms » (sous les listes). Modifiable par les rôles qui modifient les Paramètres (le
directeur de portefeuille, A-14) : ajouter (code de trois lettres), modifier (noms, descriptions, modes, partie de chaque étape),
retirer — **supprimé** s’il a été ajouté dans Keystone et qu’aucun contrat ne l’utilise, sinon **désactivé** (un Incoterm
standard ou utilisé n’est jamais supprimé ; il n’est plus proposé pour un nouveau contrat, le contrat qui l’a le garde) —,
réactiver. Les autres rôles des Paramètres (Logistique comprise) lisent. Tout est tracé (zone « Settings »). Les Incoterms des
appels d’offres fournisseurs (`rfqs.incoterm`, liste fixe EXW / FCA / DAP / DDP) restent inchangés.

## 4. Incoterm du contrat (décision 2)

Carte « Incoterm » de l’écran Contrat (avant la carte Équipement) : l’Incoterm, son nom, le lieu convenu (« DAP Le Havre —
site du terminal »), ses modes et la répartition des étapes. « Renseigner l’Incoterm » / « Modifier » pour les éditeurs du
contrat (P-4 : le directeur, la Finance, les responsables du projet), revérifié par le DAL (`editsContract`) ; seuls les
Incoterms actifs sont proposés (l’actuel reste choisi s’il a été désactivé). Un projet sans contrat n’a pas d’Incoterm : l’écran
Expéditions l’indique et n’affiche pas d’étapes.

## 5. Règles du contrôle du colisage (décision 4)

`packingControl` (`src/domain/shipments.ts`), calculé à chaque lecture, jamais stocké :

- **attendu** pour une ligne de nomenclature rattachée à une des lignes d’équipement de l’expédition = sa quantité moins ce que
  les **expéditions antérieures** du projet (numéro EXP plus petit) en emportent ; colisé en dessous → **manquant**, au-dessus →
  **excédent** ;
- une ligne **commune au projet** (sans ligne d’équipement) peut partir avec n’importe quelle expédition : jamais manquante,
  **excédent** au-delà de sa quantité moins les expéditions antérieures ; elle n’apparaît que si elle est colisée ;
- un article d’une **autre** ligne d’équipement, un article du catalogue hors nomenclature du projet, un **article libre** →
  **hors nomenclature** ;
- chaque écart se **justifie** par un motif, valable pour l’écart exact pour lequel il a été donné (si la quantité change, il
  faut un nouveau motif) ;
- un article **sans code SH** (et non déclaré « sans objet » dans le PLM, R-102) **bloque** la validation, aucun motif ne
  l’efface ; un article sous **restriction export** est signalé (alerte, non bloquant) ;
- **synthèse par code SH** : lignes, quantité, valeur (valorisation de la nomenclature : prix commandé, sinon dernier prix
  d’achat, sinon prix catalogue — E-2a ; prix catalogue pour un article hors nomenclature ; valeur saisie pour un article libre),
  poids net et brut, origines, restriction.

Pourquoi les expéditions **antérieures** seulement : une expédition dont la liste est validée ne doit pas redevenir « non
soldée » parce qu’une expédition suivante emporte une partie de la même ligne ; l’excédent apparaît sur l’expédition qui le crée.

**Validation de la liste de colisage** (« Valider la liste de colisage ») : refusée si rien n’est colisé, s’il manque un code
SH, ou si un écart n’est pas justifié ; elle passe l’expédition en **préparée**. Toute modification du contenu, des chargements
ou des lignes d’équipement d’une expédition préparée la **ramène en brouillon** (validation effacée, tracée) ; « Rouvrir la liste
de colisage » fait de même. Après l’enlèvement, le contenu est figé.

**Livrable « Colisage & documents douaniers »** (étape Expédition, position 0) : le cocher est refusé tant que le projet n’a
aucune expédition (« Préparez d’abord les expéditions du projet ») ou qu’une de ses expéditions n’a pas de liste de colisage
validée dont le contrôle est encore soldé (« Validez d’abord la liste de colisage de chaque expédition »). Contrôle côté serveur
dans `setDeliverableAndAdvance` (tous les appelants : registre des projets, Server Function), dans `toggleStageDeliverable`, et
dans `setDeliverableAction` (message à l’utilisateur). Décocher n’est jamais refusé ; un changement d’étape forcé reste possible
(comme pour « Planning BL1 posé »).

## 6. Écran « Expéditions »

`/projects/[code]/shipments`, groupe *Chantier & transfert*, après *Chantier* (décision 1 : vue projet seulement, aucune vue
portefeuille). Indicateurs (expéditions, listes validées, en route, prochaine arrivée), carte « Transport organisé d’après
l’Incoterm du contrat » (code, nom, lieu, description, répartition des étapes), puis une carte par expédition :

- en-tête : référence, titre, statut, lignes d’équipement ; actions Modifier, Valider / Rouvrir la liste, statut suivant,
  Supprimer (brouillon) ;
- faits : mode, transitaire, origine, destination, départ / arrivée prévus et réels, liste de colisage ; alerte si l’Incoterm est
  maritime et le mode ne l’est pas ;
- **étapes du transport** d’après l’Incoterm : celles d’EPC2i (date prévue, date de réalisation, note, état : à planifier,
  planifiée, en retard, faite) sont suivies et modifiables ; celles de l’acheteur sont affichées, non suivies ;
- **chargements et contenu** : chaque chargement (type, n°, scellé, poids brut), ses lignes (article ou article libre, code SH,
  quantité, colis, dimensions, poids, origine, valeur) ;
- **contrôle du colisage** (§ 5) avec « Justifier » par écart, et **synthèse douanière par code SH**.

**Statuts** : brouillon → préparée (validation de la liste) → enlevée → en transit → arrivée → réceptionnée sur site → clôturée,
un pas à la fois (un clic périmé est refusé). L’enlèvement renseigne le départ réel, l’arrivée l’arrivée réelle, s’ils ne sont
pas saisis (date métier). Les statuts « réceptionnée » et « clôturée » sont atteignables à la main dans ce lot ; le lot B fera
passer « réceptionnée » par le pointage de la réception.

**Valeurs** : les valeurs en douane viennent des prix fournisseurs (valorisation de la nomenclature) ; elles suivent donc
NEW-D2-1 (directeur, chefs de projet, achats) **plus la Logistique**, qui les déclare (`canSeeShipmentValues`) ; masquées `•••`
pour les autres lecteurs, à l’écran comme à l’export.

## 7. Données de démonstration

- Les 11 Incoterms 2020 (aussi en production).
- **HLT-026** : contrat en **DAP « Le Havre — terminal site »** (le site de HLT-026 est au Havre).
- **EXP-01** « Modules MEMU M1–M3 » : ligne **EQ-02 (3 × MEMU)**, route, transitaire « Transports Delmas », Atelier EPC2i —
  Lyon → Le Havre, départ prévu 12 oct., arrivée 14 oct. 2026 ; **deux conteneurs 40′ HC** (MSKU 482190-3 : 8 lidars
  anticollision, 2 anémomètres ; TCLU 905514-8 : 12 caméras OCR, 3 kits de fusibles de rechange) ; les 7 étapes du vendeur sous
  DAP renseignées (emballage fait le 24 sept.) ; liste de colisage **validée** le 24 sept. par Camille Verdier ; **un petit écart
  justifié** : le kit de fusibles, article libre hors nomenclature (« un par module, annexe du contrat »). Les caméras OCR portent
  l’alerte de restriction export.
- Les lignes de nomenclature de HLT-026 sont toutes communes au projet (R-185 partie 2) : le contenu de la démonstration est fait
  de lignes communes ; le cas « manquant » est couvert par les tests.
- Valeurs affichées existantes : **aucune ne change** (tests dorés intacts). Nouveautés délibérées (R-158) : le 61ᵉ écran, le
  10ᵉ profil et son utilisateur (personne créée : `persons` + 1, `users` + 1), la carte Incoterm du Contrat de HLT-026, la carte
  Incoterms des Paramètres, les comptes de `scripts/db-check.ts` (§ R-158 : `incoterms` 11, `shipments` 1, `shipment_equipments`
  1, `shipment_steps` 7, `shipment_loads` 2, `shipment_items` 4, `shipment_gap_reasons` 1 ; 10 utilisateurs).

## 8. Profil « Logistique » et droits (décision 7)

- **Rôle** `logistics` (« Logistique »), 10ᵉ profil de « Voir en tant que » : **Camille Verdier**, coordinatrice logistique,
  service Contrôle et planification, `camille.verdier@epc2i.fr`. La personne n’existe pas dans le prototype : la seed la crée
  avec son utilisateur (hors pool de ressources), et une base de démonstration existante la reçoit une fois. En production, la
  DSI attribue le rôle d’application Entra `Keystone.Logistics` (valeur `logistics`) ou un groupe associé (`ENTRA_GROUP_ROLES`) ;
  priorité des rôles : après Finance, avant Membre.
- **Espace** : Accueil (Accueil Logistique : expéditions du projet courant, listes à valider, en route, étapes en retard, écarts
  à solder — sans montant), Mes projets, Documents, **Expéditions**, Nomenclature, Chantier, Planning, Livraisons, Congés,
  Paramètres (lecture des Incoterms). Pas de Contrat, Budget ni Facturation : l’Incoterm du contrat est affiché sur l’écran
  Expéditions ; rien de financier hors des valeurs en douane.
- **Expéditions** modifiables par le directeur, **la Logistique sur tous les projets** (comme la Finance sur le contrat : la
  logistique d’EPC2i sert tous les projets, pas une équipe nommée) et les responsables du projet (chef de projet attitré, co-CP,
  adjoint) dont l’espace a l’écran (chef de projet, achats) ; l’équipe et les autres rôles internes lisent ; le client est
  refusé (renvoyé à son accueil). Les achats ont l’écran dans leur espace (suivi du matériel acheté).
- **Lecture seule** de la Logistique sur la Nomenclature, le Chantier, le Planning et les Livraisons, même sur un projet dont elle
  serait membre de l’équipe (`logisticsReadOnly`, généralisé avec la règle de la Finance dans `roleReadOnly`).
- Chaque Server Function revérifie le droit (contexte projet), valide l’entrée ; chaque écriture du DAL revérifie le droit
  (`editsShipments`) et l’état de l’expédition, écrit en transaction, trace l’audit (avant / après, motif) et le fil d’activité.

## 9. Décisions prises sans demander

1. **La Logistique modifie les expéditions de tous les projets**, hors équipe nommée (sur le modèle de la Finance et du contrat).
2. **Expéditions** dans l’espace des chefs de projet et des achats ; lecture pour les autres rôles internes ; refus du client.
3. **Valeurs en douane visibles de la Logistique** (en plus des rôles NEW-D2-1), masquées pour les autres.
4. **Textes des Incoterms bilingues saisis** (colonnes EN / FR), pas des clés i18n ; Incoterms des appels d’offres inchangés.
5. **Seuls les éditeurs des Paramètres** (le directeur) modifient les Incoterms, comme le reste des Paramètres (A-14).
6. **Expéditions antérieures** pour l’attendu (§ 5) ; lignes communes jamais « manquantes ».
7. **Motif lié à l’écart exact** ; article sans code SH bloquant sans motif possible ; article déclaré « sans code » dans le PLM
   accepté (groupé « Sans code SH »).
8. **« Préparée » = liste de colisage validée** ; toute modification du contenu ramène en brouillon ; contenu figé après
   l’enlèvement ; seule une expédition en brouillon se supprime.
9. **Livrable** : au moins une expédition et toutes validées (pas seulement celles d’une ligne d’équipement).
10. **Origine** saisie par ligne de contenu (code pays, « FR » proposé) : les articles PLM n’ont pas de pays d’origine.
11. **Poids et dimensions par ligne de contenu** (colis) et poids brut déclaré par chargement ; pas de taux de remplissage.
12. **Accueil Logistique** dédié (sans montant) plutôt que l’accueil du directeur (portefeuille et montants).
13. **Démonstration** : contenu fait de lignes communes de HLT-026 (sa nomenclature n’a aucune ligne propre à EQ-02, et en
    rattacher changerait les valeurs de la ventilation des coûts par équipement).

## 10. Ce que fait le lot B

- **Documents** générés par Keystone et versés dans Codex (décision 3, sauf factures) : packing list, liste de colisage par
  conteneur, bon de livraison, marquage des colis, lettre de voiture CMR, instructions d’expédition au transitaire (B/L ou LTA),
  demande de certificat d’origine / EUR.1, données de la déclaration d’export — variantes PDF du fournisseur d’export
  `shipments`, index et liens comme les autres documents. Le schéma a déjà tout ce qu’il faut (chargements, n° et scellés,
  colis, dimensions, poids, origines, codes SH, valeurs, transitaire, lieux, Incoterm et lieu convenu).
- **Réception sur site** : pointage par ligne de contenu (reçu, manquant, endommagé) ; un écart crée une réserve sur l’équipement
  (punch list, `punch_items.equipment_id`, décision 5) ; la réception soldée passe l’expédition en « réceptionnée sur site ».
- **Jalons** : `atd` / `ata` → jalons `expedition` / `arrivee_site` de `pub_jalons_projets` (première date d’enlèvement,
  dernière arrivée des expéditions du projet).
- **`pub_expeditions`** pour Arche (décision 6 : la filiale suit dans Arche) : expédition, équipement, statut, ETD / ETA, dates
  réelles, nombre de colis — sans valeurs ; demande à Matrix pour la copie et les droits après le « validé ».

---

# Lot B — documents, réception sur site, jalons, `pub_expeditions`, risque de fret

Statut : construit sur la branche `r158-shipments-b` (depuis `ef49685`, lot A fusionné) le 25 oct. 2026, d’après les décisions
3, 5 et 6 du responsable produit (cadrage § 5). Migrations **0063_shipments_reception** (générée) et **0064_shipments_share**
(SQL personnalisé : `pub_jalons_projets` recréée avec ses colonnes inchangées, `pub_expeditions`).

## 11. Ce qui change (lot B)

| Pièce | Où | Rôle |
|---|---|---|
| Tables, colonnes | `0063` | `shipment_reception_lines`, `shipment_punch_items`, `shipment_documents` ; `shipments.received_on`, `closed_on`, `close_reason`, `risk_id`, index `shipments_updated_at_idx` ; `codex_document_outbox.stored_file_id` ; index des clés étrangères lues (règle R-017 : `shipments.risk_id`, `shipment_reception_lines.shipment_id` / `item_id`, `shipment_punch_items.shipment_id` / `item_id`, `shipment_documents.document_id` / `stored_file_id`, `codex_document_outbox.stored_file_id`), les deux personnes « qui a agi » dans `fk-without-index.json` |
| Vues | `0064` | `pub_jalons_projets` alimentée par les expéditions ; `pub_expeditions` |
| Règles pures | `src/domain/shipment-reception.ts`, `src/domain/shipping-documents.ts` | pointage, catégories de réserve, progression, clôture ; retard de fret et brouillon de risque ; types de documents, disponibilité, indices |
| Gabarits PDF | `src/server/export/shipping-documents/` (un fichier par document, `index.ts` = registre) | les 8 documents |
| DAL | `src/server/dal/shipment-reception.ts`, `src/server/dal/shipment-documents.ts`, lectures dans `shipments.ts`, `fileGeneratedDocument` (`documents.ts`), crochet `afterPunchItemChange` dans `advancePunchItem` (`itp.ts`) | |
| Connecteur Codex | `outbox.ts` (entrée `deposit`, fichier joint), `connector.ts` (envoi `POST /api/documents/:numéro/deposit`, TODO(codex)) | |
| Server Functions | `src/features/shipments/actions.ts` : `pointLoadAction`, `pointItemAction`, `completeReceptionAction`, `closeShipmentAction`, `fileShippingDocumentAction`, `raiseFreightRiskAction` | |
| Écran | carte de chaque expédition : alerte retard de fret, « Réception sur site », « Documents d’expédition », « Clôturer l’expédition » | |
| Export | variantes PDF `?variant=<type>&id=EXP-01` du fournisseur `shipments` | |
| Profil | `member` (équipe chantier) : écran Expéditions dans son espace, pointage seulement | |
| Traductions | `src/i18n/extra/d9-shipments-b.json` ; messages système `shipment.reception`, `shipment.documentFiled`, `shipment.riskRaised` | |

## 12. Documents générés et gabarits (décision 3)

Keystone génère **tous les documents nécessaires sauf les factures** (ni facture commerciale, ni facture douane / proforma) :

| Type (`variant`) | Document | Valeurs en douane |
|---|---|---|
| `packing_list` | Liste de colisage (chaque chargement, contenu, codes SH, poids, dimensions, origine, totaux) | oui |
| `container_packing_list` | Liste de colisage par conteneur (une page par chargement, n°, scellé, signatures chargé / contrôlé par) | non |
| `delivery_note` | Bon de livraison (quantités livrées, colonnes « reçu » et observations, trois signatures) | non |
| `marking` | Marquage des colis (une étiquette par colis, « n / N », poids brut par colis, dimensions, manutention) | non |
| `cmr` | Lettre de voiture CMR (cases de la convention ; route ou multimodal seulement) | non |
| `shipping_instructions` | Instructions d’expédition au transitaire (base du B/L, de la LTA ou de la CMR selon le mode ; port payé / dû d’après l’Incoterm) | oui |
| `origin_request` | Demande de certificat d’origine / EUR.1 (données pré-remplies) | oui |
| `export_declaration` | Données de la déclaration d’export (par code SH, pour le commissionnaire) | oui |

- **Gabarits isolés** : un fichier par document dans `src/server/export/shipping-documents/` (fonctions pures des données de
  l’expédition et de la langue) ; `common.ts` porte les blocs partagés (parties, transport, tableau de contenu, regroupement SH).
  Remplacer un document par le format standard d’EPC2i = remplacer son fichier. Pied de page « mise en page générique ».
- **Valeurs** : `canSeeShipmentValues` (NEW-D2-1 + Logistique). Pour les autres lecteurs, colonnes €, totaux et montants retirés
  (`withoutValues`) — même règle à l’écran, à l’export et dans le fichier versé (versé par un éditeur, qui voit les valeurs).
- **Disponibilité** : un document demande au moins un chargement avec du contenu ; la CMR, le mode route ou multimodal.
- **Langue** : celle de l’utilisateur qui télécharge ou verse (enregistrée sur la version versée).

## 13. Versement dans Codex

« Verser dans Codex » (éditeurs des expéditions) : le PDF est généré, passé à l’antivirus, **conservé tel que versé** dans le
magasin de fichiers de Keystone (`stored_files`, usage `export`, propriétaire `shipment_document`, empreinte SHA-256), puis, dans
une transaction :

1. la fiche de l’index Codex est **créée** (type `SHP`, numéro `SHP-HLT-0nn` comme les dépôts, indice A, diffusée, interne, lien
   `shipment` → `EXP-01`, étiquette `EXP-01`) ou, pour un document déjà versé, **révisée** (indice suivant B, C…, l’indice
   précédent retiré à la date du jour, ses entrées Codex encore ouvertes closes) ;
2. une entrée **`deposit`** est mise dans l’outbox Codex (« en attente de synchro », fichier joint par `stored_file_id`) ; le
   connecteur HTTP l’envoie aussitôt (`POST /api/documents/:numéro/deposit`, contenu en base64 — proposition TODO(codex), question
   D-1), le mock la laisse en attente ; la relecture de l’état Codex la clôt quand Codex reflète l’indice ;
3. une ligne `shipment_documents` (type, numéro, indice, fichier, empreinte, langue, auteur), l’audit (expédition et document) et
   le fil d’activité.

Le téléchargement « PDF » (tout lecteur de l’écran) régénère le document sans rien verser. Le type `SHP` (« Shipping document »,
famille Site, conservation 10 ans, ISO 8.5.4, circuit : l’auteur) est ajouté au registre des types Codex de Keystone **au premier
versement** (`ensureShippingDocType`) — pas avant, pour ne pas changer le registre tant que rien n’est versé ; **il reste à le créer
dans Codex**.

## 14. Réception sur site et réserves (décision 5)

- **Qui** : les éditeurs des expéditions (directeur, Logistique, responsables du projet) et **l’équipe chantier** — un membre de
  l’équipe nommée du projet qui modifie son écran Chantier (`canRecordReception`). La clôture manuelle reste aux éditeurs.
- **Quand** : l’expédition est « arrivée » ; la réception soldée la fige.
- **Pointage d’un chargement** : reçu (ses lignes non pointées sont reçues en totalité), **manquant** (toutes ses lignes manquantes,
  couvertes par **une** réserve du chargement — les réserves propres des lignes sont retirées), **endommagé** (conteneur, camion,
  scellé ; les lignes restent à pointer). Une note est exigée pour un écart.
- **Pointage d’une ligne** : quantités reçue, manquante, endommagée, dont la somme est la quantité expédiée ; note exigée pour un écart.
- **Réserves** : chaque écart crée une réserve de la liste unique du projet (R-117 : origine Chantier, source « Réception
  d’expédition », responsable Keystone, numérotée P-10…), sur la **ligne d’équipement de l’expédition** quand elle n’en porte
  qu’une (sinon commune), liée à l’expédition (`shipment_punch_items`). Un pointage corrigé met à jour la réserve, la **clôt** si
  l’écart disparaît, la **rouvre** s’il revient. Les photos s’ajoutent sur la réserve (fonction photos existante, R-126).
- **Catégories par défaut** (choix sans le responsable produit, modifiables dans la boîte de pointage) : **endommagé = A**
  (bloquante : à expertiser, réparer ou remplacer avant montage — sécurité), **manquant = B** (à livrer avant la SAT).
- **Réception soldée** (« Solder la réception ») : chaque chargement et chaque ligne pointés → « réceptionnée sur site »
  (`received_on` = date métier).
- **Clôture** : automatique quand la **dernière réserve** liée est close (crochet dans `advancePunchItem`) ; à la main
  (« Clôturer l’expédition ») avec un **motif obligatoire** tant qu’une réserve est ouverte, facultatif sinon (une réception sans
  écart se clôture ainsi). Chaque changement d’une réserve liée fait avancer `shipments.updated_at` (`maj_le` de la vue).
- Les statuts « arrivée → réceptionnée » et « réceptionnée → clôturée » ne passent plus par « Avancer » (lot A).

## 15. Jalons CAPEX (R-189)

`pub_jalons_projets` est recréée (`CREATE OR REPLACE`, ses six colonnes inchangées) : la vue ne lit que les étapes du cycle de vie
et le jalon codé du planning, et les alimenter aurait obligé à modifier le planning.

- `expedition` : `reel_le` = **premier enlèvement réel** (`atd`) des expéditions du projet, sinon comme avant (étape, jalon codé) ;
  `prevu_le` = jalon codé du planning, sinon **plus petite ETD**, sinon `reel_le`.
- `arrivee_site` : dès qu’une expédition est **envoyée** (tout statut sauf brouillon), les expéditions décident : `reel_le` =
  **dernière arrivée réelle** (`ata`) une fois toutes ces expéditions arrivées, sinon null ; sans expédition, comme avant.
  `prevu_le` = début du chantier (fiche chantier, comme avant), sinon jalon codé, sinon **plus grande ETA**, sinon `reel_le`.
- `maj_le` suit aussi les expéditions. Démonstration : HLT-026 `expedition` 21 sept., `arrivee_site` 22 sept. 2026.

## 16. Contrat `pub_expeditions` (décision 6)

Une ligne par expédition, lecteur `arche_app` : `projet_code`, `expedition_ref`, `equipements` (« EQ-02 · 3 × MEMU », lignes
séparées par des virgules), `statut` (`draft` … `closed`), `mode`, `incoterm`, `incoterm_lieu` (contrat), `origine`,
`destination`, `etd`, `eta`, `depart_reel_le`, `arrivee_reelle_le`, `receptionnee_le`, `nb_chargements`, `nb_reserves_ouvertes`,
`maj_le` (= `shipments.updated_at`, index `shipments_updated_at_idx` — K-11). **Aucune valeur, aucun prix, aucun contact du
transitaire** (contrôlé par `EXPEDITIONS_FORBIDDEN_COLUMN` dans `share-views.test.ts` et `db-check`). Enregistrée dans
`share-contracts.ts` (`SHARE_VIEW_COLUMNS`, `EXPEDITIONS_VIEW_TYPES`, `SHARE_MAJ_LE_INDEXES` ; 22 vues). Limite : un changement de
l’Incoterm du contrat ne fait pas avancer `maj_le` (lu en direct).

## 17. Suggestion de risque « retard de fret »

Date de besoin sur site = début de la fiche chantier, sinon fin de l’activité d’ancrage du jalon du planning codé `arrivee_site`.
Une expédition pas encore sur site (brouillon … en transit) dont l’ETA est postérieure affiche une alerte « Retard de fret · ETA …
après la date de besoin sur site … · +n jours ». Un responsable du projet qui modifie le registre des risques a le bouton
**« Ouvrir un risque »** : le formulaire « Nouveau risque » pré-rempli (« Retard de fret — EXP-02 · titre », Fournisseur /
livraison, le chef de projet, Atténuer), la cause en déclencheur ; le risque est lié à l’expédition (une seule fois). **Jamais
automatique.**

## 18. Démonstration (lot B)

EXP-01 de HLT-026 redatée avant la date de démonstration (validée le 17 sept., ETD / départ réel 21 sept., ETA / arrivée 22 sept. ;
lot A : 12 → 14 oct.), **arrivée**, réception **partielle** pointée le 23 sept. par Julien Wagner (les deux conteneurs reçus, les
lidars et anémomètres reçus, 11 caméras OCR reçues et **1 endommagée** — catégorie B choisie : la caméra fonctionne, son boîtier est
à remplacer avant la SAT —, les kits de fusibles pas encore pointés) → **réserve P-10** sur EQ-02. Ses **huit documents** se génèrent à la
demande (« PDF ») ; **aucun n’est versé dans Codex dans le jeu de démonstration** : le coffre documentaire reproduit celui du
prototype (tests dorés), le versement est couvert par `src/features/shipments/lot-b.test.ts`. Une base de démonstration existante
reçoit ces données une fois (EXP-01 encore « préparée », rien de pointé).

## 19. Décisions prises sans demander (lot B)

1. Catégories de réserve par défaut : **endommagé A, manquant B**, modifiables au pointage.
2. Réserve d’un chargement manquant **unique** pour tout son contenu ; réserves corrigées, closes ou rouvertes par le pointage.
3. Réserve sur la ligne d’équipement de l’expédition quand elle n’en a qu’une, sinon commune.
4. **L’équipe chantier pointe** (membre de l’équipe qui modifie le Chantier) : écran Expéditions ajouté à l’espace « Membre » ; la
   clôture manuelle et le versement restent aux éditeurs.
5. Réception sans écart : « réceptionnée », clôture à la main sans motif ; avec écarts : clôture automatique à la dernière réserve.
6. Type documentaire **SHP** ajouté au registre de Keystone au premier versement (famille Site, conservation 10 ans, ISO 8.5.4,
   circuit : l’auteur), fiches **diffusées** dès le versement, confidentialité interne ; une fiche par expédition et type, un
   indice par versement. Démonstration : documents générés à la demande, aucun versé (coffre du prototype inchangé).
7. PDF versé conservé dans Keystone jusqu’à la prise en charge par Codex ; envoi au connecteur HTTP en base64 (à valider avec Codex).
8. Jalon `arrivee_site` décidé par les expéditions dès qu’une est envoyée (les brouillons ne comptent pas) ; ETD / ETA en date
   prévue seulement à défaut d’autre source.
9. Date de besoin sur site : fiche chantier, sinon jalon codé ancré ; alerte seulement avant l’arrivée.
10. Expéditeur imprimé « EPC2i » + origine saisie (identité légale et adresses avec les formats standard).
11. Pas de pagination (R-017) sur l’écran Expéditions : quelques expéditions par projet, la réception et les documents par expédition.

## 20. Ce qui reste

- **Formats standard d’EPC2i** pour chaque document (décision 10) : remplacer les gabarits génériques un par un.
- **Codex** : API de dépôt (D-1) et création du type `SHP` côté Codex ; d’ici là les dépôts restent « en attente de synchro ».
- **Matrix** : copie de `pub_expeditions` (et de la nouvelle définition de `pub_jalons_projets`) dans `partage/30-keystone.sql`,
  droit de lecture `arche_app` (`partage/90-droits.sql`) — demande à présenter au responsable produit avant toute écriture.
- Pays de destination structuré (texte de la fiche chantier aujourd’hui) ; coûts de fret et assurance (à cadrer, Sage X3).
