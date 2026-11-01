# Livraison 9 — lot « Qualité du planning » (R-206)

Statut : construit sur la branche `lotF-dcma` (depuis `e239d2f`) le 1er nov. 2026, d’après les réponses du cadrage du même jour
(`docs/DECISIONS.md` § « Cadrage des prochains lots ») : **K-206** (lancer : une carte « Qualité du planning » sur l’écran Planning,
avec le détail par contrôle) et **K-206b** (les seuils du standard, modifiables dans Paramètres). **Aucune migration** (les seuils
sont une ligne de `app_settings`), aucune nouvelle dépendance. Lecture seule : rien ne modifie les données du planning.

## 1. Ce qui change

Sur l’écran **Planning** (`/projects/<code>/schedule`), sous la progression et les jalons, deux cartes :

- **Qualité du planning** — les 14 contrôles DCMA, chacun avec sa valeur (et « n / total » pour un pourcentage), son seuil, son
  verdict (Conforme / Non conforme / Sans objet, avec la raison) et, en dépliant la ligne (`<details>` : clavier et lecteur d’écran),
  la liste des activités ou des liens en cause ; chaque activité ouvre le **Plan** sur son tiroir (`/plan?act=A1250`). En tête :
  la référence utilisée (celle qu’affichent Plan et Planning, BL1 par défaut), la date d’état, les compteurs. Deux avertissements
  possibles : boucle logique, et « pas replanifié depuis les dernières modifications » (nombre d’activités que « Replanifier »
  changerait maintenant).
- **Analyse des retards** — une référence (sélecteur des références qui ont un instantané d’activités) **comparée au planning
  actuel ou à une autre référence** (`?from=BL1&to=current|BL2`, les autres paramètres de la page sont gardés) : fins des deux
  plannings, glissement de la fin (jours ouvrés), activités en retard / en avance ; **glissement du chemin critique** : le chemin
  pilotant jusqu’à la fin du projet, avec pour chaque activité l’écart de début, l’écart de fin, le **démarrage tardif**, la **durée
  allongée** et son **apport au glissement**, puis les causes principales ; enfin le détail de toutes les activités (dates des deux
  plannings et écarts), les activités ajoutées et retirées depuis la référence.

Dans **Paramètres**, une carte « Qualité du planning » : un champ par seuil (15 valeurs), le standard rappelé sous chaque champ,
enregistré à la sortie du champ / Entrée ; « Rétablir les valeurs par défaut » remet le standard.

| Pièce | Où | Rôle |
|---|---|---|
| Règles pures | `src/domain/schedule-quality.ts` | seuils (standard, bornes, lecture), les 14 contrôles (`dcmaAssessment`) |
| Moteur CPM (API publique) | `src/domain/schedule-quality-cpm.ts` | test du chemin critique (`criticalPathTest`), chemin pilotant jusqu’à la fin (`drivingPathToFinish`) |
| Analyse des retards | `src/domain/schedule-forensics.ts` | écarts par activité (`compareSchedules`), attribution du glissement (`slipAttribution`) |
| Tests de valeur | `src/domain/schedule-quality.test.ts` (29 tests, réseaux construits à la main) | |
| Lecture | `src/server/dal/schedule-quality.ts` (`getScheduleQuality`), `src/server/dal/dcma-thresholds.ts` | |
| Paramètres | `src/server/dal/settings.ts` (`setDcmaThreshold`, `getSettings().dcma`, `resetSettings`), `src/features/admin/actions.ts` (`setDcmaThresholdAction`), `model.ts`, `settings-view.tsx`, `settings-ch4.module.css` | |
| Écran | `src/features/schedule/schedule-quality-card.tsx`, `schedule-quality.module.css`, `schedule-view.tsx` (prop `quality`), page `schedule/page.tsx` | |
| Code du paramètre | `src/server/db/codes.ts` `APP_SETTING_DCMA = 'schedule.dcma'` | |
| Français | `src/i18n/extra/d9-schedule-quality.json` | |
| Tests | `src/features/schedule/schedule-quality.test.ts` (données de démonstration, lecture seule, personas, rendu FR), `src/server/dal/dcma-thresholds.test.ts` (droits, audit, remise à zéro) | |

## 2. Calcul de chaque contrôle sur le modèle de Keystone

Vocabulaire : **non terminée** = ni fin réelle cochée ni 100 % (règle de « Replanifier ») ; **démarrée** = début réel coché ou % > 0.
Durées et marges en **jours ouvrés** (S-8) : les « 44 jours » du standard sont 44 jours ouvrés. Les contrôles lisent le planning
**tel que le dernier « Replanifier » l’a publié** (dates, marges totales, contraintes stockées) — ce que montrent Plan et Gantt ;
seul le test du chemin critique fait tourner le moteur, en mémoire. Les liens comptés (2, 3, 4) sont ceux dont le **successeur
n’est pas terminé** (la logique y compte encore).

