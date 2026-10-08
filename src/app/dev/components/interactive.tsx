'use client';
// Interactive demos for the dev gallery: client state for segmented/chips/search and the overlays.
import { useState } from 'react';
import { ArrowRight, CalendarDots, CaretDown, Check, PaperPlaneTilt, Plus } from '@phosphor-icons/react/dist/ssr';
import { Button, CenteredModal, Dialog, DialogActions, Drawer, Field, Input, MenuHeader, MenuItem, Popover, Segmented, Tag, useToast } from '@/components/ds';
import {
  Callout,
  ChoiceCard,
  CardGrid,
  Eyebrow,
  FilterChips,
  FlowStepper,
  FormDialog,
  KeyValueList,
  LO,
  NumberedStepper,
  SearchField,
  WizardDialog,
  formDefFromPrototype,
  statusTagButtonClass,
} from '@/components/app';
import { useI18n } from '@/i18n/client';

const AF_RISKS = {
  title: 'New risk',
  kind: 'create',
  submit: 'Register risk',
  fields: [
    ['title', 'Title', 'text', '', 1],
    ['cat', 'Category', 'select', 'RCAT'],
    ['p', 'Probability (1–5)', 'number', '3'],
    ['i', 'Impact (1–5)', 'number', '3'],
    ['owner', 'Owner', 'select', 'TEAM'],
    ['resp', 'Response', 'select', ['Mitigate', 'Accept', 'Transfer', 'Avoid']],
    ['emv', 'EMV (k€)', 'number', ''],
    ['plan', 'Response plan', 'textarea', ''],
  ],
};

