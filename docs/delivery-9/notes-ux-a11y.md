# Livraison 9 — lot « ux-a11y » (R-157, R-154, R-183) : finitions d’ergonomie, couleurs de statut, accessibilité

Demandé par le propriétaire le 29 oct. 2026 (« tout ce qui ne demande pas d’information »). Aucune migration.

## 1. R-157 — finitions relevées par les revues

| Point | Ce qui est fait |
|---|---|
| Messages de refus génériques (Chantier, Qualité) | Chantier (`src/features/site/actions.ts`) : « Cette ligne a été modifiée entre-temps… », « Le client a déjà confirmé ce prérequis », « Ce prérequis est déjà signé sur site », « Le client doit confirmer ce prérequis avant sa signature », « Cet équipement est déjà confirmé », « Cette personne est déjà GO dans Cursus », « Une relance … attend déjà Cursus ». Qualité : règles pures `ncrRefusalText` / `deliverableRefusalText` (`src/domain/quality.ts`) — « NCR-027 · Cette NCR est clôturée dans Vigie », « … une demande attend déjà Vigie », « En vérification, seul le responsable qualité décide », « Ce livrable est déjà chez le client », « Seul un contact client du projet accepte ou refuse ce livrable »… Les autres écrans (CR, ECO, commandes, Codex) gardent « Cette décision ne vous attend plus » (hors du relevé). |
| Textes des connecteurs en anglais en mode français | Le point 2 (livraison 8) couvrait les synchros et l’ajout de connecteur. Ajouté dans `activityWhatT` (`src/features/admin/i18n.ts`) : demande de déplacement Cursus, import de l’annuaire Cursus, envoi simulé vers Sage X3, repères P&ID importés, document d’ingénierie importé, imports MS Project / P6 / tableaux, « Import de <fichier> ». |
| Recherche de la nomenclature limitée aux noms anglais | `filterBomLines` lit aussi le nom affiché (`displayName`, le libellé français) et ignore la casse et les accents (« cable » trouve « Câble ») ; écran et export. |
| Colonnes Début / Fin exportées en texte | Nouveau type de colonne `month` (`src/server/export/types.ts`) : vraie date Excel au 1er du mois, format « mmm yyyy » (EN) / « mm/yyyy » (FR) ; PDF « déc. 2026 » ; CSV « 2026-12 ». Utilisé pour Fin (Vue d’ensemble, Planning portefeuille) et Début / Fin (Registre des projets). Un texte qui n’est pas un mois (« — ») reste tel quel. |
| IF-02 / IF-05 non cliquables (cellules bloquées de la mise en service) | La référence d’une interface bloquante est un lien vers sa ligne du registre des interfaces (`#IF-02`, ligne surlignée par `:target`), pour les rôles qui voient l’écran Interfaces (`canSee`). Les autres références (texte libre) restent du texte. |
| Boutons de statut « outline » au fond gris du navigateur | `button.tag-outline { background: transparent }` (`src/app/globals.css`) et, pour l’étiquette-menu (`StatusTag.module.css`), la bordure accent rendue (le prototype la retirait : le statut ne tenait plus qu’à la couleur du texte). |
| « Modifiable » affiché en lecture seule | Pondérations : « Lecture seule · hors de votre périmètre » quand `canEdit` est faux (test de rendu). |
| Focus perdu après « Marquer payée » | Réglé pour toute action qui retire son propre bouton : `FocusKeeper` dans le shell (`src/components/app/shell/focus-keeper.tsx`, `focus-return.ts`) remet le focus sur la même ligne (son premier contrôle, sinon la ligne), sinon la ligne venue à sa place, sinon la zone principale. Test e2e sur « Marquer payée ». |
| Vues Décisions / Actions vides sans message | `EmptyState` « Aucune décision dans cette vue » / « Aucune action issue des réunions pour l’instant ». |
| Analyseur local : 2e personne ignorée | « tu vas / tu dois / tu devras / vous allez / vous devez / vous devrez / tu te charges de / tu t’occupes de / vous vous chargez de… », « you’ll / you will / you need to / you have to / you must / you’re going to » : une action dont le responsable est la personne nommée avant (« Léa, tu vas… »), sinon personne (à attribuer) — jamais l’orateur. Les questions et les mots de déroulé (« tu vas commencer par… ») ne sont pas des actions. |
| Cellules bloquées de la mise en service en texte simple | Même correction que IF-02 / IF-05 ci-dessus. |

**État : fait.**

## 2. R-154 — couleurs de statut harmonisées, aucune information par la seule couleur

