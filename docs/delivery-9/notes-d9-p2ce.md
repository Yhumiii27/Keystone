# Livraison 9 — lot « conformité CE et dossier technique machine » (P2, R-160)

Statut : construit sur la branche `d9-p2ce` le 10 nov. 2026, après la réponse du responsable produit **D9-32** (« Lancer
maintenant, avant janvier 2027 »). Sources : `docs/BACKLOG.md` § 2 P2, `docs/reste-a-developper.json` R-160, `docs/DECISIONS.md`
(D9-32), règlement Machines (UE) 2023/1230 (applicable le **20 janv. 2027**).

## 1. Ce qui change

| Pièce | Où | Rôle |
|---|---|---|
| Tables | `drizzle/0081_ce_conformity.sql` (générée) | `ce_checklist_items` (listes de référence de Paramètres), `ce_files` (un dossier CE par ligne d’équipement, contraintes de valeurs, colonne `version` R-010) |
| Données de référence, déclencheur | `drizzle/0082_ce_conformity_defaults.sql` (personnalisée) | les deux listes par défaut sur **toute** base (démonstration et production), rejouable (`ON CONFLICT DO NOTHING`) ; déclencheur `ce_files_row_version` (`ks_bump_row_version` de 0069) |
| Règles pures | `src/domain/ce-conformity.ts` (+ `ce-conformity.test.ts`, 15 tests de valeurs) | listes de choix, listes par défaut, lecture du formulaire, droits, état du dossier (calculé), date de mise sur le marché, date d’application |
| Lecture / écriture | `src/server/dal/ce-conformity.ts` | listes, dossiers d’un projet, liste portefeuille, enregistrement (audit avant / après, activité, verrou optimiste R-010), écrivains des listes |
| Server Functions | `src/features/ce/actions.ts` | `saveCeFileAction`, `addCeChecklistItemAction`, `setCeChecklistItemActiveAction`, `resetCeChecklistsAction` |
| Écrans | `src/features/ce/` : `ce-card.tsx` (Mise en service & dossier de transfert), `ce-file-editor.tsx` (le dossier, `?ce=EQ-01`), `portfolio-card.tsx` (Projets), `checklists-card.tsx` (Paramètres), `model.ts`, `ce.module.css` | |
| Avertissement à la livraison | `src/features/ce/warnings.ts`, branché dans `planSatAction` (`src/features/itpcom/actions.ts`) et `registerMachinesAction` (`src/features/aftersales/actions.ts`) | jamais bloquant |
| Message système | `ce.fileUpdated` (`src/domain/system-messages.ts`) | audit et fil d’activité en FR / EN |
| Démonstration | `DEMO_CE_FILE` (`src/server/db/seed/execution.ts`) | HLT-026 EQ-01 : dossier en cours (3/9) ; EQ-02 sans dossier |
| Traductions | `src/i18n/extra/d9-ce-conformity.json` | |
| Tests | `src/features/ce/actions.test.ts`, `src/features/ce/render.test.ts`, `src/server/dal/record-version.test.ts` (déclencheur), attentes mises à jour : toasts (`src/features/itpcom/actions.test.ts`, `src/features/aftersales/followup.test.ts`), cartes des pages (`src/features/itpcom/page.test.ts`, `src/features/admin/page.test.ts`), tables de référence de la graine de production (`src/server/db/seed/production-seed.test.ts`) | |

Aucune vue `pub_`, aucun droit accordé à un autre outil (règle M-18). Aucune dépendance ajoutée. Aucun écran ajouté au registre
(toujours 62) : le dossier vit dans l’écran « Mise en service & dossier de transfert », la liste portefeuille sous le registre
des projets, les listes de référence dans Paramètres.

## 2. Le dossier CE d’une ligne d’équipement

**Unité retenue : la ligne d’équipement (R-185)**, pas chaque exemplaire. Une ligne = un type de machine × une quantité, donc une
même conception : un seul dossier technique, une seule évaluation des risques, une seule déclaration par ligne. Les machines du
parc installé rattachées à la ligne (`machines.equipment_id`, ou toutes celles du projet quand il n’a qu’une ligne) sont
affichées sur la ligne (« Parc installé : MCH-050, MCH-051 »). *Décision prise sans demander* (voir § 7).

Contenu (table `ce_files`, créée au premier enregistrement) :

- **régime** : machine / quasi-machine — liste de choix ;
- **catégorie** : hors annexe I / annexe I partie A / annexe I partie B. Le règlement 2023/1230 a remplacé l’ancienne
  **annexe IV** de la directive 2006/42/CE par son **annexe I** : la liste parle donc d’annexe I (l’annexe IV du règlement est
  devenue le dossier technique). Liste de choix seulement, l’application ne conseille rien ;
- **procédure d’évaluation de la conformité** : module A (contrôle interne), modules B + C (examen UE de type + conformité au
  type), module H (assurance complète de la qualité), module G (vérification à l’unité). Liste de choix ; aucune
  compatibilité catégorie × procédure n’est contrôlée (ce serait un conseil juridique) ;
