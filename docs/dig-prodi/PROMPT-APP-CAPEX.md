# Prompt de démarrage — application CAPEX (DIG-PRODI)

> À coller dans un **nouveau chat Claude Code**, ouvert sur le **nouveau dépôt** de l’application CAPEX (à créer sur GitHub
> avant, par exemple `Yhumiii27/<nom-de-l-app>`), avec le dépôt `Yhumiii27/Keystone` ajouté **en lecture**. Remplacer
> `<NOM>` par le nom choisi pour l’application.

---

Tu démarres **<NOM>**, la nouvelle application du groupe pour piloter les **CAPEX des filiales** selon la méthodologie
**DIG-PRODI v4.0**. Réponds-moi en français ; le code, les identifiants et les messages de commit sont en anglais ; l’interface
est en anglais traduit, le français étant la langue par défaut.

## 1. Contexte à lire d’abord (dépôt Keystone, en lecture seule)

Ajoute le dépôt `Yhumiii27/Keystone` à la session **en lecture** et lis, dans cet ordre :
1. `docs/dig-prodi/CDC-DIG-PRODI-v4.0-draft.md` — le cahier des charges (brouillon) et la note du responsable produit.
2. `docs/dig-prodi/ANALYSE-DIG-PRODI.md` — l’analyse : incohérences du CDC à corriger (§1.3, C-1 à C-13), correspondance
   des cycles de vie (§2), comparaison (§3), lots D-1 à D-12 (§4), décisions (§6).
3. `docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md` — **la référence** : décisions A-1 à A-4, contrats d’échange (vues `pub_`),
   ce qui reste dans Keystone.
4. Le socle à reprendre : `CLAUDE.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/EXPLOITATION.md` (§4.1 serveur PostgreSQL
   commun, §12 Coolify), `drizzle/0035_share.sql` (exemple de vues `pub_`).

**Ne modifie jamais le dépôt Keystone** (ni Matrix, Codex, Vigie, Cursus). S’il faut un changement côté Keystone (nouvelle vue
`pub_`, connecteur), écris-le comme une demande précise dans `docs/DEMANDES-KEYSTONE.md` de ton dépôt ; je la transmettrai au
chat Keystone.

## 2. Périmètre de <NOM>

Le niveau **CAPEX usine** (N1) : la filiale monte une usine ou une ligne ; le groupe arbitre.
- **CAPEX** : filiale, site, sponsor, chef de projet filiale, CDG, typologie Light / Stratégique (CAPEX / CA de la filiale,
  seuil 20 %, forçable avec motif), lots (génie civil, bâtiments, utilités, VRD, recrutement, machines…), budget par classe
  d’estimation, risques, décisions.
- **Cycle DIG-PRODI** : 4 phases (Cadrage & Opportunités, Avant-Projet APS→APD, Exécution, Démarrage / Ramp-up / Transfert),
  jalons **G1** « Go Études » (COPIL GPI, 2 jours max), **G2** « Single Gate PDG », **G3** « Go Transfert / Clôture »
  (réserves soldées + 30 jours à capacité nominale, ≤ 6 mois après le début de la MES).
- **3 dossiers vivants** sous workflow : Business Case Cadrage (BP ±50 %), Dossier Investissement (pack ingénierie > 80 %,
  AFE, autorisations ICPE / PC / PLU / ATEX, BP DAF +10/−5 %), Dossier Transfert & REX (PV de transfert d’actif contresigné
  Client Interne + Dir.IG, quitus PSSR, clôture comptable, REX).
- **Circuits** : visas et signatures des jalons (signature simple Entra + horodatage + empreinte du dossier figé au départ ;
  signature avancée pour G2 plus tard), **avis d’experts asynchrones** (Qualité, HSE, DAF, Exploitation), matrice de
  délégation du Copil projet par typologie et par montant.
- **Gouvernance** : gabarit de staffing par typologie, cadence de revue (trimestrielle / mensuelle) et alertes de revue en
  retard, rapport Copil.
- **Tableaux de bord** : maturité des études (% pack), écart d’incertitude, courbe en S consolidée, jalons G et HS,
  avenants / MoC, **ramp-up** (capacité, TRS / OEE, rebuts, 30 jours continus).
- **Besoins machines** : depuis un CAPEX, la filiale demande une ou plusieurs machines **du catalogue EPC2i** (lu dans
  Keystone) ; EPC2i répond dans Keystone ; au G2 le besoin passe à « commandé ».
- **Profils** : Sponsor, Chef de projet filiale, CDG filiale, Co-DIG, Dir.IG, PDG, DAF groupe, SSE groupe, PMO EPC2i,
  Expert (Qualité / HSE / Exploitation), membre COPIL GPI, lecteur Directeur de Zone. Isolation par filiale ; vues croisées
  pour les fonctions centrales ; le PDG voit tout.

**Hors périmètre** (appartient à un autre outil, à afficher et ouvrir par lien profond seulement) : la conception et la
fabrication des machines, le catalogue machines, les devis et offres EPC2i (Keystone) ; HazID / HazOp / AMDEC / PSSR et
actions de sécurité (Vigie, à confirmer) ; documents (Codex) ; personnes et habilitations (Cursus).

## 3. Architecture imposée

