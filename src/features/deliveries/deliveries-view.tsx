// Deliveries & goods receipt body (docs/spec/08 §3, template 1598–1657): KPI row, status chips with the flow hint,
// the "Goods receipts" table (row click opens the delivery drawer `?receipt=`) and the drawer — lines (row → Project
// BOM), Delivery and Quality check sections, Documents and Photos, Open purchase order / Print receipt. Server
// Component; the actions are client islands (src/features/deliveries/receipt-actions.tsx), shown only to viewers who
// may act: `canEdit` (not outside the workspace, not a read-only project) for Register receipt and documents,
// `canQc` (quality manager, procurement, director) for the quality decision.
import { FilePdf, Funnel, ShoppingCart } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { ClickableRow } from '@/components/app/ClickableRow';
import { DocumentPreview } from '@/components/app/DocumentPreview';
import { EmptyState } from '@/components/app/EmptyState';
import { Eyebrow } from '@/components/app/Eyebrow';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KeyValueList } from '@/components/app/KeyValueList';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import type { FormDef } from '@/components/app/form-def';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import { Table, Td, Th } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import type { T } from '@/i18n/translate';
import type { DeliveriesView, DrawerView } from './model';
import { AttachNoteButton, PrintReceiptButton, QcPanel, RegisterReceiptButton, RowQcButtons } from './receipt-actions';
import s from './deliveries.module.css';

export interface DeliveriesBodyProps {
  code: string;
  view: DeliveriesView;
  /** Register receipt, attach a document: not outside the workspace, not a read-only project. */
  canEdit: boolean;
  /** Accept / Reject: `canEdit` and the viewer records quality checks. */
  canQc: boolean;
  /** "Register receipt" form of each Announced receipt (translated), by number. */
  registerForms: Record<string, { def: FormDef; context: string }>;
  /** R-126: the open receipt's photo gallery (stored by Keystone); the empty preview frame when not given. */
  photos?: ReactNode;
  t: T;
}

