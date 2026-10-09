// Project BOM body (template 1167–1311): KPI tiles, the Display segment and the selected display — flat list, assembly
// tree (+ node drawer), where-used, compare revisions or PU/PR list — and the "no multi-level assembly" notice.
// Server Component; interactive islands: FlatFilters / UsedSearch (URL search), ClickableRow (row → drawer),
// TreeTable (folding), NodeDrawer, SparesActions. Every label arrives translated in the view model.
import { CaretDown, CaretUp, CaretUpDown, Eye, PushPin, Tag as TagIcon, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { ClickableRow } from '@/components/app/ClickableRow';
import { EmptyState } from '@/components/app/EmptyState';
import { Eyebrow } from '@/components/app/Eyebrow';
import { FilterChips, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { CardTitle } from '@/components/ds/Card';
import { Segmented } from '@/components/ds/Segmented';
import { IdText, Table, Td, Th } from '@/components/ds/Table';
import { cx } from '@/components/ds/cx';
import { SparesActions } from './client-buttons';
import type { SparesOrderScope } from './spares-order-dialog';
import { FlatFilters, UsedSearch } from './flat-filters';
import type { BomScreenView, CompareView, FlatView, KpiView, SparesView, WhereUsedView } from './model';
import { NodeDrawer } from './node-drawer';
import { TreeTable } from './tree-table';
import s from './bom.module.css';
import { exportHref as fileExportHref } from '@/lib/export-href';

function Kpis({ kpis }: { kpis: KpiView[] }) {
  return (
    <KpiGrid>
      {kpis.map((k) => (
        <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
      ))}
    </KpiGrid>
  );
}

function FlatList({ view }: { view: FlatView }) {
  const L = view.labels;
  const sortTh = (key: string) => {
    const h = view.headers.find((x) => x.key === key)!;
    const Icon = h.dir === 'asc' ? CaretUp : h.dir === 'desc' ? CaretDown : CaretUpDown;
    return (
      <Th key={key} align={h.align} className={s.sortTh} aria-sort={h.dir === 'asc' ? 'ascending' : h.dir === 'desc' ? 'descending' : undefined}>
        <Link href={h.href} scroll={false} replace className={s.sortLink}>
          {h.label}
          <Icon className={cx(s.caret, h.dir && s.caretOn)} aria-hidden />
        </Link>
      </Th>
    );
  };
  return (
    <>
      <FlatFilters
        searchPlaceholder={view.searchPlaceholder}
        typeLabel={view.typeLabel}
        typeOptions={view.typeOptions}
        supplierLabel={view.supplierLabel}
        supplierOptions={view.supplierOptions}
        clearHref={view.clearHref}
        clearLabel={view.clearLabel}
        count={view.count}
      />
      <SectionCard title={view.title} hint={view.hint} scroll>
        <Table>
          <thead>
            <tr>
              {sortTh('ref')}
              {sortTh('name')}
              {sortTh('type')}
              <Th>{L.makeBuy}</Th>
              <Th>{L.pu}</Th>
              <Th align="right">{L.qty}</Th>
              <Th align="right">{L.price}</Th>
              {sortTh('total')}
              {sortTh('status')}
              <Th>{L.restrictions}</Th>
              <Th>{L.alsoUsedIn}</Th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <ClickableRow key={r.ref} href={r.href}>
                <td>
                  <IdText selected={r.selected}>{r.ref}</IdText>
                </td>
                <td>
                  <div className={s.article}>
                    <span>{r.name}</span>
                    <span className={s.articleSub}>{r.sub}</span>
                  </div>
                </td>
                <Td tone="secondary" nowrap>
                  {r.type}
                </Td>
                <Td tone="secondary">{r.makeBuy}</Td>
                <td>
                  <span className={cx(r.pu.cls, s.nowrap)}>{r.pu.label}</span>
                </td>
                <Td align="right" numeric>
                  {r.qty}
                </Td>
                <Td align="right" numeric nowrap>
                  {r.price}
                </Td>
                <Td align="right" numeric nowrap className={r.totalNote ? s.totalMuted : undefined} title={r.totalNote ?? undefined}>
                  {r.total}
                </Td>
                <td>
                  <div className={s.statusCell}>
                    <span className={cx(r.status.cls, s.nowrap)}>{r.status.label}</span>
                    {r.eco && (
                      <Link href={r.eco.href} className={cx('tag', 'tag-outline', s.ecoTag)}>
                        {r.eco.number}
                      </Link>
                    )}
                  </div>
                </td>
                <td className={cx(s.restr, r.restricted && s.restrOn)}>{r.restriction}</td>
                <td className={s.used}>{r.alsoUsedIn}</td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
        {view.empty && <EmptyState>{view.empty}</EmptyState>}
      </SectionCard>
    </>
  );
}

function WhereUsed({ view }: { view: WhereUsedView }) {
  return (
    <SectionCard gap={12}>
      <div className={s.usedHead}>
        <div className={s.headCol}>
          <CardTitle>{view.title}</CardTitle>
          <span className={s.headSub}>{view.sub}</span>
        </div>
        <UsedSearch placeholder={view.placeholder} />
      </div>
      <div className={s.usedPart}>
        <span className={s.usedRef}>{view.part.ref}</span>
        <span className={s.usedName}>{view.part.name}</span>
        <span className={view.part.status.cls}>{view.part.status.label}</span>
        <span className={s.usedEquiv}>
          {view.equivalentsLabel} {view.part.equivalents}
        </span>
      </div>
      <div className={s.usedGrid}>
        <div className={s.usedCol}>
          <Eyebrow flush>{view.pathsTitle}</Eyebrow>
          {view.paths.map((p, i) => (
            <div key={`${i}-${p.chain}`} className={s.pathRow}>
              <span className={s.pathChain}>{p.chain}</span>
              <span className={s.pathQty}>{p.qty}</span>
            </div>
          ))}
          {view.noPaths && <span className={s.none}>{view.noPaths}</span>}
        </div>
        <div className={s.usedCol}>
          <Eyebrow flush>{view.projectsTitle}</Eyebrow>
          {view.projects.map((p) => (
            <div key={p.code} className={s.projRow}>
              <span className={s.ellipsis} title={p.name}>
                {p.name}
              </span>
              <span className={s.muted}>{p.qty}</span>
              <span className={p.stage.cls}>{p.stage.label}</span>
            </div>
          ))}
        </div>
        <div className={s.usedCol}>
          <Eyebrow flush>{view.ordersTitle}</Eyebrow>
          {view.orders.map((o) => (
            <div key={o.number} className={s.poRow}>
              <span className={s.poId}>{o.number}</span>
              <span className={s.ellipsis} title={o.text}>
                {o.text}
              </span>
              <span className={cx('tag', 'tag-neutral', s.nowrap)}>{o.status}</span>
            </div>
          ))}
          {view.noOrders && <span className={s.none}>{view.noOrders}</span>}
        </div>
      </div>
    </SectionCard>
  );
}

function Compare({ view }: { view: CompareView }) {
  const L = view.labels;
  return (
    <SectionCard gap={10} scroll>
      <div className={s.cmpHead}>
        <div className={s.headCol}>
          <CardTitle>{view.title}</CardTitle>
          <span className={s.headSub}>{view.sub}</span>
        </div>
        <span className="tag tag-accent">
          {view.totalLabel} {view.total}
        </span>
      </div>
      <Table size={12.5}>
        <thead>
          <tr>
            <Th>{L.line}</Th>
            <Th>{L.article}</Th>
            <Th align="right">{L.from}</Th>
            <Th align="right">{L.to}</Th>
            <Th>{L.change}</Th>
            <Th align="right">{L.delta}</Th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.line}>
              <td className={s.cmpLine}>{r.line}</td>
              <td>{r.name}</td>
              <Td align="right" numeric>
                {r.a}
              </Td>
              <Td align="right" numeric>
                {r.b}
              </Td>
              <td>
                <span className={r.kind.cls}>{r.kind.label}</span>
              </td>
              <Td align="right" numeric nowrap>
                {r.delta}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}

function Spares({ view, canOrder, scope }: { view: SparesView; canOrder: boolean; scope: SparesOrderScope }) {
  const L = view.labels;
  return (
    <>
      <Kpis kpis={view.kpis} />
      <div className={s.sparesBar}>
        <div className={s.cluster}>
          <FilterLabel icon={TreeStructure}>{view.systemLabel}</FilterLabel>
          <Segmented wrap label={view.systemLabel} value={view.systems.find((o) => o.active)?.value ?? null} options={view.systems.map((o) => ({ value: o.value, label: o.label, href: o.href }))} />
        </div>
        <div className={s.kindWrap}>
          <div className={s.cluster}>
            <FilterLabel icon={TagIcon}>{view.kindLabel}</FilterLabel>
            <FilterChips label={view.kindLabel} value={view.kinds.find((o) => o.active)?.value ?? ''} options={view.kinds.map((o) => ({ value: o.value, label: o.label, href: o.href }))} />
          </div>
        </div>
      </div>
      <span className={s.legend}>{view.legend}</span>
      <SectionCard scroll>
        <div className={s.spHead}>
          <div className={s.headCol}>
            <CardTitle>{view.title}</CardTitle>
            <span className={s.headSub}>{view.sub}</span>
          </div>
          <SparesActions
            createLabel={view.createOrderLabel}
            exportLabel={view.exportLabel}
            canOrder={canOrder}
            scope={scope}
            exportHref={fileExportHref('bom', { format: 'pdf', code: scope.code, variant: 'spares', params: { sys: scope.system ?? undefined, kind: scope.kind ?? undefined } })}
          />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>{L.ref}</Th>
              <Th>{L.article}</Th>
              <Th>{L.pu}</Th>
              <Th align="right">{L.qPer}</Th>
              <Th align="right">{L.qTotal}</Th>
              <Th>{L.note}</Th>
              <Th align="right">{L.price}</Th>
              <Th align="right">{L.total}</Th>
              <Th>{L.lead}</Th>
              <Th>{L.stock}</Th>
              <Th>{L.status}</Th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <ClickableRow key={r.ref} href={r.href}>
                <td>
                  <IdText selected={r.selected}>{r.ref}</IdText>
                </td>
                <td>
                  <span className={s.block}>{r.name}</span>
                  {r.pinned && (
                    <Link href={r.pinned.href} className={s.pin}>
                      <PushPin aria-hidden />
                      {r.pinned.text}
                    </Link>
                  )}
                </td>
                <td>
                  <span className={r.kind.cls}>{r.kind.label}</span>
                </td>
                <Td align="right" numeric>
                  {r.qPer}
                </Td>
                <Td align="right" numeric className={s.qTotal}>
                  {r.qTotal}
                </Td>
                <td className={s.noteCell}>{r.note}</td>
                <Td align="right" numeric nowrap>
                  {r.price}
                </Td>
                <Td align="right" numeric nowrap>
                  {r.total}
                </Td>
                <td className={s.lead}>{r.lead}</td>
                <td className={cx(s.stock, r.stockShort && s.stockShort)}>{r.stock}</td>
                <td>
                  <span className={cx(r.status.cls, s.nowrap)}>{r.status.label}</span>
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
        {view.empty && <EmptyState>{view.empty}</EmptyState>}
      </SectionCard>
    </>
  );
}

export function BomBody({ view, canEdit }: { view: BomScreenView; canEdit: boolean }) {
  return (
    <div className={s.root}>
      <Kpis kpis={view.kpis} />
      <div className={s.toolbar}>
        <div className={s.cluster}>
          <FilterLabel icon={Eye}>{view.displayLabel}</FilterLabel>
          <Segmented wrap label={view.displayLabel} value={view.state.view} options={view.views.map((o) => ({ value: o.value, label: o.label, href: o.href }))} />
        </div>
        <span className={s.note}>{view.note}</span>
      </div>
      {view.flat && <FlatList view={view.flat} />}
      {view.tree && <TreeTable view={view.tree} />}
      {view.node && <NodeDrawer key={view.node.ref} view={view.node} />}
      {view.used && <WhereUsed view={view.used} />}
      {view.compare && <Compare view={view.compare} />}
      {view.spares && <Spares view={view.spares} canOrder={canEdit} scope={{ code: view.code, system: view.state.sys, kind: view.state.kind }} />}
      {view.noTree && <EmptyState variant="boxed">{view.noTree}</EmptyState>}
    </div>
  );
}
