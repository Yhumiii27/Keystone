// R-158 lot A — Shipments screen body (Server Component): KPI tiles, the contract's Incoterm and its split, then one card per
// shipment — facts, transport steps (the seller's tracked, the buyer's shown), loads with their content, the packing control
// against the BOM and the per-HS-code summary. Edit controls (client islands, ./buttons.tsx) only for the shipment editors.
// Lot B: the freight-delay warning (and "Create a risk" for a lead), the site reception (pointing for the editors and the site
// team, the punch items raised), the shipping documents (download for every reader, "File in Codex" for the editors) and the
// manual closure.
import { Info, ShippingContainer, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Callout } from '@/components/app/Callout';
import { DataTable, type DataColumn } from '@/components/app/DataTable';
import { EmptyState } from '@/components/app/EmptyState';
import { KeyValueList } from '@/components/app/KeyValueList';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { StatusTag } from '@/components/app/StatusTag';
import { screenHref } from '@/config/screens';
import type { FormDef } from '@/components/app/form-def';
import type { T } from '@/i18n/translate';
import { ExportFileButton } from '@/features/exports/export-file-button';
import { ShipmentFormButton, ShipmentRunButton } from './buttons';
import type { ControlRowView, DocumentRowView, ItemRowView, ReceptionItemView, ShipmentView, ShipmentsScreenView, StepRowView } from './model';
import s from './shipments.module.css';

export interface ShipmentForms {
  edit: FormDef;
  load: FormDef;
  editLoad: FormDef;
  item: FormDef;
  editItem: FormDef;
  gap: FormDef;
  step: (step: StepRowView['step']) => FormDef;
  /** Lot B. */
  pointLoad: FormDef;
  pointItem: FormDef;
  close: FormDef;
  /** The "New risk" form (English, translated by the dialog), for a lead who edits the risks; null otherwise. */
  risk: FormDef | null;
}

export function ShipmentsBody({ view, code, canEdit, canReceive = false, context, formsFor, t }: {
  view: ShipmentsScreenView; code: string; canEdit: boolean; context: string; formsFor: (ref: string) => ShipmentForms; t: T;
  /** Lot B: the viewer points the reception (`canRecordReception`). */
  canReceive?: boolean;
}) {
  const inc = view.incoterm;
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} />)}
      </KpiGrid>
      <SectionCard title={t('Transport organised from the contract’s Incoterm')} icon={ShippingContainer} gap={10}>
        {inc.state === 'none' && <Callout icon={Info}>{t('No contract registered for this project: the transport steps come from the contract’s Incoterm')}</Callout>}
        {inc.state === 'unset' && (
          <Callout icon={Info} action={<Link className={s.link} href={screenHref('contract', { code })}>{t('Open the contract')}</Link>}>
            {t('The contract has no Incoterm yet: set it on the Contract screen')}
          </Callout>
        )}
        {inc.state === 'set' && (
          <>
            <div className={s.incHead}>
              <span className={s.incCode}>{inc.code}</span>
              <span className={s.incName}>{inc.name}</span>
              {inc.place && <span className={s.incPlace}>{inc.place}</span>}
              <span className={s.muted}>{inc.modes}</span>
            </div>
            {inc.description && <p className={s.text}>{inc.description}</p>}
            <div className={s.split} role="list" aria-label={t('Split of responsibilities')}>
              {inc.split.map((st) => (
                <span key={st.label} role="listitem" className={st.seller ? s.seller : s.buyer} title={st.party}>
                  {st.label} · {st.party}
                </span>
              ))}
            </div>
          </>
        )}
      </SectionCard>
      {!view.shipments.length && (
        <EmptyState variant="boxed">{view.hasEquipment ? t('No shipment yet for this project') : t('No equipment line on this project: add one on the Contract screen first')}</EmptyState>
      )}
      {view.shipments.map((sh) => (
        <ShipmentCard key={sh.ref} sh={sh} code={code} canEdit={canEdit} canReceive={canReceive} context={context} forms={formsFor(sh.ref)} t={t} />
      ))}
    </Stack>
  );
}

