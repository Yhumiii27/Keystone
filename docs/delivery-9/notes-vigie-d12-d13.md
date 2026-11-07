# Livraison 9 — demandes de Vigie D13 (NC de projet) et D12 (ordres de modification)

Statut : construit sur la branche `vigie-views` (depuis `350c293`, « REQUESTS: M-19, D12 and D13 accepted ») le 7 nov. 2026.
Entrées de `REQUESTS.md` : « [2026-11-05] Vigie → Keystone — NC de projet … (D13) » et « [2026-11-06] Vigie → Keystone — Ordres de
modification … (D12) », validées par le responsable produit les 5 et 6 nov. 2026.

Sources lues en lecture seule (aucune écriture dans ces dépôts) :
- Vigie `main` : `drizzle/0026_convergence_m02_nc_inbox.sql` (table `inbound_requests`, fonction `pub_signaler_avancement_nc`,
  numéro CV-07), `drizzle/0029_convergence_m02_ecr_eco.sql` (fonction `pub_signaler_avancement_eco`), `drizzle/0009_partage.sql`
  et `0013_share_health_filter.sql` (définitions de `pub_non_conformites` et `pub_hse_projet`), `src/lib/rules/inbound.ts`
  (règles appliquées aux demandes).
- Matrix `main` : `data/publications-depot.json` (définitions de `pub_ordres_modification`, `pub_eco_approbations`,
  `pub_eco_effectivite`, `pub_demandes_recues` et liens), `data/contrats/vigie.pub_demandes_recues.json`,
  `infra/postgres/partage/90-droits.sql` (droits de lecture de `keystone_app`), `REQUESTS.md`.

Une migration : **0077** (`drizzle/0077_vigie_request_outcome.sql`, renumérotée à l’intégration) — quatre colonnes sur chacune des deux files d’envoi
(`vigie_outcome`, `vigie_result_code`, `vigie_result`, `vigie_processed_at`). Aucune vue `pub_`, aucun droit accordé (M-18).

## 1. Ce qui a été construit

### Configuration

- `VIGIE_SOURCE` = `server` | `simulation` (défaut `server` avec `DATABASE_URL`, sinon `simulation` ; `server` sans
  `DATABASE_URL` = erreur), comme `ARCHE_SOURCE`. `VIGIE_API_URL` / `VIGIE_API_KEY` ne sont plus lues (avertissement si elles sont
  posées, pour qu’une ancienne configuration démarre). Mode du connecteur : `sql` (« Connecteur actif · vues de la base
  partagée ») ou `mock`. `.env.example`, `docs/EXPLOITATION.md` § 4 et `CONNECTOR_ENV` (Administration) mis à jour ;
  `scripts/db-check.ts` force `simulation` (le serveur de la CI n’a pas de schéma `vigie`), `tests/e2e/run.ts` aussi.

### Lectures (D13 point 1, D12 point 1)

`src/server/integrations/vigie/server.ts` lit, par `select to_jsonb(v) from vigie.<vue> v` (une colonne ajoutée en fin de vue ne
casse rien) : `pub_non_conformites`, `pub_hse_projet`, `pub_ordres_modification`, `pub_eco_approbations`, `pub_eco_effectivite`.
Les lignes sont contrôlées par `src/domain/vigie-views.ts` (pur, testé) : ligne mal formée (numéro qui n’est pas `EV-AAAA-n` ou
`ECO-AAAA-NNN`, code inconnu) écartée et comptée ; NC d’un projet absent de Keystone écartée. Correspondances : celles des
demandes (`eco_type` → type, `requested_by_name` → requestedBy, `vigie_updated_at` → updatedAt, `approval_key` → key,
`approver_text` → approver…). Les colonnes de partage D13 déjà présentes dans le miroir (`closed_on`, `supplier_id`,
`owner_matricule`) et `released_at` (D12) sont maintenant écrites. Source de NC `design` (« Conception BE » de Vigie) ajoutée au
code `ncrSource` (« Design office » / « Bureau d’études »).

