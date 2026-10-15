'use client';
// Selection bar and Vault card (docs/spec/10 §4.4h–i, template 2320–2343). Multi-select is transient client state
// (`dv.sel`): the 16px check of each row toggles it, the bar shows "{n} selected" with "Download zip" (the files are in
// Codex: a toast says so, with an "Open Codex" link to the selection — R-033, TODO(codex) D-1), "Export register (xlsx)"
// (the ticked documents; the card's button exports the register as filtered — chapter 4 exports) and "Clear". A row click
// opens / closes the document record drawer (`?doc=`); the download icon gives the Codex hand-off toast (R-127, D-2).
import { Check, FileXls, FileZip } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { ClickableRow } from '@/components/app/ClickableRow';
import { EmptyState } from '@/components/app/EmptyState';
import { SectionCard } from '@/components/app/SectionCard';
import { Button } from '@/components/ds/Button';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Ellipsis, Table, Td, Th } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import { showToast } from '@/components/ds/Toast';
import { downloadExport } from '@/features/exports/download';
import { useI18n } from '@/i18n/client';
import { exportHref } from '@/lib/export-href';
import { codexSelectionUrl } from '@/server/integrations/codex/links';
import { DownloadButton } from './codex-buttons';
import { selectedT } from './i18n';
import type { VaultRowView } from './model';
import s from './docs.module.css';

export interface VaultTableProps {
  project: string;
  /** "Vault · 38 / 40 documents" (translated). */
  title: string;
  rows: VaultRowView[];
  /** "No document matches" or null. */
  empty: string | null;
  /** The "Download zip" toast links to the selection in Codex (the files are stored there); false for a client (no Codex access). */
  codexLink?: boolean;
}

export function VaultTable({ project, title, rows, empty, codexLink }: VaultTableProps) {
  const { t, lang } = useI18n();
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const count = Object.values(sel).filter(Boolean).length;
  const toggle = (n: string) => setSel((cur) => ({ ...cur, [n]: !cur[n] }));
  const [busy, setBusy] = useState(false);
  // "Export register (xlsx)": the register as filtered on screen (URL state), or only the ticked documents.
  const exportRegister = async (numbers: string[]) => {
    setBusy(true);
    try {
      const params = new URLSearchParams(window.location.search);
      params.delete('doc');
      if (numbers.length) params.set('numbers', numbers.join(','));
      await downloadExport(exportHref('docs', { format: 'xlsx', code: project, params }), t('Export failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {count > 0 && (
        <div className={s.selBar} role="region" aria-label={t('Selection')}>
          <span className={s.selText} aria-live="polite">
            {selectedT(count, t, lang)}
          </span>
          <Button
            variant="secondary"
            size="xs"
            icon={FileZip}
            onClick={() =>
              showToast(
                t('Download zip needs Codex — the document files are stored in Codex'),
                codexLink ? { href: codexSelectionUrl(Object.keys(sel).filter((n) => sel[n])), label: t('Open Codex') } : undefined,
              )
            }
          >
            {t('Download zip')}
          </Button>
          <Button variant="secondary" size="xs" icon={FileXls} disabled={busy} onClick={() => exportRegister(Object.keys(sel).filter((n) => sel[n]))}>
            {t('Export register (xlsx)')}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setSel({})}>
            {t('Clear')}
          </Button>
        </div>
      )}

      <SectionCard scroll>
        <div className={s.cardHead}>
          <div className={s.cardTitleCol}>
            <CardTitle>{title}</CardTitle>
            <span className={s.cardSub}>
              {t('Flat vault · every document is numbered by the system, tagged, versioned and downloadable · folders are just saved views')}
            </span>
          </div>
          <Button variant="secondary" size="sm" icon={FileXls} disabled={busy} onClick={() => exportRegister([])}>
            {t('Export register (xlsx)')}
          </Button>
        </div>
        <Table size={12.5}>
          <thead>
            <tr>
              <th />
              <Th>{t('Number')}</Th>
              <Th>{t('Title')}</Th>
              <Th>{t('Kind')}</Th>
              <Th>{t('Service')}</Th>
              <Th>{t('Project')}</Th>
              <Th>{t('Rev')}</Th>
              <Th>{t('Status')}</Th>
              <Th>{t('Confidentiality')}</Th>
              <Th>{t('Tags')}</Th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const on = !!sel[d.number];
              return (
                <ClickableRow key={d.number} href={d.href}>
                  <td className={s.checkCell}>
                    <button
                      type="button"
                      className={cx(s.check, on && s.checkOn)}
                      aria-pressed={on}
                      aria-label={`${t('Select')} ${d.number}`}
                      onClick={() => toggle(d.number)}
                    >
                      {on && <Check className={s.checkIcon} aria-hidden />}
                    </button>
                  </td>
                  <td className={s.numberCell}>
                    <span className={s.numberWrap}>
                      {d.number}
                      {d.isNew && (
                        <Tag tone="accent" size="micro" nowrap={false}>
                          {t('New')}
                        </Tag>
                      )}
                    </span>
                  </td>
                  <td className={s.titleCell}>{d.title}</td>
                  <Td tone="secondary">{d.kind}</Td>
                  <Td tone="secondary">{d.service}</Td>
                  <td className={s.projectCell}>{d.project}</td>
                  <td className={s.num}>{d.revision}</td>
                  <td>
                    <span className={cx(d.statusClass, s.nowrapTag)}>{d.status}</span>
                  </td>
                  <td>
                    <span className={cx(d.confClass, s.confTag)}>{d.conf}</span>
                  </td>
                  <td className={s.tagsCell}>
                    <Ellipsis title={d.tags}>{d.tags}</Ellipsis>
                  </td>
                  <td className={s.dlCell}>
                    <DownloadButton project={project} number={d.number} label={`${t('Download PDF')} · ${d.number}`} variant="icon" />
                  </td>
                </ClickableRow>
              );
            })}
          </tbody>
        </Table>
        {empty && <EmptyState>{empty}</EmptyState>}
      </SectionCard>
    </>
  );
}
