# Delivery 8 — plan

> **Resume point.** Delivery 8 builds the items of `docs/RESTE-A-DEVELOPPER.md` that can be built now after delivery 7. A triage workflow (11–12 Oct 2026) examined the 103 remaining items that are not "à décider": one agent per batch read each item, the owner's answers and the current code, then an independent skeptic tried to refute every "buildable" verdict. 90 items came out buildable or partly buildable, 13 blocked; the planning step kept the ones that can be built in parallel without stepping on each other and excluded the rest (§4). Each lot writes `docs/delivery-8/notes-<lot>.md`; the detailed brief of every lot is in `docs/delivery-8/lot-briefs.md`. When everything is integrated and reviewed, write `docs/DELIVERY-8.md` (same structure as `DELIVERY-7.md`).

## 1. Lots

Merge order: `audit-i18n-shell` → `platform-ops` → `roles-rates-hr` → `cost-change` → `supply-engineering` → `connectors` → `docs-client-portfolio` → `work-planning` → `site-quality`.

| # | Lot | Theme | Items | Migration |
|---|---|---|---|---|
| 1 | `audit-i18n-shell` | Append-only audit trail with actor user, French completeness guard and message keys for the activity feed, portfolio-wide search, sidebar, date-offset fix and the 'Transfert' wording | R-168, R-184, R-052, R-151, R-167, R-156 | yes |
| 2 | `platform-ops` | Production platform kit: container and Coolify deployment, backups and restore, dependency watch and security policy, antivirus on uploads, French runbook and role guides | R-003, R-004, R-174, R-175, R-177 | yes |
| 3 | `roles-rates-hr` | Roles and HR: Finance role and 'View as client' entry, dated rate grid with one valuation rule, production rate coefficients, portfolio labour cost by zone, skills indicators, hours variance threshold | R-044, R-139, R-083, R-178, R-086, R-087, R-088 | yes |
| 4 | `cost-change` | Change control and cost: sequential CR chain with CCB threshold and CR notifications, CR justification, cost categories frozen after BL1, billing blocked over 100 %, Budget KPI thresholds, BL1 deliverable tick | R-069, R-015, R-081, R-077, R-080, R-054, R-140 | yes |
| 5 | `supply-engineering` | Purchasing and engineering: purchase-order cancellation, honest Sage X3 mock, part validation, BOM substitution cost and duplicate flag, P&ID catalogue search and revision gap, installed-base pins, after-sales warranty figures and fleet-wide forms | R-095, R-034, R-102, R-104, R-108, R-109, R-110, R-111, R-145, R-155, R-153 | yes |
| 6 | `connectors` | Vigie and Cursus connectors on the Keystone side: mirror pruning and contract, project-filtered links, rejected-receipt NCR link and alerts, dormant Vigie notification hooks, Cursus staff directory, Cursus event endpoint, absences from Cursus and GDPR minimisation of leave | R-023, R-024, R-025, R-096, R-015, R-027, R-029, R-031, R-173 | yes |
| 7 | `docs-client-portfolio` | Codex documents and client portal documents, plus portfolio views: Codex connector links/state/index read, record-only history, clickable relations, computed client document categories, 5-axis scoring, projects map, sliding portfolio schedule | R-033, R-127, R-128, R-138, R-134, R-135, R-136 | yes |
| 8 | `work-planning` | Personal work, meetings, requests and plan: @mentions and task notifications, board drag-and-drop, meeting follow-up tasks, honest Outlook/Teams labels and read receipts, sourcing task to procurement, re-requests, confirmation toasts, plan trash positions, plan owner names, interface received date | R-149, R-015, R-150, R-067, R-037, R-089, R-090, R-152, R-064, R-172, R-116 | yes |
| 9 | `site-quality` | Quality and site: one punch list per project, ITP systems frozen per project, site sheet created and filled by the PM, computed site-team conflicts with arbitration, daily report without the incident box, targeted Cursus employee link | R-117, R-057, R-118, R-119, R-122, R-032 | yes |

Items split across lots: R-015 (change-request events in `cost-change`; deliveries, invoices and the dormant Vigie hooks in `connectors`; mentions and assigned tasks in `work-planning`).

### Items