Rafraîchissement : comme avant (à la lecture au plus une fois par minute, « Synchroniser », travail `vigie-outbox` pour l’envoi) ;
une vue illisible (lien ou publication absents, serveur arrêté) garde le miroir et journalise un avertissement. Plus aucun appel
HTTP vers Vigie. Le simulateur (`mock`) reste : miroirs de la démonstration, avancement « en attente de synchronisation ».

### Avancement (D13 points 3 et 4, D12 points 2 et 3)

- `select vigie.pub_signaler_avancement_nc(p_numero => …, p_projet => …, p_nature => 'step' | 'verification', p_etape_depuis,
  p_etape_cible (step seulement), p_decision (verification), p_commentaire, p_acteur_nom, p_acteur_role, p_enregistre_le,
  p_id_externe => id de l’entrée, p_activite / p_article / p_livrable => null)`.
- `select vigie.pub_signaler_avancement_eco(p_numero, p_nature => 'step' | 'approval', p_cle, p_decision, p_etape_depuis,
  p_etape_cible, p_commentaire, p_acteur_nom, p_acteur_role, p_enregistre_le, p_id_externe)`.
- Le numéro rendu (numéro de la demande dans Vigie) est gardé dans `vigie_ref` de l’entrée. Renvoyer la même entrée redonne la
  même demande (`p_id_externe`).
- États de la file (`VigieSyncStatus`) : `pending` (pas encore déposée ; une erreur passagère — fonction ou lien absent, serveur
  injoignable — la laisse `pending` avec son erreur, elle est renvoyée), `sent` (déposée), `failed` (P0V01 appelant non admis ou
  P0V02 argument invalide : jamais renvoyée telle quelle), **`refused`** (nouveau : Vigie a rejeté la demande à son traitement ; fin
  des renvois ; « Refusée par Vigie »).
- Réponse asynchrone : `vigie.pub_demandes_recues` (publication de Matrix, filtre `caller = session_user`) est lue pour les
  entrées déposées dont l’issue est inconnue ou encore `received` : `applied`, ou `rejected` → `refused` avec `code_resultat` et
  `resultat` gardés. Vue absente : les entrées restent `sent`, issue inconnue (aucune erreur).
- Affichage : une entrée en attente (pending, ou déposée et encore `received`, ou déposée après le dernier rafraîchissement)
  donne le statut demandé et bloque une deuxième demande ; une entrée `failed` ou `refused` est montrée (avec le motif de Vigie)
  tant qu’elle est la dernière et que la fiche n’a pas bougé, sans jamais bloquer une nouvelle demande
  (`src/server/integrations/vigie/outbox-state.ts`). Le compteur « échecs » de la ligne Vigie (Activité et intégrations) compte
  `failed` et `refused`.

### Règles restrictives de Vigie reprises dans Keystone (D13 point 5, D12 point 3)

- NC : étape suivante seulement ; **jamais « Confinement »** (qualification par le QHSE de Vigie) ni « Clôturée » : le bouton
  « → Confinement » d’une NC ouverte disparaît (`ncrKeystoneStep`, `ncrActionFor`, `canStep`) et le serveur refuse (« the containment
  step is decided in Vigie ») ; motif du refus frais « Le confinement se décide dans Vigie ».
- Vérification : une proposition au QHSE de Vigie. Acceptée (`applied`), elle reste affichée (« Clôture demandée ») et bloque une
  deuxième vérification tant que la NC est encore « Vérification » dans Vigie ; elle disparaît quand Vigie clôt ou renvoie la NC.
- ECO : clés **englead et pm seulement** (`KEYSTONE_ECO_KEYS`, `ecoKeyDecidedInKeystone`) : la clé qualité n’est plus décidable dans
  Keystone (boutons absents, file « Mes approbations » vide pour la qualité, refus serveur « … approval is decided in Vigie »,
  indication « L’approbation qualité se décide dans Vigie. ») ; jamais `released` ni `rejected` (Keystone n’a que « Démarrer
  l’analyse d’impact » et « Soumettre à approbation », interchangeabilité exigée — inchangé).
- Les références activité / article / livrable (`p_nature => 'references'`) ne sont pas envoyées : Keystone n’a pas d’écran qui
  les pose (rien de nouveau construit sans validation).

