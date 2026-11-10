# Livraison 9 · lot « no client » — portail client et profil Client retirés (D9-06, D9-22, D9-23, D9-25, D9-26)

Décisions du propriétaire (`docs/DECISIONS.md`) : les clients ne voient pas Keystone (D9-06, D9-22, D9-23) ; une
« décision client » est une décision prise en réunion « client présent » (D9-25) ; la grille pouvoir / intérêt des parties
prenantes disparaît, elles se définissent par leurs rôles et responsabilités (D9-26).

Migration : `drizzle/0078_no_client.sql` (générée par `npm run db:generate`, complétée à la main pour la reprise des
données). Aucune vue `pub_` ne lit une colonne retirée (vérifié sur les 22 vues des migrations 0000–0074).

## 1. Portail client et profil Client retirés (D9-06, D9-22, D9-23)

Retiré :
- l’écran « Mon projet » du client (`/projects/<code>/client`, écran `client`) et l’aperçu « Voir comme le client » de
  l’en-tête ; le registre compte désormais **61 écrans** (`src/config/screens.ts`, `CLAUDE.md`) ;
- le rôle `client` de `RoleKey`, de `ROLE_SCREENS`, de `PERSONAS` (9 profils, `DEMO_CLIENT_ORG` retiré) et des règles de
  droits : `projectAccess` n’a plus de branche client (`refused`, `client`), `refuseClient`, `clientProjectCodes`,
  `canPreviewClientView`, `clientSeesMeeting`, `clientSeesPhotos`, `clientRefusedScreen/Project`… supprimés ; la
  connexion Entra ne connaît plus le rôle Client ni l’organisation (`no_organisation`) ;
- les points signalés par le client (`client_issues`, `raiseClientIssue`, écran, export) : table supprimée ;
- l’accusé de réception d’un document par le client (`acknowledgeDocumentAction`) ; la table
  `document_acknowledgements` est **gardée** (historique affiché « Partagé avec le client »), plus aucun écrivain ;
- les avis destinés au client : invitation à la SAT, « Livrable à accepter », filtres « client » de la cloche, des
  rappels, des courriels (`noticeVisibility`, `isClientOnly`), de la recherche et des badges de la coque ;
- les exports du portail (planning client, relevé de compte) et le fournisseur `client` des exports ;
- `users.client_id` (migration) ; les comptes de démonstration qui n’avaient que le rôle Client sont désactivés, le rôle
  `client` est retiré des autres comptes (migration) ;
- les liens `/projects/<code>/client` (anciens favoris) redirigent vers le Plan du projet (`[...rest]`, D9-07).

Gardé, et pourquoi :
- **le rapport d’état « client »** (audience client de l’export Tendances) : c’est un document que le chef de projet
  produit et envoie lui-même ; il lit `getClientReportData` (`src/server/dal/client-report.ts`, ex-`client.ts` sans les
  points ni les documents) et `clientReportView` (`src/features/rexclient/model.ts`) ;
- **la personne de contact du client** (Nadia Bensaïd, `persons.client_id` → « Port authority ») : contact du projet,
  plus utilisatrice ; `users.is_external` reste (comptes de sous-traitants) ;
- **les livrables avec acceptation client**, **les réunions** et **les décisions** (voir ci-dessous).

### Décision du client enregistrée par le chef de projet

- **Livrable** : sur un livrable soumis, les responsables du projet (chef de projet titulaire, co-chef, adjoint,
  directeur — `managesProject`) enregistrent « Acceptation du client (PV) » ou « Refus du client » : date de la décision
  du client (au plus tard la date du jour métier ; pas de borne basse : le jeu de démonstration du prototype porte des dates de soumission postérieures à la date d’état) et **référence du document signé** (obligatoire pour une
  acceptation, ex. `PV-HLT-014` ; facultative pour un refus, avec la lettre de commentaires). Stockées dans
  `deliverables.acceptance_ref` et `deliverable_reviews.reference` (migration) ; le registre affiche « 25 sept. ·
  PV-HLT-014 » ; journal d’audit avant / après avec la référence (`recordClientDecisionAction`,
  `decideDeliverable(…, { on, reference, comments })`).
- **Demande de modification** : l’étape « Client / commanditaire » de la chaîne (P-6b) est enregistrée par le chef de
  projet titulaire (`STEP_DECIDER.client = 'pm'`) avec la date et la référence du document signé
  (`recordClientChangeStepAction`, commentaire de l’étape « Client decision of <date> · <référence> ») ; le bouton
  « Valider » direct est refusé pour cette étape.
- **Mes validations** : les livrables soumis et l’étape client d’une demande de modification apparaissent aux
  responsables, sans décision en ligne (ouverture de la fiche, où le document signé se saisit).

## 2. D9-25 — case « Client présent » sur la réunion

- `meetings.client_present` (booléen, défaut faux ; migration : vrai pour les réunions de type « externe » existantes).
- Case « Client présent » dans « Nouvelle réunion » (nouveau type de champ `checkbox` de `FormDialog` / `form-def.ts`)
  et sur la fiche de la réunion (`setMeetingClientPresentAction`, qui modifie les réunions du projet, compte rendu envoyé compris, audit
  avant / après) ; étiquette « Client présent » sur la carte ; colonne « Client present » de l’export des réunions.
- Les décisions d’une réunion « client présent » sont les décisions client (`isClientMeeting = m.clientPresent`,
  `src/domain/meetings.ts`), y compris dans le rapport d’état client.

## 3. D9-26 — grille pouvoir / intérêt retirée

- Colonnes `stakeholders.influence`, `interest`, `attitude` supprimées (migration), avec la grille, les filtres, les
  champs du formulaire et les colonnes d’export. « Dernier contact » est gardé (voir questions ouvertes).

## Tests

- Tests dorés adaptés avec un commentaire citant D9-06 / D9-26 (qualité : le chef de projet décide sur un livrable
  soumis ; décomptes de « Mes validations », de la coque et des profils : 9 au lieu de 10).
- `tests/e2e` : visites du portail et de « Voir comme le client » retirées ; la chaîne d’une nouvelle référence (BL3)
  enregistre l’accord du client par le chef de projet avec un document signé.

## Décisions prises sans demander

- `users.client_id` supprimé ; comptes uniquement « client » désactivés (jamais supprimés : l’audit les cite).
- `client_present` repris de `type = 'external'` pour les réunions existantes.
- Référence du document signé obligatoire pour une acceptation (livrable) et un accord (demande de modification),
  facultative pour un refus.
- Les avis « Invitation à la SAT » et « Livrable à accepter » sont supprimés, pas redirigés : le chef de projet invite le
  client et lui envoie le livrable hors de Keystone.
- `document_acknowledgements` gardée en lecture seule (historique), sans écrivain.
- La personne de contact client de démonstration reste une personne (contact), sans compte.

## Reste / questions ouvertes

- « Dernier contact » des parties prenantes : à garder ou retirer avec la grille (D9-26 ne le dit pas) ?
- Rôles et responsabilités des parties prenantes : la matrice RACI par rôle (R-058) attend la matrice du propriétaire.
- DocuSign (D9-06) : l’envoi en signature est un nouvel outil à cadrer avec la DSI — non construit ; la référence du
  document signé se saisit à la main en attendant.
- Les points signalés par les clients (`client_issues`) ont été supprimés avec leurs données de démonstration ; si une
  base réelle en contenait, les exporter avant la migration 0078.