- **évaluation des risques** : référence Codex (Keystone garde la référence, le document vit dans Codex) ;
- **normes harmonisées appliquées** : liste libre, une par ligne (doublons retirés, 40 au plus) ;
- **exigences essentielles (annexe III)** : pour chaque intitulé actif de Paramètres, « Non évaluée », « Applicable · à
  démontrer », « Applicable · satisfaite », « Sans objet » ;
- **contenu du dossier technique (annexe IV)** : pour chaque intitulé actif, « À faire », « Terminé », « Sans objet », relié à un
  **livrable du projet** (les livrables de type « Certificats (CE, levage…) » proposés d’abord) et / ou à une **référence
  Codex** ; « Terminé » exige l’un des deux ;
- **notice d’instructions** (notice d’assemblage pour une quasi-machine) : référence Codex ;
- **déclaration UE de conformité** (ou **déclaration d’incorporation** pour une quasi-machine, le titre suit le régime) :
  signataire, date, référence Codex ;
- **date du marquage CE** (pas pour une quasi-machine : refusé par le serveur et par une contrainte de la table).

Une référence Codex est un identifiant sans espace (`RPT-HLT-040`, 60 caractères au plus) ; elle n’est pas vérifiée dans l’index
Codex (un document peut ne pas y être encore synchronisé).

**Réutilisation de l’existant** (aucun doublon) : les livrables restent ceux de l’écran Qualité (type « Certificats (CE,
levage…) »), le dossier CE ne fait que les citer ; la ligne « Déclaration CE & certificats de conformité » du dossier de transfert
est affichée sous la carte CE (statut et document, ex. `COC-HLT-012`) ; la démonstration reprend cette référence comme
déclaration de HLT-026 EQ-01.

## 3. État du dossier (calculé, jamais stocké)

`ceReadiness` (`src/domain/ce-conformity.ts`), recalculé à chaque lecture contre les **intitulés actifs** de Paramètres :

| Contrôle | Machine | Quasi-machine |
|---|---|---|
| Régime choisi | ✓ | ✓ |
| Catégorie de l’annexe I choisie | ✓ | — |
| Procédure d’évaluation choisie | ✓ | — |
| Évaluation des risques référencée | ✓ | ✓ |
| Exigences essentielles évaluées et satisfaites (toutes « satisfaite » ou « sans objet ») | ✓ | ✓ |
| Dossier technique complet (tous « terminé » ou « sans objet ») | ✓ | ✓ |
| Notice (d’instructions / d’assemblage) référencée | ✓ | ✓ |
| Déclaration signée (signataire, date, référence Codex) | ✓ | ✓ |
| Marquage CE daté | ✓ | — |

États : « Non démarré » (aucun dossier), « En cours », « Dossier complet ». Pourcentage = contrôles satisfaits / contrôles. Les
normes harmonisées sont listées mais jamais exigées (une machine peut n’en appliquer aucune). Un intitulé retiré de Paramètres
ne compte plus (la réponse reste stockée et s’affiche barrée) ; un intitulé ajouté rend incomplets les dossiers qui ne l’ont pas
évalué.

## 4. Avertissement à la livraison (jamais bloquant) et liste portefeuille

- **Écran « Mise en service & dossier de transfert »** : carte « Conformité CE · dossier technique » sous le dossier de transfert,
  une ligne par équipement (équipement, parc installé, mise sur le marché, état, ce qui manque, « Ouvrir le dossier CE »). Un
  bandeau avertit quand une ligne dont le dossier est incomplet a atteint la livraison (une étape « Livraison » datée ou faite
  sur ses systèmes de mise en service, propres ou communs, ou des machines déjà au parc installé). Jamais affichée au client.
- **« Planifier la SAT »** et **« Enregistrer les machines livrées »** (parc installé) : l’action est faite, et le message de
  confirmation ajoute « · Dossier CE incomplet · EQ-02 · la livraison n’est pas bloquée » quand le dossier de la ligne concernée
  (celle du système, toutes pour un système commun ; la ligne livrée, sinon la ligne principale) est incomplet.
- L’avertissement vaut **avant comme après le 20 janv. 2027** : la directive 2006/42/CE exige déjà dossier, déclaration et
  marquage. *Décision prise sans demander* (plus d’avertissements plutôt que moins).
- **Projets (portefeuille)** : carte « Conformité CE · machines mises sur le marché à partir du 20 janv. 2027 » sous le registre,
  filtrée par la zone choisie : les lignes des projets ni clos ni annulés dont le dossier est incomplet **et** auxquelles le
  règlement s’applique, la plus proche d’abord ; chaque ligne ouvre son dossier.

**Date de mise sur le marché d’une ligne** (`ceMarketDate`) : tous les exemplaires livrés au parc installé → la dernière date
de livraison ; sinon la plus tardive des dates « Livraison » de ses systèmes de mise en service (propres ou communs) ; sinon la
fin prévue du projet (date de l’assistant, sinon fin du mois de fin) ; sinon inconnue. Le règlement s’applique à une date ≥
20 janv. 2027, **ou inconnue** (prudent). En démonstration, HLT-026 est livré le 14 janv. 2027 (directive : hors de la liste,
mais l’avertissement reste) ; ERP-202, NDC-031 et WSA-044 (EQ-01) sont dans la liste.

