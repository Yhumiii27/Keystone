'use client';
// Import dialog of Activity & integrations › Import / export (chapter 4, S-9 and the Excel / CSV imports). Opened by dropping or
// choosing a file on an import card. Steps (numbered stepper, as the other staged imports):
//  1. Source — the file and its target: a schedule (MS Project XML / P6 XER) into a NEW project (name, client, project manager)
//     or an EXISTING one (matching on UID or Activity ID), baselines on / off; a table (budget lines, BOM, parts catalogue,
//     resource assignments) with its project and mode (add and update / add only). "Check the file" uploads it (POST /api/import).
//  2. Column mapping (tables only) — target field → column, proposed from the headers (EN / FR), sheet of a workbook, sample rows.
//  3. Preview — the dry run: counts OK / warnings / errors and create / update / skip, what is not imported, the rows with their
//     messages; "Import" is the explicit confirmation (refused, with a new preview, when the data changed since).
// Messages come from the server in English and are translated here (translateMessage).
import { ArrowLeft, FileArrowUp, ListChecks, Play, Warning } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState, useTransition } from 'react';
import { Callout } from '@/components/app/Callout';
import { NumberedStepper } from '@/components/app/Stepper';
import { Button } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input, Select } from '@/components/ds/Field';
import { Segmented } from '@/components/ds/Segmented';
import { Table, Th } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import type { ImportKind, ImportMode } from '@/server/db/codes';
import type { ImportStep, MappingView, PreviewRowView, PreviewView } from '@/server/interchange/jobs';
import { fmt, translateMessage } from '@/server/interchange/messages';
import { INTERCHANGE_DEFAULTS } from '@/server/interchange/defaults';
import type { TableKind } from '@/server/interchange/table';
import { applyImportAction, cancelImportAction, importSetupAction, previewTableAction, tableMappingAction, type ImportSetup } from './interchange-actions';
import s from './interchange.module.css';
import { fieldsText } from '@/i18n/data-text';

/** EN labels of the import kinds (as importKind in src/server/db/codes.ts). */
export const KIND_LABEL: Record<ImportKind, string> = {
  mspdi: 'MS Project XML', xer: 'Primavera P6 XER', budget_lines: 'Budget lines', bom: 'Bill of materials', parts: 'Parts catalogue', assignments: 'Resource assignments',
};
const TABLE_KINDS: TableKind[] = ['budget_lines', 'bom', 'parts', 'assignments'];

const sizeText = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);

export interface ImportDialogProps {
  /** Card the file was given to: a schedule (MS Project / P6 — detected from the file) or an Excel / CSV table. */
  card: 'schedule' | 'table';
  /** Card name (translated), the dialog title. */
  title: string;
  file: File;
  onClose: () => void;
}