- Q-5 / Q-6 cités dans `tones.ts` sont les questions **02 Q-5 / Q-6 de la spécification**, pas celles de `DECISIONS.md` (mise
  en service). Le propriétaire a tranché **X-13b = « Harmoniser : un statut = une couleur partout »** (et X-13a = garder la
  palette avec un texte ou une icône sur chaque statut). Appliqué :
  - Budget › Demandes de modification (`budgetChange`) = Contrôle des modifications (`change`) : approuvée en neutre, en
    revue / en attente en accent, refusée en contour (avant : approuvée en accent, refusée en neutre).
  - Fiche d’activité (`activityDetail`, `drawerStatus`) = ligne du planning : en cours en contour, terminée en neutre, non
    commencée en texte atténué (avant : en cours en accent, non commencée en contour).
  Tests mis à jour avec un commentaire citant X-13b.
- Couleur seule : la valeur d’une tuile KPI en « LO » porte une icône d’alerte (`AlertMark`, `src/components/app/AlertMark.tsx`,
  sur toutes les tuiles) et un texte lu par les lecteurs d’écran (« Alerte ») quand l’écran le passe (`alertLabel` : tuiles et
  écarts CV / SV de Budget › Performance). Point non lu de la cloche : texte « Non lue » ; pastilles de la matrice
  d’ingénierie (révision périmée / accusé de réception / sans accusé) : titre et texte masqué ; points de gravité doublés d’une
  étiquette passés en `aria-hidden`. Les autres points audités (chaîne des CR, ECO, sourcing, documents, compétences,
  demandes, légendes) avaient déjà leur texte ou un libellé accessible.

**État : fait** pour les écarts relevés et l’audit des points ; reste possible (non bloquant) : passer `alertLabel` aux ~80
autres tuiles KPI (l’icône est déjà là partout, seul le texte pour lecteur d’écran manque).

## 3. R-183 — audit WCAG 2.1 AA et contrôles axe automatiques

- **Dépendance** : `@axe-core/playwright` 4.13.0 en **devDependency seulement** (moteur axe-core de Deque, standard du
  secteur, sans dépendance d’exécution ; lancé depuis Playwright déjà présent). Aucun job CI ajouté : le contrôle tourne dans
  le run e2e existant.
- **Spec** `tests/e2e/09-accessibility.spec.ts` : axe (étiquettes wcag2a/2aa/21a/21aa) sur tous les écrans en directeur (EN),
  et sur les écrans principaux des neuf autres personas (FR) ; échec sur une violation *serious* ou *critical* (les *moderate*
  / *minor* sont listées en annotations). Plus deux parcours clavier : lien d’évitement, focus après « Marquer payée ».
- **Corrections** : lien d’évitement « Aller au contenu principal » dans le shell, `main#main-content` focalisable ; focus
  conservé après une action (ci-dessus) ; en-tête de colonne vide des actions de réunion nommé ; icônes décoratives en
  `aria-hidden` ; classe `.sr-only` (`src/app/globals.css`). Contraste d’accent-300 : #d2cefd sur la surface #232532 ≈ 11 : 1,
  conforme AA. Onglets et segments : ce sont des liens d’URL (`aria-current`) ou des boutons (`aria-pressed`) dans un
  `role="group"` nommé — motif valide, pas de `role="tab"` (qui exigerait la navigation aux flèches) ; voir §5 pour ce qu’axe a
  relevé.

## 4. Décisions prises sans demander

- Refus précis : texte en anglais source découpé par « · » pour la traduction du toast ; numéro de l’objet en tête.
- Recherche de la nomenclature insensible aux accents.
- Colonnes « mois » : date au 1er du mois, affichée mois + année (pas de jour inventé).
- Bordure rendue aux étiquettes-menus « outline » (écart au prototype, pour que le statut ne tienne pas qu’à la couleur).
- Actions à la 2e personne sans nom : sans responsable (à attribuer), plutôt que l’orateur.
- Harmonisation des couleurs selon X-13b (pas de différence voulue par le propriétaire).

## 5. Fichiers partagés touchés

`src/app/globals.css` (fond des boutons-étiquettes, lien d’évitement, `.sr-only`) ; `src/app/(app)/layout.tsx` (lien
d’évitement, `FocusKeeper`, `id` du `main`) ; `src/components/app/{Kpi.tsx,tones.ts,StatusTag.module.css,index.ts}` ;
`src/server/export/{types,format,xlsx,pdf}.ts` ; `src/i18n/extra/index.ts` (+ `d9-ux-a11y.json`) ; `package.json`,
`package-lock.json` (seule l’entrée axe ajoutée). `nocturne.css` n’est pas modifié.