export function Interactive({ part }: { part: 'filters' | 'overlays' }) {
  const { t } = useI18n();
  const toast = useToast();
  const [prio, setPrio] = useState<'low' | 'med' | 'high'>('med');
  const [chip, setChip] = useState('A1250');
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState(1);
  const [tpl, setTpl] = useState('EMP');
  const [reason, setReason] = useState('');

  if (part === 'filters')
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <Segmented
          value={prio}
          onChange={setPrio}
          options={[
            { value: 'low', label: t('Low') },
            { value: 'med', label: t('Medium') },
            { value: 'high', label: t('High') },
          ]}
        />
        <FilterChips
          value={chip}
          onChange={setChip}
          options={['A1250', 'A1260', 'A1320'].map((v) => ({ value: v, label: v }))}
        />
        <SearchField placeholder={t('Search projects')} value={q} onChange={setQ} />
        <SearchField placeholder={t('Search reference, article, manufacturer ref')} size="sm" flex="1 1 240px" maxWidth={340} param="q" />
      </div>
    );

  const riskDef = formDefFromPrototype(AF_RISKS, { RCAT: ['Technical', 'Supplier / delivery', 'HSE (safety)'], TEAM: ['Romain Aubert', 'Julien Wagner'] });

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <Button variant="secondary" size="sm" onClick={() => setDrawer(true)}>Drawer</Button>
        <Button variant="secondary" size="sm" onClick={() => setDialog(true)}>Dialog (force)</Button>
        <Button variant="secondary" size="sm" onClick={() => setModal(true)}>Centered modal</Button>
        <Button variant="primary" icon={Plus} onClick={() => setForm(true)}>{t('New risk')}</Button>
        <Button variant="primary" icon={Plus} onClick={() => { setStep(1); setWizard(true); }}>{t('New project')}</Button>
        <Button variant="secondary" size="sm" onClick={() => toast.showEn('R-21 · Risk registered')}>Toast</Button>
        <Popover
          triggerClassName={statusTagButtonClass('accent')}
          trigger={
            <>
              Fabrication & Assemblage
              <CaretDown />
            </>
          }
          minWidth="240px"
          offset={-4}
          inset={6}
        >
          <MenuHeader>{t('Move to')}</MenuHeader>
          <MenuItem icon={ArrowRight} iconTone="accent" meta={t('2 deliverables missing')} onClick={() => toast.show('FAT')}>
            FAT
          </MenuItem>
          <MenuItem icon={ArrowRight} iconTone="accent" onClick={() => toast.show('Annulé')}>
            Annulé
          </MenuItem>
        </Popover>
        <Popover triggerClassName="btn btn-secondary" trigger={<>{t('View as')}</>} zIndex={40} side="above" offset={6}>
          <MenuHeader>{t('View as')}</MenuHeader>
          <MenuItem size={12.5} selected>Marie Lefebvre</MenuItem>
          <MenuItem size={12.5}>Romain Aubert</MenuItem>
        </Popover>
      </div>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        id="A1250"
        title="Steel erection — Bays 3–4"
        titlePlacement="inline"
        meta={<Tag tone="accent">{t('In progress')} · 62%</Tag>}
        actions={
          <Button variant="secondary" size="sm" icon={CalendarDots}>
            {t('Show in Gantt')}
          </Button>
        }
      >
        <FlowStepper steps={[{ label: t('Draft'), reached: true }, { label: t('Approved'), reached: true, current: true }, { label: t('Ordered'), reached: false }]} meta={`${t('Raised by')} R. Aubert`} />
        <KeyValueList
          title={t('General')}
          items={[
            { k: t('Owner'), v: 'J. Wagner' },
            { k: t('Planned finish'), v: '30 Oct', color: LO },
            { k: t('Budget'), v: '€420k' },
          ]}
        />
      </Drawer>

      <Dialog open={dialog} onClose={() => setDialog(false)} title={t('Force stage change')} subtitle="Harbor Line Terminal Expansion · Fabrication & Assemblage → FAT" width={560} placement="center" maxHeight={null} zIndex={55}>
        <Callout variant="emphasis">{t('Missing deliverables')}</Callout>
        <Field label={t('Reason for forcing (required)')} htmlFor="force-reason">
          <Input id="force-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. client pressure on delivery date, deliverable to follow next week')} />
        </Field>
        <DialogActions variant="flush">
          <Button variant="secondary" onClick={() => setDialog(false)}>{t('Cancel')}</Button>
          {reason.trim() && (
            <Button variant="primary" icon={ArrowRight} onClick={() => setDialog(false)}>
              {t('Confirm and request validation')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <CenteredModal open={modal} onClose={() => setModal(false)} title={t('Import a list')} subtitle="Process list rev C → Mechanical" width={720}>
        <NumberedStepper steps={[t('Source'), t('Column mapping'), t('Check & import')]} current={1} />
        <Eyebrow>{t('Source tool')}</Eyebrow>
        <DialogActions variant="flush">
          <Button variant="ghost" size="sm" onClick={() => setModal(false)}>{t('Cancel')}</Button>
          <Button variant="primary" size="sm" icon={PaperPlaneTilt}>{t('Next')}</Button>
        </DialogActions>
      </CenteredModal>

      <FormDialog
        {...riskDef}
        translate
        open={form}
        onClose={() => setForm(false)}
        context="Harbor Line Terminal Expansion"
        onSubmit={async (v) => {
          await new Promise((r) => setTimeout(r, 300));
          return `R-21 · ${t('Risk registered')} · ${v.title}`;
        }}
      />

      <WizardDialog
        open={wizard}
        onClose={() => setWizard(false)}
        title={t('New project')}
        steps={[t('Basics'), t('Structure'), t('Budget'), t('Schedule')]}
        step={step}
        onStepChange={setStep}
        onFinish={() => setWizard(false)}
        finishIcon={Check}
      >
        <CardGrid min={200} gap={10}>
          <ChoiceCard selected={tpl === 'blank'} onSelect={() => setTpl('blank')} title="Projet blank" description="WBS vide — vous définissez lots, catégories et calendriers." />
          <ChoiceCard selected={tpl === 'EMP'} onSelect={() => setTpl('EMP')} title="Planning EMP" description="Planning standard EMP : études, structure, montage mécanique, électricité & automatisme, essais, réception." />
        </CardGrid>
      </WizardDialog>
    </>
  );
}
