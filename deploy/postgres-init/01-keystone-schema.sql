-- Dedicated PostgreSQL of deploy/compose.yaml (service db): run once by the postgres image on an EMPTY volume
-- (/docker-entrypoint-initdb.d). Keystone keeps its tables, share views and migration journal in the schema "keystone" and
-- never creates a schema itself (docs/EXPLOITATION.md § 4.1); on the shared EPC2I server, Matrix's base layer creates it.
CREATE SCHEMA IF NOT EXISTS keystone AUTHORIZATION CURRENT_USER;
