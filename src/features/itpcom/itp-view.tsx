// Inspection & test plan · punch list screen body (docs/spec/07 §2.4, template 880–892): the Display switch (plan |
// punch list, `?view=`), the KPI row (both views), then either the plan — one block per template system with its
// lines, point type, stage, reference, date, result and the Codex record button — or the punch list with the row step
// Start / Close (client island, editors only; "No punch item yet" when the project has none). "Add inspection" / "Add
// punch item" is the header's primary action. Server Component.
import { ClipboardText, Eye, FileText, ListChecks } from '@phosphor-icons/react/dist/ssr';
import { EmptyState } from '@/components/app/EmptyState';
import { FilterBar, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { ButtonLink } from '@/components/ds/Button';
import { Segmented } from '@/components/ds/Segmented';
import { Ellipsis, Table, Td, Th } from '@/components/ds/Table';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import type { DocButtonView, InspectionGroupView, ItpScreenView, PunchRowView } from './model';
import { PunchStep } from './punch-step';
import s from './itpcom.module.css';

export interface ItpBodyProps {
  code: string;
  view: ItpScreenView;
  /** Row steps allowed (not outside the workspace, not a read-only project). */
  canEdit: boolean;
  t: T;
}

const VIEW_ICON = { plan: ClipboardText, punch: ListChecks } as const;

export function ItpBody({ code, view, canEdit, t }: ItpBodyProps) {
  return (
    <Stack>
      <FilterBar>
        <FilterLabel icon={Eye}>{view.displayLabel}</FilterLabel>
        <Segmented wrap label={view.displayLabel} value={view.view} options={view.views.map((o) => ({ value: o.value, label: o.label, href: o.href, icon: VIEW_ICON[o.value] }))} />
      </FilterBar>

      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      {view.plan && (
        <SectionCard title={view.plan.title} scroll>
          {view.plan.groups.map((g) => (
            <PlanGroup key={g.system} group={g} />
          ))}
          {view.plan.empty && <EmptyState variant="boxed">{view.plan.empty}</EmptyState>}
        </SectionCard>
      )}

      {view.punch && (
        <SectionCard title={view.punch.title} subtitle={view.punch.subtitle} scroll>
          {view.punch.empty ? (
            <EmptyState variant="boxed">{view.punch.empty}</EmptyState>
          ) : (
            <PunchTable code={code} rows={view.punch.rows} canEdit={canEdit} t={t} />
          )}
        </SectionCard>
      )}
    </Stack>
  );
}

/** Punch list table (12.5px); the unlabelled first column (P-01…) is named for screen readers. */
function PunchTable({ code, rows, canEdit, t }: { code: string; rows: PunchRowView[]; canEdit: boolean; t: T }) {
  return (
    <Table size={12.5}>
      <thead>
        <tr>
          <Th aria-label={t('Reference')} />
          <Th>{t('Item')}</Th>
          <Th>{t('System')}</Th>
          <Th>{t('Cat.')}</Th>
          <Th>{t('Raised by')}</Th>
          <Th>{t('Owner')}</Th>
          <Th>{t('Due')}</Th>
          <Th>{t('Status')}</Th>
          <Th aria-label={t('Actions')} />
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <PunchRow key={p.number} code={code} row={p} canEdit={canEdit} />
        ))}
      </tbody>
    </Table>
  );
}

/** Ghost record button (`ph ph-file-text` + reference, 11.5px) opening the Codex record. */
export function DocButton({ doc }: { doc: DocButtonView }) {
  return (
    <ButtonLink href={doc.href} variant="ghost" size="mini" icon={FileText} nowrap aria-label={doc.label} title={doc.label}>
      {doc.ref}
    </ButtonLink>
  );
}

function PlanGroup({ group: g }: { group: InspectionGroupView }) {
  return (
    <div className={s.group}>
      <div className={s.groupHead}>
        <span>{g.system}</span>
        <span className={s.groupCount}>{g.passedText}</span>
        <span className={s.groupRule} aria-hidden />
      </div>
      <Table size={12.5} aria-label={g.system}>
        <tbody>
          {g.rows.map((r) => (
            <tr key={r.number}>
              <Td className={s.idCell}>{r.number}</Td>
              <Td className={s.name}>{r.name}</Td>
              <Td>
                <span className={cx(r.typeClass, s.small)}>{r.type}</span>
              </Td>
              <Td tone="secondary">{r.stage}</Td>
              <Td className={s.ref}>
                <Ellipsis title={r.reference || undefined}>{r.reference}</Ellipsis>
              </Td>
              <Td className={cx(s.cell12, s.nowrap)}>{r.date}</Td>
              <Td>
                <span className={cx(r.statusClass, s.nowrap)} style={{ color: r.statusColor }}>
                  {r.status}
                </span>
              </Td>
              <Td className={s.right}>{r.doc && <DocButton doc={r.doc} />}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function PunchRow({ code, row: p, canEdit }: { code: string; row: PunchRowView; canEdit: boolean }) {
  return (
    <tr>
      <Td className={s.num400}>{p.number}</Td>
      <Td className={s.pretty} color={p.color}>
        {p.item}
      </Td>
      <Td tone="secondary">{p.location}</Td>
      <Td>
        <span className={cx(p.categoryClass, s.small)}>{p.category}</span>
      </Td>
      <Td tone="secondary">{p.source}</Td>
      <Td className={s.cell12}>{p.owner}</Td>
      <Td className={cx(s.cell12, s.nowrap)}>{p.due}</Td>
      <Td>
        <span className={cx(p.statusClass, s.nowrap)}>{p.status}</span>
      </Td>
      <Td className={s.right}>{canEdit && <PunchStep code={code} number={p.number} label={p.step?.label ?? null} ariaLabel={p.step?.ariaLabel ?? null} from={p.step?.from ?? null} />}</Td>
    </tr>
  );
}