function ShipmentCard({ sh, code, canEdit, canReceive, context, forms, t }: {
  sh: ShipmentView; code: string; canEdit: boolean; canReceive: boolean; context: string; forms: ShipmentForms; t: T;
}) {
  const target = { ref: sh.ref };
  const ctx = `${context} · ${sh.ref}`;
  const editContent = canEdit && sh.editableContent;
  const actions = canEdit ? (
    <div className={s.actions}>
      <ShipmentFormButton kind="edit" code={code} target={target} context={ctx} form={forms.edit} values={sh.form} label={t('Edit')} ariaLabel={`${t('Edit')} · ${sh.ref}`} />
      {sh.canValidate && (
        <ShipmentRunButton kind="validate" code={code} target={target} label={t('Validate packing list')} variant="primary" disabledReason={sh.validateBlocker} />
      )}
      {sh.canReopen && <ShipmentRunButton kind="reopen" code={code} target={target} label={t('Reopen packing list')} />}
      {sh.advance && <ShipmentRunButton kind="advance" code={code} target={{ ref: sh.ref, from: sh.advance.from }} label={sh.advance.label} />}
      {sh.canClose && (
        <ShipmentFormButton kind="close" code={code} target={target} context={ctx} form={forms.close} label={t('Close shipment')} variant="secondary" ariaLabel={`${t('Close shipment')} · ${sh.ref}`} />
      )}
      {sh.canRemove && (
        <ShipmentRunButton
          kind="remove" code={code} target={target} label={t('Remove')} variant="ghost" ariaLabel={`${t('Remove')} · ${sh.ref}`}
          confirm={{ title: `${t('Remove')} · ${sh.ref}`, text: t('The shipment, its loads, content and steps are removed.'), cancel: t('Cancel') }}
        />
      )}
    </div>
  ) : undefined;

  const stepCols: DataColumn<StepRowView>[] = [
    { key: 'step', header: t('Step'), render: (r) => r.label },
    { key: 'party', header: t('Party'), render: (r) => <span className={r.tracked ? s.sellerText : s.muted}>{r.party}</span> },
    { key: 'planned', header: t('Planned'), render: (r) => (r.tracked ? r.planned : ''), nowrap: true },
    { key: 'actual', header: t('Done on'), render: (r) => (r.tracked ? r.actual : ''), nowrap: true },
    { key: 'state', header: t('State'), render: (r) => <StatusTag tone={r.state === 'late' ? 'accent' : r.state === 'buyer' ? 'muted' : r.state === 'done' ? 'neutral' : 'outline'} size="sm">{r.state === 'buyer' ? '—' : r.stateLabel}</StatusTag> },
    { key: 'note', header: t('Note'), render: (r) => (r.tracked ? r.note : ''), tone: 'secondary' },
    ...(canEdit && sh.status !== 'closed' ? [{
      key: 'edit', header: '', align: 'right' as const,
      render: (r: StepRowView) => (r.tracked ? (
        <ShipmentFormButton kind="step" code={code} target={{ ref: sh.ref, step: r.step }} context={ctx} form={forms.step(r.step)} values={r.form} label={t('Edit')} ariaLabel={`${t('Edit')} · ${r.label}`} />
      ) : null),
    }] : []),
  ];

  return (
    <SectionCard
      title={<span className={s.title}>{sh.title} <StatusTag tone={sh.tone}>{sh.statusLabel}</StatusTag></span>}
      subtitle={`${t('Equipment')} · ${sh.equipment}`}
      actions={actions}
      gap={12}
      scroll
    >
      <KeyValueList layout="inline" items={sh.facts.map((f) => ({ k: f.k, v: f.v }))} />
      {sh.modeWarning && <Callout icon={Warning} variant="compact">{sh.modeWarning}</Callout>}
      {sh.delay && (
        <Callout
          icon={Warning} variant="compact" role="alert"
          action={sh.risk ? (
            <Link className={s.link} href={sh.risk.href}>{sh.risk.number}</Link>
          ) : sh.riskDraft && forms.risk ? (
            <ShipmentFormButton kind="risk" code={code} target={target} context={`${ctx} · ${t('Freight delay')}`} form={forms.risk} values={sh.riskDraft} label={t('Create a risk')} variant="secondary" translate />
          ) : undefined}
        >
          {t('Freight delay')} · {sh.delay}
        </Callout>
      )}

      <div className={s.block}>
        <div className={s.sectionLabel}>{t('Transport steps')}</div>
        {sh.steps.length ? (
          <DataTable columns={stepCols} rows={sh.steps} rowKey={(r) => r.step} size={12.5} />
        ) : (
          <span className={s.muted}>{t('The steps come from the contract’s Incoterm')}</span>
        )}
      </div>

      <div className={s.block}>
        <div className={s.blockHead}>
          <div className={s.sectionLabel}>{t('Loads and content')}</div>
          {editContent && (
            <div className={s.actions}>
              <ShipmentFormButton kind="addLoad" code={code} target={target} context={ctx} form={forms.load} label={t('Add load')} />
              {sh.loads.length > 0 && (
                <ShipmentFormButton kind="addItem" code={code} target={target} context={ctx} form={forms.item} values={{ load: String(sh.loads[0].number) }} label={t('Add content')} />
              )}
            </div>
          )}
        </div>
        {!sh.loads.length && <span className={s.muted}>{t('No load declared yet')}</span>}
        {sh.loads.map((l) => (
          <div key={l.number} className={s.load}>
            <div className={s.blockHead}>
              <span className={s.loadTitle}>{l.title}</span>
              {l.sub && <span className={s.muted}>{l.sub}</span>}
              {editContent && (
                <div className={s.actions}>
                  <ShipmentFormButton kind="addItem" code={code} target={target} context={ctx} form={forms.item} values={{ load: String(l.number) }} label={t('Add content')} ariaLabel={`${t('Add content')} · #${l.number}`} />
                  <ShipmentFormButton kind="editLoad" code={code} target={{ ref: sh.ref, number: l.number }} context={ctx} form={forms.editLoad} values={l.form} label={t('Edit')} ariaLabel={`${t('Edit')} · #${l.number}`} />
                  <ShipmentRunButton
                    kind="removeLoad" code={code} target={{ ref: sh.ref, number: l.number }} label={t('Remove')} variant="ghost" ariaLabel={`${t('Remove')} · #${l.number}`}
                    confirm={{ title: `${t('Remove')} · #${l.number}`, text: t('The load and its content are removed.'), cancel: t('Cancel') }}
                  />
                </div>
              )}
            </div>
            <DataTable columns={itemColumns(t, editContent, code, sh.ref, ctx, forms)} rows={l.items} rowKey={(r) => r.id} size={12.5} empty={t('Empty load')} hideHeaderWhenEmpty />
          </div>
        ))}
      </div>

      <div className={s.block}>
        <div className={s.blockHead}>
          <div className={s.sectionLabel}>{t('Packing control against the BOM')}</div>
          <StatusTag tone={sh.control.cleared ? 'neutral' : 'accent'} size="sm">{sh.control.summary}</StatusTag>
        </div>
        {sh.control.missingHs.length > 0 && (
          <Callout icon={Warning} variant="compact" role="alert">
            {t('Without HS code — blocks the packing list')} · {sh.control.missingHs.join(' · ')}
          </Callout>
        )}
        {sh.control.restricted.length > 0 && (
          <Callout icon={Warning} variant="compact">
            {t('Export restriction')} · {sh.control.restricted.join(' · ')}
          </Callout>
        )}
        {sh.control.rows.length ? (
          <DataTable columns={controlColumns(t, editContent, code, sh.ref, ctx, forms)} rows={sh.control.rows} rowKey={(r) => r.key} size={12.5} />
        ) : (
          <span className={s.muted}>{t('The shipment’s equipment lines have no BOM line of their own; common BOM lines packed are listed here')}</span>
        )}
      </div>

      {sh.reception && <ReceptionBlock sh={sh} code={code} canReceive={canReceive} ctx={ctx} forms={forms} t={t} />}

      <div className={s.block}>
        <div className={s.sectionLabel}>{t('Shipping documents')}</div>
        <DataTable
          size={12.5} rows={sh.documents} rowKey={(r) => r.kind}
          columns={[
            { key: 'label', header: t('Document'), render: (r: DocumentRowView) => <>{r.label}<div className={s.muted}>{r.hint}</div></> },
            { key: 'filed', header: t('Filed in Codex'), render: (r: DocumentRowView) => r.filed ?? (r.blocker ?? '—'), tone: 'secondary' },
            {
              key: 'do', header: '', align: 'right',
              render: (r: DocumentRowView) => (r.blocker ? null : (
                <div className={s.actions}>
                  <ExportFileButton href={r.href} label={t('PDF')} size="mini" ariaLabel={`${r.label} · ${sh.ref}`} />
                  {canEdit && (
                    <ShipmentRunButton kind="file" code={code} target={{ ref: sh.ref, key: r.kind }} label={t(r.filed ? 'File a new revision' : 'File in Codex')} ariaLabel={`${t('File in Codex')} · ${r.label}`} />
                  )}
                </div>
              )),
            },
          ]}
        />
      </div>

      {sh.control.hs.length > 0 && (
        <div className={s.block}>
          <div className={s.sectionLabel}>{t('Customs summary by HS code')}</div>
          <DataTable
            size={12.5}
            rows={[...sh.control.hs, { code: t('Total'), ...sh.control.totals, origins: '', restricted: false }]}
            rowKey={(r) => r.code}
            columns={[
              { key: 'code', header: t('HS code'), render: (r) => <span className={s.num}>{r.code}{r.restricted ? ' ⚠' : ''}</span> },
              { key: 'lines', header: t('Lines'), render: (r) => r.lines, numeric: true, align: 'right' },
              { key: 'qty', header: t('Quantity'), render: (r) => r.quantity, numeric: true, align: 'right' },
              { key: 'value', header: t('Customs value'), render: (r) => r.value, numeric: true, align: 'right' },
              { key: 'net', header: t('Net'), render: (r) => r.net, numeric: true, align: 'right' },
              { key: 'gross', header: t('Gross'), render: (r) => r.gross, numeric: true, align: 'right' },
              { key: 'origin', header: t('Origin'), render: (r) => r.origins },
            ]}
          />
        </div>
      )}
    </SectionCard>
  );
}

