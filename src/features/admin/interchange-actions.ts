'use server';
// Server Functions of the import / export cards and the connector "Configure" dialog of Activity & integrations (chapter 4).
// The upload itself is the Route Handler POST /api/import (files up to 20 MB); these functions continue a job (column mapping,
// dry-run preview, explicit confirmation, cancel), list what the dialogs offer the viewer, and save the Keystone-side settings
// of a connector. Every function re-checks the viewer ("View as" persona): import rights per kind and project
// (src/server/interchange/rights.ts), the job's author, and the workspace rule of the screen for "Configure" / "Sync now".
// Messages are EN source sentences; the dialogs translate them (src/server/interchange/messages.ts translateMessage).
import { revalidatePath } from 'next/cache';
import { SCREEN_BY_ID, canSee, screenHref, type ScreenId } from '@/config/screens';
import { connectorDirection, type ConnectorDirection, type ImportKind } from '@/server/db/codes';
import { getConnectorConfig, updateConnectorConfig } from '@/server/dal/connector-config';
import { listProjects } from '@/server/dal/projects';
import { formatsOf, listExportProviders } from '@/server/export/registry';
import '@/server/export/providers';
import { applyImport, cancelImport, importTargets, previewTable, tableMapping, type ImportStep, type ImportViewer } from '@/server/interchange/jobs';
import { importKindsOf } from '@/server/interchange/rights';
import { isMineProject, getScreenAccess } from '@/server/project-context';
import { fmt, translateMessage } from '@/server/interchange/messages';
import { getI18n, getViewer } from '@/server/session';
import { syncConnectorAction } from './actions';

