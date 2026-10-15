'use client';
// Editor of the selected machine type (docs/spec/09 §9.7–9.10, template 1535–1570): identity card (label, default
// calendar, description, Activate / Deactivate), payment pattern (deposit / delivery / acceptance, live total; a total
// other than 100 % is saved and flagged), standard phases, ITP systems, cost categories (reference budget, k€, live
// total), financial REX references and the projects of this type. Text fields are saved on blur (Enter in one-line
// fields), selects on change, list rows by sending the whole list. `mtCanEdit` (director, PM, engineering lead, quality
// = the screen's workspace): other viewers get read-only fields and no add / remove / toggle buttons (the prototype
// left the inputs and × buttons active, P-14).
import { ArrowRight, CheckCircle, Plus, X } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition, type KeyboardEvent } from 'react';
import { Button, ButtonLink, IconButton } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { showToast } from '@/components/ds/Toast';
import { NEW_COST_CATEGORY, NEW_ITP_SYSTEM, NEW_PHASE, parseBudgetInput, parsePercentInput, paymentTerms } from '@/domain/admin';
import { useI18n } from '@/i18n/client';
import { money } from '@/lib/format';
import type { CalendarCode, CostType } from '@/server/db/codes';
import {
  removeRexReferenceAction, setMachineTypeCostCategoriesAction, setMachineTypeItpSystemsAction, setMachineTypePhasesAction, updateMachineTypeAction,
  type AdminActionResult,
} from './actions';
import type { EditableText, MtDetailView } from './model';
import s from './admin.module.css';

