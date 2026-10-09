'use client';
// "Import P&ID tags" dialog (AF `pid`, docs/spec/09 §6.11, template 138–157 look): a structured staging import in two
// steps. Step 1 — the prototype's fields: File (CSV / TSV / Excel .xlsx; the revision is read from a name such as
// "PID-HLT-026_revE_tags.xlsx"), Revision *, Source, Mode, plus the tag list pasted from Excel as an alternative.
// "Check tags" stages the import on the server (nothing written) → step 2: the revision line, counts per change, the
// staged lines with their changes, reasons and warnings; "Import tags" applies it (re-planned on the server) and toasts
// "27 tags · rev E imported · 3 new · 1 updated". Back returns to step 1 with the values kept.
import { FileArrowUp, ListChecks, Play, Warning } from '@phosphor-icons/react/dist/ssr';
import { useId, useRef, useState, useTransition } from 'react';
import { Callout } from '@/components/app/Callout';
import { Button } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input, Select, Textarea } from '@/components/ds/Field';
import { Table, Th } from '@/components/ds/Table';
import { showToast } from '@/components/ds/Toast';
import { nextRevision } from '@/domain/pid';
import { PID_FIELDS, PID_IMPORT_MODES, PID_IMPORT_SOURCES, type PidImportMode, type PidImportSource } from '@/domain/pid-import';
import { useI18n } from '@/i18n/client';
import { applyPidImportAction, stagePidImportAction, type PidImportRequest } from './actions';
import type { PidStageView } from './import-model';
import s from './pid.module.css';

/** Server Function requests are capped at 1 MB (Next.js `serverActions.bodySizeLimit` default): a workbook travels as base64 (+33 %). */
const MAX_TEXT_BYTES = 700_000;
const MAX_XLSX_BYTES = 600_000;
const FAILED = 'The change could not be saved';