function itemColumns(t: T, editContent: boolean, code: string, ref: string, ctx: string, forms: ShipmentForms): DataColumn<ItemRowView>[] {
  return [
    { key: 'article', header: t('Article'), render: (r) => <span className={s.num}>{r.article}</span>, nowrap: true },
    { key: 'description', header: t('Description'), render: (r) => <>{r.description}{r.restricted && <span className={s.restricted} title={r.restricted}> ⚠</span>}</> },
    { key: 'hs', header: t('HS code'), render: (r) => r.hs, nowrap: true },
    { key: 'qty', header: t('Quantity'), render: (r) => r.quantity, numeric: true, align: 'right' },
    { key: 'pkg', header: t('Packages'), render: (r) => r.packages, numeric: true, align: 'right' },
    { key: 'dims', header: t('Dimensions'), render: (r) => r.dims, nowrap: true, tone: 'secondary' },
    { key: 'net', header: t('Net'), render: (r) => r.net, numeric: true, align: 'right' },
    { key: 'gross', header: t('Gross'), render: (r) => r.gross, numeric: true, align: 'right' },
    { key: 'origin', header: t('Origin'), render: (r) => r.origin },
    { key: 'value', header: t('Customs value'), render: (r) => r.value, numeric: true, align: 'right' },
    ...(editContent ? [{
      key: 'edit', header: '', align: 'right' as const,
      render: (r: ItemRowView) => (
        <div className={s.actions}>
          <ShipmentFormButton kind="editItem" code={code} target={{ ref, id: r.id }} context={ctx} form={forms.editItem} values={r.form} label={t('Edit')} ariaLabel={`${t('Edit')} · ${r.article}`} />
          <ShipmentRunButton kind="removeItem" code={code} target={{ ref, id: r.id }} label={t('Remove')} variant="ghost" ariaLabel={`${t('Remove')} · ${r.article}`} />
        </div>
      ),
    }] : []),
  ];
}

