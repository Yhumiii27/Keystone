// View of a staged "Import P&ID tags" plan (src/domain/pid-import.ts), translated for the viewer: the revision line,
// source · mode · file, the counts per change, the recognised / ignored columns, the staged lines (line, tag,
// description, change tag, changed fields / reason / warnings) and whether the import can be applied. Pure.
import {
  PID_DELTA_LABEL, PID_DELTA_ORDER, PID_DELTA_TAG, fieldLabel, importModeLabel, importSourceLabel, planHasChanges,
  type PidImportMode, type PidImportPlan, type PidImportSource,
} from '@/domain/pid-import';
import type { Lang, T } from '@/i18n/translate';
import { dataT, fieldsT, messageT, revisionLineT } from './i18n';

/** Lines shown in the dialog (the counts cover every line). */
export const STAGE_LINES_SHOWN = 400;

export interface PidStageView {
  revisionLine: string;
  /** "Excel list · Add & update · PID-HLT-026_revE_tags.xlsx". */
  meta: string;
  counts: { key: string; label: string; count: number; tagClass: string }[];
  /** "Recognised columns: Tag, Description, Kind". */
  columns: string;
  /** "Ignored columns: Line size"; null when none. */
  ignored: string | null;
  lines: { key: string; line: string; tag: string; desc: string; change: string; changeClass: string; details: { text: string; warn: boolean }[] }[];
  /** "… 120 more lines" when the list is cut. */
  more: string | null;
  canImport: boolean;
  /** Why the import cannot be applied ("Nothing to import: every tag is unchanged"). */
  note: string | null;
}

export function pidStageView(
  input: { plan: PidImportPlan; revision: string; currentRevision: string | null; documentNumber: string | null; source: PidImportSource; mode: PidImportMode; fileName: string; projectCode: string },
  t: T,
  lang: Lang,
): PidStageView {
  const { plan } = input;
  const fr = lang === 'fr';
  const revChanged = input.currentRevision !== input.revision;
  let note: string | null = null;
  if (plan.error) note = messageT(plan.error, t, lang);
  else if (!plan.counts.imported) note = t('No valid tag in the file');
  else if (!planHasChanges(plan) && !revChanged) note = t('Nothing to import: every tag is unchanged');
  const shown = plan.lines.slice(0, STAGE_LINES_SHOWN);
  const rest = plan.lines.length - shown.length;
  return {
    revisionLine: revisionLineT(input.currentRevision, input.revision, input.documentNumber ?? `PID-${input.projectCode}`, lang),
    meta: [t(importSourceLabel(input.source)), t(importModeLabel(input.mode)), input.fileName || t('Pasted cells')].join(' · '),
    counts: PID_DELTA_ORDER.map((d) => ({ key: d, label: t(PID_DELTA_LABEL[d]), count: plan.counts[d], tagClass: PID_DELTA_TAG[d] })),
    columns: (fr ? 'Colonnes reconnues : ' : 'Recognised columns: ') + (plan.columns.map((c) => t(fieldLabel(c))).join(', ') || '—'),
    ignored: plan.ignored.length ? `${fr ? 'Colonnes ignorées : ' : 'Ignored columns: '}${plan.ignored.join(', ')}` : null,
    lines: shown.map((l, i) => {
      const details: { text: string; warn: boolean }[] = [];
      if (l.reason) details.push({ text: messageT(l.reason, t, lang), warn: true });
      if (l.changes.length) details.push({ text: fieldsT(l.changes.map(fieldLabel), t), warn: false });
      for (const w of l.warnings) details.push({ text: messageT(w, t, lang), warn: true });
      return {
        key: `${l.line ?? 'x'}-${l.tag}-${i}`,
        line: l.line == null ? '—' : String(l.line),
        tag: l.tag,
        desc: l.value ? dataT(l.value.description, lang) : '',
        change: t(PID_DELTA_LABEL[l.delta]),
        changeClass: PID_DELTA_TAG[l.delta],
        details,
      };
    }),
    more: rest > 0 ? (fr ? `… ${rest} lignes de plus` : `… ${rest} more lines`) : null,
    canImport: note == null,
    note,
  };
}