export function ImportDialog({ card, title, file, onClose }: ImportDialogProps) {
  const { t, lang } = useI18n();
  const tr = (m: string) => translateMessage(m, t);
  const router = useRouter();
  const id = useId();
  const [setup, setSetup] = useState<ImportSetup | null>(null);
  const [phase, setPhase] = useState<'source' | 'mapping' | 'preview'>('source');
  const [mode, setMode] = useState<ImportMode>(card === 'schedule' ? INTERCHANGE_DEFAULTS.scheduleMode : INTERCHANGE_DEFAULTS.tableMode);
  const [kind, setKind] = useState<TableKind | null>(null);
  const [chosenProject, setProject] = useState('');
  const [matchOn, setMatchOn] = useState<'uid' | 'activity_id'>(INTERCHANGE_DEFAULTS.matchOn);
  const [baselines, setBaselines] = useState<boolean>(INTERCHANGE_DEFAULTS.importBaselines);
  const [projectName, setProjectName] = useState('');
  const [client, setClient] = useState('');
  const [pm, setPm] = useState('');
  const [mapping, setMapping] = useState<MappingView | null>(null);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    importSetupAction()
      .then((r) => {
        if (!alive) return;
        setSetup(r);
        const k = TABLE_KINDS.find((x) => r.kinds.includes(x)) ?? null;
        setKind(k);
        setPm(r.selfManager ?? (r.managers.some((m) => m.name === INTERCHANGE_DEFAULTS.defaultProjectManager) ? INTERCHANGE_DEFAULTS.defaultProjectManager : (r.managers[0]?.name ?? '')));
      })
      .catch(() => alive && setError(t('The import failed')));
    return () => {
      alive = false;
    };
  }, [t]);

  const scheduleKind: ImportKind = /\.xer$/i.test(file.name) ? 'xer' : 'mspdi';
  const tableKinds = setup ? TABLE_KINDS.filter((k) => setup.kinds.includes(k)) : [];
  const targetKind: ImportKind | null = card === 'schedule' ? scheduleKind : kind;
  const projects = useMemo(() => (setup && targetKind ? setup.projects[targetKind] : []), [setup, targetKind]);
  const needsProject = card === 'schedule' ? mode === 'update' : kind !== 'parts';
  // The chosen project when it is a target of the current kind, else the first one.
  const project = projects.some((p) => p.code === chosenProject) ? chosenProject : (projects[0]?.code ?? '');
  const canSchedule = !!setup && (setup.kinds.includes('mspdi') || setup.kinds.includes('xer'));
  const ready = !!setup && !pending && (card === 'schedule' ? canSchedule : !!kind) && (!needsProject || !!project);

  const jobId = preview?.jobId ?? mapping?.jobId ?? null;
  const handle = (r: ImportStep) => {
    if (!r.ok) {
      setError(tr(r.error));
      if (r.stale) setPreview(r.stale);
      return;
    }
    if (r.step === 'mapping') {
      setMapping(r.mapping);
      setPhase('mapping');
    } else if (r.step === 'preview') {
      setPreview(r.preview);
      setPhase('preview');
    }
  };

  const upload = () =>
    start(async () => {
      setError(null);
      const form = new FormData();
      form.set('file', file);
      form.set('kind', card === 'schedule' ? 'schedule' : (kind ?? ''));
      form.set('mode', mode);
      if (needsProject) form.set('code', project);
      if (card === 'schedule') {
        form.set('matchOn', matchOn);
        form.set('baselines', baselines ? '1' : '0');
        if (mode === 'new') {
          if (projectName.trim()) form.set('projectName', projectName.trim());
          if (client.trim()) form.set('client', client.trim());
          if (pm) form.set('pm', pm);
        }
      }
      try {
        const res = await fetch('/api/import', { method: 'POST', body: form });
        handle((await res.json()) as ImportStep);
      } catch {
        setError(t('The import failed'));
      }
    });

  const changeSheet = (sheet: string) =>
    start(async () => {
      if (!mapping) return;
      setError(null);
      handle(await tableMappingAction(mapping.jobId, sheet));
    });

  const check = () =>
    start(async () => {
      if (!mapping) return;
      setError(null);
      handle(await previewTableAction(mapping.jobId, mapping.mapping, mapping.sheet));
    });

  const confirm = () =>
    start(async () => {
      if (!preview) return;
      setError(null);
      const r = await applyImportAction(preview.jobId);
      if (r.ok && r.step === 'done') {
        onClose();
        showToast(tr(fmt('Imported · {0} created · {1} updated', r.created, r.updated)));
        if (r.href) router.push(r.href);
        else router.refresh();
        return;
      }
      handle(r);
    });

  const cancelJob = () =>
    start(async () => {
      if (jobId) await cancelImportAction(jobId).catch(() => null);
      onClose();
    });

  const back = () => {
    setError(null);
    if (phase === 'preview' && mapping) setPhase('mapping');
    else {
      if (jobId) void cancelImportAction(jobId).catch(() => null);
      setMapping(null);
      setPreview(null);
      setPhase('source');
    }
  };

  const steps = card === 'table' ? [t('File & target'), t('Column mapping'), t('Check & import')] : [t('File & target'), t('Check & import')];
  const current = phase === 'source' ? 1 : phase === 'mapping' ? 2 : card === 'table' ? 3 : 2;
  const fileLine = (
    <div className={s.fileLine}>
      <FileArrowUp className={s.fileIcon} aria-hidden />
      <span className={s.fileName}>{file.name}</span>
      <span className={s.fileMeta}>{sizeText(file.size)}</span>
    </div>
  );
  const errorBox = error && (
    <Callout variant="emphasis" icon={Warning} role="alert">
      {error}
    </Callout>
  );

  return (
    <Dialog open onClose={onClose} title={title} subtitle={t('Nothing is written before you confirm the preview.')} width={phase === 'preview' ? 820 : 640} offsetTop="6vh" maxHeight="88vh">
      <NumberedStepper steps={steps} current={current} />
      {phase === 'source' && (
        <form
          className={s.body}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) upload();
          }}
        >
          {fileLine}
          {!setup ? (
            <span className={s.hint}>{t('Loading…')}</span>
          ) : card === 'schedule' ? (
            !canSchedule ? (
              <Callout variant="info">{t('You may not import this file into this project')}</Callout>
            ) : (
              <div className={s.grid}>
                <Field label={t('Import into')} span="full">
                  <Segmented
                    fullWidth
                    label={t('Import into')}
                    value={mode}
                    onChange={(v) => setMode(v)}
                    options={[{ value: 'new', label: t('New project') }, { value: 'update', label: t('Existing project'), disabled: !projects.length }]}
                  />
                </Field>
                {mode === 'new' ? (
                  <>
                    <Field label={t('Project name')} htmlFor={`${id}-name`} span="full" hint={t('Empty: the name in the file')}>
                      <Input id={`${id}-name`} value={projectName} maxLength={200} onChange={(e) => setProjectName(e.target.value)} />
                    </Field>
                    <Field label={t('Client')} htmlFor={`${id}-client`} hint={t('Empty: the company in the file')}>
                      <Input id={`${id}-client`} value={client} maxLength={120} onChange={(e) => setClient(e.target.value)} />
                    </Field>
                    <Field label={t('Project manager')} htmlFor={`${id}-pm`}>
                      <Select
                        id={`${id}-pm`}
                        value={pm}
                        disabled={!!setup.selfManager}
                        onChange={(e) => setPm(e.target.value)}
                        options={(setup.selfManager ? [{ name: setup.selfManager, label: setup.selfManager }] : setup.managers).map((m) => ({ value: m.name, label: m.label }))}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label={t('Project')} htmlFor={`${id}-project`} span="full">
                      <Select id={`${id}-project`} value={project} onChange={(e) => setProject(e.target.value)} options={projects.map((p) => ({ value: p.code, label: fieldsText(p.label, t, lang) }))} />
                    </Field>
                    <Field label={t('Match activities on')} span="full" hint={t('The other key is used when the first one finds nothing')}>
                      <Segmented
                        fullWidth
                        label={t('Match activities on')}
                        value={matchOn}
                        onChange={(v) => setMatchOn(v)}
                        options={[{ value: 'uid', label: t('UID') }, { value: 'activity_id', label: t('Activity ID') }]}
                      />
                    </Field>
                  </>
                )}
                <label className={cx(s.checkLine, s.full)}>
                  <input type="checkbox" checked={baselines} onChange={(e) => setBaselines(e.target.checked)} />
                  {mode === 'new' ? t('Import the baselines of the file (Baseline 0 → BL1)') : t('Import the file’s Baseline 0 as a new proposed baseline')}
                </label>
                <span className={cx(s.hint, s.full)}>{t('Recalculation stays manual: the dates of the file are kept until the next Reschedule.')}</span>
              </div>
            )
          ) : !tableKinds.length ? (
            <Callout variant="info">{t('You may not import this file into this project')}</Callout>
          ) : (
            <div className={s.grid}>
              <Field label={t('Data to import')} htmlFor={`${id}-kind`}>
                <Select id={`${id}-kind`} value={kind ?? ''} onChange={(e) => setKind(e.target.value as TableKind)} options={tableKinds.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))} />
              </Field>
              <Field label={t('Mode')} htmlFor={`${id}-mode`}>
                <Select
                  id={`${id}-mode`}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ImportMode)}
                  options={[{ value: 'update', label: t('Add and update') }, { value: 'new', label: t('Add only') }]}
                />
              </Field>
              {kind !== 'parts' && (
                <Field label={t('Project')} htmlFor={`${id}-tproject`} span="full">
                  <Select id={`${id}-tproject`} value={project} onChange={(e) => setProject(e.target.value)} options={projects.map((p) => ({ value: p.code, label: fieldsText(p.label, t, lang) }))} />
                </Field>
              )}
              <span className={cx(s.hint, s.full)}>{t('CSV (; or , separated, UTF-8 or Windows) or Excel (.xlsx) · one row per line under a header row · empty cells never erase a value')}</span>
            </div>
          )}
          {errorBox}
          <DialogActions>
            <Button variant="secondary" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="primary" icon={ListChecks} disabled={!ready} aria-busy={pending || undefined}>
              {t('Check the file')}
            </Button>
          </DialogActions>
        </form>
      )}

      {phase === 'mapping' && mapping && (
        <div className={s.body}>
          {fileLine}
          {mapping.sheets.length > 1 && (
            <Field label={t('Sheet')} htmlFor={`${id}-sheet`}>
              <Select id={`${id}-sheet`} value={mapping.sheet ?? ''} onChange={(e) => changeSheet(e.target.value)} options={mapping.sheets} disabled={pending} />
            </Field>
          )}
          <span className={s.hint}>
            {t(KIND_LABEL[mapping.kind])} · {t('Header row')} {mapping.headerLine} · {t('Columns proposed from the headers — check them')}
          </span>
          <div className={s.mapGrid}>
            {mapping.fields.map((f) => (
              <MapRow
                key={f.key}
                id={`${id}-map-${f.key}`}
                label={t(f.label)}
                required={f.required}
                value={mapping.mapping[f.key] ?? ''}
                columns={mapping.columns}
                none={t('Not imported')}
                onChange={(v) => setMapping({ ...mapping, mapping: { ...mapping.mapping, [f.key]: v || null } })}
              />
            ))}
          </div>
          {mapping.sample.length > 0 && (
            <div className={s.sample}>
              <Table size={12.5} scroll={false}>
                <thead>
                  <tr>
                    {mapping.columns.map((c) => (
                      <Th key={c}>{c}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mapping.sample.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          {errorBox}
          <DialogActions>
            <Button variant="secondary" icon={ArrowLeft} onClick={back}>
              {t('Back')}
            </Button>
            <Button variant="primary" icon={ListChecks} disabled={pending || mapping.fields.some((f) => f.required && !mapping.mapping[f.key])} aria-busy={pending || undefined} onClick={check}>
              {t('Check the mapping')}
            </Button>
          </DialogActions>
        </div>
      )}

      {phase === 'preview' && preview && (
        <div className={s.body}>
          <PreviewBody preview={preview} t={t} tr={tr} />
          {errorBox}
          <DialogActions>
            <Button variant="secondary" onClick={cancelJob} disabled={pending}>
              {t('Cancel import')}
            </Button>
            <Button variant="secondary" icon={ArrowLeft} onClick={back} disabled={pending}>
              {t('Back')}
            </Button>
            <Button variant="primary" icon={Play} disabled={!preview.canImport || pending} aria-busy={pending || undefined} onClick={confirm}>
              {t('Import now')}
            </Button>
          </DialogActions>
        </div>
      )}
    </Dialog>
  );
}

function MapRow({ id, label, required, value, columns, none, onChange }: { id: string; label: string; required: boolean; value: string; columns: string[]; none: string; onChange: (v: string) => void }) {
  return (
    <>
      <label htmlFor={id} className={s.mapLabel}>
        {label}
        {required && <span className={s.star}> *</span>}
      </label>
      <Select id={id} size="inline" value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: '', label: none }, ...columns.map((c) => ({ value: c, label: c }))]} />
    </>
  );
}