function controlColumns(t: T, editContent: boolean, code: string, ref: string, ctx: string, forms: ShipmentForms): DataColumn<ControlRowView>[] {
  return [
    { key: 'article', header: t('Article'), render: (r) => r.article },
    { key: 'category', header: t('BOM'), render: (r) => r.category, tone: 'secondary' },
    { key: 'expected', header: t('Expected'), render: (r) => r.expected, numeric: true, align: 'right' },
    { key: 'packed', header: t('Packed'), render: (r) => r.packed, numeric: true, align: 'right' },
    { key: 'gap', header: t('Gap'), render: (r) => <StatusTag tone={r.open ? 'accent' : r.gap ? 'outline' : 'neutral'} size="sm">{r.gapLabel}</StatusTag> },
    { key: 'reason', header: t('Reason'), render: (r) => r.justification ?? (r.open ? t('To justify') : ''), tone: 'secondary' },
    ...(editContent ? [{
      key: 'justify', header: '', align: 'right' as const,
      render: (r: ControlRowView) => (r.gap ? (
        <ShipmentFormButton kind="justify" code={code} target={{ ref, key: r.key }} context={`${ctx} · ${r.article}`} form={forms.gap} values={{ reason: r.justification ?? '' }}
          label={t(r.justification ? 'Edit reason' : 'Justify')} ariaLabel={`${t('Justify')} · ${r.article}`} />
      ) : null),
    }] : []),
  ];
}