### Numéro des NC (D13 point 2, CV-07) et données de démonstration

Le numéro d’une NC est la référence EV-… de Vigie (`number = vigie_ref`). La démonstration est renumérotée par un seul module,
`src/domain/vigie-demo.ts` : Harbor Line « NCR-0nn » → « EV-2026-0nn » (chiffres du prototype gardés) ; la paire générée NCR-040 /
NCR-041 des autres projets avec données devient unique par projet (NDC-031 : EV-2026-040/041, RCF-019 : 042/043, ERP-202 :
044/045, WSA-044 : 046/047, MSR-012 : 048/049). Appliqué au chargement des données du prototype (`src/server/prototype/index.ts`,
`demoNcrDeep` : NC, liens des rapports journaliers, réserves, notifications, tirages de provision, textes et clés du dictionnaire
français) et à l’instantané des NC (`prototypeNcrSnapshot`, `vigieRef` = numéro). Liens profonds : `/evenements?etat=tous&sel=EV-…`
(inchangé, le numéro étant la référence). Les analyseurs de référence acceptent `EV-AAAA-n` (tirages de provision, liens des
rapports journaliers) ; exemples de saisie « ex. EV-2026-029 ».

Les quatre textes de démonstration qui citent une NC et que le dictionnaire français traduisait (« NCR-029 raised — Critical »,
activité, tirage de provision) ont leur entrée française sous le nouveau numéro (`src/i18n/extra/d9-vigie-views.json`).

Tests dorés : les valeurs du prototype (fichiers `*.golden.json` générés depuis la maquette, et le harnais des réunions qui
l’exécute) sont comparées après passage par `demoNcrGolden` (même règle que les données ; sous une clé de projet, la numérotation
de ce projet) ; chaque attente changée cite D13 dans un commentaire. La comparaison au prototype est donc gardée partout.

## 2. Écarts de comportement visibles (attentes de tests modifiées)

| Ce qui change | Pourquoi |
|---|---|
| Numéros de NC « EV-2026-0nn » partout dans la démonstration ; recherche « ev-2026-029 » | CV-07 |
| Sur RCF-019, ERP-202, WSA-044, MSR-012 les NC générées ne s’appellent plus NCR-040 / 041 mais EV-2026-042… 049 | unicité des références de Vigie |
| Plus de « → Confinement » sur une NC ouverte (prototype : oui) | règle de Vigie (qualification par le QHSE) |
| La qualité ne décide plus sa clé d’ECO dans Keystone ; indication « Passez en Responsable ingénierie ou Chef de projet… » (la qualité n’est plus citée) | D12 point 3 |
| Une erreur passagère laisse l’entrée « en attente » (avant : « échec » puis renvoi) | D12/D13 : « failed » réservé à P0V01 / P0V02 |
| Tests HTTP (fetch simulé) remplacés par des tests sur le schéma `vigie` simulé dans PGlite | plus d’API |

## 3. Tests

- `src/test/vigie-server.ts` : côté Vigie du serveur dans PGlite — vues aux colonnes des contrats (tables de support remplies par
  les tests), les deux fonctions **copiées des migrations 0026 et 0029 de Vigie** (mêmes contrôles, mêmes SQLSTATE),
  `pub_demandes_recues` selon la définition de Matrix, et `processVigieRequests` qui joue le traitement de Vigie.
- `src/server/integrations/vigie/views-d12-d13.test.ts` (13 cas : lectures, paramètres nommés, idempotence, stale → refused,
  proposition de vérification, Confinement refusé, P0V01, P0V02, vue d’état absente, clé englead / qualité, étape d’ECO).
- `src/domain/vigie-views.test.ts`, `src/domain/vigie-demo.test.ts` (règles pures).
- Réécrits sur le serveur simulé : `refresh-d8.test.ts`, `outbox.test.ts`, `jobs.test.ts` (Vigie), `delivery4-writes.test.ts`,
  `delivery5-writes.test.ts`, `features/admin/model.test.ts` (connecteur actif en mode `sql`), tests de configuration.
- Pas de nouveau test PostgreSQL réel : le chemin SQL est le même sur PGlite (fonctions plpgsql, paramètres nommés) ; sur le
  serveur il dépend des liens de Matrix (ci-dessous).

