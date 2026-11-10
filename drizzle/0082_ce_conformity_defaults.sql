-- R-160 (P2, D9-32): the default CE conformity checklists — Annex III headings (number and short title) and Annex IV
-- technical-file headings of Regulation (EU) 2023/1230 (src/domain/ce-conformity.ts DEFAULT_EHSR, DEFAULT_TECHFILE), on every
-- database (demonstration and production). Replayable: an entry already there is left as it is. The CE file's version trigger
-- (R-010, ks_bump_row_version of 0069).
INSERT INTO "ce_checklist_items" ("kind", "code", "title", "position", "active", "is_default") VALUES
  ('ehsr', '1.1', 'General remarks', 0, true, true),
  ('ehsr', '1.2', 'Control systems', 1, true, true),
  ('ehsr', '1.3', 'Protection against mechanical hazards', 2, true, true),
  ('ehsr', '1.4', 'Required characteristics of guards and protective devices', 3, true, true),
  ('ehsr', '1.5', 'Risks due to other hazards', 4, true, true),
  ('ehsr', '1.6', 'Maintenance', 5, true, true),
  ('ehsr', '1.7', 'Information', 6, true, true),
  ('ehsr', '2', 'Supplementary requirements for certain categories of machinery', 7, true, true),
  ('ehsr', '3.1', 'Mobility · General', 8, true, true),
  ('ehsr', '3.2', 'Mobility · Work positions', 9, true, true),
  ('ehsr', '3.3', 'Mobility · Control systems', 10, true, true),
  ('ehsr', '3.4', 'Mobility · Protection against mechanical hazards', 11, true, true),
  ('ehsr', '3.5', 'Mobility · Protection against other hazards', 12, true, true),
  ('ehsr', '3.6', 'Mobility · Information and indications', 13, true, true),
  ('ehsr', '4.1', 'Lifting · General', 14, true, true),
  ('ehsr', '4.2', 'Lifting · Machinery whose power source is other than manual effort', 15, true, true),
  ('ehsr', '4.3', 'Lifting · Information and markings', 16, true, true),
  ('ehsr', '4.4', 'Lifting · Instructions', 17, true, true),
  ('ehsr', '5', 'Machinery intended for underground work', 18, true, true),
  ('ehsr', '6', 'Machinery presenting particular hazards due to the lifting of persons', 19, true, true),
  ('techfile', 'description', 'General description of the machinery and its intended use', 0, true, true),
  ('techfile', 'risk_assessment', 'Risk assessment and protective measures', 1, true, true),
  ('techfile', 'drawings', 'Design and manufacturing drawings, calculation notes and circuit diagrams', 2, true, true),
  ('techfile', 'explanations', 'Descriptions and explanations of the drawings and of the operation', 3, true, true),
  ('techfile', 'standards', 'Harmonised standards and technical specifications applied', 4, true, true),
  ('techfile', 'tests', 'Test reports and results', 5, true, true),
  ('techfile', 'instructions', 'Instructions for use', 6, true, true),
  ('techfile', 'incorporated', 'Declarations of incorporated partly completed machinery and products', 7, true, true),
  ('techfile', 'declaration', 'Copy of the EU declaration of conformity', 8, true, true),
  ('techfile', 'series', 'Measures ensuring the conformity of series production', 9, true, true),
  ('techfile', 'software', 'Safety-related software (source code or programming logic)', 10, true, true)
ON CONFLICT ("kind", "code") DO NOTHING;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ce_files_row_version" ON "ce_files";
--> statement-breakpoint
CREATE TRIGGER "ce_files_row_version" BEFORE UPDATE ON "ce_files" FOR EACH ROW EXECUTE FUNCTION "ks_bump_row_version"();