const ACTION_LABEL = { create: 'To create', update: 'To update', skip: 'Skipped' } as const;
const STATUS_TONE = { ok: 'neutral', warning: 'outline', error: 'accent' } as const;
/** EN labels of the codes a table row carries (as the codecs of src/server/db/codes.ts). */
const CODE_LABEL: Record<string, Record<string, string>> = {
  costType: { labor: 'Labor', material: 'Material', equipment: 'Equipment', subcontract: 'Subcontract', fees: 'Fees', reserve: 'Reserve' },
  scope: { keystone: 'Keystone', client: 'Client', overlay: 'Overlay' },
  makeBuy: { manufactured: 'Manufactured', purchased: 'Purchased' },
  status: { validated: 'Validated', not_validated: 'Not validated', outdated: 'Outdated', obsolete: 'Obsolete' },
};
const ROW_KIND: Record<string, string> = { calendar: 'Calendar', wbs: 'Work package', activity: 'Activity', baseline: 'Baseline' };

function rowText(r: PreviewRowView, t: (s: string) => string): { name: string; sub: string } {
  const d = r.data;
  const str = (v: unknown) => (v == null || v === '' ? '' : String(v));
  switch (d.kind) {
    case 'activity':
      return {
        name: str(d.name),
        sub: [
          d.start || d.finish ? `${str(d.start) || '—'} → ${str(d.finish) || '—'}` : '', `${str(d.duration)} ${t('working days')}`, `${str(d.pct)} %`,
          Array.isArray(d.preds) && d.preds.length ? `${t('Predecessors')} · ${(d.preds as string[]).join(', ')}` : '', d.constraint ? str(d.constraint) : '',
        ].filter(Boolean).join(' · '),
      };
    case 'calendar':
      return { name: str(d.name), sub: `${(d.workDays as number[] | undefined)?.length ?? 0} ${t('working days per week')} · ${str(d.hoursPerDay)} h` };
    case 'wbs':
    case 'baseline':
      return { name: str(d.name ?? r.key), sub: '' };
    default: {
      const name = str(d.name ?? d.resource ?? d.ref ?? r.key);
      const rest = Object.entries(d)
        .filter(([k, v]) => !['line', 'name', 'resource', 'ref', 'code', 'activity'].includes(k) && v != null && v !== '')
        .map(([k, v]) => (CODE_LABEL[k]?.[String(v)] ? t(CODE_LABEL[k][String(v)]) : String(v)))
        .join(' · ');
      return { name, sub: rest };
    }
  }
}

