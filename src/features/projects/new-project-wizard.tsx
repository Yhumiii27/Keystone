'use client';
// New project wizard (docs/spec/01 §10, 03 §5.8; template 2972–3056, npVals 3946–3967): 4 steps — Basics,
// Structure, Budget, Schedule — over a draft kept by <NewProjectLauncher>. No field validation, as in the prototype.
import { CalendarBlank, Clock, FlagBanner, Plus, X } from '@phosphor-icons/react/dist/ssr';
import { useId } from 'react';
import { ChoiceCard } from '@/components/app/Check';
import { WizardDialog } from '@/components/app/Wizard';
import { Button, IconButton } from '@/components/ds/Button';
import { Field, Input, PseudoInput } from '@/components/ds/Field';
import { Segmented } from '@/components/ds/Segmented';
import { Tag } from '@/components/ds/Tag';
import {
  CONTINGENCIES, DAS_LIST, NEW_CATEGORY, WIZARD_CALENDARS, WIZARD_CURRENCIES, allocateProjectIdentity, analyticHint, categorySource,
  wizardClientCode, wizardTotal, wizardTotalText, type ProjectIdentity, type WizardCalendar, type WizardCurrency,
} from '@/domain/lifecycle';
import { useI18n } from '@/i18n/client';
import type { NewProjectSetup, WizardTemplate } from '@/server/dal/projects-register';
import { categoriesText, wizardSummaryText } from './i18n';
import w from './wizard.module.css';

export interface WizardCategory {
  name: string;
  /** EN type label: Labor, Material, Subcontract, Fees, Equipment. */
  type: string;
  /** Free text, parsed with parseFloat (k). */
  budget: string;
}

/** `state.np` without `open` / `step`. `cats: null` = the default template's categories (not loaded yet). */
export interface WizardDraft {
  name: string;
  client: string;
  das: string;
  mt: string;
  cur: WizardCurrency;
  template: string;
  cats: WizardCategory[] | null;
  cont: number;
  cal: WizardCalendar;
}

export const DEFAULT_DRAFT: WizardDraft = {
  name: '', client: '', das: '2', mt: 'EMP', cur: 'EUR', template: 'EMP', cats: null, cont: 5, cal: 'Standard 5d · 8h',
};

const BLANK: WizardTemplate = { id: 'blank', mt: null, name: 'Projet blank', desc: '', wbs: 'Vide', acts: 'Aucune', cal: 'Standard 5d · 8h', phases: [], cats: [] };

/** NP_TEMPLATES.find(id) || NP_TEMPLATES[0]. */
export const templateOf = (setup: NewProjectSetup, id: string): WizardTemplate =>
  setup.templates.find((x) => x.id === id) ?? setup.templates[0] ?? BLANK;
const catsOf = (tpl: WizardTemplate): WizardCategory[] => tpl.cats.map((c) => ({ ...c }));

/** Categories of the draft (template defaults until the user edits them). */
export const draftCategories = (setup: NewProjectSetup, d: WizardDraft): WizardCategory[] => d.cats ?? catsOf(templateOf(setup, d.template));

/** Identity the project will get (nextProjectId / nextAnalytic for the client typed so far). */
export const draftIdentity = (setup: NewProjectSetup, d: WizardDraft): ProjectIdentity =>
  allocateProjectIdentity({ code3: wizardClientCode(d.client.trim(), setup.clientCodes), numbers: setup.numbers, codes: setup.codes, analytics: setup.analytics });

export interface NewProjectWizardProps {
  open: boolean;
  onClose: () => void;
  step: number;
  onStepChange: (step: number) => void;
  setup: NewProjectSetup;
  draft: WizardDraft;
  onDraft: (patch: Partial<WizardDraft>) => void;
  onCreate: () => void;
  pending: boolean;
}

