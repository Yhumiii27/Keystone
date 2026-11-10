'use client';
// R-160 (P2, D9-32): the CE file of one equipment line — regime, Annex I category and conformity assessment route (choice lists,
// no legal advice), risk assessment (Codex reference), harmonised standards (free list), the essential requirements checklist
// (Annex III headings of Settings), the technical-file headings (Annex IV, each linked to a deliverable or a Codex reference), the
// instructions, the declaration (signatory, date, Codex reference) and the CE marking date. The fields outside the viewer's
// scope are disabled (the server keeps them anyway: `applyCeScope`). Labels and options arrive translated from the server.
import { ArrowClockwise, CheckCircle, Circle, FloppyDisk } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SectionCard } from '@/components/app/SectionCard';
import { StaleRecordCallout } from '@/components/app/StaleRecord';
import { Button } from '@/components/ds/Button';
import { Field, Input, Select, Textarea } from '@/components/ds/Field';
import { Table, Td, Th } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { saveCeFileAction } from './actions';
import type { CeEditorView, CeFormValues } from './model';
import s from './ce.module.css';

const toPayload = (v: CeFormValues) => ({
  ...v,
  // Partly completed machinery: no route, no CE marking (the fields are hidden values the server would refuse).
  ...(v.regime === 'partly_completed' ? { route: '', ceMarkingOn: '' } : null),
  standards: v.standards.split('\n'),
  techFile: Object.fromEntries(Object.entries(v.techFile).map(([k, e]) => [k, { status: e.status, deliverable: e.deliverable || null, codexRef: e.codexRef || null }])),
});

