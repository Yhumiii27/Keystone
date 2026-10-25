# Application CAPEX et Keystone — répartition, échanges et changements dans Keystone

> 22 oct. 2026. Fait suite à [`ANALYSE-DIG-PRODI.md`](ANALYSE-DIG-PRODI.md) et à la décision du responsable produit du
> 22 oct. 2026 : **le niveau CAPEX (méthodologie DIG-PRODI) est une application dédiée**, distincte de Keystone ; les
> données sont communes ; Keystone reste l’outil de l’ingénierie process et équipements d’EPC2i. Le prompt de démarrage de
> l’application CAPEX est [`PROMPT-APP-CAPEX.md`](PROMPT-APP-CAPEX.md).

## 1. Décisions

| # | Décision | Conséquence |
|---|---|---|
| A-1 | **Application CAPEX séparée** (nom à choisir, comme Codex, Vigie, Cursus), dépôt GitHub à part. | Les filiales et le groupe n’ont pas de compte Keystone ; Keystone n’a pas de profils filiale ni d’isolation multi-organisation (lot D-4 de l’analyse abandonné côté Keystone). |
| A-2 | **Données communes = serveur PostgreSQL commun EPC2I** (décision M-01 du dépôt Matrix, déjà appliquée à Keystone, PR #15) : une base `epc2i`, **un schéma par outil** (`keystone`, `capex`…), un rôle par outil, partage en lecture par des **vues `pub_`** contractuelles. | Chaque application n’écrit que dans son schéma et lit les vues `pub_` des autres. Pas de table partagée en écriture. |
| A-3 | **Code commun, sans copie des modules métier.** L’application CAPEX démarre avec le **socle** de Keystone (coquille, design Nocturne, i18n, Entra, audit, tâches, exploitation) repris une fois ; les modules métier ne sont pas copiés. Le socle est ensuite extrait en paquet partagé (`@epc2i/socle`, lot R-194) dès que le MVP CAPEX a montré ce qui est vraiment commun. | Divergence limitée à quelques semaines, puis une seule source du socle. |
| A-4 | **Propriétés** : le CAPEX possède les CAPEX, leurs phases et jalons G1/G2/G3, les dossiers vivants, les lots hors EPC2i, le BP, la typologie, le ramp-up, les besoins machines (côté demande). Keystone possède le catalogue machines, la réponse aux besoins (qualification, devis, offre), les projets EPC2i et tout leur contenu. Vigie possède HazID / HazOp / AMDEC / PSSR et les actions de sécurité (si Vigie les porte — à confirmer). | Mêmes règles de frontière que pour Codex, Vigie, Cursus : on affiche, on ouvre par lien profond, on ne crée pas chez l’autre. |

## 2. Échanges (contrats de vues `pub_`)

Chaque flux est une vue `pub_` lue par l’autre application (colonnes jamais supprimées ni renommées ; nouvelle version
`pub_<nom>_v2` si besoin ; nouvelles colonnes en fin de vue). Les lecteurs interrogent par date (`maj_le`, comparée à une valeur
`timestamptz`), comme les tâches planifiées de Keystone le font déjà pour Cursus ; la colonne source est indexée quand `maj_le` est
une seule colonne d’une table qui grandit (livrables, réserves : K-11, 23 oct. 2026, [`notes-share-views.md`](../delivery-9/notes-share-views.md) § 8).

| Sens | Vue | Contenu | Propriétaire |
|---|---|---|---|
| Keystone → CAPEX | `pub_catalogue_machines` (nouvelle) | fiches publiées : type, variante, options, capacité nominale, prix catalogue indicatif, délai type, statut | Keystone (R-186) |
| CAPEX → Keystone | `pub_capex` | CAPEX : code, filiale, site, intitulé, phase, typologie, sponsor, chef de projet filiale, dates G1/G2/G3 | CAPEX |
| CAPEX → Keystone | `pub_besoins_machines` | besoin : CAPEX, ligne, machine du catalogue (ou besoin libre), quantité, options, capacité visée, date de besoin, statut côté filiale (brouillon, soumis, retiré, commandé) | CAPEX |
| Keystone → CAPEX | `pub_reponses_besoins` (**publiée le 24 oct. 2026**, migration `0050_capex_needs_share`, [`notes-r187-capex-needs.md`](../delivery-9/notes-r187-capex-needs.md)) | réponse EPC2i : qualification (faisable, à étudier, refusé), classe d’estimation, montant de la fourchette, devis / offre (référence Codex), validité, projet EPC2i créé | Keystone (R-187) |
| Keystone → CAPEX | `pub_projets` (existe ; **+ `capex_code`, `besoin_ref` publiés le 22 oct. 2026**, R-190) + `pub_jalons_projets` (**publiée le 22 oct. 2026**) | étape courante, rattachement au CAPEX et au besoin ; dates prévues / réelles : commande, fin d’études, FAT, expédition, arrivée site, SAT, PV, fin de garantie (correspondance : [`notes-share-views.md`](../delivery-9/notes-share-views.md) § 3 ; date BL1 publiée le 25 oct. 2026 : [`notes-r189-reference-dates.md`](../delivery-9/notes-r189-reference-dates.md)) | Keystone (R-189, R-190) |
| Keystone → CAPEX | `pub_avancement_projets` (**publiée le 22 oct. 2026**) | % d’avancement physique, SPI (tâche `share-progress`, toutes les heures), date de fin prévue, montant du contrat et des avenants **côté vente**, facturé, en k€ — **aucun coût interne, taux ni marge** (question ouverte P-05, testé) | Keystone (R-189) |
| Keystone → CAPEX | `pub_avenants` (**publiée le 22 oct. 2026**) | avenants envoyés au client (brouillons exclus) : numéro, objet, montant, délai (jours de la demande de modification liée), statut proposé / signé / refusé, date de signature | Keystone (R-189) |
| Keystone → CAPEX | `pub_reserves` (**publiée le 22 oct. 2026**), `pub_livrables` (existe ; **+ `type`, `accepte_le`, `maj_le` le 22 oct. 2026**) | réserves A/B/C ouvertes / levées ; livrables et PV d’acceptation | Keystone (R-189) |
| Keystone → CAPEX | `pub_pack_ingenierie` (nouvelle) | part EPC2i du pack ingénierie : pièces attendues / validées par famille (P&ID, BOM, layout, électrique, analyses fonctionnelles), % pondéré | Keystone (R-191) |
| Keystone → CAPEX | `pub_parc_machines` (existe ; **+ `type_machine_code`, `livree_le`, `maj_le` le 23 oct. 2026**, K-07) | machines livrées (numéro, type, site, projet, date de livraison), une ligne par machine et article monté | Keystone (R-193) |
| CAPEX → Keystone | `pub_rampup` | par machine du parc : capacité nominale atteinte, TRS / OEE et rebuts de réception, date « 30 jours continus » | CAPEX (lu par R-193) |
| Vigie → les deux | (à définir avec Vigie) | études et actions HazID / HazOp / AMDEC / PSSR, état et retards | Vigie (R-192) |

Vues publiées le 22 oct. 2026 (migration `0038_share_followup`, notes [`docs/delivery-9/notes-share-views.md`](../delivery-9/notes-share-views.md)) :
`pub_jalons_projets`, `pub_avancement_projets`, `pub_avenants`, `pub_reserves`, les colonnes ajoutées en fin de `pub_projets` et
`pub_livrables`, et `pub_jalons` pour Crucible (R-195). Les droits de lecture d’`arche_app` et de `crucible_app` restent à poser
dans Matrix (`partage/90-droits.sql`, rôles à créer dans le socle), comme la copie de ces vues dans `partage/30-keystone.sql`.
Publiées depuis : `pub_catalogue_machines` (R-186, 24 oct. 2026), `pub_reponses_besoins` (R-187, 24 oct. 2026, avec le connecteur `capex` qui lit `arche.pub_capex` et `arche.pub_besoins_machines`). Reste à publier : `pub_pack_ingenierie` (R-191).

Le **G2 du CAPEX** fait passer le besoin à « commandé » : Keystone crée alors le projet EPC2i (ou l’ajoute à un projet) et
publie le lien dans `pub_reponses_besoins`. Le **G3 du CAPEX** lit les PV et les réserves de tous les projets EPC2i du CAPEX.

Les liens profonds se font dans les deux sens (fiche CAPEX ↔ projet EPC2i), sur le modèle de Codex / Vigie / Cursus
(`src/server/integrations/<app>/`) : un connecteur `capex` dans Keystone (miroir en lecture des vues CAPEX, liens profonds,
simulation tant que l’application CAPEX n’existe pas).

## 3. Ce qui change dans Keystone (nouveaux éléments du reste à développer)

| Id | Lot | Effort | Dépend de |
|---|---|---|---|
| **R-185** (existe) | **Multi-équipements** — devient le prérequis du lien CAPEX : un besoin de plusieurs machines doit tenir dans un projet EPC2i (équipements type × quantité ; planning, ITP, mise en service, BOM, coûts par équipement ; contrat, facturation, équipe, documents communs). | XL | cadrage avec le responsable produit |
| **R-186** | **Catalogue machines publié** : les types de machine (`mtypes`) deviennent des fiches catalogue (variantes, options, capacité nominale, prix catalogue indicatif, délai type, budget de référence, statut publié / retiré) ; vue `pub_catalogue_machines`. Le configurateur (règles d’options, chiffrage automatique) reste une option à valider. | L | R-053 (standard par type de machine) |
| **R-187** | **Besoins des filiales** : connecteur `capex` (miroir de `pub_capex` et `pub_besoins_machines`, liens profonds, simulation) ; corbeille « Besoins des filiales » pour le directeur et les chefs de projet ; qualification, réponse chiffrée (classe d’estimation), devis puis offre (Codex) ; création du projet EPC2i à la commande avec la référence du CAPEX et du besoin ; vue `pub_reponses_besoins`. Rejoint la proposition P6 « Offres & chiffrage ». | L | R-185, R-186, R-188 |
| **R-188** | **Classe d’estimation** sur les versions de budget et les offres (±50 % / ±30 % / +10 −5 %), fourchette affichée, indicateur « écart d’incertitude » ; une offre ferme exige la classe +10/−5. | M | — |
| **R-189** | **Vues de suivi pour le CAPEX** : `pub_jalons_projets`, `pub_avancement_projets` (côté vente seulement, P-05), `pub_avenants`, `pub_reserves` (migrations à part, contrats documentés dans Matrix `partage/30-keystone.sql`). | M | réponse P-05 pour le détail financier |
| **R-190** | **Filiale = client interne** : un client peut être une filiale du groupe (organisation interne), un projet porte la référence de son CAPEX ; les filiales suivent leurs projets dans l’application CAPEX, pas dans le portail client (qui reste aux clients externes, R-179). | S | R-187 |
| **R-191** | **Part EPC2i du pack ingénierie** : types de livrable layout / plan de masse machine, schéma électrique et bilan de puissance, analyse fonctionnelle ; liste type pondérée par type de machine ; % de complétude au tableau de bord ingénierie ; vue `pub_pack_ingenierie`. | M | liste type à fournir (CDC C-9) |
| **R-192** | **Sécurité machine** : HazOp / AMDEC machine, zonage ATEX machine, condition « PSSR obtenu » avant la mise en service avec produit — données Vigie (miroir), blocage dans Keystone. | M | Vigie (porte-t-il ces études ?) |
| **R-193** | **Retour de montée en puissance** : le parc installé affiche la capacité nominale atteinte et le TRS de réception lus dans `pub_rampup` (REX machine). | S | application CAPEX |
| **R-194** | **Socle partagé `@epc2i/socle`** : extraire de Keystone la coquille, le design Nocturne, l’infrastructure i18n, l’authentification Entra, la piste d’audit, le moteur de validations, les tâches planifiées, la configuration, les journaux et la santé, l’exploitation ; Keystone et CAPEX le consomment (paquet versionné). Aucun changement de comportement dans Keystone. | L | MVP CAPEX stabilisé |

**Ne change pas dans Keystone** : les 13 étapes, les baselines, l’EVM, les achats, l’ingénierie, l’ITP, la mise en service, la
garantie, les connecteurs existants, les 9 profils. Les lots D-1, D-2, D-4, D-5, D-6 (BP), D-9, D-10 (ramp-up) et D-12 (au
niveau CAPEX) de l’analyse **passent dans l’application CAPEX**. D-11 (hébergement en France, I-1a) vaut pour les deux.

## 4. Questions ouvertes

1. Nom de l’application CAPEX et dépôt GitHub (à créer par le responsable produit).
2. P-05 : quelles données financières d’un projet EPC2i la filiale peut-elle voir (prix de vente, avenants, facturé : oui ;
   coûts, marge : non, par défaut) ?
3. Vigie porte-t-il HazID / HazOp / AMDEC / PSSR ?
4. Catalogue : module de Keystone (R-186, recommandé) puis configurateur à part si besoin confirmé ?
5. Multi-équipements (R-185) : un besoin de plusieurs machines = un projet EPC2i à plusieurs équipements (recommandé) ?
