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