## 4. Décisions prises sans demander

1. `VIGIE_SOURCE` par défaut `server` avec `DATABASE_URL` (comme Arche et Matrix) ; `db-check` et l’e2e forcent `simulation`.
2. Refus « stale » : pas de renvoi automatique « d’après le nouvel état » (la demande D13 l’évoquait) — Keystone ne décide pas à la
   place de la personne : l’entrée passe « refusée » avec le motif, le miroir rafraîchi montre le nouvel état et la personne
   peut redemander. Facile à changer dans `outcomeUpdate` si le responsable préfère un renvoi.
3. Une entrée `refused` / `failed` reste visible (dernière entrée, fiche inchangée) mais ne bloque rien.
4. Une demande restée `received` (traitement de Vigie arrêté) bloque une nouvelle demande sur la même fiche, comme une demande
   en attente ; Vigie en fait une échéance de son QHSE au-delà d’un jour.
5. Toutes les ECO publiées par `pub_ordres_modification` sont gardées (elles portent les articles et projets de Keystone).
6. Les notifications R-015 (« NC émise dans Vigie », « ECO en attente de votre approbation ») sont maintenant actives en mode
   `sql` ; la clé qualité reste citée dans le second avis (la personne approuve alors dans Vigie).
7. Texte du journal d’activité de la vérification inchangé (« Verified and closed … · en attente de synchronisation ») ; le
   statut demandé reste « Clôturée » tant que la proposition attend.

## 5. Ce qui reste — à demander à Matrix et à Vigie (rien n’a été écrit dans leurs dépôts)

Vérifié dans `data/publications-depot.json` et `REQUESTS.md` de Matrix (`main` du 7 nov.) :

| Objet | Nature | État chez Matrix | À faire |
|---|---|---|---|
| `vigie.pub_non_conformites`, `vigie.pub_hse_projet` | lecture `keystone_app` | droits dans `90-droits.sql` (vues de Vigie, reprises par Matrix) | rien |
| `vigie.pub_ordres_modification`, `pub_eco_approbations`, `pub_eco_effectivite` | lecture `keystone_app` | définies au dépôt, droits dans `90-droits.sql` | appliquer sur le serveur (migration 0029 de Vigie passée) |
| `vigie.pub_signaler_avancement_nc` | exécution `keystone_app` | lien préparé (demande Vigie → Matrix du 05/11, ACCEPTÉE) | « Autoriser » sur le serveur en service |
| `vigie.pub_demandes_recues` | lecture `keystone_app` | publication et lien préparés (ACCEPTÉE) | appliquer sur le serveur |
| **`vigie.pub_signaler_avancement_eco`** | **exécution `keystone_app`** | **absent** du dépôt des publications et de `REQUESTS.md` de Matrix | **à demander** (par Vigie, propriétaire, ou par Keystone après « validé ») : lien `execution` keystone_app → `vigie.pub_signaler_avancement_eco(text, text, text, text, text, text, text, text, text, timestamptz, text)` |
| contrat `vigie.pub_demandes_recues.json` | — | colonne `nature` décrite `nc_*` seulement | signaler que la vue montre aussi `eco_step` / `eco_approval` (D12) ; Keystone ne lit pas `nature` |

Tant que ces liens manquent, Keystone fonctionne en état « en attente » clair : une vue illisible garde le miroir, une fonction
non exécutable laisse l’entrée « en attente de synchronisation avec Vigie » avec l’erreur, renvoyée par le travail
`vigie-outbox` dès que le lien existe ; une vue d’état illisible laisse les entrées « envoyées ».

## 6. Statut des demandes

- D13 : **FAITE** côté Keystone (lectures, numéro CV-07, avancement, réponse asynchrone, règles, liens) ; fonctionnement réel
  au premier passage des liens de Matrix sur le serveur.
- D12 : **ACCEPTÉE** (construit côté Keystone) ; passera à FAITE quand Matrix aura appliqué les trois publications et ajouté le lien
  d’exécution `pub_signaler_avancement_eco` (manquant, § 5).
