'use client';
// New project wizard (docs/spec/01 §10, 03 §5.8; template 2972–3056, npVals 3946–3969): 4 steps — Basics,
// Structure, Budget, Schedule — over a draft kept by <NewProjectLauncher>.
// Chapter 4 (A-2 / L-3, src/domain/project-template.ts): name, client, planned start and the site (L-3b: city + a
// country of the countries table) are required — Next stays disabled until they are filled; the planned finish is
// optional (empty → taken from the instantiated plan) and validated as a window when given; the PM is chosen among the project managers (the viewer by default when
// they are one); planned start / finish are dates; the templates are the machine types of the Machine types screen and
// creation instantiates them (work packages, activities, FS links, cost categories, ITP plan); the type of a cost
// category is a real choice and "Add category" offers Settings › Cost categories; the calendar defaults to the machine
// type's, and its working time and holidays are the real ones.
import { CalendarBlank, Clock, FlagBanner, Plus, X } from '@phosphor-icons/react/dist/ssr';
import { useId } from 'react';
import { ChoiceCard } from '@/components/app/Check';
import { WizardDialog } from '@/components/app/Wizard';
import { Button, IconButton } from '@/components/ds/Button';
import { Field, Input, PseudoInput, Select } from '@/components/ds/Field';
import { Segmented } from '@/components/ds/Segmented';
import { Tag } from '@/components/ds/Tag';
import { BUILTIN_CALENDAR_BY_CODE } from '@/domain/calendar';
import {
  CATEGORY_TYPES, CONTINGENCIES, DAS_LIST, NEW_CATEGORY, WIZARD_CURRENCIES, allocateProjectIdentity, analyticHint, categorySource,
  wizardClientCode, wizardTotal, wizardTotalText, type ProjectIdentity, type WizardCurrency,
} from '@/domain/lifecycle';
import {
  DEFAULT_PLANNED_START, WIZARD_CALENDAR_OPTIONS, holidaysText, templateActivitiesText, templateWbsText, wizardSiteError, wizardWindowError,
  workingTimeText,
} from '@/domain/project-template';
import { useI18n } from '@/i18n/client';
import type { CalendarCode } from '@/server/db/codes';
import type { NewProjectSetup, WizardTemplate } from '@/server/dal/projects-register';
import { categoriesText, wizardSummaryText } from './i18n';
import { templateTextT, workingTimeT } from './wizard-i18n';
import w from './wizard.module.css';
import { dataText } from '@/i18n/data-text';

export interface WizardCategory {
  name: string;
  /** EN type label: Labor, Material, Subcontract, Fees, Equipment. */
  type: string;
  /** Free text, parsed with parseFloat (k). */
  budget: string;
}

/**
 * `state.np` without `open` / `step`. `cats: null` = the default template's categories (not loaded yet); `cal: null` =
 * the template's calendar; `pm: null` = the setup's default PM (the viewer when they are a project manager).
 */
export interface WizardDraft {
  name: string;
  client: string;
  das: string;
  mt: string;
  cur: WizardCurrency;
  template: string;
  cats: WizardCategory[] | null;
  cont: number;
  cal: CalendarCode | null;
  /** Person id of the project manager. */
  pm: string | null;
  /** Planned window, ISO dates; finish '' = taken from the instantiated plan (L-3b). */
  start: string;
  finish: string;
  /** Site (L-3b): city and country (EN name of the countries table). */
  city: string;
  country: string;
}

export const DEFAULT_DRAFT: WizardDraft = {
  name: '', client: '', das: '2', mt: 'EMP', cur: 'EUR', template: 'EMP', cats: null, cont: 5, cal: null, pm: null,
  start: DEFAULT_PLANNED_START, finish: '', city: '', country: '',
};

const BLANK: WizardTemplate = {
  id: 'blank', mt: null, name: 'Projet blank', desc: '', wbs: templateWbsText(0), acts: templateActivitiesText(0), cal: 'Standard 5d · 8h',
  calCode: 'standard_5x8', phases: [], cats: [], itpSystems: [],
};

/** Calendar of the draft: the one chosen, else the template's (when the wizard offers it), else Standard. */
export const draftCalendar = (setup: NewProjectSetup, d: WizardDraft): CalendarCode => {
  if (d.cal) return d.cal;
  const tpl = templateOf(setup, d.template).calCode;
  return WIZARD_CALENDAR_OPTIONS.some((o) => o.value === tpl) ? tpl : 'standard_5x8';
};

