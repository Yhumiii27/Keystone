'use client';
// Interactive parts of Activity, integrations & audit (docs/spec/10 §2.4–2.5, chapter 4):
// - per connector row: "Sync now" (Codex index, Vigie and Cursus connectors for real; the others record a simulated run;
//   refused for a connector disabled by IT) and "Configure" (D-7a: the Keystone-side settings — frequency, data scope,
//   direction, enabled — shown read-only, since IT configures connectors outside Keystone);
// - the import / export cards: a file dropped or chosen on "MS Project XML", "Primavera P6 XER" or "Excel / CSV" opens the
//   import dialog (upload → mapping → preview → confirmation) — these cards are only listed while IMPORTS_ENABLED is on
//   (D-7b, src/domain/ch4-defaults.ts); the export cards open a dialog that downloads the MS Project XML of a project or the
//   Excel / PDF export of a screen. A zone is active for the viewers allowed to import that card's kinds (rights of
//   src/server/interchange/rights.ts), and for the export cards in the workspace only.
import { ArrowsClockwise } from '@phosphor-icons/react/dist/ssr';
import { useId, useState, useTransition, type DragEvent } from 'react';
import { Button } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import type { ImportKind } from '@/server/db/codes';
import { ConnectorConfigDialog } from './connector-config-dialog';
import { ExportDialog, type ExportCardFormat } from './export-dialog';
import { ImportDialog } from './import-dialog';
import { syncConnectorAction } from './actions';
import s from './admin.module.css';

export function ConnectorActions({ name, label }: { name: string; label: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [configure, setConfigure] = useState(false);
  const sync = () =>
    start(async () => {
      try {
        const r = await syncConnectorAction(name);
        showToast('error' in r ? r.error : (r.toast ?? ''));
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      }
    });
  return (
    <div className={s.connActions}>
      <Button variant="secondary" size="row" icon={ArrowsClockwise} disabled={pending} aria-busy={pending || undefined} aria-label={`${t('Sync now')} · ${label}`} onClick={sync}>
        {t('Sync now')}
      </Button>
      <Button variant="ghost" size="compact" aria-label={`${t('Configure')} · ${label}`} onClick={() => setConfigure(true)}>
        {t('Configure')}
      </Button>
      {configure && <ConnectorConfigDialog name={name} label={label} onClose={() => setConfigure(false)} />}
    </div>
  );
}

/** The six IMPORTS cards (EN names, as stored): what each one does. */
type Card = { direction: 'import'; card: 'schedule' | 'table'; kinds: ImportKind[]; accept: string } | { direction: 'export'; format: ExportCardFormat };
const CARDS: Record<string, Card> = {
  'MS Project XML': { direction: 'import', card: 'schedule', kinds: ['mspdi', 'xer'], accept: '.xml,.xer,application/xml,text/xml' },
  'Excel / CSV': { direction: 'import', card: 'table', kinds: ['budget_lines', 'bom', 'parts', 'assignments'], accept: '.csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  'Primavera P6 XER': { direction: 'import', card: 'schedule', kinds: ['mspdi', 'xer'], accept: '.xer,.xml,.txt' },
  'Export — MS Project XML': { direction: 'export', format: 'xml' },
  'Export — Excel': { direction: 'export', format: 'xlsx' },
  'Export — PDF': { direction: 'export', format: 'pdf' },
};

/**
 * "Drop a file or click to choose" (`aspect-ratio:5/1`, dashed). `format` is the card name as displayed (translated);
 * `kinds` the import kinds the viewer may run (default: all when the screen is editable, none otherwise).
 */
export function DropZone({ format, direction, canEdit, kinds }: { format: string; direction: 'import' | 'export'; canEdit: boolean; kinds?: readonly ImportKind[] }) {
  const { t } = useI18n();
  const id = useId();
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const name = Object.keys(CARDS).find((n) => n === format || t(n) === format);
  const card = name ? CARDS[name] : null;
  // Export cards open the export dialog: no file to drop (the prototype's drop-zone text only fits the import cards).
  const label = direction === 'export' || card?.direction === 'export' ? t('Click to choose what to export') : t('Drop a file or click to choose');
  const allowed = card?.direction === 'import' ? (kinds ? card.kinds.some((k) => kinds.includes(k)) : canEdit) : canEdit;
  if (!allowed) return <div className={cx(s.dropZone, s.dropZoneRo)}>{label}</div>;

  if (direction === 'export' || card?.direction === 'export') {
    return (
      <>
        <button
          type="button"
          className={s.dropZone}
          onClick={() => (card?.direction === 'export' ? setExporting(true) : showToast(`${format} · ${t('No export handler for this format')}`))}
        >
          {label}
        </button>
        {exporting && card?.direction === 'export' && <ExportDialog format={card.format} title={format} onClose={() => setExporting(false)} />}
      </>
    );
  }
  const staged = (f: File | null | undefined) => {
    if (!f) return;
    if (!card) showToast(`${f.name} · ${format} · ${t('No import handler for this format')}`);
    else setFile(f);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    staged(e.dataTransfer.files?.[0]);
  };
  return (
    <>
      <label
        htmlFor={id}
        className={cx(s.dropZone, over && s.dropZoneOver)}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {label}
        <input
          id={id}
          type="file"
          className={s.srOnly}
          accept={card?.direction === 'import' ? card.accept : undefined}
          aria-label={`${format} · ${label}`}
          onChange={(e) => {
            staged(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {file && card?.direction === 'import' && <ImportDialog card={card.card} title={format} file={file} onClose={() => setFile(null)} />}
    </>
  );
}