| # | Contrôle | Calcul | Seuil standard |
|---|---|---|---|
| 1 | Logique | activités non terminées sans prédécesseur ou sans successeur ÷ activités non terminées. Le **début** du réseau (la seule activité sans prédécesseur, s’il n’y en a qu’une) et sa **fin** (la seule sans successeur) ne comptent pas : ce sont les bouts du réseau | ≤ 5 % |
| 2 | Avances | nombre de liens à décalage négatif | 0 |
| 3 | Décalages | liens à décalage positif ÷ liens | ≤ 5 % |
| 4 | Types de liens | liens fin-à-début ÷ liens (les SS, FF, SF sont listés) | ≥ 90 % |
| 5 | Contraintes impératives | activités non terminées avec MSO, MFO, SNLT ou FNLT ÷ activités non terminées (SNET et FNET sont souples) | ≤ 5 % |
| 6 | Marge élevée | activités non terminées de marge totale > 44 j ouvrés ÷ activités non terminées (une marge non calculée ne compte pas) | ≤ 5 % |
| 7 | Marge négative | nombre d’activités non terminées de marge totale < 0 | 0 |
| 8 | Durée élevée | activités non terminées de **durée d’origine** > 44 j ouvrés ÷ activités non terminées | ≤ 5 % |
| 9 | Dates invalides | nombre d’activités : non démarrée avec un début prévu avant la date d’état, non terminée avec une fin prévue avant elle, début réel ou fin réelle après elle | 0 |
| 10 | Ressources | activités non terminées **de durée > 0** sans affectation de ressource **ni budget** ÷ ces activités (DCMA : « heures ou euros ») | 0 % (voir § 3) |
| 11 | Activités manquées | parmi les activités de la référence dont la fin de référence ≤ date d’état : non terminées, ou terminées après leur fin de référence ÷ ces activités | ≤ 5 % |
| 12 | Test du chemin critique | 600 jours ouvrés ajoutés au reste à faire de la **première activité critique non terminée** (ordre topologique) ; le moteur CPM recalcule en mémoire ; réussi si la fin du projet recule d’autant (mesuré sur le calendrier de l’activité, tolérance 1 %) | réussi |
| 13 | CPLI | (CPL + marge) ÷ CPL ; CPL = jours ouvrés du calendrier du projet de la date d’état à la fin prévue (la plus tardive des fins actuelles) ; marge = jours ouvrés de la fin prévue à la fin de référence (négative en retard) | ≥ 0,95 |
| 14 | BEI | activités terminées ÷ activités de la référence dont la fin de référence ≤ date d’état (celles qui ne sont pas terminées sont listées) | ≥ 0,95 |

**Sans objet** (avec la raison affichée) : pas d’activité non terminée (1, 5–8), pas de lien vers une activité non terminée (2–4),
pas d’activité de durée > 0 (10), pas de référence avec un instantané d’activités (11, 14), pas de date de fin de référence (13),
aucune activité due à la date d’état (11, 14), reste à faire fini avant la date d’état (13), pas d’activité critique non terminée
ou réseau invalide (12). Une **boucle logique** fait échouer le test 12 (les activités de la boucle sont listées).

**Référence** des contrôles 11, 13, 14 : la référence affichée par Plan et Planning (S-3, BL1 par défaut) ; fin de référence = la
plus tardive des fins de son instantané, à défaut la fin enregistrée de la référence.

**Analyse des retards** : écarts en jours ouvrés du calendrier du projet, positifs = plus tard (écart de début = écart des bornes
de début, écart de fin = écart des bornes de fin). Chemin pilotant : le moteur CPM tourne en mémoire comme « Replanifier »
(progression → dates réelles) ; on part de l’activité non terminée qui finit le plus tard et on remonte par le prédécesseur
pilotant (lien à marge nulle) qui finit le plus tard, y compris une activité terminée qui pilote encore. Pour chaque activité du
chemin : **apport** = écart de fin − écart de fin hérité du prédécesseur pilotant (0 pour la première) = **démarrage tardif**
(écart de début − hérité) + **durée allongée** (écart de fin − écart de début). Les apports s’additionnent jusqu’à l’écart de fin de
la dernière activité, c’est-à-dire le glissement le long du chemin (sur HLT-026 : +17 j ouvrés, dont +29 apportés par A1250, puis
des rattrapages). Une activité absente de la référence n’apporte rien de connu ; la suivante porte son écart.

