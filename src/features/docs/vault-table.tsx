'use client';
// Selection bar and Vault card (docs/spec/10 §4.4h–i, template 2320–2343). Multi-select is transient client state
// (`dv.sel`): the 16px check of each row toggles it, the bar shows "{n} selected" with "Download zip", "Export
// register (xlsx)" (no export behind them yet, D-2: "coming soon" toasts) and "Clear". A row click opens / closes the
// document record drawer (`?doc=`); the download icon logs a download of the current revision.
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
import { useI18n } from '@/i18n/client';
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
}

export function VaultTable({ project, title, rows, empty }: VaultTableProps) {
  const { t, lang } = useI18n();
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const count = Object.values(sel).filter(Boolean).length;
  const toggle = (n: string) => setSel((cur) => ({ ...cur, [n]: !cur[n] }));
  const soon = (label: string) => () => showToast(t(`${label} — coming soon`));

  return (
    <>
      {count > 0 && (
        <div className={s.selBar} role="region" aria-label={t('Selection')}>
          <span className={s.selText} aria-live="polite">
            {selectedT(count, t, lang)}
          </span>
          <Button variant="secondary" size="xs" icon={FileZip} onClick={soon('Download zip')}>
            {t('Download zip')}
          </Button>
          <Button variant="secondary" size="xs" icon={FileXls} onClick={soon('Export register (xlsx)')}>
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
          <Button variant="secondary" size="sm" icon={FileXls} onClick={soon('Export register (xlsx)')}>
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
