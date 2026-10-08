// Documents — the Codex index (docs/spec/11 §3.10, screens 10 §4 Documents and §5 Document types register).
// Codex (the document management system) owns the files, numbering, approval circuits and retention; Keystone
// keeps a synced index of the records (number, revision, status, confidentiality, tags, links), the approval proof,
// distribution / client acknowledgements and the download log, and hands deposits over to Codex.
//
// The prototype synthesises part of the history (one revision every 21 days, approval dates counted back from the
// document date, two fixed download entries per released document). The seed materialises that history as rows so
// the screens read data, never formulas; a real Codex sync replaces them (OPEN QUESTION D-1, 10 OQ13).
import { boolean, date, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type {
  ApproverRole, Confidentiality, DepositStatus, DocDownloadSource, DocFamily, DocLinkKind, DocRecipient, DocService, DocumentStatus,
} from '../codes';
import { id, timestamps } from './_common';
import { persons } from './organisation';
import { projects } from './portfolio';

/** Document types register (DOC_TYPES 3615, 28 types) — read-only mirror of Codex. */
export const documentTypes = pgTable('document_types', {
  /** "PID", "MIN"… */
  code: text('code').primaryKey(),
  /** EN source string: "P&ID", "Meeting minutes". */
  label: text('label').notNull(),
  family: text('family').$type<DocFamily>().notNull(),
  /** "Asset life", "10 years", "Superseded + 3 years"… (EN source strings). */
  retention: text('retention').notNull(),
  /** "8.3 Design & development". */
  isoClause: text('iso_clause').notNull(),
  /** Released documents of the type are shared with the client and need an acknowledgement. */
  isClientDeliverable: boolean('is_client_deliverable').notNull(),
  position: integer('position').notNull(),
});

/** Approval circuit of a type ("Author → Engineering lead → Project manager"): step 0 is the originator. */
export const documentTypeCircuitSteps = pgTable(
  'document_type_circuit_steps',
  {
    typeCode: text('type_code').notNull().references(() => documentTypes.code),
    position: integer('position').notNull(),
    role: text('role').$type<ApproverRole>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.typeCode, t.position] })],
);

/** Named approver of a circuit role (DOC_WHO 3617 — global in the prototype; projectId reserved for per-project overrides). */
export const documentApproverAssignments = pgTable(
  'document_approver_assignments',
  {
    id: id(),
    role: text('role').$type<ApproverRole>().notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').notNull().references(() => persons.id),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.role, t.projectId).nullsNotDistinct()],
);

/** Index record of a Codex document (DOCS 3618, 42 records; deposits and meeting minutes created in Keystone). */
export const documents = pgTable('documents', {
  id: id(),
  /** `TYPE-PROJ-SEQ`: "PID-HLT-026", "PRO-QMS-021", "LST-INS-026". */
  number: text('number').notNull().unique(),
  typeCode: text('type_code').notNull().references(() => documentTypes.code),
  title: text('title').notNull(),
  /** Null = company quality-system document (`proj: 'QMS'`), visible from every project. */
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  service: text('service').$type<DocService>().notNull(),
  /** Current revision letter ("D"). */
  currentRevision: text('current_revision').notNull(),
  status: text('status').$type<DocumentStatus>().notNull(),
  /** Date of the current revision ("26 Sep" → 2026-09-26). */
  issuedOn: date('issued_on', { mode: 'string' }).notNull(),
  authorPersonId: uuid('author_person_id').references(() => persons.id),
  /** Author as Codex returns it ("P. Noguès"). */
  authorName: text('author_name').notNull(),
  confidentiality: text('confidentiality').$type<Confidentiality>().notNull(),
  /** Classification: activity ids, P&ID tags, references ("A1410 · A1420 · LT-101" split on " · "). */
  tags: text('tags').array().notNull(),
  /** Distribution list (`to`: "meca,elec,auto,client"). */
  recipients: text('recipients').array().$type<DocRecipient[]>().notNull(),
  /** Last automatic withdrawal on release of a revision > A (engOv.obs: "rev C withdrawn automatically · 29 Sep"). */
  lastWithdrawnRevision: text('last_withdrawn_revision'),
  lastWithdrawnOn: date('last_withdrawn_on', { mode: 'string' }),
  /** Created from Keystone (deposit hand-off, meeting minutes) — "New" tag. */
  isNew: boolean('is_new').notNull().default(false),
  /** Codex deep link (OPEN QUESTION D-1). */
  codexId: text('codex_id'),
  codexUrl: text('codex_url'),
  /** Vault order: DOCS order; Keystone-created records are prepended with a lower value. */
  sortOrder: integer('sort_order').notNull(),
  ...timestamps,
});

/** Revisions A … current (synthetic history in the seed: one revision every 21 days). */
export const documentRevisions = pgTable(
  'document_revisions',
  {
    id: id(),
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    revision: text('revision').notNull(),
    /** 0 = A. */
    position: integer('position').notNull(),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    authorPersonId: uuid('author_person_id').references(() => persons.id),
    authorName: text('author_name').notNull(),
    /** Withdrawn (obsolete) when a later revision was released; null for the current revision. */
    withdrawnOn: date('withdrawn_on', { mode: 'string' }),
    /** Working versions recorded in Codex for the revision (prototype: current "A.3", earlier "{n} working versions"). */
    workingVersions: integer('working_versions').notNull(),
  },
  (t) => [unique().on(t.documentId, t.revision)],
);

/** Approval proof of the current revision: one row per circuit step (step 0 = originator, signed at issue). */
export const documentApprovals = pgTable(
  'document_approvals',
  {
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    revision: text('revision').notNull(),
    stepPosition: integer('step_position').notNull(),
    role: text('role').$type<ApproverRole>().notNull(),
    /** Named approver (author for step 0, DOC_WHO otherwise); null when the role has no assignment ("—"). */
    approverPersonId: uuid('approver_person_id').references(() => persons.id),
    approverName: text('approver_name'),
    /** Signed on (null = pending). */
    signedOn: date('signed_on', { mode: 'string' }),
    /** Who actually recorded the signature in Keystone ("Approve in Codex"), when different from the seed. */
    signedByPersonId: uuid('signed_by_person_id').references(() => persons.id),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.revision, t.stepPosition] })],
);