## 5. Droits et traçabilité

| Qui | Dossier CE | Listes de Paramètres |
|---|---|---|
| Responsable ingénierie, qualité (membres de l’équipe du projet) | modifient tout le dossier | lisent |
| Chef de projet (PM de référence, co-PM, adjoint du projet) | modifie la déclaration (signataire, date, référence) et la date du marquage CE ; le reste est conservé tel quel côté serveur (`applyCeScope`) | lisent |
| Directeur de portefeuille | **lit** (consigne du lot) | modifie (règle A-14 de Paramètres) |
| Autres rôles internes | lisent (hors espace de travail pour certains) | lisent |
| Client | jamais affiché, refusé | — |

Règle pure `ceEditScope` ; la Server Function la calcule depuis le contexte du projet (`getProjectContext`, écran
« Mise en service ») et l’écrivain la revérifie (espace de travail, rôle, `managesProject` pour le PM). Chaque enregistrement
écrit une ligne d’audit (zone « Conformité CE », champs modifiés avant / après, message `ce.fileUpdated`) et un événement
d’activité ; un enregistrement sans changement n’écrit rien. Verrou optimiste R-010 : un dossier modifié entre-temps par
quelqu’un d’autre est refusé avec « Recharger ». Les listes : audit zone « Paramètres » (ajout, retrait, rétablissement,
réinitialisation).

## 6. À faire valider par le responsable produit et le service QHSE

1. **Contenu des deux listes** (Paramètres › Listes de contrôle de la conformité CE). Les intitulés ont été écrits de mémoire du
   règlement, **à vérifier contre le Journal officiel** :
   - annexe III : sections 1, 3 et 4 au deuxième niveau (1.1 à 1.7, 3.1 à 3.6, 4.1 à 4.4), sections 2, 5 et 6 en un seul
     intitulé chacune. Faut-il descendre au troisième niveau (1.1.1…, notamment **1.1.9 protection contre la corruption** et
     **1.2.1 sécurité et fiabilité des systèmes de commande**, nouveautés du règlement) ? Un intitulé s’ajoute dans Paramètres ;
   - annexe IV : onze rubriques (description, évaluation des risques, plans, explications, normes, essais, notice, déclarations
     incorporées, copie de la déclaration, fabrication en série, logiciels de sécurité). Leurs lettres ne sont pas reprises ;
     la partie B (quasi-machines) n’a pas de liste propre : les rubriques sans objet se marquent « Sans objet ».
2. **Unité du dossier** : une par ligne d’équipement (conception commune) — ou une déclaration par numéro de série ?
3. **Droits** : le directeur lit seulement (consigne) alors qu’il modifie tout ailleurs ; les listes sont modifiées par le
   directeur seul (règle de Paramètres) — faut-il les ouvrir à la qualité ?
4. **Avertissement** : « Planifier la SAT » et l’enregistrement au parc installé avertissent ; faut-il aussi avertir au passage
   du projet aux étapes « Mise en service & SAT » / « Garantie », ou bloquer (aujourd’hui : jamais) ?
5. **Contrôles de cohérence** non faits volontairement (pas de conseil juridique) : catégorie annexe I partie A ⇒ organisme
   notifié (module A exclu), date du marquage postérieure à la déclaration. À ajouter si QHSE les valide.
6. **Mise sur le marché** : la règle du § 4 (dernière livraison, sinon date « Livraison » de la mise en service, sinon fin du
   projet) est une approximation ; une date saisie par ligne serait plus juste.

## 7. Décisions prises sans demander

- Dossier **par ligne d’équipement** (R-185), affichant les machines du parc installé de la ligne.
- Pas de nouvel écran : carte et dossier dans « Mise en service & dossier de transfert » (`?ce=EQ-01`), liste portefeuille sous
  le registre des projets, listes dans Paramètres (même éditeurs que Paramètres).
- Listes dans une table dédiée (`ce_checklist_items`) plutôt que dans `reference_values` : les sept cartes de Paramètres sont
  figées par les tests d’or du prototype et l’annexe III a besoin d’un numéro distinct du titre.
- Listes par défaut posées **par la migration** (et non par la graine) : une base de production existante les reçoit aussi.
- Avertissement avant et après le 20 janv. 2027 ; liste portefeuille seulement pour les machines sous le règlement.
- Date inconnue ⇒ le règlement s’applique (prudent).
- Le PM ne modifie que la déclaration et le marquage ; la notice d’instructions est un document technique (ingénierie, qualité).

## 8. Ce qui reste

- Validations du § 6.
- Feuille d’export « Conformité CE » de l’écran Mise en service (l’export existant n’a pas été étendu).
- Vérifier qu’une référence Codex existe dans l’index (aujourd’hui texte libre au bon format).
- Publication vers d’autres outils : aucune (aucun besoin exprimé ; une vue se demanderait à Matrix).

**État de R-160** : fait pour le périmètre demandé (dossier, état calculé, avertissement, liste portefeuille, droits, audit) ; à
marquer « fait » après intégration, les points du § 6 restant à valider par le responsable produit et le QHSE.