/** Runs an action; refusals are toasted. Returns true on success. */
async function attempt(p: Promise<AdminActionResult>): Promise<boolean> {
  try {
    const r = await p;
    if ('error' in r) {
      showToast(r.error);
      return false;
    }
    if (r.toast) showToast(r.toast);
    return true;
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Local state reset whenever the server value changes (after a save or another viewer's change), without remounting. */
function useServerState<V>(server: V, key: string): [V, (v: V) => void] {
  const [state, setState] = useState(server);
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setState(server);
  }
  return [state, setState];
}

const enterBlurs = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.currentTarget.blur();
};

export function MachineTypeEditor({ mt, canEdit }: { mt: MtDetailView; canEdit: boolean }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const save = (p: () => Promise<AdminActionResult>, onFail?: () => void) =>
    start(async () => {
      if (!(await attempt(p())) && onFail) onFail();
    });
  return (
    <div className={s.mtRight} aria-busy={pending || undefined}>
      <Identity key={mt.code} mt={mt} canEdit={canEdit} save={save} />
      <div className={s.twoGrid}>
        <TextListCard
          key={`phases-${mt.code}`}
          title={t('Standard phases')}
          addLabel={t('Add phase')}
          numbered
          rows={mt.phases}
          canEdit={canEdit}
          onSave={(list, fail) => save(() => setMachineTypePhasesAction(mt.code, list), fail)}
          newItem={NEW_PHASE}
        />
        <TextListCard
          key={`itp-${mt.code}`}
          title={t('ITP systems')}
          addLabel={t('Add system')}
          rows={mt.itpSystems}
          canEdit={canEdit}
          onSave={(list, fail) => save(() => setMachineTypeItpSystemsAction(mt.code, list), fail)}
          newItem={NEW_ITP_SYSTEM}
          // E-9 'a' (R-057): the inspection plans of existing projects keep the systems they were created with.
          hint={t('Changes apply to projects created afterwards')}
        />
      </div>
      <CostCategories key={`cats-${mt.code}`} mt={mt} canEdit={canEdit} save={save} />
      <div className={s.twoGrid}>
        <div className={cx('card', 'elev-sm', s.sectionCard)}>
          <span className={s.sectionLabel}>{t('Financial REX · reference projects')}</span>
          {mt.refs.map((r) => (
            <div key={r.analyticCode} className={cx(s.refRow, !canEdit && s.refRowRo)}>
              <span className={s.pretty}>{r.name}</span>
              {canEdit && (
                <IconButton
                  icon={X}
                  label={`${t('Remove')} · ${r.name}`}
                  title={t('Remove')}
                  size={24}
                  className={s.rowRemove}
                  disabled={pending}
                  onClick={() => save(() => removeRexReferenceAction(mt.code, r.analyticCode))}
                />
              )}
            </div>
          ))}
          {!mt.refs.length && <span className={s.emptyNote}>{t('No reference project yet · the first closed project of this type will feed it')}</span>}
        </div>
        <div className={cx('card', 'elev-sm', s.sectionCard)}>
          <span className={s.sectionLabel}>{t('Projects using this type')}</span>
          {mt.projects.map((p) => (
            <div key={p.code} className={s.projRow}>
              <span className={s.projText}>
                <span>{p.name}</span>
                <span className={s.projSub}>{p.sub}</span>
              </span>
              {p.openHref && (
                <ButtonLink href={p.openHref} variant="ghost" size="xs" iconRight={ArrowRight}>
                  {t('Open project')}
                </ButtonLink>
              )}
            </div>
          ))}
          {!mt.projects.length && <span className={s.emptyNote}>{t('No project of this type yet')}</span>}
        </div>
      </div>
    </div>
  );
}

type Save = (p: () => Promise<AdminActionResult>, onFail?: () => void) => void;

function Identity({ mt, canEdit, save }: { mt: MtDetailView; canEdit: boolean; save: Save }) {
  const { t } = useI18n();
  const [label, setLabel] = useServerState(mt.label, mt.label);
  const [desc, setDesc] = useServerState(mt.description, mt.description);
  // The select shows the new calendar while it is saved (a controlled select bound to the server value would jump back).
  const [cal, setCal] = useServerState<CalendarCode>(mt.calendar, mt.calendar);
  const termsKey = `${mt.deposit}|${mt.delivery}|${mt.acceptance}`;
  const [pct, setPct] = useServerState({ dep: String(mt.deposit), deliv: String(mt.delivery), acc: String(mt.acceptance) }, termsKey);
  const terms = paymentTerms(parsePercentInput(pct.dep), parsePercentInput(pct.deliv), parsePercentInput(pct.acc));
  const id = (f: string) => `mt-${mt.code}-${f}`;
  const commitPct = (k: 'dep' | 'deliv' | 'acc', field: 'depositPct' | 'deliveryPct' | 'acceptancePct', server: number) => {
    if (!canEdit || (parsePercentInput(pct[k]) === server && pct[k].trim() === String(server))) return;
    save(() => updateMachineTypeAction(mt.code, { [field]: pct[k] }), () => setPct({ dep: String(mt.deposit), deliv: String(mt.delivery), acc: String(mt.acceptance) }));
  };
  return (
    <div className={cx('card', 'elev-sm', s.identityCard)}>
      <div className={s.identityHead}>
        <div className={cx('card-title', s.identityTitle)}>{`${mt.displayCode} · ${mt.label}`}</div>
        <span className="tag tag-neutral">{mt.stateText}</span>
        {canEdit && (
          <Button variant="secondary" size="xs" onClick={() => save(() => updateMachineTypeAction(mt.code, { active: !mt.active }))}>
            {mt.toggleLabel}
          </Button>
        )}
      </div>
      <div className={s.fieldGrid}>
        <div className="field">
          <label htmlFor={id('code')}>{t('Code')}</label>
          <input id={id('code')} className={cx('input', s.mtInput)} value={mt.displayCode} disabled />
        </div>
        <div className="field">
          <label htmlFor={id('label')}>{t('Label')}</label>
          <input
            id={id('label')}
            className={cx('input', s.mtInput)}
            value={label}
            readOnly={!canEdit}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={enterBlurs}
            onBlur={() => {
              if (canEdit && label !== mt.label) save(() => updateMachineTypeAction(mt.code, { label }), () => setLabel(mt.label));
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={id('cal')}>{t('Default calendar')}</label>
          <select
            id={id('cal')}
            className={cx('input', s.mtInput)}
            value={cal}
            disabled={!canEdit}
            onChange={(e) => {
              const next = e.target.value as CalendarCode;
              setCal(next);
              save(() => updateMachineTypeAction(mt.code, { calendar: next }), () => setCal(mt.calendar));
            }}
          >
            {mt.calendarOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className={cx('field', s.fullField)}>
          <label htmlFor={id('desc')}>{t('Description')}</label>
          <textarea
            id={id('desc')}
            className={cx('input', s.mtTextarea)}
            rows={2}
            value={desc}
            readOnly={!canEdit}
            maxLength={2000}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => {
              if (canEdit && desc !== mt.description) save(() => updateMachineTypeAction(mt.code, { description: desc }), () => setDesc(mt.description));
            }}
          />
        </div>
      </div>
      <div className={s.terms}>
        <span className={s.sectionLabel}>{t('Payment pattern (deposit / delivery / acceptance)')}</span>
        <div className={s.termsRow}>
          {(
            [
              ['dep', 'depositPct', 'Deposit %', mt.deposit],
              ['deliv', 'deliveryPct', 'Delivery %', mt.delivery],
              ['acc', 'acceptancePct', 'Acceptance %', mt.acceptance],
            ] as const
          ).map(([k, field, lbl, server]) => (
            <div key={k} className={cx('field', s.pctField)}>
              <label htmlFor={id(k)}>{t(lbl)}</label>
              <input
                id={id(k)}
                type="number"
                min={0}
                max={100}
                className={cx('input', s.mtInput)}
                value={pct[k]}
                readOnly={!canEdit}
                onChange={(e) => setPct({ ...pct, [k]: e.target.value })}
                onKeyDown={enterBlurs}
                onBlur={() => commitPct(k, field, server)}
              />
            </div>
          ))}
          <span className={s.termsTotal}>
            {t('Total')} {terms.text}
          </span>
          {terms.ok ? <CheckCircle className={s.termsOk} aria-hidden /> : <span className={s.termsBad}>{t('Shares must total 100 %')}</span>}
        </div>
      </div>
    </div>
  );
}

interface TextRow {
  /** Stored value (null for a row not saved yet). */
  stored: string | null;
  /** What the input showed when loaded (translated stored value). */
  shown: string;
  text: string;
}

const rowsOf = (list: EditableText[]): TextRow[] => list.map((x) => ({ stored: x.value, shown: x.display, text: x.display }));
/** Value written back: the stored text when the row was not edited (the input may show a translation). */
const sendValue = (r: TextRow) => (r.stored != null && r.text === r.shown ? r.stored : r.text);

function TextListCard({ title, addLabel, numbered, rows: server, canEdit, onSave, newItem, hint }: {
  title: string;
  addLabel: string;
  numbered?: boolean;
  rows: EditableText[];
  canEdit: boolean;
  onSave: (list: string[], fail: () => void) => void;
  newItem: string;
  /** Help line under the list (translated). */
  hint?: string;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useServerState(rowsOf(server), JSON.stringify(server));
  const reset = () => setRows(rowsOf(server));
  const commit = (next: TextRow[]) => onSave(next.map(sendValue), reset);
  return (
    <div className={cx('card', 'elev-sm', s.sectionCard)}>
      <div className={s.sectionHead}>
        <span className={s.sectionLabel}>{title}</span>
        {canEdit && (
          <Button variant="ghost" icon={Plus} className={s.addBtn} onClick={() => commit([...rows, { stored: null, shown: newItem, text: newItem }])}>
            {addLabel}
          </Button>
        )}
      </div>
      {rows.map((r, i) => (
        <div key={i} className={numbered ? s.phaseRow : s.itpRow}>
          {numbered && <span className={s.phaseNo}>{i + 1}</span>}
          <input
            className={cx('input', s.mtInput)}
            aria-label={`${title} ${i + 1}`}
            value={r.text}
            readOnly={!canEdit}
            maxLength={120}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            onKeyDown={enterBlurs}
            onBlur={() => {
              if (canEdit && r.text !== r.shown) commit(rows);
            }}
          />
          {canEdit && (
            <IconButton
              icon={X}
              label={`${t('Remove')} · ${r.text}`}
              title={t('Remove')}
              size={24}
              className={s.rowRemove}
              onClick={() => commit(rows.filter((_, j) => j !== i))}
            />
          )}
        </div>
      ))}
      {hint && <span className={s.emptyNote}>{hint}</span>}
    </div>
  );
}

interface CatRow {
  name: TextRow;
  type: CostType;
  budget: string;
}

function CostCategories({ mt, canEdit, save }: { mt: MtDetailView; canEdit: boolean; save: Save }) {
  const { t, lang } = useI18n();
  const init = (): CatRow[] => mt.costCategories.map((c) => ({ name: { stored: c.name.value, shown: c.name.display, text: c.name.display }, type: c.type, budget: c.budget }));
  const [rows, setRows] = useServerState(init(), JSON.stringify(mt.costCategories));
  const total = rows.reduce((sum, r) => sum + (parseBudgetInput(r.budget) ?? 0), 0);
  const commit = (next: CatRow[]) =>
    save(() => setMachineTypeCostCategoriesAction(mt.code, next.map((r) => ({ name: sendValue(r.name), type: r.type, budget: r.budget }))), () => setRows(init()));
  const set = (i: number, patch: Partial<CatRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const changed = (i: number) => {
    const r = rows[i];
    const c = mt.costCategories[i];
    return !c || r.name.text !== r.name.shown || r.budget.trim() !== c.budget;
  };
  return (
    <div className={cx('card', 'elev-sm', s.costCard)}>
      <div className={s.sectionHead}>
        <span className={s.sectionLabel}>{t('Cost categories (reference budget, k€)')}</span>
        {canEdit && (
          <Button
            variant="ghost"
            icon={Plus}
            className={s.addBtn}
            onClick={() => commit([...rows, { name: { stored: null, shown: NEW_COST_CATEGORY.name, text: NEW_COST_CATEGORY.name }, type: NEW_COST_CATEGORY.type, budget: String(NEW_COST_CATEGORY.budgetKeur) }])}
          >
            {t('Add category')}
          </Button>
        )}
      </div>
      <div className={cx(s.catGrid, s.catHead)} aria-hidden>
        <span>{t('Category')}</span>
        <span>{t('Type')}</span>
        <span className={s.right}>{t('Budget')}</span>
        <span />
      </div>
      {rows.map((r, i) => (
        <div key={i} className={cx(s.catGrid, s.catRow)}>
          <input
            className={cx('input', s.mtInput)}
            aria-label={`${t('Category')} ${i + 1}`}
            value={r.name.text}
            readOnly={!canEdit}
            maxLength={120}
            onChange={(e) => set(i, { name: { ...r.name, text: e.target.value } })}
            onKeyDown={enterBlurs}
            onBlur={() => {
              if (canEdit && changed(i)) commit(rows);
            }}
          />
          <select
            className={cx('input', s.mtInput)}
            aria-label={`${t('Type')} ${i + 1}`}
            value={r.type}
            disabled={!canEdit}
            onChange={(e) => {
              const next = rows.map((x, j) => (j === i ? { ...x, type: e.target.value as CostType } : x));
              setRows(next);
              commit(next);
            }}
          >
            {mt.costTypeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            className={cx('input', s.mtInput, s.right)}
            aria-label={`${t('Budget')} ${i + 1}`}
            value={r.budget}
            readOnly={!canEdit}
            onChange={(e) => set(i, { budget: e.target.value })}
            onKeyDown={enterBlurs}
            onBlur={() => {
              if (canEdit && changed(i)) commit(rows);
            }}
          />
          {canEdit ? (
            <IconButton icon={X} label={`${t('Remove')} · ${r.name.text}`} title={t('Remove')} size={24} className={s.rowRemove} onClick={() => commit(rows.filter((_, j) => j !== i))} />
          ) : (
            <span className={s.spacer24} />
          )}
        </div>
      ))}
      <div className={cx(s.catGrid, s.catTotal)}>
        <span>{t('Total')}</span>
        <span />
        <span className={cx(s.right, s.tabular)}>{money(total, lang)}</span>
        <span className={s.spacer24} />
      </div>
    </div>
  );
}