/** Relations of a document (`links`: [['Deliverable', 'D-016']]) — free references until the targets are modelled. */
export const documentLinks = pgTable('document_links', {
  id: id(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<DocLinkKind>().notNull(),
  /** "D-016", "EL-VFD-200", "PO-2026-118", "P-01", "CR-004". */
  targetRef: text('target_ref').notNull(),
  position: integer('position').notNull(),
});

/** Client acknowledgement of a released client-deliverable revision (`engOv.ack[id|rev]`). Absent row = pending. */
export const documentAcknowledgements = pgTable(
  'document_acknowledgements',
  {
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    revision: text('revision').notNull(),
    acknowledgedByPersonId: uuid('acknowledged_by_person_id').references(() => persons.id),
    acknowledgedOn: date('acknowledged_on', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.revision] })],
);

/** Download log (`engOv.dl` + the Codex log). */
export const documentDownloads = pgTable('document_downloads', {
  id: id(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  revision: text('revision').notNull(),
  personId: uuid('person_id').references(() => persons.id),
  /** "S. Haddad" / persona full name. */
  personName: text('person_name').notNull(),
  downloadedOn: date('downloaded_on', { mode: 'string' }).notNull(),
  /** "PDF" | "Native". */
  format: text('format').notNull(),
  source: text('source').$type<DocDownloadSource>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Deposit hand-offs to Codex (`dv.dep`): a new document, or a new revision of an existing one. */
export const documentDeposits = pgTable('document_deposits', {
  id: id(),
  typeCode: text('type_code').notNull().references(() => documentTypes.code),
  /** Null = QMS. */
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  /** "PO-2026-118" / "CR-RAIL-A100" (free text). */
  linkedPoRef: text('linked_po_ref'),
  linkedPartRef: text('linked_part_ref'),
  /** New revision of this document (null for a new document). */
  contextDocumentId: uuid('context_document_id').references(() => documents.id, { onDelete: 'set null' }),
  /** Number previewed and recorded ("CER-HLT-042"). */
  number: text('number').notNull(),
  /** Index record created or updated by the hand-off. */
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  status: text('status').$type<DepositStatus>().notNull(),
  requestedByPersonId: uuid('requested_by_person_id').references(() => persons.id),
  requestedOn: date('requested_on', { mode: 'string' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Codex index synchronisations ("Last sync 08:02 · 412 records"). */
export const documentIndexSyncs = pgTable('document_index_syncs', {
  id: id(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
  /** Records in Codex at that sync (beyond the documents indexed here). */
  recordCount: integer('record_count').notNull(),
  requestedByPersonId: uuid('requested_by_person_id').references(() => persons.id),
});