async function importViewer(): Promise<ImportViewer> {
  const v = await getViewer();
  return { name: v.name, short: v.short, role: v.role };
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

export interface ImportSetup {
  kinds: ImportKind[];
  /** Projects per kind (UPDATE targets, table imports). */
  projects: Record<ImportKind, { code: string; label: string }[]>;
  /** Project managers offered for a schedule imported as a new project (the PM imports for themself). */
  managers: { name: string; label: string }[];
  /** The viewer's own name when they are a PM (fixed project manager). */
  selfManager: string | null;
}

/** What the import dialog offers this viewer. */
export async function importSetupAction(): Promise<ImportSetup> {
  const viewer = await importViewer();
  const [projects, all] = await Promise.all([importTargets(viewer), listProjects()]);
  const managers = [...new Set(all.map((p) => p.pm).filter((x) => x && x !== '—'))].sort().map((n) => ({ name: n, label: n }));
  return { kinds: importKindsOf(viewer.role), projects, managers, selfManager: viewer.role === 'pm' ? viewer.short : null };
}

/** Column mapping of a table import (another sheet of a workbook). */
export async function tableMappingAction(jobId: unknown, sheet: unknown): Promise<ImportStep> {
  if (!isId(jobId)) return { ok: false, error: 'Invalid request' };
  return tableMapping(jobId, typeof sheet === 'string' ? sheet.slice(0, 120) : null, await importViewer());
}

/** Dry run of a table import with the mapping chosen by the user. */
export async function previewTableAction(jobId: unknown, mapping: unknown, sheet: unknown): Promise<ImportStep> {
  if (!isId(jobId) || !mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return { ok: false, error: 'Invalid request' };
  const clean: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(mapping as Record<string, unknown>)) {
    if (typeof k !== 'string' || k.length > 40) return { ok: false, error: 'Invalid request' };
    clean[k] = typeof v === 'string' && v ? v.slice(0, 200) : null;
  }
  return previewTable(jobId, clean, typeof sheet === 'string' ? sheet.slice(0, 120) : null, await importViewer());
}

const DONE_SCREEN: Record<ImportKind, ScreenId> = { mspdi: 'plan', xer: 'plan', budget_lines: 'budget', bom: 'bom', parts: 'plm', assignments: 'plan' };

/** Explicit confirmation: writes the import (refused when the data changed since the preview — the new preview is returned). */
export async function applyImportAction(jobId: unknown): Promise<ImportStep & { href?: string }> {
  if (!isId(jobId)) return { ok: false, error: 'Invalid request' };
  const r = await applyImport(jobId, await importViewer());
  if (!r.ok || r.step !== 'done') return r;
  revalidatePath('/', 'layout');
  const screen = DONE_SCREEN[r.kind];
  const href = SCREEN_BY_ID[screen].scope === 'project' ? (r.projectCode ? screenHref(screen, { code: r.projectCode }) : undefined) : screenHref(screen);
  return { ...r, href };
}

export async function cancelImportAction(jobId: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!isId(jobId)) return { ok: false, error: 'Invalid request' };
  const r = await cancelImport(jobId, await importViewer());
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ── Exports ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ExportTarget {
  screen: ScreenId;
  /** EN source title of the screen. */
  title: string;
  project: boolean;
}

export interface ExportSetup {
  targets: ExportTarget[];
  /** Projects with planning data the viewer may export (client: their organisation only). */
  projects: { code: string; label: string }[];
}

/** Screens with an Excel (tables) or PDF (report) export in the viewer's workspace, and the projects they may export. */
export async function exportSetupAction(format: unknown): Promise<ExportSetup> {
  const viewer = await getViewer();
  const fmt = format === 'pdf' ? 'pdf' : format === 'xml' ? 'xml' : 'xlsx';
  const all = await listProjects();
  const projects = all.filter((p) => p.hasData && (viewer.role !== 'client' || isMineProject(viewer, p))).map((p) => ({ code: p.code, label: `${p.displayId} · ${p.name}` }));
  if (fmt === 'xml') return { targets: [], projects };
  const targets = listExportProviders()
    .filter((p) => formatsOf(p).includes(fmt) && canSee(viewer.role, p.screen))
    .map((p) => ({ screen: p.screen, title: SCREEN_BY_ID[p.screen].title, project: SCREEN_BY_ID[p.screen].scope === 'project' }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { targets, projects };
}

// ── Connector "Configure" ─────────────────────────────────────────────────────────────────────────────────────────────
export interface ConnectorConfigView {
  name: string;
  frequency: string;
  dataScope: string;
  direction: ConnectorDirection | null;
  enabled: boolean;
  configuredAt: string | null;
  configuredByName: string | null;
}

async function plumbingEditor(): Promise<{ name: string } | null> {
  const access = await getScreenAccess('plumbing');
  return access.canEdit ? { name: access.viewer.name } : null;
}

export async function connectorConfigAction(name: unknown): Promise<{ ok: true; config: ConnectorConfigView } | { ok: false; error: string }> {
  if (!(await plumbingEditor())) return { ok: false, error: 'Activity & integrations is read-only for you' };
  if (typeof name !== 'string' || name.length > 80) return { ok: false, error: 'Invalid request' };
  const c = await getConnectorConfig(name);
  if (!c) return { ok: false, error: 'Invalid request' };
  return {
    ok: true,
    config: { name: c.name, frequency: c.frequency, dataScope: c.dataScope, direction: c.direction, enabled: c.enabled, configuredAt: c.configuredAt?.toISOString() ?? null, configuredByName: c.configuredByName },
  };
}

/** Saves the Keystone-side settings of a connector (frequency, data scope, direction, enabled); credentials stay out of scope. */
export async function saveConnectorConfigAction(name: unknown, values: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = await plumbingEditor();
  if (!editor) return { ok: false, error: 'Activity & integrations is read-only for you' };
  if (typeof name !== 'string' || name.length > 80 || !values || typeof values !== 'object') return { ok: false, error: 'Invalid request' };
  const v = values as Record<string, unknown>;
  const direction = v.direction === '' || v.direction == null ? null : v.direction;
  if (direction !== null && !connectorDirection.isCode(direction)) return { ok: false, error: 'Invalid direction' };
  if (typeof v.frequency !== 'string' || typeof v.dataScope !== 'string' || typeof v.enabled !== 'boolean') return { ok: false, error: 'Invalid request' };
  try {
    await updateConnectorConfig(name, { frequency: v.frequency, dataScope: v.dataScope, direction: direction as ConnectorDirection | null, enabled: v.enabled }, editor.name);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The change could not be saved' };
  }
  revalidatePath('/admin/integrations');
  return { ok: true };
}

/** "Sync now", refused for a connector disabled in "Configure". */
export async function syncEnabledConnectorAction(name: unknown) {
  if (typeof name === 'string' && name.length <= 80 && (await plumbingEditor())) {
    const c = await getConnectorConfig(name);
    if (c && !c.enabled) return { error: translateMessage(fmt('Connector {0} is disabled — enable it in Configure', name), (await getI18n()).t) };
  }
  return syncConnectorAction(name);
}