/** Project manager of the draft (person id). */
export const draftManager = (setup: NewProjectSetup, d: WizardDraft): string | null => d.pm ?? setup.defaultManagerId;

/** Step 1 is complete: name and client typed (L-3), planned start (and window) valid, site city and country chosen (L-3b). */
export const basicsComplete = (d: WizardDraft, countries?: readonly string[]) =>
  !!d.name.trim() && !!d.client.trim() && !wizardWindowError(d.start, d.finish) && !wizardSiteError(d.city, d.country, countries ?? (d.country ? [d.country] : []));

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
  const cal = draftCalendar(setup, draft);
  const calDef = BUILTIN_CALENDAR_BY_CODE[cal];
  const calLabel = WIZARD_CALENDAR_OPTIONS.find((o) => o.value === cal)?.label ?? cal;
  const pm = draftManager(setup, draft);
  const manager = setup.managers.find((m) => m.id === pm);
  const windowError = wizardWindowError(draft.start, draft.finish);
  const canAdvance = step !== 1 || basicsComplete(draft, setup.countries);
  // Typing a known city fills its country (CITY_COUNTRY); the country stays editable.
  const setCity = (city: string) => {
    const known = setup.cities.find((c) => c.name.toLowerCase() === city.trim().toLowerCase());
    onDraft(known && !draft.country ? { city, country: known.country } : { city });
  };
  // "Add category": the next Settings › Cost category not used yet (A-14), else "New category · Labor · 0".
  const nextSettingsCategory = setup.settingsCategories.find((c) => {
    const names = [c.name, dataText(c.name, lang)].map((n) => n.toLowerCase());
    return !cats.some((x) => names.includes(x.name.trim().toLowerCase()));
  });

  const setMachineType = (mt: string) => {
    const T = setup.templates.find((x) => x.mt === mt);
    // A blank start stays blank and keeps its categories; otherwise switch to that type's template (3956) and its calendar.
    if (draft.template === 'blank' || !T) onDraft({ mt });
    else onDraft({ mt, template: T.id, cats: catsOf(T), cal: null });
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
      canAdvance={canAdvance}
      pending={pending}
    >
      {step === 1 && (
        <div className={w.grid2}>
          <Field label={t('Project name')} span="full" htmlFor={`${id}-name`} required>
            <Input
              id={`${id}-name`}
              value={draft.name}
              onChange={(e) => onDraft({ name: e.target.value })}
              placeholder={t('Eastbank Warehouse Automation')}
              maxLength={200}
              required
              aria-required
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
          <Field label={t('Project manager')} htmlFor={`${id}-pm`}>
            <div className={w.pmRow}>
              {manager && <span className={w.avatar}>{manager.initials}</span>}
              <Select
                id={`${id}-pm`}
                className={w.pmSelect}
                value={pm ?? ''}
                onChange={(e) => onDraft({ pm: e.target.value || null })}
                options={setup.managers.map((m) => ({ value: m.id, label: m.short }))}
              />
            </div>
          </Field>
          <Field label={t('Client / sponsor')} htmlFor={`${id}-client`} required>
            <Input
              id={`${id}-client`}
              value={draft.client}
              onChange={(e) => onDraft({ client: e.target.value })}
              placeholder={t('Logistics business unit')}
              maxLength={200}
              required
              aria-required
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
          <Field label={t('Planned start')} htmlFor={`${id}-start`} required>
            <div className={w.dateRow}>
              <CalendarBlank className={w.dateIcon} aria-hidden />
              <Input id={`${id}-start`} type="date" value={draft.start} onChange={(e) => onDraft({ start: e.target.value })} required aria-required />
            </div>
          </Field>
          <Field
            label={t('Planned finish')}
            htmlFor={`${id}-finish`}
            hint={windowError && draft.start && draft.finish ? t(windowError) : t('Optional — taken from the plan when empty')}
          >
            <div className={w.dateRow}>
              <CalendarBlank className={w.dateIcon} aria-hidden />
              <Input
                id={`${id}-finish`}
                type="date"
                value={draft.finish}
                min={draft.start || undefined}
                onChange={(e) => onDraft({ finish: e.target.value })}
                aria-invalid={(!!windowError && !!draft.finish) || undefined}
              />
            </div>
          </Field>
          <Field label={t('Site city')} htmlFor={`${id}-city`} required>
            <Input
              id={`${id}-city`}
              value={draft.city}
              onChange={(e) => setCity(e.target.value)}
              list={`${id}-cities`}
              placeholder={t('Le Havre')}
              maxLength={120}
              required
              aria-required
            />
            <datalist id={`${id}-cities`}>
              {setup.cities.map((c) => (
                <option key={c.name} value={c.name}>
                  {t(c.country)}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label={t('Site country')} htmlFor={`${id}-country`} required>
            <Select
              id={`${id}-country`}
              value={draft.country}
              onChange={(e) => onDraft({ country: e.target.value })}
              required
              aria-required
              options={[{ value: '', label: t('Choose a country') }, ...setup.countries.map((c) => ({ value: c, label: t(c) }))]}
            />
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
                  title={dataText(x.name, lang)}
                  description={dataText(x.desc, lang)}
                  onSelect={() => onDraft({ template: x.id, cats: catsOf(x) })}
                />
              ))}
          </div>
          <div className={w.copy}>
            {[
              { label: 'WBS', value: templateTextT(tmpl.wbs, t, lang) },
              { label: 'Activities & logic', value: templateTextT(tmpl.acts, t, lang) },
              { label: 'Cost categories', value: categoriesText(t, lang, tmpl.cats.length) },
              { label: 'Calendars', value: t(tmpl.cal) },
              { label: 'Inspection plan', value: tmpl.itpSystems.length ? itpSystemsText(tmpl.itpSystems.length, lang) : t('Not created'), muted: !tmpl.itpSystems.length },
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
            <Button
              variant="ghost"
              icon={Plus}
              className={w.btn13}
              onClick={() =>
                onDraft({
                  cats: [...cats, nextSettingsCategory ? { name: dataText(nextSettingsCategory.name, lang), type: nextSettingsCategory.type, budget: '0' } : { ...NEW_CATEGORY, name: t(NEW_CATEGORY.name) }],
                })
              }
            >
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
              value={cal}
              onChange={(v) => onDraft({ cal: v })}
              options={WIZARD_CALENDAR_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
            />
          </Field>
          <Field label={t('Progress cycle (data date)')}>
            <PseudoInput icon={Clock} caret={false}>{t('Weekly · Fridays')}</PseudoInput>
          </Field>
          <Field label={t('Baseline policy')}>
            {/* R-054 (L-2 "a"): BL1 is frozen at the end of APD and ticks its deliverable (the prototype's "Planning → Active" was stale). */}
            <PseudoInput icon={FlagBanner} caret={false}>{t('BL1 frozen at the end of APD (ticks “Planning BL1 posé”)')}</PseudoInput>
          </Field>
          <Field label={t('Working time')}>
            <PseudoInput caret={false}>{calDef ? workingTimeT(workingTimeText(calDef), lang) : '—'}</PseudoInput>
          </Field>
          <Field label={t('Holidays')}>
            <PseudoInput caret={false}>{calDef ? t(holidaysText(calDef)) : '—'}</PseudoInput>
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
                calendar: calLabel,
              })}
            </span>
          </div>
        </div>
      )}
    </WizardDialog>
  );
}

/** "6 ITP systems" (FR « 6 systèmes ITP »). */
const itpSystemsText = (n: number, lang: string) =>
  lang === 'fr' ? `${n} ${n > 1 ? 'systèmes' : 'système'} ITP` : `${n} ITP ${n > 1 ? 'systems' : 'system'}`;

function CategoryRow({ cat, onChange, onRemove }: { cat: WizardCategory; onChange: (patch: Partial<WizardCategory>) => void; onRemove: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <Input className={w.catInput} value={cat.name} onChange={(e) => onChange({ name: e.target.value })} aria-label={t('Category')} maxLength={200} />
      <Select
        className={w.catType}
        value={cat.type}
        onChange={(e) => onChange({ type: e.target.value })}
        aria-label={t('Type')}
        options={CATEGORY_TYPES.map((v) => ({ value: v, label: t(v) }))}
      />
      <Input className={w.catInput} alignRight value={cat.budget} onChange={(e) => onChange({ budget: e.target.value })} aria-label={t('Budget (k)')} inputMode="decimal" />
      <IconButton icon={X} label={t('Remove')} variant="ghost" size={32} muted onClick={onRemove} />
    </>
  );
}