export function DeliveriesBody({ code, view, canEdit, canQc, registerForms, photos, t }: DeliveriesBodyProps) {
  return (
    <div className={s.stack}>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={Funnel}>{t('Status')}</FilterLabel>
          <FilterChips label={t('Status')} value={view.chip} options={view.chips.map((c) => ({ value: c.value, label: c.label, count: c.count, href: c.href }))} />
        </FilterGroup>
        <FilterNote>{t('Announced → received → quality check → accepted or rejected · accepted quantities go to stock')}</FilterNote>
      </FilterBar>

      <SectionCard title={t('Goods receipts')} hint={t('Click a delivery for its lines, quality check and documents')} scroll>
        <Table size={13}>
          <thead>
            <tr>
              <Th>{t('Delivery')}</Th>
              <Th>{t('Order')}</Th>
              <Th>{t('Supplier')}</Th>
              <Th>{t('Articles')}</Th>
              <Th align="right">{t('Delivered / ordered')}</Th>
              <Th align="right">{t('Accepted')}</Th>
              <Th align="right">{t('Rejected')}</Th>
              <Th>{t('Quality')}</Th>
              <Th>{t('Put-away')}</Th>
              <Th>{t('Status')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <ClickableRow key={r.id} href={r.href}>
                <td>
                  <div className={s.delivery}>
                    <span className={cx(s.id, r.selected && s.idOn)}>{r.id}</span>
                    <span className={s.sub}>{r.sub}</span>
                  </div>
                </td>
                <td className={s.po}>{r.po}</td>
                <td>{r.supplier}</td>
                <td className={s.refs}>{r.lines}</td>
                <Td align="right" numeric nowrap>
                  {r.qty}
                </Td>
                <Td align="right" numeric>
                  {r.acc}
                </Td>
                <Td align="right" numeric color={r.rejColor}>
                  {r.rej}
                </Td>
                <td className={s.qc}>{r.qc}</td>
                <td className={s.loc}>{r.loc}</td>
                <td>
                  <Tag tone={r.tone}>{r.status}</Tag>
                </td>
                <td>
                  <div className={s.rowActions}>
                    {canEdit && r.canReceive && registerForms[r.id] && (
                      <RegisterReceiptButton code={code} number={r.id} form={registerForms[r.id].def} context={registerForms[r.id].context} variant="row" />
                    )}
                    {canQc && r.canQc && <RowQcButtons code={code} number={r.id} />}
                  </div>
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
        {view.empty && <EmptyState>{t('No delivery in this status')}</EmptyState>}
      </SectionCard>

      {view.drawer && <DeliveryDrawer code={code} d={view.drawer} canEdit={canEdit} canQc={canQc} register={registerForms[view.drawer.id] ?? null} photos={photos} t={t} />}
    </div>
  );
}

export interface DrawerProps {
  code: string;
  d: DrawerView;
  canEdit: boolean;
  canQc: boolean;
  register: { def: FormDef; context: string } | null;
  /** R-126: the receipt's photo gallery. */
  photos?: ReactNode;
  t: T;
}

/** Delivery drawer (delivVals 4462–4465) over the DS Drawer (client; closes to the register URL without `?receipt=`). */
function DeliveryDrawer(props: DrawerProps) {
  const { d } = props;
  const tag = (
    <Tag tone={d.tone} nowrap={false}>
      {d.status}
    </Tag>
  );
  return (
    <Drawer open closeHref={d.closeHref} id={d.head} title={d.supplier} meta={tag}>
      <DeliveryDrawerBody {...props} />
    </Drawer>
  );
}

/** Drawer content: lines, Delivery and Quality check sections (with the QC / receive actions), Documents, Photos, footer. */
export function DeliveryDrawerBody({ code, d, canEdit, canQc, register, photos, t }: DrawerProps) {
  return (
    <>
      <div className={s.linesWrap}>
        <Table size={12.5} className={s.linesTable}>
          <thead>
            <tr>
              <Th>{t('Reference')}</Th>
              <Th>{t('Article')}</Th>
              <Th align="right">{t('Ordered')}</Th>
              <Th align="right">{t('Delivered')}</Th>
              <Th align="right">{t('Accepted')}</Th>
              <Th align="right">{t('Rejected')}</Th>
              <Th>{t('Put-away')}</Th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <ClickableRow key={l.ref} href={l.href}>
                <td className={s.lineRef}>{l.ref}</td>
                <td>{l.name}</td>
                <Td align="right" numeric>
                  {l.o}
                </Td>
                <Td align="right" numeric>
                  {l.d}
                </Td>
                <Td align="right" numeric>
                  {l.a}
                </Td>
                <Td align="right" numeric color={l.rColor}>
                  {l.r}
                </Td>
                <td className={s.lineLoc}>{l.loc}</td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
      </div>

      <div className={s.grid}>
        <KeyValueList title={t('Delivery')} items={d.meta.map((m) => ({ k: m.k, v: m.v, color: m.color }))} />
        <div className={s.col}>
          <KeyValueList title={t('Quality check')} items={d.qc.map((m) => ({ k: m.k, v: m.v, color: m.color }))} />
          {canQc && d.canQc && (
            <QcPanel key={d.id} code={code} number={d.id} context={`${d.id} · ${d.supplier}`} lines={d.qcLines} deliveredText={d.lines.map((l) => l.d)} />
          )}
          {canEdit && d.canReceive && register && <RegisterReceiptButton code={code} number={d.id} form={register.def} context={register.context} variant="drawer" />}
        </div>
      </div>

      <div className={s.grid}>
        <div className={s.col}>
          <Eyebrow>{t('Documents')}</Eyebrow>
          {d.docs.map((doc, i) => (
            <div key={`${doc}-${i}`} className={s.doc}>
              <FilePdf className={s.docIcon} aria-hidden />
              <span className={s.docName} title={doc}>
                {doc}
              </span>
            </div>
          ))}
          {!d.docs.length && <span className={s.noDocs}>{t('No document yet')}</span>}
          {canEdit && <AttachNoteButton code={code} number={d.id} />}
        </div>
        <div className={s.photos}>
          <Eyebrow>{t('Photos')}</Eyebrow>
          {photos ?? <DocumentPreview ratio="16/9" fit="cover" placeholder={t('Drop receipt photos')} />}
        </div>
      </div>

      <div className={s.footer}>
        <ButtonLink href={d.poHref} variant="secondary" size="sm" icon={ShoppingCart}>
          {t('Open purchase order')}
        </ButtonLink>
        <PrintReceiptButton code={code} number={d.id} />
      </div>
    </>
  );
}
