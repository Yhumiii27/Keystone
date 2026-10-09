'use client';
// A button that downloads one export file (chapter 4): "Export PO", "Print receipt", "Download statement", "PV de
// réception", "Export list", "Export overlay list", "Export register (xlsx)". Same look as the button it replaces; busy
// while the file is produced; refusals show in a toast (src/features/exports/download.ts).
import { FileCsv, FilePdf, FileXls } from '@phosphor-icons/react/dist/ssr';
import { useState, type MouseEvent } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { downloadExport } from './download';

const ICON = { pdf: FilePdf, xlsx: FileXls, csv: FileCsv } as const;

export interface ExportFileButtonProps {
  /** exportHref(…) of the file. */
  href: string;
  /** Translated label. */
  label: string;
  icon?: keyof typeof ICON;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Translated accessible name when the label alone is ambiguous ("Export PO · PO-1082"). */
  ariaLabel?: string;
}

export function ExportFileButton({ href, label, icon = 'pdf', variant = 'ghost', size = 'sm', className, ariaLabel }: ExportFileButtonProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const run = async (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await downloadExport(href, t('Export failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant={variant} size={size} icon={ICON[icon]} className={className} disabled={busy} aria-busy={busy || undefined} aria-label={ariaLabel} onClick={run}>
      {label}
    </Button>
  );
}
