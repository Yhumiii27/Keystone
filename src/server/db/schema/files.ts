// Files, imports and exports (chapter 4): files stored by Keystone (task attachments, meeting transcripts, imported files —
// src/server/storage), staged import jobs with their preview rows (S-9 and the Excel / CSV table imports), and the export log
// (src/server/export). Codex documents are not stored here: Codex owns them (Keystone keeps the index, documents.ts).
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { FileScanStatus } from '../../../domain/file-scan';
import type { ExportFormat, ImportJobStatus, ImportKind, ImportMode, ImportRowAction, ImportRowStatus, StoredFilePurpose } from '../codes';
import { id } from './_common';
import { persons } from './organisation';
import { projects } from './portfolio';

/**
 * A file kept by Keystone under <data dir>/files (`storagePath` is relative to that folder). `ownerType` / `ownerId` say what
 * it is attached to ('task_attachment', 'meeting_transcript', 'import_job'…); deleting the owner deletes the row and the file
 * through the storage module. `scanStatus` is the antivirus verdict (R-175): 'unscanned' (scanning off, or stored before it),
 * 'clean', or 'infected' — a file flagged by a rescan is blocked (downloads answer 410) and kept until IT acts.
 */
export const storedFiles = pgTable('stored_files', {
  id: id(),
  purpose: text('purpose').$type<StoredFilePurpose>().notNull(),
  /** Original file name as uploaded (sanitised). */
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  storagePath: text('storage_path').notNull().unique(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  ownerType: text('owner_type'),
  ownerId: uuid('owner_id'),
  createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
  createdByName: text('created_by_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  scanStatus: text('scan_status').$type<FileScanStatus>().notNull().default('unscanned'),
  scannedAt: timestamp('scanned_at', { withTimezone: true }),
  /** Signature clamd reported (internal: logs and IT only, never shown to the uploader). */
  scanSignature: text('scan_signature'),
});

/**
 * Import job (staging): upload → parse → (column mapping for Excel / CSV) → preview → explicit confirmation → transactional
 * write. Nothing reaches the business tables before `applied`; a dry run stops at `previewed`.
 */
export const importJobs = pgTable('import_jobs', {
  id: id(),
  kind: text('kind').$type<ImportKind>().notNull(),
  mode: text('mode').$type<ImportMode>().notNull(),
  status: text('status').$type<ImportJobStatus>().notNull(),
  /** Target project (existing project, or the project created by a 'new' schedule import once applied). */
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  fileId: uuid('file_id').references(() => storedFiles.id, { onDelete: 'set null' }),
  fileName: text('file_name').notNull(),
  /** Excel / CSV column mapping: target field → source column (auto-detected, then edited). */
  mapping: jsonb('mapping').$type<Record<string, string | null>>().notNull().default({}),
  /** Kind-specific options (sheet name, separator, new project name, baseline to import…). */
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  /** Preview / result summary: counts per status and action, unmapped fields, created ids. */
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
  createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
  createdByName: text('created_by_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  previewedAt: timestamp('previewed_at', { withTimezone: true }),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  appliedByName: text('applied_by_name'),
});

/** Preview rows of an import job (OK / warning / error with messages), replaced at each preview. */
export const importJobRows = pgTable('import_job_rows', {
  id: id(),
  jobId: uuid('job_id').notNull().references(() => importJobs.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  status: text('status').$type<ImportRowStatus>().notNull(),
  action: text('action').$type<ImportRowAction>().notNull(),
  /** Matching key: UID / Activity ID / part reference / category code. */
  key: text('key'),
  /** Normalised row (target field → value). */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  /** EN source messages ("Unknown predecessor A9999", "Duration not a number"). */
  messages: text('messages').array().notNull().default([]),
}, (t) => [index('import_job_rows_job_id_idx').on(t.jobId)]);

/** Export log: every file produced by the export route (screen, format, filters, rows) — for the audit trail. */
export const exportLog = pgTable('export_log', {
  id: id(),
  screen: text('screen').notNull(),
  format: text('format').$type<ExportFormat>().notNull(),
  /** Provider variant ('table', 'po', 'receipt', 'statement'…). */
  variant: text('variant'),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  params: jsonb('params').$type<Record<string, string>>().notNull().default({}),
  rowCount: integer('row_count').notNull().default(0),
  fileName: text('file_name').notNull(),
  byPersonId: uuid('by_person_id').references(() => persons.id),
  byName: text('by_name').notNull(),
  byRole: text('by_role'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
