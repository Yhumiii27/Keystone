# Cadrage — expéditions du matériel vers la filiale (R-158)

> 25 oct. 2026. Demande du responsable produit : « il manque un module de gestion des expéditions du matériel vers la
> filiale ». R-158 et `docs/BACKLOG.md` § 1 prévoient un atelier de cadrage avant de construire : ce document propose le
> périmètre et les choix par défaut (§ 3), à valider (§ 4).

## 1. Aujourd’hui

- Le transport n’existe que comme étape *Expédition* du cycle de vie, avec 3 livrables cochables : « Colisage & documents
  douaniers », « Transport contracté », « Expédition effectuée ».
- Les articles PLM portent déjà un code douanier (`parts.hs_code`) et une restriction export (`export_restriction`), et la
  nomenclature du projet est rattachée à ses lignes d’équipement (R-185) ; rien ne les exploite pour l’expédition.
- L’écran *Livraisons* ne traite que les réceptions fournisseurs ; l’écran *Chantier* gère la préparation du site.
- Les jalons publiés à l’application CAPEX (`pub_jalons_projets`) contiennent déjà `expedition` et `arrivee_site`, sans
  source réelle de dates.
- Une filiale peut être le client interne d’un projet (R-190).

## 2. Ce que le module doit permettre

Préparer, documenter, suivre et clôturer chaque envoi de matériel d’EPC2i vers le site de la filiale (ou d’un client
externe) : quoi part, dans quels colis et conteneurs, par quel transport, avec quels documents, où en est l’envoi, et ce
qui est arrivé (ou manque) à la réception sur site.

## 3. Proposition

| Sujet | Proposition par défaut |
|---|---|
| **Place dans Keystone** | Un écran projet **« Expéditions »** dans le groupe *Chantier & transfert* (après *Chantier*), plus une vue portefeuille « Expéditions en cours » pour la logistique et le directeur. |
| **Expédition** | Un projet a une ou plusieurs **expéditions** (EXP-01…), chacune rattachée à une ou plusieurs lignes d’équipement (R-185) ; statut brouillon → préparée → enlevée → en transit → arrivée → réceptionnée → clôturée. |
| **Colis et conteneurs** | Colis (n°, dimensions, poids brut / net, contenu = lignes de nomenclature et quantités) regroupés dans des chargements : camion, conteneur 20' / 40' / 40' HC / open-top / flat-rack, hors gabarit ; taux de remplissage calculé. |
| **Transport** | Mode (routier, maritime, aérien, multimodal), Incoterm (2020), transitaire (fournisseur existant), ports / aéroports, ETD / ETA, jalons suivis : enlèvement, dédouanement export, embarquement, arrivée, dédouanement import, livraison site. Saisis à la main au départ (pas de suivi automatique du transitaire). |
| **Contrôle colisage ↔ nomenclature** | Quantités expédiées comparées à la nomenclature de l’équipement : manquants, excédents, articles hors nomenclature ; le livrable « Colisage & documents douaniers » ne peut être coché que contrôle soldé (ou écart justifié). |
| **Douane** | Codes HS repris des articles, synthèse par code HS (valeur, poids, origine), alerte sur les articles sous restriction export ; un article sans code HS bloque la validation de la packing list. |
| **Valeurs et coûts** | Valeur par colis et par expédition depuis les prix de la nomenclature / des commandes ; coûts fret, assurance, droits et taxes saisis et imputés à une catégorie du budget du projet (pas de facturation). |
| **Documents** | Générés en PDF par Keystone : packing list, facture proforma / commerciale (valeur douane), liste de colisage par conteneur ; **versés dans Codex** comme les autres documents (index et liens dans Keystone). CMR, B/L, LTA, certificat d’origine / EUR.1 et déclaration d’export : référencés (n°, date, pièce Codex), pas générés. |
| **Réception sur site** | À l’arrivée, pointage colis par colis (reçu, manquant, endommagé) ; un écart crée une **réserve** (punch list, R-185 : rattachée à l’équipement) ; la réception soldée passe l’expédition en « réceptionnée ». |
| **Liens** | Dates réelles d’enlèvement et d’arrivée → jalons `expedition` et `arrivee_site` de `pub_jalons_projets` ; étape *Expédition* du cycle de vie (livraisons cochées par le module) ; risque « retard de fret » proposé quand l’ETA dépasse le besoin site. |
| **Filiale / CAPEX** | La filiale suit l’avancement dans l’application CAPEX via une vue **`pub_expeditions`** (expédition, équipement, statut, ETD / ETA, dates réelles, nombre de colis — sans valeurs) ; pas d’accès filiale dans Keystone (cohérent avec R-190). |
| **Droits** | Préparation et suivi : chef de projet et responsables du projet, **rôle logistique** si EPC2i en a un (sinon chef de projet) ; valeurs et coûts : comme le budget ; lecture : équipe projet. |
| **Sage X3** | Rien d’échangé au départ (A-1a « à discuter ») ; les coûts de fret réels arriveront avec les extractions X3 (R-034). |
| **Hors périmètre** | Réservation de fret, suivi GPS / API transitaire, gestion des stocks de la filiale, rapatriement de matériel (retour chantier → EPC2i), outillage envoyé sur chantier (proposition P7). |

**Ordre de construction proposé** : (1) expéditions, colis, chargements, contrôle colisage ↔ nomenclature ; (2) transport,
jalons, réception sur site et réserves ; (3) douane, valeurs, coûts et documents (PDF + Codex) ; (4) liens jalons CAPEX,
cycle de vie, risque et vue `pub_expeditions` (demande à Matrix pour la copie et les droits, après « validé »).

## 4. Points à valider par le responsable produit

1. **Écran projet « Expéditions »** dans *Chantier & transfert* + vue portefeuille (recommandé), ou un module à part au niveau du portefeuille ?
2. **Granularité** : expédition → chargements (camion / conteneur) → colis → lignes de nomenclature (recommandé) ?
3. **Documents** : Keystone génère packing list et facture proforma / commerciale ; les autres (CMR, B/L, LTA, EUR.1, export) sont seulement référencés (recommandé) ?
4. **Contrôle bloquant** : le colisage doit être soldé (ou l’écart justifié) avant de cocher « Colisage & documents douaniers » (recommandé) ?
5. **Réception sur site** : pointage colis par colis, un écart crée une réserve sur l’équipement (recommandé) ?
6. **Filiale** : suivi dans l’application CAPEX par une vue `pub_expeditions` sans valeurs, sans accès dans Keystone (recommandé) ?
7. **Qui prépare les expéditions** : y a-t-il un rôle « logistique / supply chain » chez EPC2i (nouveau profil), ou le chef de projet et l’acheteur ?
8. **Données à fournir** : transitaires habituels, Incoterms pratiqués, modèles de packing list / facture proforma d’EPC2i.