function PreviewBody({ preview, t, tr }: { preview: PreviewView; t: (s: string) => string; tr: (s: string) => string }) {
  const sum = preview.summary as Record<string, unknown>;
  const target = preview.projectCode ?? (preview.kind === 'parts' ? t('Parts catalogue') : preview.mode === 'new' ? `${t('New project')} · ${String(sum.projectName ?? '')}` : '—');
  const unmapped = (sum.unmapped as string[] | undefined) ?? [];
  const warnings = (sum.warnings as string[] | undefined) ?? [];
  const isSchedule = preview.kind === 'mspdi' || preview.kind === 'xer';
  return (
    <>
      <div className={s.head}>
        <span className={s.headTitle}>{preview.fileName}</span>
        <span className={s.headMeta}>
          {t(KIND_LABEL[preview.kind])} · {target}
          {isSchedule && sum.start ? ` · ${String(sum.start)} → ${String(sum.finish ?? '—')}` : ''}
        </span>
      </div>
      <div className={s.counts} aria-label={t('Import preview')}>
        {(['ok', 'warning', 'error'] as const).map((k) => (
          <span key={k} className={s.count}>
            <Tag tone={STATUS_TONE[k]} size="sm">
              {t(k === 'ok' ? 'OK' : k === 'warning' ? 'Warnings' : 'Errors')}
            </Tag>
            <span className={s.countN}>{preview.counts[k]}</span>
          </span>
        ))}
        <span className={s.sep} aria-hidden />
        {(['create', 'update', 'skip'] as const).map((k) => (
          <span key={k} className={s.count}>
            {t(ACTION_LABEL[k])} <span className={s.countN}>{preview.actions[k]}</span>
          </span>
        ))}
      </div>
      {preview.blocking.map((b) => (
        <Callout key={b} variant="emphasis" icon={Warning} role="alert">
          {tr(b)}
        </Callout>
      ))}
      {(warnings.length > 0 || unmapped.length > 0) && (
        <div className={s.notes}>
          {warnings.length > 0 && (
            <>
              <span className={s.notesTitle}>{t('Warnings')}</span>
              <ul>
                {warnings.map((w) => (
                  <li key={w}>{tr(w)}</li>
                ))}
              </ul>
            </>
          )}
          {unmapped.length > 0 && (
            <>
              <span className={s.notesTitle}>{t('Not imported or mapped differently')}</span>
              <ul>
                {unmapped.map((w) => (
                  <li key={w}>{tr(w)}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div className={s.tableWrap}>
        <Table size={12.5} scroll={false}>
          <thead>
            <tr>
              <Th>{isSchedule ? t('Type') : t('Line')}</Th>
              <Th>{t('Match key')}</Th>
              <Th>{t('Name')}</Th>
              <Th>{t('Change')}</Th>
              <Th>{t('Details')}</Th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r) => {
              const { name, sub } = rowText(r, t);
              return (
                <tr key={r.position}>
                  <td className={s.kind}>{isSchedule ? t(ROW_KIND[String(r.data.kind)] ?? '') : String(r.data.line ?? '')}</td>
                  <td className={s.key}>{r.key ?? '—'}</td>
                  <td className={s.name}>
                    {name}
                    {sub && <span className={s.sub}>{sub}</span>}
                  </td>
                  <td>
                    <Tag tone={STATUS_TONE[r.status]} size="sm">
                      {t(ACTION_LABEL[r.action])}
                    </Tag>
                  </td>
                  <td className={s.msgs}>
                    {r.messages.map((m, i) => (
                      <div key={i} className={r.status !== 'ok' ? s.msgWarn : undefined}>
                        {tr(m)}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      {preview.more > 0 && <span className={s.more}>{tr(fmt('{0} more rows are not shown', preview.more))}</span>}
    </>
  );
}
