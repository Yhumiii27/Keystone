// "My project — client view" body (docs/spec/03 §8, template 2180–2236): KPI tiles, the "Display" segments (URL state
// `?tab=`) and one of the six tabs — Progress & milestones, Schedule (S-9a: summary Gantt + PDF, not in the prototype),
// Decisions, Invoices, Issues, Documents. Server Component;
// the decisions, "Raise issue" and "Acknowledge receipt" are client islands shown to the viewers allowed to act (the
// project's client contact; the director may also raise issues). Shared documents link to their Codex record; Delivery 8
// (L-9 = a, R-138): a "By category" strip, computed from the Codex index, sits above them (a grouped display, no filter).
import { Eye } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { EmptyState } from '@/components/app/EmptyState';
import { FilterBar, FilterLabel } from '@/components/app/Filter';
import { KeyValueList } from '@/components/app/KeyValueList';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { CardTitle } from '@/components/ds/Card';
import { Segmented } from '@/components/ds/Segmented';
import { Table, Td, Th } from '@/components/ds/Table';
import { ObjectStatusTag } from '@/components/app/StatusTag';
import { ProjectGantt, ProjectGanttLegend } from '@/components/charts/project-gantt';
import { DownloadButton } from '@/features/docs/codex-buttons';
import { ExportFileButton } from '@/features/exports/export-file-button';
import { exportHref } from '@/lib/export-href';
import { docHref } from '@/features/docs/links';
import type { T } from '@/i18n/translate';
import { AcknowledgeButton, DecisionButtons, DownloadStatementButton, RaiseIssueForm } from './buttons';
import type { ClientScreenView } from './model';
import s from './rexclient.module.css';

export interface ClientCapabilities {
  /** Approve / reject change requests and deliverables, acknowledge documents (the project's client contact). */
  decide: boolean;
  /** Raise an issue (the project's client contact or the director). */
  raise: boolean;
}

interface Props {
  code: string;
  view: ClientScreenView;
  can: ClientCapabilities;
  t: T;
}

export function ClientView({ code, view, can, t }: Props) {
  return (
    <div className={s.root}>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      <FilterBar>
        <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
        <Segmented wrap label={t('Display')} value={view.tab} options={view.tabs} />
      </FilterBar>
      {view.tab === 'progress' && <ProgressTab view={view} t={t} />}
      {view.tab === 'planning' && <PlanningTab code={code} view={view} t={t} />}
      {view.tab === 'decisions' && <DecisionsTab code={code} view={view} can={can} t={t} />}
      {view.tab === 'invoices' && <InvoicesTab code={code} view={view} t={t} />}
      {view.tab === 'issues' && <IssuesTab code={code} view={view} can={can} t={t} />}
      {view.tab === 'docs' && <DocumentsTab code={code} view={view} can={can} t={t} />}
    </div>
  );
}