| Item | Lot | Verdict | Effort | Title |
|---|---|---|---|---|
| R-168 | `audit-i18n-shell` | buildable | M | Renforcer le journal d'audit (avant / après, motif, utilisateur, immuabilité) |
| R-184 | `audit-i18n-shell` | buildable | L | Contrôler automatiquement la complétude de la traduction française |
| R-052 | `audit-i18n-shell` | buildable | S | Étendre la recherche globale au portefeuille, filtrée selon les droits |
| R-151 | `audit-i18n-shell` | buildable | S | Toujours afficher le nom du groupe dans une section de menu repliée |
| R-167 | `audit-i18n-shell` | buildable | S | Corriger isoOfDayOffset pour les décalages négatifs |
| R-156 | `audit-i18n-shell` | buildable | S | Traduire l’étape « Handover » par « Transfert » |
| R-003 | `platform-ops` | partly buildable | M | Host a multi-user instance (beta, then production) |
| R-004 | `platform-ops` | partly buildable | M | Backups and restore (RPO ≤ 15 min, RTO ≤ 4 h) |
| R-174 | `platform-ops` | partly buildable | S | Faire auditer la sécurité avant production (test d'intrusion, veille des dépendances) |
| R-175 | `platform-ops` | buildable | M | Analyser par antivirus les fichiers déposés dans Keystone |
| R-177 | `platform-ops` | partly buildable | M | Rédiger le guide utilisateur, former par rôle et organiser le support |
| R-044 | `roles-rates-hr` | partly buildable | M | Créer le rôle Finance (contrat, facturation, grille de taux) |
| R-139 | `roles-rates-hr` | partly buildable | S | "View as client" entry for the director and the project's PM (P-11) |
| R-083 | `roles-rates-hr` | partly buildable | L | Dater la grille de taux par rôle et unifier la valorisation des heures |
| R-178 | `roles-rates-hr` | partly buildable | S | Fournir et charger les listes de référence réelles d'EPC2i |
| R-086 | `roles-rates-hr` | buildable | S | Afficher le coût main-d’œuvre du portefeuille par zone sur Ressources |
| R-087 | `roles-rates-hr` | buildable | S | Compétences : échelle unique 1–5 et deux indicateurs |
| R-088 | `roles-rates-hr` | buildable | S | Rendre réglable le seuil d’écart d’heures (±10 %, inclus), couleurs distinctes |
| R-069 | `cost-change` | partly buildable | M | Rendre séquentiel le circuit des CR avec étapes non requises automatiques |
| R-015 | `cost-change` | partly buildable | L | Notifier les événements clés aux personnes concernées (X-6a) |
| R-081 | `cost-change` | buildable | M | Figer le montant des catégories de coûts après BL1 |
| R-077 | `cost-change` | buildable | M | Bloquer la facturation quand les jalons dépassent 100 % |
| R-080 | `cost-change` | buildable | S | Colorer les indicateurs du Budget selon les seuils et signer les barres d’écart |
| R-054 | `cost-change` | buildable | S | Lier le livrable « Planning BL1 posé » à la référence BL1 réelle |
| R-140 | `cost-change` | buildable | S | Show the CR justification in the CR drawer and to the client (X-11) |
| R-095 | `supply-engineering` | partly buildable | M | Cancel a purchase order with a reason (draft now; placed order after arbitration) |
| R-034 | `supply-engineering` | partly buildable | S | Construire le connecteur Sage X3 (extractions quotidiennes et envois) |
| R-102 | `supply-engineering` | partly buildable | M | Mettre en place la validation des articles par l'ingénierie |
| R-104 | `supply-engineering` | buildable | S | Chiffrer les remplacements d'articles entre deux révisions |
| R-108 | `supply-engineering` | buildable | M | P&ID : rechercher l'article d'un repère dans tout le catalogue |
| R-109 | `supply-engineering` | buildable | S | P&ID : signaler l'écart de révision avec Codex et proposer un ré-import |
| R-110 | `supply-engineering` | buildable | S | Ne protéger pour le parc que les pièces réellement montées |
| R-111 | `supply-engineering` | buildable | S | Signaler le doublon possible de la grue EQ-CRN-250T / ASM-RMG-250 |
| R-145 | `supply-engineering` | buildable | S | Coût garantie sur l'année civile et alerte sur la fin prolongée (NEW-D5-2 « a ») |
| R-155 | `supply-engineering` | buildable | S | Corriger le message de zone vide des listes de machines |
| R-153 | `supply-engineering` | buildable | S | Retirer le nom du projet des formulaires qui ne visent pas un projet |
| R-023 | `connectors` | partly buildable | S | Connect Vigie's real API (NCR, HSE, ECO) and switch to the Vigie number |
| R-024 | `connectors` | partly buildable | S | Have Vigie build its ECO module with the proposed addresses |
| R-025 | `connectors` | partly buildable | S | Prefill Vigie reports and filter its lists by project |
| R-096 | `connectors` | buildable | S | Rejected receipt: prefilled Vigie supplier NCR and buyer alert |
| R-015 | `connectors` | partly buildable | L | Notifier les événements clés aux personnes concernées (X-6a) |
| R-027 | `connectors` | partly buildable | M | Import Cursus's staff directory (matricule ↔ person) |
| R-029 | `connectors` | buildable | M | Créer le point d'entrée des événements poussés par Cursus |
| R-031 | `connectors` | partly buildable | M | Recevoir les absences de Cursus et débrancher Lucca |
| R-173 | `connectors` | partly buildable | S | Mettre Keystone en conformité RGPD (données personnelles, conservation, sous-traitants) |
| R-033 | `docs-client-portfolio` | partly buildable | M | Construire le connecteur Codex (index, approbations, dépôts, liens profonds) |
| R-127 | `docs-client-portfolio` | partly buildable | S | Limiter la reprise Codex à la fiche, à la révision et au circuit en cours |
| R-128 | `docs-client-portfolio` | buildable | S | Rendre cliquables les relations Livrable, Commande et Réserve d’un document |
| R-138 | `docs-client-portfolio` | partly buildable | M | Client portal: document categories computed from the Codex index (L-9) |
| R-134 | `docs-client-portfolio` | buildable | S | Score a proposal on the 5 ranking axes |
| R-135 | `docs-client-portfolio` | buildable | M | Projects map: stage-coloured tag, 'Clos / annulé' legend, keyboard markers |
| R-136 | `docs-client-portfolio` | buildable | M | Portfolio schedule: sliding 24-month window, quarter steps |
| R-149 | `work-planning` | buildable | M | Notifier les personnes mentionnées par @ dans les commentaires de tâche |
| R-015 | `work-planning` | partly buildable | L | Notifier les événements clés aux personnes concernées (X-6a) |
| R-150 | `work-planning` | buildable | S | Changer le statut d'une tâche par glisser-déposer dans le Tableau |
| R-067 | `work-planning` | buildable | M | Créer les tâches de suivi des actions de compte rendu avec l'échéance saisie |
| R-037 | `work-planning` | partly buildable | S | Synchroniser les réunions Outlook / Teams vers Keystone (S-11) |
| R-089 | `work-planning` | partly buildable | M | Envoyer aux achats une tâche pour trouver l’intervenant externe |
| R-090 | `work-planning` | buildable | S | Allow re-requesting a withdrawn resource request (P-8c) |
| R-152 | `work-planning` | buildable | S | Afficher les messages de confirmation manquants |
| R-064 | `work-planning` | partly buildable | S | Corbeille du Plan : confirmer rétention et droits, purge planifiée |
| R-172 | `work-planning` | partly buildable | S | Solder les TODO(db) restants (import P&ID, lien CR ↔ activité, nom du responsable) |
| R-116 | `work-planning` | buildable | S | Dater la réception d’une interface |
| R-117 | `site-quality` | buildable | M | Fusionner les réserves ITP et chantier en une liste unique par projet |
| R-057 | `site-quality` | buildable | S | Figer dans le projet les systèmes ITP du type de machine |
| R-118 | `site-quality` | partly buildable | L | Permettre au CP de créer et renseigner la fiche chantier |
| R-119 | `site-quality` | partly buildable | L | Détecter et lever automatiquement les conflits de l’équipe chantier |
| R-122 | `site-quality` | buildable | S | Retirer la case incident du rapport journalier au profit de Vigie |
| R-032 | `site-quality` | partly buildable | S | Finaliser les liens ciblés et les relances vers Cursus |

## 2. Defaults taken for open points (owner to confirm)

| Point | Default built | Why |
|---|---|---|
| Business 'today' in every delivery-8 feature | The frozen demo anchors stay 'today' (NOW_ISO 30 Sep, STATUS_ISO 25 Sep, PG_NOW, CODEX_TODAY_ISO); new pure rules take today as a parameter | R-013 (real clock) and S-4 (data date) are not in this delivery; one switch later instead of a partial clock |
| Notification channel and mechanics | Keystone bell only; createNotification({ toPersonIds }) after the writer's transaction commits, actor removed, try/catch + logError, never undoing the write; fixed English titles translated by t(), typed text in the sub-line shown with fieldsText; clients only through the existing read-time filter | X-6a/X-6b; no mail relay (R-036 excluded); transactions may rerun (R-010); R-148 |
| Translations | FR strings only in src/i18n/extra/d8-<lot>.json (pre-registered); fr-dict.json not edited; deliberate overrides of prototype keys allowed in the d8 file and listed with their decision id in the dictionaries-test allowlist | Parallel lots never edit the same dictionary; fr-dict.json stays the prototype copy; clashes caught by the extended dictionaries test (R-184) |
| Prototype goldens | Not regenerated; the test overrides the expectation with a comment citing the decision; only exception R-104 (goldens regenerated from the prototype with an explicit E-2b patch and a hand-checked diff) | CLAUDE.md golden rule |
| Migrations | One generated migration per lot (+ custom ones where stated); at integration each lot's migrations are dropped and regenerated in merge order, custom ones re-created with `drizzle-kit generate --custom` and the same SQL, in the order the lot's notes give | Delivery 7 practice; never edit an existing migration |
| Persona count in tests | Tests loop over PERSONAS / role lists; the Finance persona (R-044) makes 9 | Avoid broken counts when roles-rates-hr merges |
| Remaining-work page | Only the integrator updates docs/reste-a-developper.json (progress, history, updated) after each merge, runs npm run remaining:page, commits and republishes the artifact to the same URL; lots report in docs/delivery-8/notes-<lot>.md | Standing rule, without nine-way conflicts on one JSON |
| Items split over lots | R-015 (CR events in cost-change; delivery/invoice and dormant Vigie hooks in connectors; mention and task assigned in work-planning), R-025 (site call in connectors), R-128 anchors (row ids in site-quality), R-157 item 2 (by R-184) — marked done only when every part is merged; R-015 stays en_cours (KPI alerts deferred, Vigie hooks dormant) | Each part lives with the file owner to avoid conflicts |
| R-069 CCB threshold | 50 k€ on \|amount\|, strictly greater, Settings key change.ccbThreshold edited by the director; steps fixed at submission with the threshold then in force | Prototype highlight `amt > 50`; P-6c 'au-delà' and 'seuil réglable'; alternative 0 keeps today's always-CCB behaviour |
| R-069 contractual impact | Required on New CR; client step 'na' only for 'None (internal)'; existing CRs backfilled from stored decisions; amendment prepared only when the impact includes the price | P-6b; A-4; dates-only amendment stays an open question |
| R-069 open points not worked around | PM-step routing stays with the PM of record; no PM recording the client's decision while no client accounts exist; no CCB on every re-baseline; portal 'approved changes' unchanged | Not asked by the answers; I-2b; notes-rights open question |
| R-015 CR notification recipients | Current step's approvers (PM of record; director-role users; client contacts of the project's organisation; CCB = director), then the next step's after each decision, the requester on final approval or rejection | X-6a; P-6a (CCB = director); follows the sequential chain |
| R-081 freeze after BL1 | Any BLn ≥ 1 in any state; only the amount freezes (name and type editable); new category at 0 k€; director not exempt; Excel/CSV rows refused or created at 0 | C-3a; same 'after BL1' test as Set baseline (S-3) |
| R-081 CR cost category | Optional, internal only; without it only BAC and work packages move; negative amounts refused when raised and clamped at posting | A-4 needs a target; owner to confirm vs a required category |
| R-077 billing block | Per basis group (base contract or its amendment) above 100.01 %; under 100 % stays a hint; only planned milestones are edited or removed, removal confirmed and numbers never reused | C-7 'le total' is ambiguous; C-7a 'on peut toujours retoucher'; S-5 confirmation |
| R-080 Budget tiles | Alert at the Settings 'at risk' threshold (0.97); EAC/VAC follow CPI; TCPI alerts above 1/risk (named constant); cv = 0 neutral stub; Overview EAC tile and PM Home literals unchanged | C-1 'mêmes seuils'; mono-accent design; A-13 consistency left as an open question |
| R-054 BL1 deliverable | BL1 = BLn ≥ 1 current or superseded; ticked by Set baseline, CR approval or NEW import; no auto-advance; manual tick refused without BL1 (forcing still possible); Set baseline not restricted to APD | L-2 'a' option detail |
| R-140 justification | One text shown internally and to the client; New CR placeholder warns it reaches the client; portal shows it on waiting decisions only; no edit after creation | X-11 shared; edit flow not asked |
| R-095 PO cancellation | Draft: author, project leads, director; Awaiting approval: withdrawn by the submitter; reason required ≤ 1000 chars (also for Reject); only Keystone-drafted local orders; never once Ordered; the RFQ stays awarded | SC-3a and P-5c agree only before the order is placed; leads/director extension recorded for the owner |
| R-034 Sage X3 mock | Demo database: X3 actions kept and labelled simulated; production database: X3 buttons hidden and refused; Sage X3 row stays 'Not connected'; no x3-import job | A-15, R-021 as built, PDM precedent |
| R-102 part validation | Validators englead and director; PLM editors complete the record while Not validated; HS required unless an explicit 'Not applicable' flag; export 'None' confirmed explicitly (existing rows unconfirmed); seeded Validated parts untouched; no manual Outdated/Obsolete; no Vigie ECO hook | E-1a/E-1b; null had two meanings; V-2 contract not agreed |
| R-104 substitution cost | qtyTo × new price − qtyFrom × old price; old part valued by the E-2a rule; unknown price → quantity-only rule | E-2b defines only the equal-quantity case |
| R-108 P&ID search | Default filter = the tag's compatible types with 'All types'; ≤ 20 results, project BOM first; non-validated/obsolete parts selectable with their status; add-to-BOM qty 1, tag scope, tag activity only when in the plan; 'Link only' without BOM edit right | E-6; never creates a part (A-1b open) |
| R-109 P&ID revision banner | Shown when Codex's reference revision (E-5: draft → previous, obsolete excluded) is ahead, even right after a release step; non-comparable revisions → neutral 'different'; re-import suggests the Codex revision; button for P&ID editors only | A-9; the owner described the seed case as the gap |
| R-110 installed-base pins | A machine without recorded configuration keeps every ECO part; the kept revision is the one fitted on the machine | E-4 'a' assumes a known configuration; cautious default |
| R-111 duplicate flag | Generic rule (purchased vs assembly line, same HS and catalogue price, outside each other's structure); qualitative note, no amount, no dismiss | NEW-D4-5 'c'; R-169 (no code constants) |
| R-145 warranty figures | Calendar year by reportedOn; 'Extended' while a recorded extension runs; status computed on read; FR tile « Coût garantie de l'année » | NEW-D5-2 'a' |
| R-155 zone notice | 'No machine in this zone' when the zone has no machine; otherwise per-view texts (no claim / intervention / warranty cost) | X-16 + 07 A.1; the literal text would be false for APAC › Interventions |
| R-153 fleet-wide forms | No project sub-line (Plan intervention treated like New claim); Sync vault names the project inside its 'Current project' option | X-10; the vault run is still attached to that project |
| R-023 Vigie mirror | Rows with undelivered progress are not pruned (NOT EXISTS in the DELETE); rejected entries stay 'failed' with no auto-abandon; X-Api-Key until Vigie publishes its scheme; Keystone NCR numbers never sent | V-2, V-3a; avoids losing recorded progress |
| R-024 / R-025 Vigie contract and links | Contract documents are proposals; 'projet' parameter = Keystone project code until NEW-SYS-1; both items stay en_cours | Vigie's ECO module and parameter support are external; NEW-SYS-1 open |
| R-096 rejected receipt | One Vigie report link per rejected line (parameter names a V-3 proposal); alert to the PO buyer (submitter → author → RFQ owner) and the project's leads, actor excluded, fallback procurement users; no NC echo | NEW-D4-3, SC-3b, X-6a |
| R-015 invoice blocked and Vigie events | Invoice blocked → buyer chain (else procurement) + director; NCR raised and ECO to approve only from the Vigie HTTP refresh (dormant in mock); KPI alerts deferred | Prototype n8; Vigie API pending; KPI alerts need S-4/R-013 and a first-run baseline |
| R-027 staff directory | Match by matricule, then work e-mail, else create; never delete; team → department only by exact name; dormant until CURSUS_DIRECTORY=on; names shown from persons at read time, stored clearance names untouched | NEW-CURSUS-2; endpoint unknown; avoids breaking reminders keyed by name |
| R-029 Cursus events | POST /api/integrations/cursus/events with X-Api-Key and a separate CURSUS_EVENTS_KEY (required in production, demo key refused); event-id idempotency; 503 when the connector is disabled; inbox kept 13 months; heures.validees stored but never applied | NEW-CURSUS-7; the timesheet link awaits the owner's confirmation |
| R-031 absences | Two types: Leave (CP, RTT) and Absence (sick, training, other), no reason stored; no Sync button; days = working days minus Settings holidays; unresolved matricules kept for replay | NEW-CURSUS-4, NEW-CURSUS-7 |
| R-173 GDPR (buildable part) | Leave display and export minimised to the two types; start-up warning when Claude analysis is enabled in production; no retention purge; leave visibility unchanged until the DPO decides | NEW-CURSUS-4; DPO decisions pending |
| R-033 Codex | Deep links on Codex's home with ignored parameters (TODO(codex)); Codex row 'live' in http mode with outbox counts; hourly index read in http mode only; in http mode the local deposit is refused with an 'Open Codex' link; mock unchanged | D-1 open; A-15 (no phantom Keystone drafts next to Codex records) |
| R-127 Codex history | Drawer shows record, current revision and current circuit plus a link to Codex for history (not for clients); no Keystone download log, Download buttons give the Codex hand-off toast; obsolete-revisions KPI keeps reading stored rows (not displayed) | D-2 'a'; spec 00 §7.16 forbids the revision-letter sum |
| R-128 document relations | Resolved in the record's own project; PO by number then X3 ref; punch items open the ITP punch list row; unknown → inert; no canSee gating | D-2 context; A-6 one list (R-117); consistent with Article/CR links |
| R-138 client document categories | One type → category constant (MIN, HSE 'HSE documents', PV, CTR, else Codex family); empty categories hidden; grouped strip without a filter | L-9; no new interaction; the HSE type is a plan, not a report |
| R-134 scoring | New axes default 3; no prefill of current scores; prototype labels kept | L-5a; FormDialog defaults are static |
| R-135 projects map | Stage tag in register tones; legend 'Clos / annulé'; markers focusable in cluster order, no arrow keys | L-7 'a' |
| R-136 portfolio window | Quarter start nearest to now − 12 months (Oct 2025 – Sep 2027 on the seed), quarter steps, ?from=YYYY-MM within Jan 2020 – Oct 2035, rows never filtered | L-8 'a'; now = PG_NOW until R-013 |
| R-044 Finance role | Persona Léa Marchand; edits the Contract page on every project; procurement loses Contract; billing gate unchanged; rates edited by director + Finance (PMs read); budget rate by director + Finance; margins visible; supplier prices masked; read-only on Budget/Hours/Billing; director's Home; no Portfolio | P-4, P-12 'c', C-9; the P-2 departure is for the owner to confirm |
| R-139 'View as client' | Entry for the director and the project's leads; other internal roles keep the read-only outside view; the director keeps 'Raise issue' | P-11 'a'; I-2b (no client accounts: raise is the only internal path) |
| R-083 dated rates | Seed grid effective 2026-01-01; edits take an explicit effective date (default business date); person → role by exact job title, unmatched 'not valued'; crews keep an isolated named 60 €/h fallback until a crew role exists | A-10, R-4a/b; production has no person → role source until R-027 (open question) |
| R-178 production coefficients | Five multipliers at prototype factors seeded in production as unconfirmed placeholders, idempotent backfill; no loader, no department editor | A-10; D-7b; no new tools |
| R-086 labour cost tile | Zone = ks-zone cookie; projects in execution (A-3); labour categories by costType 'labor' | R-2 'a'; same population as the Overview |
| R-087 skills | Expert = level ≥ 4; two separate tiles; coverage list names the case | R-5a, R-5b |
| R-088 hours variance | One symmetric ±10 % inclusive threshold in integer arithmetic, director-edited in Settings; also drives the Variance KPI | R-6b; float rounding breaks the inclusive boundary |
| R-149 mentions | Mentionable = persons with an active internal account; nothing to the author, clients or persons without account; no '@' suggestion list | R-8b 'a'; the list is absent from the prototype (no-new-tools) |
| R-150 board | 'Move to…' menu as the keyboard/touch path; assignee or director only; order by due date | R-8c 'a'; R-146 tablets |
| R-067 follow-up tasks | Internal person (no client organisation, not an external user) gets the task; external owner → stakeholder's relationship owner → project PM → no task; typed due kept (else +3 working days); activity optional | S-12 'a' |
| R-037 Outlook / Teams | Teams row requalified (not retired); a read receipt = a Keystone recipient clicks 'Open minutes'; Channels tile without Teams; bell footer says e-mail is not connected | S-11, X-6b, I-3c keeps Teams |
| R-089 sourcing task | Task to the first active procurement user (else the director); procurement gets My work; procurement or director names an existing person; no person creation | P-8b; R-027 owns person creation |
| R-090 re-request | Withdrawn requests re-sent as they were, by the sender only, no new read-only guard | P-8c 'a'; same behaviour as rejected re-requests |
| R-152 toasts | 'Request RQ-xxx sent'; forced moves toast 'Validation requested from the portfolio director'; auto moves silent | X-9 yes, L-1 |
| R-064 plan trash | Ghost-slot positions; 30 days / 20 entries / PM + director kept | S-5 values still unconfirmed |
| R-172 plan owners | Display name = full name, else short name; '—' for activities without owner | Same rule as data.owners |
| R-116 interface receipt | Received date defaults to NOW_ISO, never after today; no backfill; no edit after receipt | Q-4 'a' |
| R-117 unified punch list | Site items renumbered after ITP items; site items category B, ITP items owner Keystone; location-prefix rule kept (no system column); Start/Close only on Inspections & punch list; client sees all reserves without NCR numbers or site photos | A-6 'a'; P-10b; Site card read-only as in the prototype |
| R-057 ITP systems | Existing plans frozen with their type's systems at migration time; machine-type edits apply to projects created afterwards | E-9 'a' |
| R-118 site sheet | Leads and director create and edit from Études to Mise en service (hidden at Garantie, Clos, Annulé); mission actuals not typed; no Cursus creation request queued; field defaults from the project | D-3 'a'; C-2a/A-12 reject typed actuals; R-028 waits for Cursus |
| R-119 site conflicts | Over-allocation 110 %; Cursus expiring → Cert, pending/missing → Doc; arbitration by the director or the person's department head (contractors: director and leads); an arbitration lasts while its cause is unchanged; leave from leave_entries | D-6b 'a' |
| R-122 daily report | hse_incident column and saved values kept; link 'HSE incident? Declare it in Vigie' in the form | NEW-SITE-2 'a' |
| R-032 Cursus employee link | /collaborateurs?matricule=<m>, shown only with a matricule; reminders stay pending | NEW-CURSUS-3; parameter name to confirm with Cursus |
| R-168 audit trail | Append-only by database trigger (REVOKE waits for I-1a); screen keeps 5 columns, the ISO CSV gains reason/before/after/user; system actors have no user; per-writer before/after pass after delivery 8 | Spec 11 §3.12; hosting undecided |
| R-184 French completeness | Audit trail stays the English ISO record, translated at display only; seeded rows get exact FR entries; activity writers converted to message keys after delivery 8; same-in-French allowlist reviewed in code review | NEW-D1-2, R-148; writers belong to other lots |
| R-052 search | Internal roles see hits of every project, current project first, 3 per kind; clients see CRs of their organisation's projects only | X-5 portfolio; P-10b |
| R-156 Transfert | Masculine agreement; « Réception » kept for SAT / COD / IST payment patterns | NEW-D5-3 'a' |
| R-003 hosting | Coolify compose with PostgreSQL 16 + app + worker from one image; demo beta only behind host basic auth; PR #1 left open for the owner | I-1a note (independent cloud server first) |
| R-004 backups | Off unless KEYSTONE_BACKUP_DIR is set; every 10 min; retention 48 h / 30 d / 12 m; restore only into an empty target; quarterly drill; error log only | I-1b RPO ≤ 15 min, RTO ≤ 4 h; no mail relay |
| R-174 dependencies | CI fails on high/critical production advisories only; weekly Dependabot, reviewed, never auto-merged; uuid pinned to 11.1.1 | Spec 00 §8.12/§8.15 |
| R-175 antivirus | ClamAV, fail-closed, required explicitly with the production seed; refused uploads quarantined 30 days; flagged stored files blocked (410) and kept until IT acts | Platform hardening like R-008; owner to confirm |
| R-177 documentation | French Markdown under docs/ (runbook + 7 internal role guides + recette); no in-app help; item stays en_cours | No new tools; training/support/hosting parts are placeholders |

## 3. Integration rules

- **Preparatory commit** (done before the lots fork): `src/i18n/extra/d8-<lot>.json` registered for the nine lots; marker comments in `src/domain/jobs.ts`, `src/server/jobs/definitions.ts` and `src/server/db/seed/index.ts` under which each lot inserts its jobs and backfills.
- Preparatory commit by the integrator on main-2a2fep BEFORE forking the nine worktrees (no behaviour change): create empty src/i18n/extra/d8-<lot>.json files ({}) for the nine lots and register them in src/i18n/extra/index.ts; rewrite `JobName` in src/domain/jobs.ts as a multi-line union and add one marker comment per job-adding lot (platform-ops: backup, files-rescan; connectors: cursus-directory, cursus-events-purge; docs-client-portfolio: codex-index) inside JobName, JOB_SCHEDULES and RUNS (src/server/jobs/definitions.ts); add marker comments in src/server/db/seed/index.ts for the backfill calls of cost-change, roles-rates-hr and connectors. Lots then never edit index.ts and insert only under their own marker, so git sees non-adjacent hunks.
- Merge order: audit-i18n-shell (append-only trigger and completeness/dictionary guards first) → platform-ops → roles-rates-hr (9th persona early) → cost-change → supply-engineering → connectors → docs-client-portfolio → work-planning → site-quality (largest seed and migration churn last). After each merge: npm run typecheck, lint, test, db:check, route matrix; then update docs/reste-a-developper.json and republish the page.
- drizzle/ (every lot): each lot keeps its own generated migration and custom migrations during the lot; at integration drop them and regenerate in merge order (`npm run db:generate`, then `drizzle-kit generate --custom --name <same>` with identical SQL) following the order each lot's notes give (site-quality: punch renumbering custom BEFORE the generated unique-key swap; audit-i18n-shell: generated columns BEFORE the trigger custom). Compare each regenerated SQL with the lot's original.
- src/server/db/schema/organisation.ts: connectors adds persons.matricule, directory_team, directory_synced_at; roles-rates-hr adds persons.rate_role_id. Adjacent column additions in the persons table: the integrator keeps both.
- src/server/db/codes.ts: audit-i18n-shell (isoOfDayOffset only), cost-change (contract impact), supply-engineering (part validation), connectors (leave types), site-quality (punch origin labels), docs-client-portfolio (remove DocDownloadSource). Each lot edits only its own section and inserts new codecs next to related ones.
- Settings plumbing (src/features/admin/settings-view.tsx, src/features/admin/actions.ts, src/features/admin/model.ts, src/server/dal/settings.ts, src/domain/settings-defaults.ts, src/server/db/seed/settings.ts, src/server/export/providers/admin.ts): cost-change adds change.ccbThreshold, roles-rates-hr adds hours.variance. Both are OPTIONAL SettingsDefaults fields, each on its own row next to 'Project health rules', with their own setter and action placed next to the health-threshold code (not at end of file). admin/model.ts is also touched by audit-i18n-shell (plumbingView only) and export providers/admin.ts by audit-i18n-shell (activity/audit rendering only).
- HR files (src/server/dal/hr.ts, src/domain/hr.ts, src/features/hr/actions.ts, forms.ts, i18n.ts, src/server/export/providers/resources.ts): connectors touches ONLY the leave functions (absence writer, leave types, Sync Lucca removal, leave workbook); roles-rates-hr touches only rates, hours, skills and the resources/labour workbook. src/features/hr/skills-view.tsx (incl. the 'Tracked with expiry in Lucca' tile) belongs to roles-rates-hr.
- Lucca text lines: src/server/dal/shell.ts:336 STATIC_EXTRA and src/domain/admin.ts:43 → connectors (one line each); site-view.tsx:316 collision subtitle → site-quality (R-119); skills-view.tsx:37 → roles-rates-hr (R-087).
- src/server/dal/shell.ts and shell.test.ts: audit-i18n-shell owns searchShell, searchShellClient and deepLink (incl. the R-149 'task' fix); connectors edits only line 336; roles-rates-hr edits only shell.test.ts:58/:82 (Record<RoleKey>).
- src/domain/admin.ts: audit-i18n-shell (auditCsv), connectors (line 43), work-planning (notificationChannels) — function-level edits only.
- src/domain/approvals.ts: cost-change (canDecideStep / pendingStepFor), supply-engineering (rejectPrompt 'purchase-order'), docs-client-portfolio (codexVaultItems href) — function-level edits only.
- Client portal files: src/domain/rexclient.ts — cost-change (crAwaitsClient, crDecisionRow) and docs-client-portfolio (new clientDocCategories); src/features/rexclient/model.ts and client-view.tsx — cost-change (DecisionsTab, decision rows) and docs-client-portfolio (DocumentsTab, categories view); src/app/(app)/projects/[code]/client/page.tsx — roles-rates-hr only (preview banner); src/server/dal/client.ts — cost-change (l.137) and docs-client-portfolio (documentCategories).
- src/domain/home.ts and src/server/dal/home.test.ts: cost-change (crAwaiting, CR overlays) and roles-rates-hr (engLeadHome, R-5b englead overlay) — separate functions and overlays.
- src/domain/connectors.ts and src/server/dal/integrations.ts: docs-client-portfolio (Codex state, Codex row counts, Sync now), connectors (Cursus row: last event, directory Sync now), work-planning (new function overriding the Outlook/Teams scope texts at read time). Prefer new functions over editing shared ones.
- Contract files: cost-change owns src/features/contract/* (milestone edit/remove, invoice block, billing page) and puts its rights tests in actions.test.ts; roles-rates-hr edits only setBudgetRateAction, contract/page.tsx:29 canSetRate, gate.test.ts and contract.golden.json (P-4). The contract rule itself lives in project-context.ts / rights.ts (roles-rates-hr).
- src/config/role-screens.ts: roles-rates-hr adds the finance entry and removes 'contract' from procurement's list; work-planning adds a separate `base.procurement.push('mywork')` line next to the P-9a block (R-089). src/domain/rights.ts and page-header.tsx belong to roles-rates-hr only (site-quality puts its arbitration rule in src/domain/site.ts).
- src/server/dal/projects-register.ts: cost-change edits getRegisterData (bl1 flag); site-quality edits createWizardProject (frozen ITP systems). src/features/projects/: cost-change owns register-cells.tsx, actions.ts and the wizard text; work-planning edits only register.tsx move() toast and new-project-launcher.tsx.
- src/server/dal/site.ts: site-quality owns it; roles-rates-hr edits only the weekend-premium function (R-083). src/features/site/model.ts: site-quality owns it; connectors edits only the vigieHseListUrl call at line 204 (R-025) and the assertion at site/render.test.ts:118.
- src/server/integrations/vigie/links.ts → connectors only (R-023, R-024, R-025, R-096). src/server/integrations/cursus/{connector,types,mirror}.ts → connectors only; src/server/integrations/cursus/links.ts → site-quality only (R-032).
- Photos: platform-ops changes the upload scan (dal/photos.ts addPhoto call, 422/503/410 error mapping in src/app/api/photos routes); site-quality changes the punch lookup by (project, number) and photoGate/clientSeesPhotos origin from the DB row. Same route files, different statements; the second to merge resolves.
- src/server/dal/tasks.ts, src/features/mywork/model.ts, task-sheet.tsx: work-planning owns comments/mentions, reassignment and the sheet actions; roles-rates-hr edits only the task cost-note computation and its display line (R-083).
- src/server/dal/resources.ts → roles-rates-hr only; site-quality (R-119) reads the pool, allocations and leave through existing readers without editing the file.
- src/i18n/fr-rules.ts: audit-i18n-shell (R-156 handover rules), work-planning (R-149 mention rule), roles-rates-hr (R-087 skill rules). Insert each rule next to related rules with a decision comment; the integrator re-checks first-match order after each merge.
- src/i18n/extra/dictionaries.test.ts → audit-i18n-shell only. Lots that deliberately override a prototype FR key (supply-engineering R-145 'Warranty cost YTD'; audit-i18n-shell R-156) list it in their notes; the integrator adds it to the allowlist at merge.
- Shared legacy test files (src/server/dal/delivery2*.test.ts, delivery3*.test.ts, delivery4*.test.ts, delivery5*.test.ts, scripts/db-check.ts): each lot changes only the existing expectations its items change and writes new tests in new files. Known adjacent edits: delivery5-writes.test.ts cleanup table list (site-quality adds site_conflict_arbitrations, docs-client-portfolio drops client_document_categories) and db-check table counts (docs-client-portfolio, site-quality, roles-rates-hr, audit-i18n-shell) — the integrator merges and re-runs db:check.
- src/features/procurement/model.test.ts: audit-i18n-shell rewrites only the l.317 UPDATE into a writeAudit insert; supply-engineering adds rfqHint tests in a new block or new file.
- src/server/config/parse.ts, parse.test.ts and .env.example: platform-ops (backup and file-scan variables, parse.test.ts:135 expectation) and connectors (CURSUS_EVENTS_KEY, CURSUS_DIRECTORY next to the CURSUS_* block, AI/DPA warning next to the ANTHROPIC block). Place each variable next to its system's block.
- src/server/db/seed/resources.ts and seed/reference.ts: connectors edits only the leave-type functions; roles-rates-hr only the rate/multiplier functions. seed/index.ts backfill calls go under each lot's marker.
- src/components/app/form-def.ts and FormDialog.tsx → site-quality only (optional note-link for R-122); cost-change uses a placeholder for R-140 instead of a FormDef change.
- After audit-i18n-shell merges, audit_entries refuses UPDATE/DELETE/TRUNCATE and its project_id FK is NO ACTION: no lot may write code or tests that update/delete audit rows or delete projects with audit rows; the integrator watches for trigger failures in later merges.
- Tests/e2e: new scenarios go in new files (tests/e2e/d8-<lot>.spec.ts); existing specs changed only where an item changes them (cost-change 02-planning, work-planning 06-portfolio, site-quality 08-delivery7). Route matrix: roles-rates-hr (9th persona, procurement mywork via work-planning) and connectors (new events route) — the integrator re-runs it after both.
- docs/reste-a-developper.json, docs/RESTE-A-DEVELOPPER.md and .artifacts/reste-a-developper.html: integrator only (standing rule); lots write progress suggestions in docs/delivery-8/notes-<lot>.md. Items left en_cours by design: R-004, R-015, R-024, R-025, R-032, R-064, R-168, R-173, R-174, R-177, R-178.

## 4. Not in this delivery

| Item | Why |
|---|---|
| R-094 | Not buildable: waits for the owner's purchasing procedure (P-5a: thresholds, approval levels, Sage circuit) and the Keystone / Sage X3 role split (A-1a); sending approval data to Sage needs R-034. |
| R-074 | Not buildable: needs validated Cursus hours per task (R-030, timesheet link not validated), Sage X3 receipt and invoice extracts (R-034, A-1a, I-3b), the dated rate grid with Finance rights, and a decision on material actual cost at receipt (C-2a) vs at stock issue (SC-5a). |
| R-082 | Not buildable: waits for the owner's Sage analytic / NIM extract and the budget breakdown discussion (S-6), the analytic code format (NEW-SYS-1) and recurring imports (I-3b, D-7b). |
| R-125 | Not buildable: Codex's deposit form route and parameters (D-1) and its index API returning the Codex number and revision are unknown; the Codex project identifier waits for NEW-SYS-1 / R-181. |
| R-107 | Not buildable: the owner must first lift D-7b (no imports) for engineering lists, then engineering must provide real EPLAN, TIA Portal and SolidWorks exports with versions and the expected output format. |
| R-022 | Not buildable: the owner must confirm where #000 and XXX000 come from and which one is the common key sent to Cursus and Vigie (NEW-SYS-1). |
| R-026 | Not buildable: Vigie has no supplier evaluation process (ISO 9001 §8.4) nor an API exposing grades per supplier. |
| R-035 | Not buildable: needs access to the SolidWorks PDM / 3DEXPERIENCE API or a scheduled export (IT, engineering) and the A-1b decision on who owns part numbers. |
| R-060 | Not buildable: the owner must say what advances projects.data_date and what the Friday freeze records (S-4); depends on R-013. |
| R-005 | Not buildable: the object store and the multi-instance question depend on the hosting choice (I-1a). |
| R-012 | Not buildable: the owner must settle S-9b vs D-7b (imports frozen) and provide the MS Project / P6 files and the list of projects to take over. |
| R-019 | Not buildable: the owner decides whether to adapt or retire Keystone.app once the beta server is chosen (I-1a / R-003). |
| R-058 | Not buildable: the company RACI matrix by role (S-13b) is still being defined by the owner. |
| R-001 | Process step, not a worktree lot: merging main-2a2fep into main needs the owner's explicit approval ('on continue' is not that approval); open the PR and fast-forward only when the owner says so, at hand-over. |
| R-013 | Too risky in a parallel delivery: XL change over ~78 files / ~230 references, including the DAL writers of every delivery-8 lot, and the data-date half still waits for S-4 / R-060. Build it as its own lot right after delivery 8 is merged; every delivery-8 rule already takes 'today' as a parameter. |
| R-085 | Depends on R-013 (real clock) and R-084 (single capacity/load source), both deferred; S-7 (what-if horizon) is still open. |
| R-084 | Too risky now: XL, empties the demo heatmaps and KPIs unless the owner decides what happens to the seeded loads (A-15), and real hours and absences wait for R-027 / R-031 data; touches ~15 consumers owned by several lots. Ask the owner first, then build after delivery 8. |
| R-014 | Depends on R-022 (NEW-SYS-1, blocked): once project-scoped numbers are stored, changing the project token needs a renumbering migration; ~35 test files and DALs owned by four delivery-8 lots would change. Wait for the owner's project-code answer. |
| R-093 | Depends on R-034 (Sage X3 extract) and D-7b: imports are switched off (IMPORTS_ENABLED=false) and the production seed has no suppliers, so removing free entry would make New part / New RFQ unusable in production. Wait for the X3 supplier file or the owner lifting D-7b for it. |
| R-030 | CLAUDE.md and DELIVERY-7 §6 still list 'the Cursus timesheet link' as not built by decision / awaiting validation; it also removes the Log form and Lucca import before Cursus sends any hours (production would freeze logged hours at 0). Needs a one-line owner confirmation; R-029 stores heures.validees meanwhile. |
| R-180 | Same 'Cursus timesheet link' validation question as R-030 (BACKLOG §1 bis, CLAUDE.md); no consumer exists yet and the matricule key waits for R-027. Build once the owner confirms. |
| R-028 | Cursus has no site-creation endpoint (NEW-CURSUS-1 needs a Cursus change); R-118 in this delivery shows 'Cursus site: not created yet'. Build the outbox when Cursus publishes the route. |
| R-051 | Too risky in parallel: L, a rights-bypass surface across ~10 Server Functions and DAL writers owned by five delivery-8 lots (orders, changes, deliveries, documents, Vigie progress); owner priority 'Plus tard'. Schedule after delivery 8 when the decision paths are settled. |
| R-010 | Cross-cutting over writers that four delivery-8 lots rewrite (contract, plan, tasks, budget categories, rates); the UX (refuse-and-reload vs merge) is still undecided (DELIVERY-7 §8). Build as one lot after delivery 8, starting with the shared helper. |
| R-017 | Needs the final delivery-8 schema: adds indexes to every schema file and rewrites sidebar badges/caching over DALs owned by five lots; the p95 target waits for hosting (I-1a). Schedule after delivery 8. |
| R-036 | Real sending waits for IT to grant Microsoft Graph Mail.Send (I-3c, Microsoft last in I-3a); L and cross-cutting (Settings, commissioning, meetings, bell) with four lots. R-037 makes the bell and Channels texts honest meanwhile. |
| R-113 | Too large and unsettled for this delivery: XL, needs R-117 and R-057 (built now) merged first, and owner calls (stage→step mapping contradicts seeded dates, commissioning lead as a team role erases the referent label, Q-6a reservations). Plan it for delivery 9. |
| R-053 | Waits for the owner's machine-type standard data (L-3a 'À discuter': WBS, lots, budgets promised) so a container built now would likely be reshaped; its ITP-line editor is UI absent from the prototype that the owner should see first. |
| R-141 | Depends on R-179 / I-2b: no client can sign in at launch, so a survey would stay 'awaiting the client' forever; Q-9's 'envoyé à la clôture' trigger also needs the owner's choice. |
| R-018 | Owner priority 'Plus tard'; the foreign-client benefit of X-1 needs client accounts (I-2b); reading the language from the session on every request risks sign-in redirect loops. Build together with R-036's per-user preferences. |
| R-121 | Only meaningful with the real clock (R-013): at the frozen 25 Sep business date no seeded prerequisite is late, so nothing would ever fire, and the first run after R-013 would flood. Build with R-013. |
| R-147 | Cross-cutting: switches makeT('en') app-wide and changes ≥ 10 EN goldens owned by other lots, with English wording not yet validated (X-12a). Build as one lot after delivery 8, with the proposed glossary sent to the owner for review first. |
| R-154 | Colour/icon sweep across 24+ files owned by six delivery-8 lots (plan drawer, budget, changes, sourcing, ECO, P&ID, documents, portfolio Gantt) and overlapping R-080; do it as a post-merge sweep on the integrated branch. |
| R-157 | Ten fixes in files owned by seven lots (site/quality actions, BOM, exports, commissioning, contract, meetings, analyser); do it as a post-merge sweep. Its item 2 (connector texts in French) is delivered by R-184 in audit-i18n-shell. |
| R-183 | Open-ended axe fixes on 59 screens × 3 personas that can touch any file; run once every delivery-8 screen change has landed (post-merge sweep, timeboxed). |
| R-171 | Dead code sits in files owned by five lots (tasks.ts, stock.ts, prioritisation.ts, resources.ts, portfolio.ts) and the OPEN QUESTION comment sweep spans 53 files: post-merge sweep. Its canDecideStep unification is done by R-069 in cost-change. |

Still not in scope: every "à décider" item (25), the new modules waiting for the owner's validation (`docs/BACKLOG.md`), and the merge of `main-2a2fep` into `main` (R-001), which waits for the owner's explicit approval.