export function NewProjectWizard({ open, onClose, step, onStepChange, setup, draft, onDraft, onCreate, pending }: NewProjectWizardProps) {
  const { t, lang } = useI18n();
  const id = useId();
  const tmpl = templateOf(setup, draft.template);
  const cats = draftCategories(setup, draft);
  const codes = setup.clientCodes;
  const { number: pid, analytic: ana } = draftIdentity(setup, draft);
  const total = wizardTotal(cats, draft.cont);
  const setCat = (i: number, patch: Partial<WizardCategory>) => onDraft({ cats: cats.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const setMachineType = (mt: string) => {
    const T = setup.templates.find((x) => x.mt === mt);
    // A blank start stays blank and keeps its categories; otherwise switch to that type's template (3956).
    if (draft.template === 'blank' || !T) onDraft({ mt });
    else onDraft({ mt, template: T.id, cats: catsOf(T) });
  };

  return (
    <WizardDialog
      open={open}
      onClose={onClose}
      title={t('New project')}
      steps={[t('Basics'), t('Structure'), t('Budget'), t('Schedule')]}
      step={step}
      onStepChange={onStepChange}
      onFinish={onCreate}
      pending={pending}
    >
      {step === 1 && (
        <div className={w.grid2}>
          <Field label={t('Project name')} span="full" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              value={draft.name}
              onChange={(e) => onDraft({ name: e.target.value })}
              placeholder={t('Eastbank Warehouse Automation')}
              maxLength={200}
            />
          </Field>
          <Field label={t('Project ID')}>
            <PseudoInput caret={false} className={w.readonly}>
              <span className={w.value}>{pid}</span>
              <span className={w.valueHint}>{t('#000 · auto-incremented')}</span>
            </PseudoInput>
          </Field>
          <Field label={t('Analytic code')}>
            <PseudoInput caret={false} className={w.readonly}>
              <span className={w.value}>{ana}</span>
              <span className={w.valueHintClip}>{t(analyticHint(draft.client.trim(), codes))}</span>
            </PseudoInput>
          </Field>
          <Field label={t('DAS')}>
            <Segmented
              fullWidth
              label={t('DAS')}
              value={draft.das}
              onChange={(das) => onDraft({ das })}
              options={DAS_LIST.map((v) => ({ value: v, label: `DAS ${v}` }))}
            />
          </Field>
          <Field label={t('Machine type')}>
            <Segmented
              fullWidth
              label={t('Machine type')}
              value={draft.mt}
              onChange={setMachineType}
              options={setup.machineTypes.map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <Field label={t('Project manager')}>
            <PseudoInput>
              <span className={w.avatar}>{t('SP')}</span>
              {t('S. Perrin')}
            </PseudoInput>
          </Field>
          <Field label={t('Client / sponsor')} htmlFor={`${id}-client`}>
            <Input
              id={`${id}-client`}
              value={draft.client}
              onChange={(e) => onDraft({ client: e.target.value })}
              placeholder={t('Logistics business unit')}
              maxLength={200}
            />
          </Field>
          <Field label={t('Currency')}>
            <Segmented
              fullWidth
              label={t('Currency')}
              value={draft.cur}
              onChange={(cur) => onDraft({ cur })}
              options={WIZARD_CURRENCIES.map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <Field label={t('Planned start')}>
            <PseudoInput icon={CalendarBlank}>{t('11 Jan 2027')}</PseudoInput>
          </Field>
          <Field label={t('Planned finish')}>
            <PseudoInput icon={CalendarBlank}>{t('30 Sep 2027')}</PseudoInput>
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className={w.col}>
          <span className={w.startFrom}>{t('Start from')}</span>
          <div className={w.templates}>
            {setup.templates
              .filter((x) => x.id === 'blank' || x.mt === draft.mt)
              .map((x) => (
                <ChoiceCard
                  key={x.id}
                  selected={draft.template === x.id}
                  title={t(x.name)}
                  description={t(x.desc)}
                  onSelect={() => onDraft({ template: x.id, cats: catsOf(x) })}
                />
              ))}
          </div>
          <div className={w.copy}>
            {[
              { label: 'WBS', value: t(tmpl.wbs) },
              { label: 'Activities & logic', value: t(tmpl.acts) },
              { label: 'Cost categories', value: categoriesText(t, lang, tmpl.cats.length) },
              { label: 'Calendars', value: t(tmpl.cal) },
              { label: 'Baselines', value: t('Not copied'), muted: true },
            ].map((c) => (
              <div key={c.label} className={w.copyItem}>
                <span className={w.eyebrow}>{t(c.label)}</span>
                <span className={c.muted ? `${w.copyValue} ${w.copyValueMuted}` : w.copyValue}>{c.value}</span>
              </div>
            ))}
          </div>
          {tmpl.phases.length > 0 && (
            <div className={w.phases}>
              <span className={w.eyebrow}>{t('Standard phases — WBS level 1')}</span>
              <div className={w.phaseTags}>
                {tmpl.phases.map((ph, i) => (
                  <Tag key={i} tone="neutral" className={w.phaseTag}>
                    {i + 1} · {t(ph)}
                  </Tag>
                ))}
              </div>
              <span className={w.phaseNote}>{t('The budget breakdown in the next step follows the same machine type.')}</span>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className={w.col}>
          <div className={w.catHead}>
            <span className={w.catTitle}>{t('Cost categories for this project')}</span>
            <span className={w.catSource}>{t(categorySource({ blank: tmpl.id === 'blank', name: tmpl.name }))}</span>
          </div>
          <div className={w.cats}>
            <span className={w.eyebrow}>{t('Category')}</span>
            <span className={w.eyebrow}>{t('Type')}</span>
            <span className={`${w.eyebrow} ${w.right}`}>{t('Budget (k)')}</span>
            <span />
            {cats.map((c, i) => (
              <CategoryRow key={i} cat={c} onChange={(patch) => setCat(i, patch)} onRemove={() => onDraft({ cats: cats.filter((_, j) => j !== i) })} />
            ))}
          </div>
          <div className={w.catFoot}>
            <Button variant="ghost" icon={Plus} className={w.btn13} onClick={() => onDraft({ cats: [...cats, { ...NEW_CATEGORY, name: t(NEW_CATEGORY.name) }] })}>
              {t('Add category')}
            </Button>
            <div className={w.contingency}>
              <span className={w.muted}>{t('Contingency')}</span>
              <Segmented
                label={t('Contingency')}
                value={String(draft.cont)}
                onChange={(v) => onDraft({ cont: Number(v) })}
                options={CONTINGENCIES.map((v) => ({ value: String(v), label: `${v}%` }))}
              />
            </div>
            <div className={w.total}>
              <span className={w.eyebrow}>{t('Total budget')}</span>
              <span className={w.totalValue}>{wizardTotalText(total, draft.cur)}</span>
            </div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className={w.grid2}>
          <Field label={t('Default calendar')} span="full">
            <Segmented
              fullWidth
              label={t('Default calendar')}
              value={draft.cal}
              onChange={(cal) => onDraft({ cal })}
              options={WIZARD_CALENDARS.map((v) => ({ value: v, label: t(v) }))}
            />
          </Field>
          <Field label={t('Progress cycle (data date)')}>
            <PseudoInput icon={Clock}>{t('Weekly · Fridays')}</PseudoInput>
          </Field>
          <Field label={t('Baseline policy')}>
            <PseudoInput icon={FlagBanner}>{t('Set BL1 at Planning → Active')}</PseudoInput>
          </Field>
          <Field label={t('Working time')}>
            <PseudoInput>08:00 – 17:00</PseudoInput>
          </Field>
          <Field label={t('Holidays')}>
            <PseudoInput>{t('US federal + site shutdown 24 Dec – 2 Jan')}</PseudoInput>
          </Field>
          <div className={w.summary}>
            <span className={w.eyebrow}>{t('Will be created')}</span>
            <span className={w.summaryText}>
              {wizardSummaryText(t, lang, {
                projectId: pid,
                analytic: ana,
                das: draft.das,
                machineType: draft.mt,
                name: draft.name,
                template: { blank: tmpl.id === 'blank', wbs: tmpl.wbs, acts: tmpl.acts },
                categories: cats.length,
                contingencyPct: draft.cont,
                calendar: draft.cal,
              })}
            </span>
          </div>
        </div>
      )}
    </WizardDialog>
  );
}

function CategoryRow({ cat, onChange, onRemove }: { cat: WizardCategory; onChange: (patch: Partial<WizardCategory>) => void; onRemove: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <Input className={w.catInput} value={cat.name} onChange={(e) => onChange({ name: e.target.value })} aria-label={t('Category')} maxLength={200} />
      <PseudoInput className={w.catType}>{t(cat.type)}</PseudoInput>
      <Input className={w.catInput} alignRight value={cat.budget} onChange={(e) => onChange({ budget: e.target.value })} aria-label={t('Budget (k)')} inputMode="decimal" />
      <IconButton icon={X} label={t('Remove')} variant="ghost" size={32} muted onClick={onRemove} />
    </>
  );
}