/** Lot B — the site reception: each load and its content lines, pointed (received, missing, damaged), the punch items raised. */
function ReceptionBlock({ sh, code, canReceive, ctx, forms, t }: { sh: ShipmentView; code: string; canReceive: boolean; ctx: string; forms: ShipmentForms; t: T }) {
  const r = sh.reception!;
  const point = canReceive && r.open;
  return (
    <div className={s.block}>
      <div className={s.blockHead}>
        <div className={s.sectionLabel}>{t('Site reception')}</div>
        <StatusTag tone={r.complete ? 'neutral' : 'accent'} size="sm">{r.progress}</StatusTag>
        {point && (
          <div className={s.actions}>
            <ShipmentRunButton kind="complete" code={code} target={{ ref: sh.ref }} label={t('Complete the reception')} variant="primary" disabledReason={r.completeBlocker} />
          </div>
        )}
      </div>
      {r.loads.map((l) => (
        <div key={l.number} className={s.load}>
          <div className={s.blockHead}>
            <span className={s.loadTitle}>{l.title}</span>
            <span className={s.muted}>{l.state ?? t('To point')}{l.note ? ` · ${l.note}` : ''}</span>
            {point && (
              <div className={s.actions}>
                <ShipmentFormButton kind="pointLoad" code={code} target={{ ref: sh.ref, number: l.number }} context={`${ctx} · #${l.number}`} form={forms.pointLoad} values={l.form} label={t('Point the load')} ariaLabel={`${t('Point the load')} · #${l.number}`} />
              </div>
            )}
          </div>
          <DataTable
            size={12.5} rows={l.items} rowKey={(x) => x.id} empty={t('Empty load')} hideHeaderWhenEmpty
            columns={[
              { key: 'article', header: t('Article'), render: (x: ReceptionItemView) => <span className={s.num}>{x.article}</span>, nowrap: true },
              { key: 'description', header: t('Description'), render: (x: ReceptionItemView) => x.description },
              { key: 'shipped', header: t('Shipped'), render: (x: ReceptionItemView) => x.shipped, numeric: true, align: 'right' },
              { key: 'pointed', header: t('Reception'), render: (x: ReceptionItemView) => x.pointed ?? t('To point'), tone: 'secondary' },
              { key: 'note', header: t('Note'), render: (x: ReceptionItemView) => x.note ?? '', tone: 'secondary' },
              ...(point && !l.missing ? [{
                key: 'do', header: '', align: 'right' as const,
                render: (x: ReceptionItemView) => (
                  <ShipmentFormButton kind="pointItem" code={code} target={{ ref: sh.ref, id: x.id }} context={`${ctx} · ${x.article}`} form={forms.pointItem} values={x.form} label={t('Point')} ariaLabel={`${t('Point')} · ${x.article}`} />
                ),
              }] : []),
            ]}
          />
        </div>
      ))}
      {r.punch.length > 0 && (
        <>
          <div className={s.blockHead}>
            <span className={s.loadTitle}>{t('Punch items raised by the reception')}</span>
            {r.summary && <span className={s.muted}>{r.summary}</span>}
            <Link className={s.link} href={r.punchHref}>{t('Open the punch list')}</Link>
          </div>
          <DataTable
            size={12.5} rows={r.punch} rowKey={(x) => x.number}
            columns={[
              { key: 'number', header: t('Punch item'), render: (x) => <span className={s.num}>{x.number}</span>, nowrap: true },
              { key: 'text', header: t('Gap'), render: (x) => x.text },
              { key: 'category', header: t('Category'), render: (x) => x.category, tone: 'secondary' },
              { key: 'status', header: t('Status'), render: (x) => <StatusTag tone={x.open ? 'accent' : 'neutral'} size="sm">{x.status}</StatusTag> },
            ]}
          />
          <span className={s.muted}>{t('Photos are added on the punch item (punch list).')}</span>
        </>
      )}
    </div>
  );
}