## 3. Décisions prises sans demander (faciles à changer)

1. **Seuil du contrôle 10 (ressources) = 0 %** : le standard DCMA ne donne pas de chiffre (« toutes les activités de durée ≥ 1 jour
   devraient porter des heures ou des euros ») ; 0 % applique cette phrase, modifiable dans Paramètres. Une activité est « chargée »
   si elle a une affectation de ressource (`activity_assignments`, personne, équipe, engin ou matière) **ou** un budget > 0 ; rien
   ne suppose un type de machine (R-185).
2. **Bouts du réseau exclus du contrôle 1** quand ils sont uniques (une seule activité sans prédécesseur, une seule sans successeur) ;
   un réseau à plusieurs départs ou arrivées les voit tous signalés (NDC-031 : quatre fins de chaîne par lot).
3. **Liens comptés** : ceux vers une activité non terminée (pratique Acumen / DCMA) ; dénominateur des contrôles 1, 5–8 : activités
   non terminées, jalons compris (sauf le 10).
4. **Contrôle 8 sur la durée d’origine actuelle**, pas sur la durée de la référence (une activité ajoutée depuis la référence est
   ainsi contrôlée).
5. **Test du chemin critique** : 600 jours ouvrés, première activité critique non terminée, tolérance 1 % (des calendriers à
   semaines ou fériés différents décalent un peu les dates). Une activité démarrée est retardée par son reste à faire.
6. **Données publiées** pour les contrôles 1–11, 13, 14 (ce que l’écran montre), moteur en mémoire pour le 12 et pour le chemin
   pilotant ; quand le planning n’a pas été replanifié depuis des modifications, un avertissement donne le nombre d’activités qui
   changeraient (sur la démonstration : 11 pour HLT-026, jamais replanifié).
7. **Entre deux références**, le chemin pilotant est celui de la **logique actuelle** (les instantanés de référence ne gardent ni
   les liens ni les marges) — l’écran le dit.
8. **Droits** : lecture pour quiconque voit le Planning du projet (`getProjectContext(code, 'schedule')` ; le client est renvoyé à
   son accueil) ; seuils modifiables par la **directrice de portefeuille** seule, comme tout Paramètres (A-14) — la demande disait
   « admin / directeur » : il n’y a pas de rôle « admin » distinct dans Keystone. Chaque modification d’un seuil : ligne d’audit
   « Schedule quality thresholds » avec avant / après, événement du fil ; « Rétablir les valeurs par défaut » remet le standard.
9. **Liens des activités** vers le Plan (`?act=`), qui ouvre le tiroir de l’activité ; le Gantt interactif (R-198) n’a pas de
   sélection par URL.
10. Au plus **100 activités listées** par contrôle (le nombre total est affiché).

## 4. Indépendance vis-à-vis du moteur (R-204 à venir)

Le diagnostic ne lit du moteur que son API publique : `schedule()`, `remainingDuration()`, `changedActivities()` et, dans le
résultat, `order`, `criticalPath`, `projectFinish` et, par activité, `state`, `finish`, `critical`, `drivingPredecessors`
(`src/domain/schedule-quality-cpm.ts`). Les contrôles 1–11, 13, 14 et l’analyse des écarts ne dépendent pas du moteur du tout.
Quand R-204 ajoutera des sous-réseaux fournisseurs, il suffira que `loadScheduleNetwork` les inclue (ou d’ajouter un filtre par
niveau) pour que la carte les contrôle.

## 5. Multi-équipements (R-185)

Aucune hypothèse d’un seul type de machine : les contrôles portent sur toutes les activités du projet, y compris celles des lots
propres à un équipement ; « chargée » couvre toute ressource. Un filtre par ligne d’équipement n’a pas été ajouté (question § 7).

## 6. Vérifications

Voir le rapport du lot (typecheck, lint, suite complète, build de production).

## 7. Questions ouvertes pour le responsable produit

1. **Ressources (contrôle 10)** : garder « 0 % sans ressource ni budget », ou ne compter que les affectations de ressources (le budget
   ne suffirait plus) ?
2. **Contrôle 1** : exclure aussi les fins de chaîne propres à chaque équipement (un projet multi-équipements a naturellement
   plusieurs fins) ?
3. **Filtre par équipement** de la carte pour les projets à plusieurs lignes d’équipement ?
4. **Contrôles par projet** : faut-il des seuils propres à un projet (aujourd’hui : seuils de l’entreprise) ?
5. Faut-il un **indicateur de qualité au portefeuille** (nombre de contrôles non conformes par projet) ?
