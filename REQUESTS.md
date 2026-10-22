# Requêtes inter-applications
Format d'une entrée :
## [YYYY-MM-DD] <app demandeuse> → <cette app> — <titre court>
- Statut : OUVERTE | ACCEPTÉE | REFUSÉE | FAITE
- Demande : (quoi)
- Justification : (pourquoi, impact sur l'app demandeuse)
- Détails techniques : (tables, champs, types, endpoints, exemples)
- Validé par Guillaume le : (date)

## [2026-10-22] Crucible → Keystone — Publier les jalons des projets (vue pub_jalons)
- Statut : OUVERTE
- Demande : publier une vue `keystone.pub_jalons` des jalons des projets, avec la date de fin de l'activité liée quand elle est datée.
- Justification : Crucible (planification des moyens d'essais R&D partagés, dépôt Yhumiii27/Crucible) anticipe les besoins d'essais à partir des échéances des projets (rétro-planification, plan de charge prévisionnel, livraison 3 de Crucible). Les jalons existent dans Keystone mais ne sont pas publiés. Sans la vue, les jalons des projets présents dans Keystone sont ressaisis à la main dans Crucible (double saisie, risque d'écart). Matrix a déjà prévu le droit de lecture (`infra/postgres/partage/90-droits.sql` : `keystone.pub_jalons` → `crucible_app`).
- Détails techniques : vue `pub_jalons` (schéma `keystone`, `WITH (security_barrier)`, contrat : colonnes ajoutées en fin seulement) sur `milestones` jointe à `projects` et, si `activity_id` est posé, à `activities`. Colonnes : `projet_code` (text, `projects.code`), `jalon_id` (uuid), `nom` (text), `position` (integer), `mois_reference` (`baseline_month`), `mois_prevu` (`forecast_month`), `statut` (text), `activite_code` (text, null si aucune activité liée), `date_fin_activite` (date, `activities.finish_date`, null si non datée), `maj_le` (timestamptz). Lecteur : `crucible_app` (droit accordé par Matrix). Crucible lit par `projet_code` et `maj_le`.
- Validé par Guillaume le : 2026-10-22
