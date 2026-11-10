// R-160 (P2, D9-32): "CE conformity · technical file" on the Commissioning & handover screen — one row per equipment line (R-185)
// with its machines in the installed base, when they are placed on the market, the file's readiness (computed) and what is
// missing; the handover warning (never a block); the handover dossier's CE declaration line, reused. `?ce=EQ-01` opens the line's
// CE file below the card (./ce-file-editor.tsx). Server Component.
import { SealCheck, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Callout } from '@/components/app/Callout';
import { EmptyState } from '@/components/app/EmptyState';
import { ProgressBar } from '@/components/app/Progress';
import { SectionCard } from '@/components/app/SectionCard';
import { cx } from '@/components/ds/cx';
import { Table, Td, Th } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import { screenHref } from '@/config/screens';
import { ceEditScope } from '@/domain/ce-conformity';
import { getProjectCe } from '@/server/dal/ce-conformity';
import type { ProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { CeFileEditor } from './ce-file-editor';
import { ceCardView, ceEditorView } from './model';
import s from './ce.module.css';

export async function CeConformityCard({ ctx, selected }: { ctx: ProjectContext; selected: string | null }) {
  const code = ctx.project.code;
  const [{ t, lang }, ce] = await Promise.all([getI18n(), getProjectCe(code)]);
  if (!ce) return null;
  const base = screenHref('commissioning', { code });
  const view = ceCardView(ce, t, lang, (ref) => `${base}?ce=${ref}#ce-file`, selected);
  const line = selected ? ce.lines.find((l) => l.ref === selected) : undefined;
  const scope = ceEditScope(ctx.viewer.role, { lead: ctx.access.lead, canEditScreen: ctx.canEdit('commissioning') });
  return (
    <>
      <SectionCard title={view.title} hint={view.hint} icon={SealCheck} scroll>
        {view.warning && (
          <Callout variant="emphasis" icon={Warning} role="status">
            {view.warning}
          </Callout>
        )}
        {view.lines.length ? (
          <Table size={12.5}>
            <thead>
              <tr>
                <Th>{t('Equipment')}</Th>
                <Th>{t('Installed base')}</Th>
                <Th>{t('Placed on the market')}</Th>
                <Th>{t('Readiness')}</Th>
                <Th>{t('Missing')}</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody>
              {view.lines.map((l) => (
                <tr key={l.ref} className={cx(l.selected && s.selected)}>
                  <Td>{l.equipment}</Td>
                  <Td className={s.num}>{l.machines}</Td>
                  <Td>
                    <span className={s.nowrap}>{l.market}</span>
                    <span className={s.sub}>
                      {l.regime}
                    </span>
                  </Td>
                  <Td>
                    <div className={s.readiness}>
                      <ProgressBar value={l.pct} variant="inline" label={l.progress} labelSize="sm" ariaLabel={t('Readiness')} />
                      <Tag tone={l.tone} size="sm">
                        {l.state}
                      </Tag>
                      {l.warn && <Warning aria-label={t('CE file incomplete at the handover')} />}
                    </div>
                  </Td>
                  <Td className={s.missing}>{l.missing}</Td>
                  <Td align="right">
                    <Link href={l.href} className={s.link}>
                      {t('Open the CE file')}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState variant="boxed">{view.empty}</EmptyState>
        )}
        {view.dossier && <span className={s.muted}>{view.dossier}</span>}
      </SectionCard>
      {line && <CeFileEditor key={`${line.ref}-${line.token ?? 'new'}`} view={ceEditorView(ce, line, scope, t, lang)} />}
    </>
  );
}