- **Données communes** : serveur PostgreSQL commun EPC2I (décision M-01 du dépôt Matrix), base `epc2i`, **schéma `capex`**
  (nom à confirmer) et rôle `capex_app`, sans droit sur les autres schémas. Tu n’écris **que** dans ton schéma ; tu lis les
  autres outils **uniquement** par leurs vues `pub_` (en lecture, droits accordés par `partage/90-droits.sql` de Matrix).
  Tu publies tes propres vues `pub_` (`pub_capex`, `pub_besoins_machines`, `pub_rampup`) : ce sont des contrats — une colonne
  n’est jamais supprimée ni renommée, les nouvelles vont en fin de vue. Les scripts Matrix (création du schéma, du rôle,
  droits) sont à **proposer** dans `docs/DEMANDES-MATRIX.md`, pas à écrire dans le dépôt Matrix.
- **Lectures Keystone** : `pub_catalogue_machines`, `pub_reponses_besoins`, `pub_projets`, `pub_jalons_projets`,
  `pub_avancement_projets`, `pub_avenants`, `pub_reserves`, `pub_livrables`, `pub_pack_ingenierie`, `pub_parc_machines`.
  La plupart **n’existent pas encore** (lots R-186 à R-191 de Keystone) : construis un **connecteur `keystone`** avec un
  miroir en lecture et une **simulation** (données de démonstration cohérentes) tant que les vues manquent, sur le modèle des
  connecteurs de Keystone (`src/server/integrations/<app>/` : miroir, liens profonds, simulation, interrupteur).
- **Socle repris de Keystone, une fois** (décision A-3) — copie **uniquement** du socle, jamais des modules métier :
  configuration validée (`src/server/config/`), journaux et santé (`/api/health`), horloge métier (`src/domain/clock.ts`,
  `src/server/clock.ts`), connexion Microsoft Entra ID et session (`src/server/auth/`), piste d’audit append-only, moteur
  « Mes validations » (`src/domain/approvals.ts`, `src/server/approvals/` — le moteur, pas les fournisseurs métier), tâches
  planifiées et worker (`src/server/jobs/`), i18n et contrôle de complétude du français (`src/i18n/`), design Nocturne
  (`src/styles/nocturne.css`, `src/components/ds`, `src/components/app`), coquille et registre d’écrans, durcissement HTTP,
  conteneur, Coolify, sauvegardes, CI. Note dans `docs/SOCLE.md` le commit Keystone d’origine de chaque élément repris : le
  socle sera ensuite extrait en paquet partagé `@epc2i/socle` (lot R-194 de Keystone) et ces copies seront remplacées.
- **Pile** : la même que Keystone (Next.js 16 — lis `node_modules/next/dist/docs/` avant d’écrire du code, cette version a des
  changements cassants —, Drizzle, PostgreSQL / PGlite pour le développement et les tests, Vitest, Playwright).
- **Hébergement** : données en France (exigence du CDC) ; l’IA (aide à la décision) est désactivable et ne s’active qu’avec un
  fournisseur conforme (question I-1a / C-13).
- **Ports sur le Mac du responsable produit** : n’utilise ni ne tue jamais 3000 (Keystone), 3100 / 3110 (Codex), 3200
  (Vigie), 3210 / 3217 / 5173 (Cursus), 3310 (tests de Keystone). Prends **3400** pour <NOM> (et 3410 pour ses tests).

## 4. Méthode

1. **Livraison 0 — cadrage (documents seulement, pas de code)** :
   - `docs/spec/` : écrans, objets, règles, profils et droits, cycle DIG-PRODI paramétré, dossiers vivants, circuits ;
   - `docs/DECISIONS.md` : les questions ouvertes (C-1 à C-13 de l’analyse, A-1 à A-4, §4 de l’architecture), chacune avec
     une proposition par défaut — je réponds avant la livraison 1 ;
   - `docs/CONTRATS.md` : le détail colonne par colonne des vues `pub_` lues et publiées ;
   - `docs/DEMANDES-KEYSTONE.md` et `docs/DEMANDES-MATRIX.md` ;
   - un plan de livraisons (`docs/PLAN.md`) aligné sur le §5 du CDC (cadrage, tests IT, pilote 1–2 CAPEX, déploiement).
   Arrête-toi là et présente-moi le cadrage avant de coder.
2. **Livraison 1 — socle** : reprise du socle, coquille vide, connexion, profils, isolation par filiale, santé, CI verte.
3. **Livraisons suivantes** (dans l’ordre du plan validé) : CAPEX et cycle DIG-PRODI ; dossiers vivants et circuits de
   jalons ; besoins machines et connecteur Keystone (simulation d’abord) ; tableaux de bord ; ramp-up et transfert ; IA.
4. **À chaque livraison** : tests unitaires et de bout en bout, typecheck, lint ; notes de livraison ; une page « reste à
   développer » tenue à jour comme dans Keystone (`docs/reste-a-developper.json` → `npm run remaining:page`).
5. **Règles reprises de Keystone** : rien hors du CDC sans mon accord ; ce que les gens tapent s’affiche tel quel (pas de
   `t()`) ; la piste d’audit n’est jamais modifiée ni effacée ; chaque Server Function valide l’entrée et les droits côté
   serveur ; migrations générées, jamais réécrites ; chaque lot vérifié va dans `main` par une PR fusionnée une fois la CI
   verte.

Commence par lire les documents du §1, puis propose-moi le cadrage de la livraison 0.