/** Revision written in a file name: "…_revE_…", "… rev C.csv", "PID-rev02.xlsx". */
export function revisionOfFileName(name: string): string | null {
  const m = /(?:^|[^a-z0-9])rev[\s_.-]?([a-z0-9]{1,3})(?=[^a-z0-9]|$)/i.exec(name.replace(/\.[a-z0-9]+$/i, ''));
  return m ? m[1].toUpperCase() : null;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface ImportTagsDialogProps {
  code: string;
  /** Project label for the sub-line ("#026 · Harbor Line Terminal Expansion"), translated. */
  context: string;
  /** Revision of the registered P&ID (null: none — the import registers it). */
  currentRevision: string | null;
  onClose: () => void;
}

export function ImportTagsDialog({ code, context, currentRevision, onClose }: ImportTagsDialogProps) {
  const { t } = useI18n();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'source' | 'check'>('source');
  const [file, setFile] = useState<{ name: string; kind: 'text' | 'xlsx'; data: string } | null>(null);
  const [paste, setPaste] = useState('');
  const [rev, setRev] = useState(currentRevision ? nextRevision(currentRevision) : 'A');
  const [source, setSource] = useState<PidImportSource>('autocad');
  const [mode, setMode] = useState<PidImportMode>('merge');
  const [stage, setStage] = useState<PidStageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const request = (): PidImportRequest => (file ? { fileName: file.name, kind: file.kind, data: file.data, rev, source, mode } : { fileName: '', kind: 'text', data: paste, rev, source, mode });
  const ready = (!!file || !!paste.trim()) && !!rev.trim();

  const choose = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 4));
      const zip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
      if (f.size > (zip || /\.xlsx$/i.test(f.name) ? MAX_XLSX_BYTES : MAX_TEXT_BYTES)) {
        setError(t('The file is too large'));
        return;
      }
      setFile(zip || /\.xlsx$/i.test(f.name) ? { name: f.name, kind: 'xlsx', data: toBase64(buf) } : { name: f.name, kind: 'text', data: new TextDecoder().decode(buf) });
      setPaste('');
      const r = revisionOfFileName(f.name);
      if (r) setRev(r);
    } catch {
      setError(t('The file could not be read'));
    }
  };

  const check = () => {
    if (!ready || pending) return;
    setError(null);
    if (!file && paste.length > MAX_TEXT_BYTES) {
      setError(t('The tag list is too large'));
      return;
    }
    startTransition(async () => {
      try {
        const r = await stagePidImportAction(code, request());
        if (r.error || !r.stage) setError(r.error ?? t(FAILED));
        else {
          setStage(r.stage);
          setPhase('check');
        }
      } catch {
        setError(t(FAILED));
      }
    });
  };

  const apply = () => {
    if (!stage?.canImport || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await applyPidImportAction(code, request());
        if (r.error) setError(r.error);
        else {
          onClose();
          if (r.toast) showToast(r.toast);
        }
      } catch {
        setError(t(FAILED));
      }
    });
  };

  const sub = (
    <>
      {context ? `${context} · ` : ''}
      {t('Required fields are marked ·')} <span className={s.star}>*</span>
    </>
  );

  return (
    <Dialog open onClose={onClose} title={t('Import P&ID tags')} subtitle={sub} subtitleSize={12} width={phase === 'check' ? 760 : 640} offsetTop="8vh" maxHeight="84vh">
      {phase === 'source' ? (
        <form
          className={s.formContents}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          <div className={s.grid}>
            <Field label={t('File')} htmlFor={`${id}-file`} span="full" hint={t('CSV, TSV or Excel (.xlsx) · one row per tag under a header row')}>
              <div className={s.fileRow}>
                <input
                  ref={fileRef}
                  id={`${id}-file`}
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className={s.hiddenInput}
                  onChange={(e) => {
                    void choose(e.target.files?.[0]);
                    // Choosing the same file again (after an edit) fires a change again.
                    e.target.value = '';
                  }}
                />
                <Button variant="secondary" icon={FileArrowUp} className={s.btn125} onClick={() => fileRef.current?.click()}>
                  {t('Choose a file')}
                </Button>
                <span className={cx(s.fileName, !file && s.fileNone)}>{file ? file.name : t('No file chosen')}</span>
              </div>
            </Field>
            <Field label={t('Revision')} required htmlFor={`${id}-rev`}>
              <Input id={`${id}-rev`} value={rev} maxLength={6} aria-required onChange={(e) => setRev(e.target.value)} />
            </Field>
            <Field label={t('Source')} htmlFor={`${id}-source`}>
              <Select id={`${id}-source`} value={source} onChange={(e) => setSource(e.target.value as PidImportSource)} options={PID_IMPORT_SOURCES.map(([v, l]) => ({ value: v, label: t(l) }))} />
            </Field>
            <Field label={t('Mode')} htmlFor={`${id}-mode`}>
              <Select id={`${id}-mode`} value={mode} onChange={(e) => setMode(e.target.value as PidImportMode)} options={PID_IMPORT_MODES.map(([v, l]) => ({ value: v, label: t(l) }))} />
            </Field>
            <Field label={t('Or paste the tag list')} htmlFor={`${id}-paste`} span="full">
              <Textarea
                id={`${id}-paste`}
                className={s.paste}
                value={paste}
                placeholder={t('Cells copied from Excel, header row first')}
                onChange={(e) => {
                  setPaste(e.target.value);
                  if (e.target.value) setFile(null);
                }}
              />
            </Field>
            <span className={cx(s.colsHint, s.full)}>
              {t('Columns')} · {PID_FIELDS.map(([f, l]) => (f === 'tag' || f === 'description' ? `${t(l)} *` : t(l))).join(', ')}
            </span>
          </div>
          {error && (
            <Callout variant="emphasis" icon={Warning} role="alert">
              {error}
            </Callout>
          )}
          <DialogActions>
            <Button variant="secondary" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="primary" icon={ListChecks} disabled={!ready || pending} aria-busy={pending || undefined}>
              {t('Check tags')}
            </Button>
          </DialogActions>
        </form>
      ) : (
        stage && (
          <>
            <div className={s.stage}>
              <div className={s.stageHead}>
                <span className={s.stageRev}>{stage.revisionLine}</span>
                <span className={s.stageMeta}>{stage.meta}</span>
              </div>
              <div className={s.counts} aria-label={t('Staged changes')}>
                {stage.counts.map((c) => (
                  <span key={c.key} className={s.count}>
                    <span className={c.tagClass}>{c.label}</span>
                    <span className={s.countN}>{c.count}</span>
                  </span>
                ))}
              </div>
              <span className={s.colsHint}>
                {stage.columns}
                {stage.ignored ? ` · ${stage.ignored}` : ''}
              </span>
              {stage.lines.length > 0 && (
                <div className={s.stageTable}>
                  <Table size={12.5}>
                    <thead>
                      <tr>
                        <Th>{t('Line')}</Th>
                        <Th>{t('Tag')}</Th>
                        <Th>{t('Description')}</Th>
                        <Th>{t('Change')}</Th>
                        <Th>{t('Details')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {stage.lines.map((l) => (
                        <tr key={l.key}>
                          <td className={s.lineNo}>{l.line}</td>
                          <td className={s.oTag}>{l.tag}</td>
                          <td className={s.pretty}>{l.desc}</td>
                          <td>
                            <span className={cx(l.changeClass, s.nowrap)}>{l.change}</span>
                          </td>
                          <td className={s.details}>
                            {l.details.map((d, i) => (
                              <div key={i} className={d.warn ? s.detailWarn : undefined}>
                                {d.text}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
              {stage.more && <span className={s.more}>{stage.more}</span>}
              {stage.note && <Callout variant="info">{stage.note}</Callout>}
              {error && (
                <Callout variant="emphasis" icon={Warning} role="alert">
                  {error}
                </Callout>
              )}
            </div>
            <DialogActions>
              <Button
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setPhase('source');
                }}
              >
                {t('Back')}
              </Button>
              <Button variant="primary" icon={Play} disabled={!stage.canImport || pending} aria-busy={pending || undefined} onClick={apply}>
                {t('Import tags')}
              </Button>
            </DialogActions>
          </>
        )
      )}
    </Dialog>
  );
}