function ProgressTab({ view, t }: { view: ClientScreenView; t: T }) {
  return (
    <div className={s.flexRow}>
      <SectionCard gap={10} flex="1.4 1 560px">
        <div className={s.chartHead}>
          <div className={s.chartTitle}>
            <CardTitle>{t('Progress to date')}</CardTitle>
            <span className={s.chartSub}>{t('Cumulative % complete · planned vs actual')}</span>
          </div>
          <div className={s.legend}>
            <span className={s.legendItem}>
              <span className={s.swatch} />
              {t('Planned')}
            </span>
            <span className={s.legendItem}>
              <span className={`${s.swatch} ${s.swatchActual}`} />
              {t('Actual')}
            </span>
          </div>
        </div>
        {view.progress ? (
          <div className={s.bars} role="img" aria-label={view.progress.map((p) => `${p.label} ${t('Planned')} ${p.planH} · ${t('Actual')} ${p.actH}`).join(' · ')}>
            {view.progress.map((p) => (
              <div key={p.label} className={s.barCol}>
                <div className={s.barPair}>
                  <div className={s.barPlan} style={{ height: p.planH }} />
                  <div className={s.barActual} style={{ height: p.actH }} />
                </div>
                <span className={s.barLabel}>{p.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState variant="boxed">{t('No schedule recorded for this project')}</EmptyState>
        )}
      </SectionCard>
      <SectionCard gap={4} flex="1 1 280px">
        <CardTitle className={s.titleGap}>{t('Milestones')}</CardTitle>
        {view.milestones.map((m) => (
          <div key={m.name} className={s.msRow}>
            <div className={s.stackText}>
              <span>{m.name}</span>
              <span className={s.msSub}>{`${t('Contract')} ${m.baseDate} ${t('· Forecast')} ${m.fcDate}`}</span>
            </div>
            <span className={m.tagClass}>{m.status}</span>
          </div>
        ))}
        {!view.milestones.length && <EmptyState>{t('No milestone recorded for this project')}</EmptyState>}
      </SectionCard>
    </div>
  );
}

/**
 * "Schedule" (S-9a, read-only): the Schedule screen's Gantt — work packages baseline vs forecast, today line, milestone
 * diamonds — and the milestone list, with the Gantt PDF (export document `planning` of the portal).
 */
function PlanningTab({ code, view, t }: { code: string; view: ClientScreenView; t: T }) {
  const p = view.planning;
  if (!p)
    return (
      <SectionCard gap={10}>
        <CardTitle>{t('Schedule — baseline vs forecast')}</CardTitle>
        <EmptyState variant="boxed">{t('No schedule recorded for this project')}</EmptyState>
      </SectionCard>
    );
  return (
    <>
      <SectionCard gap={10} scroll>
        <div className={s.chartHead}>
          <div className={s.chartTitle}>
            <CardTitle>{t('Schedule — baseline vs forecast')}</CardTitle>
            <span className={s.chartSub}>{p.finish}</span>
          </div>
          <ProjectGanttLegend labels={{ critical: t('Critical path'), task: t('Task'), baseline: t('Baseline'), milestone: t('Milestone') }} />
          <ExportFileButton href={exportHref('client', { format: 'pdf', code, variant: 'planning' })} label={t('Download PDF')} variant="secondary" size="sm" />
        </div>
        {p.tasks.length || p.milestones.length ? (
          <ProjectGantt
            months={p.months}
            tasks={p.tasks}
            milestones={p.milestones}
            todayL={p.todayL}
            labels={{ workPackage: t('Work package'), done: t('Done'), slip: t('Slip'), milestones: t('Milestones'), today: t('Today') }}
          />
        ) : (
          <EmptyState variant="boxed">{t('No work package scheduled for this project')}</EmptyState>
        )}
      </SectionCard>
      <SectionCard gap={4}>
        <CardTitle className={s.titleGap}>{t('Milestones')}</CardTitle>
        {p.list.map((m, i) => (
          <div key={i} className={s.planMsRow}>
            <div className={s.stackText}>
              <span>{m.name}</span>
              <span className={s.msSub}>{m.dates}</span>
            </div>
            <span className={`${s.planSlip} ${m.slipAlert ? s.planSlipAlert : ''}`}>{m.slipText}</span>
            <ObjectStatusTag kind="milestone" code={m.status} label={m.statusLabel} />
          </div>
        ))}
        {!p.list.length && <EmptyState>{t('No milestone recorded for this project')}</EmptyState>}
      </SectionCard>
    </>
  );
}

function DecisionsTab({ code, view, can, t }: { code: string; view: ClientScreenView; can: ClientCapabilities; t: T }) {
  return (
    <div className={s.grid460}>
      <SectionCard gap={4}>
        <div className={s.cardHead}>
          <CardTitle>{t('Waiting for your decision')}</CardTitle>
          <span className={s.chartSub}>{t('Change requests affect the contract value or the handover date · deliverables are accepted with a signed PV')}</span>
        </div>
        {view.decisions.map((d) => (
          <div key={d.id} className={s.decRow}>
            <div className={s.decMain}>
              <span className={s.decHead}>
                <span className="tag tag-outline">{d.kindLabel}</span>
                <span className={s.decMeta}>
                  {d.id} · {d.when}
                </span>
              </span>
              <span className={s.decTitle}>{d.title}</span>
              <span className={s.decSub}>{d.sub}</span>
            </div>
            {can.decide && <DecisionButtons code={code} kind={d.kind} id={d.id} approveLabel={d.approveLabel} rejectLabel={t('Reject')} />}
          </div>
        ))}
        {!view.decisions.length && <EmptyState pad={10}>{t('Nothing waiting for you')}</EmptyState>}
      </SectionCard>
      <SectionCard gap={4}>
        <CardTitle className={s.titleGap}>{t('Decided')}</CardTitle>
        {view.decided.map((d) => (
          <div key={d.id} className={s.decidedRow}>
            <div className={s.decidedText}>
              <span className={s.ellipsis} title={d.title}>
                {d.title}
              </span>
              <span className={s.decidedMeta}>
                {d.id} · {d.when}
              </span>
            </div>
            <span className={d.tagClass}>{d.state}</span>
          </div>
        ))}
        {!view.decided.length && <EmptyState>{t('No decision yet')}</EmptyState>}
      </SectionCard>
    </div>
  );
}

function InvoicesTab({ code, view, t }: { code: string; view: ClientScreenView; t: T }) {
  return (
    <div className={s.flexRow}>
      <SectionCard title={t('Invoices & payments')} hint={t('Milestone billing per contract · 30 days net')} flex="1.8 1 560px" scroll>
        <Table>
          <thead>
            <tr>
              <Th>{t('Invoice')}</Th>
              <Th>{t('Milestone')}</Th>
              <Th align="right">{t('Amount')}</Th>
              <Th>{t('Payment')}</Th>
              <Th>{t('Status')}</Th>
            </tr>
          </thead>
          <tbody>
            {view.invoices.map((i, k) => (
              <tr key={`${k}-${i.name}`}>
                <Td className={s.invNo}>{i.no}</Td>
                <Td>{i.name}</Td>
                <Td className={s.amount}>{i.amount}</Td>
                <Td className={s.payment}>{i.payment}</Td>
                <Td>
                  <span className={i.tagClass}>{i.status}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {view.invoicesEmpty && <EmptyState>{view.invoicesEmpty}</EmptyState>}
      </SectionCard>
      <SectionCard gap={4} flex="1 1 260px">
        <CardTitle className={s.titleGap}>{t('Contract summary')}</CardTitle>
        {view.summary && <KeyValueList items={view.summary} />}
        {view.summaryEmpty && <EmptyState>{view.summaryEmpty}</EmptyState>}
        <DownloadStatementButton code={code} label={t('Download statement')} />
      </SectionCard>
    </div>
  );
}

function IssuesTab({ code, view, can, t }: { code: string; view: ClientScreenView; can: ClientCapabilities; t: T }) {
  return (
    <SectionCard title={t('Issues you raised')} hint={t('Acknowledged within 2 working days · answered by the project manager')}>
      {can.raise && <RaiseIssueForm code={code} placeholder={t('Describe a new issue or request')} label={t('Raise issue')} />}
      {view.issues.map((i) => (
        <div key={i.id} className={s.issueRow}>
          <div className={s.issueText}>
            <span className={s.issueTitle}>{i.title}</span>
            <span className={s.issueMeta}>
              {i.id} · {i.when}
            </span>
            <span className={s.issueResp}>{i.response}</span>
          </div>
          <span className={i.tagClass}>{i.status}</span>
        </div>
      ))}
      {!view.issues.length && <EmptyState>{t('No issue raised yet')}</EmptyState>}
    </SectionCard>
  );
}

function DocumentsTab({ code, view, can, t }: { code: string; view: ClientScreenView; can: ClientCapabilities; t: T }) {
  return (
    <SectionCard title={t('Documents')} subtitle={view.docsLabels.sub} scroll>
      {view.docCategories.length > 0 && (
        <div className={s.docCats}>
          <span className={s.docCatsTitle}>{view.docsLabels.byCategory}</span>
          <ul className={s.docCatList} aria-label={view.docsLabels.byCategory}>
            {view.docCategories.map((c) => (
              <li key={c.key} className={s.docCat}>
                <span className={s.docCatHead}>
                  <span className={s.docCatName}>{c.name}</span>
                  <span className={s.docCatCount}>{c.files}</span>
                </span>
                <span className={s.docCatSub}>{c.description}</span>
                <span className={s.docCatSub}>{c.latest}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Table size={12.5}>
        <thead>
          <tr>
            <Th>{view.docsLabels.idHeader}</Th>
            <Th>{t('Title')}</Th>
            <Th>{t('Rev')}</Th>
            <Th>{t('Status')}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {view.docs.map((d) => (
            <tr key={d.id}>
              <Td className={s.docId}>
                <Link href={docHref(d.id, code)} className={s.docLink} scroll={false}>
                  {d.id}
                </Link>
              </Td>
              <Td className={s.docTitle}>
                {d.title} <span className={s.docMeta}>· {d.typeLabel} · {d.date}</span>
              </Td>
              <Td className={s.tabular}>{d.rev}</Td>
              <Td>
                <span className={`${d.tagClass} ${s.nowrap}`}>{d.status}</span>
              </Td>
              <Td className={s.docActions}>
                <DownloadButton project={code} number={d.id} label={`${t('Download PDF')} · ${d.id}`} variant="icon" />
                {d.acknowledged ? (
                  <span className={`tag tag-neutral ${s.nowrap}`}>{d.ackLabel}</span>
                ) : can.decide ? (
                  <AcknowledgeButton code={code} number={d.id} label={d.ackLabel} />
                ) : (
                  <span className={`tag tag-outline ${s.nowrap}`}>{t('Acknowledgment pending')}</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {!view.docs.length && <span className={s.emptyDocs}>{view.docsLabels.empty}</span>}
    </SectionCard>
  );
}