export function CeFileEditor({ view }: { view: CeEditorView }) {
  const { t } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<CeFormValues>(view.values);
  const [conflict, setConflict] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const tech = view.scope !== 'technical';
  const project = view.scope === 'none';
  const partly = v.regime === 'partly_completed';
  const set = <K extends keyof CeFormValues>(k: K, value: CeFormValues[K]) => setV((x) => ({ ...x, [k]: value }));
  const setEhsr = (code: string, status: string) => setV((x) => ({ ...x, ehsr: { ...x.ehsr, [code]: status } }));
  const setTech = (code: string, patch: Partial<CeFormValues['techFile'][string]>) =>
    setV((x) => ({ ...x, techFile: { ...x.techFile, [code]: { ...(x.techFile[code] ?? { status: 'todo', deliverable: '', codexRef: '' }), ...patch } } }));
  const id = (k: string) => `ce-${view.ref}-${k}`;

  const save = () =>
    startTransition(async () => {
      const r = await saveCeFileAction(view.projectCode, view.ref, toPayload(v), view.token);
      if ('error' in r) {
        if (r.conflict) setConflict(r.error);
        else showToast(r.error);
        return;
      }
      setConflict(null);
      if (r.toast) showToast(r.toast);
      router.refresh();
    });

  return (
    <SectionCard title={view.title} hint={view.updated ? `${t('Updated')} ${view.updated}` : undefined} scroll>
      <div id="ce-file" />
      {view.readOnlyNote && <span className={s.muted}>{view.readOnlyNote}</span>}
      <div className={s.checks} aria-label={t('Readiness')}>
        {view.checks.map((c) => (
          <Tag key={c.label} tone={c.ok ? 'neutral' : 'outline'} size="sm" icon={c.ok ? CheckCircle : Circle}>
            {c.label}
          </Tag>
        ))}
      </div>

      <h3 className={s.sectionHead}>
        <span>{t('Regime and conformity assessment')}</span>
        <span className={s.rule} aria-hidden />
      </h3>
      <div className={s.grid}>
        <Field label={t('Regime')} htmlFor={id('regime')}>
          <Select id={id('regime')} value={v.regime} options={view.regimes} disabled={tech} onChange={(e) => set('regime', e.target.value)} />
        </Field>
        <Field label={t('Annex I category')} htmlFor={id('category')}>
          <Select id={id('category')} value={v.category} options={view.categories} disabled={tech || partly} onChange={(e) => set('category', e.target.value)} />
        </Field>
        <Field label={t('Conformity assessment route')} htmlFor={id('route')}>
          <Select id={id('route')} value={partly ? '' : v.route} options={view.routes} disabled={tech || partly} onChange={(e) => set('route', e.target.value)} />
        </Field>
        <Field label={t('Risk assessment · Codex reference')} htmlFor={id('risk')}>
          <Input id={id('risk')} value={v.riskAssessmentRef} disabled={tech} placeholder="RPT-HLT-040" onChange={(e) => set('riskAssessmentRef', e.target.value)} />
        </Field>
        <Field label={t('Harmonised standards applied')} htmlFor={id('standards')} span="full" hint={t('One per line')}>
          <Textarea id={id('standards')} short value={v.standards} disabled={tech} placeholder="EN ISO 12100:2010" onChange={(e) => set('standards', e.target.value)} />
        </Field>
        <Field label={t(partly ? 'Assembly instructions · Codex reference' : 'Instructions · Codex reference')} htmlFor={id('instructions')}>
          <Input id={id('instructions')} value={v.instructionsRef} disabled={tech} placeholder="MAN-HLT-015" onChange={(e) => set('instructionsRef', e.target.value)} />
        </Field>
      </div>

      <h3 className={s.sectionHead}>
        <span>{t('Essential health and safety requirements (Annex III)')}</span>
        <span className={s.rule} aria-hidden />
      </h3>
      <Table size={12.5}>
        <thead>
          <tr>
            <Th>{t('Number')}</Th>
            <Th>{t('Requirement')}</Th>
            <Th>{t('Status')}</Th>
          </tr>
        </thead>
        <tbody>
          {view.ehsr.map((e) => (
            <tr key={e.code}>
              <Td className={s.code}>{e.code}</Td>
              <Td className={e.removed ? s.removed : undefined}>{e.title}</Td>
              <Td>
                <Select size="cell" className={s.cellSelect} aria-label={`${e.code} · ${t('Status')}`} value={v.ehsr[e.code] ?? 'todo'} options={view.ehsrStatuses} disabled={tech} onChange={(x) => setEhsr(e.code, x.target.value)} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <h3 className={s.sectionHead}>
        <span>{t('Technical file contents (Annex IV)')}</span>
        <span className={s.rule} aria-hidden />
      </h3>
      <Table size={12.5}>
        <thead>
          <tr>
            <Th>{t('Heading')}</Th>
            <Th>{t('Status')}</Th>
            <Th>{t('Deliverable')}</Th>
            <Th>{t('Codex reference')}</Th>
          </tr>
        </thead>
        <tbody>
          {view.techFile.map((e) => {
            const cur = v.techFile[e.code] ?? { status: 'todo', deliverable: '', codexRef: '' };
            return (
              <tr key={e.code}>
                <Td className={e.removed ? s.removed : undefined}>{e.title}</Td>
                <Td>
                  <Select size="cell" className={s.cellSelect} aria-label={`${e.title} · ${t('Status')}`} value={cur.status} options={view.techStatuses} disabled={tech} onChange={(x) => setTech(e.code, { status: x.target.value })} />
                </Td>
                <Td>
                  <Select size="cell" className={s.cellSelect} aria-label={`${e.title} · ${t('Deliverable')}`} value={cur.deliverable} options={view.deliverables} disabled={tech} onChange={(x) => setTech(e.code, { deliverable: x.target.value })} />
                </Td>
                <Td>
                  <Input size="cell" className={s.cellInput} aria-label={`${e.title} · ${t('Codex reference')}`} value={cur.codexRef} disabled={tech} onChange={(x) => setTech(e.code, { codexRef: x.target.value })} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <h3 className={s.sectionHead}>
        <span>{view.declarationTitles[v.regime] ?? view.declarationTitles['']}</span>
        <span className={s.rule} aria-hidden />
      </h3>
      <div className={s.grid}>
        <Field label={t('Signatory')} htmlFor={id('signatory')}>
          <Input id={id('signatory')} value={v.declarationSignatory} disabled={project} onChange={(e) => set('declarationSignatory', e.target.value)} />
        </Field>
        <Field label={t('Date signed')} htmlFor={id('declOn')}>
          <Input id={id('declOn')} type="date" value={v.declarationOn} disabled={project} onChange={(e) => set('declarationOn', e.target.value)} />
        </Field>
        <Field label={t('Declaration · Codex reference')} htmlFor={id('declRef')}>
          <Input id={id('declRef')} value={v.declarationRef} disabled={project} placeholder="COC-HLT-001" onChange={(e) => set('declarationRef', e.target.value)} />
        </Field>
        <Field label={t('CE marking date')} htmlFor={id('ce')} hint={partly ? t('Partly completed machinery bears no CE marking') : undefined}>
          <Input id={id('ce')} type="date" value={partly ? '' : v.ceMarkingOn} disabled={project || partly} onChange={(e) => set('ceMarkingOn', e.target.value)} />
        </Field>
      </div>

      {conflict && <StaleRecordCallout message={conflict} onReload={() => setConflict(null)} />}
      {!project && (
        <div className={s.footer}>
          <Button variant="primary" size="sm" icon={pending ? ArrowClockwise : FloppyDisk} disabled={pending} onClick={save} className={s.push}>
            {t('Save the CE file')}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
