// R-160 (P2, D9-32): under the Projects register — the machine lines of the open projects whose CE file is incomplete while
// Regulation (EU) 2023/1230 applies to them (placed on the market from 20 Jan 2027, or not dated yet), earliest first. Read-only;
// each line opens its CE file on the project's Commissioning & handover screen. Server Component; never shown to a client.
import { SealWarning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { EmptyState } from '@/components/app/EmptyState';
import { ProgressBar } from '@/components/app/Progress';
import { SectionCard } from '@/components/app/SectionCard';
import { Table, Td, Th } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import { screenHref } from '@/config/screens';
import { listPortfolioCeGaps } from '@/server/dal/ce-conformity';
import { getI18n, getViewer } from '@/server/session';
import { cePortfolioView } from './model';
import s from './ce.module.css';

/** `codes`: the projects of the selected zone (null = every zone). */
export async function CePortfolioCard({ codes }: { codes: readonly string[] | null }) {
  const viewer = await getViewer();
  if (viewer.role === 'client') return null;
  const [{ t, lang }, rows] = await Promise.all([getI18n(), listPortfolioCeGaps()]);
  const inZone = codes ? rows.filter((r) => codes.includes(r.projectCode)) : rows;
  const view = cePortfolioView(inZone, t, lang, (code, ref) => `${screenHref('commissioning', { code })}?ce=${ref}#ce-file`);
  return (
    <SectionCard title={view.title} hint={view.hint} icon={SealWarning} scroll>
      {view.rows.length ? (
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Project')}</Th>
              <Th>{t('Equipment')}</Th>
              <Th>{t('Placed on the market')}</Th>
              <Th>{t('Readiness')}</Th>
              <Th>{t('Missing')}</Th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={`${r.projectCode}-${r.ref}`}>
                <Td>
                  <Link href={r.href} className={s.link}>
                    {r.projectCode}
                  </Link>
                  <span className={s.sub}>{r.projectName}</span>
                </Td>
                <Td>{r.equipment}</Td>
                <Td className={s.nowrap}>{r.market}</Td>
                <Td>
                  <div className={s.readiness}>
                    <ProgressBar value={r.pct} variant="inline" label={r.progress} labelSize="sm" ariaLabel={t('Readiness')} />
                    <Tag tone={r.tone} size="sm">
                      {r.state}
                    </Tag>
                  </div>
                </Td>
                <Td className={s.missing}>{r.missing}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState variant="boxed">{view.empty}</EmptyState>
      )}
    </SectionCard>
  );
}
