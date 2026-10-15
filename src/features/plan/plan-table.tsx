'use client';
// Structure and Progress tables of the Plan screen (template 1045–1104): WBS tree with collapsible work
// packages, inline edits (Server Functions), row actions and row selection (`?act=` opens the drawer).
import {
  ArrowDown, ArrowUp, CaretDown, CaretRight, Check, CheckSquare, Lightning, Plus, Trash,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Avatar } from '@/components/app/Badges';
import { ProgressBar } from '@/components/app/Progress';
import { LO } from '@/components/app/tones';
import { Button, IconButton } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Input, Select } from '@/components/ds/Field';
import { useToast } from '@/components/ds/Toast';
import type { BarTone } from '@/domain/schedule';
import { useI18n } from '@/i18n/client';
import { editActivity, moveActivity, removeRow, renamePackage, restoreRow, type ActivityField, type PlanActionResult } from './actions';
import { COLLAPSE_COOKIE, serializeCollapsed } from './collapse';
import { planT, removeQuestion } from './i18n';
import type { PlanRowView, PlanView } from './model';
import { CURRENT_OWNER, ownerSelectOptions } from './owner-select';
import { openPlanForm } from './plan-forms';
import s from './plan.module.css';

const BAR: Record<BarTone, string> = { done: 'var(--color-neutral-500)', behind: LO, normal: 'var(--color-accent)' };
const stop = (e: MouseEvent) => e.stopPropagation();

export interface PlanTableProps {
  view: PlanView;
  code: string;
  rows: PlanRowView[];
  /** Collapse map from the cookie (default 1.1–1.3 collapsed). */
  collapsed: Record<string, boolean>;
  /** Highlighted activity (`sel`). */
  selected: string | null;
  /** Structure edits allowed (P-9a: the project's PMs and the director — not outside, on the team, not the client). */
  canEdit: boolean;
  /** Activities whose % complete the viewer enters as their owner without the structure rights (P-9a). */
  progressIds?: readonly string[];
  /** Removal with undo (S-5): the director or the project's manager, on top of the edit rights. */
  canRemove?: boolean;
  /** Owner select options (OWN: value = key, label = full name). */
  owners: { value: string; label: string }[];
  /** Row links: `${base}?${query}act=A1250` (`query` keeps the view, e.g. "view=structure&"). */
  hrefOf: { base: string; query: string };
}

type RemoveTarget = { kind: 'wp' | 'act'; id: string; label: string; count: number };

const writeCollapseCookie = (map: Record<string, boolean>) => {
  document.cookie = `${COLLAPSE_COOKIE}=${serializeCollapsed(map)}; path=/; max-age=31536000; samesite=lax`;
};

export function PlanTable(props: PlanTableProps) {
  const [collapsed, setCollapsed] = useState(props.collapsed);
  // The server map changes on navigation (cookie + the deep-linked activity's work package expanded, `openPlan`):
  // adopt it, and persist it so the expansion survives closing the drawer (prototype: collapsed[w] = false).
  const serverMap = serializeCollapsed(props.collapsed);
  const [prevServerMap, setPrevServerMap] = useState(serverMap);
  if (serverMap !== prevServerMap) {
    setPrevServerMap(serverMap);
    setCollapsed(props.collapsed);
  }
  useEffect(() => writeCollapseCookie(JSON.parse(decodeURIComponent(serverMap))), [serverMap]);
  const [removing, setRemoving] = useState<RemoveTarget | null>(null);
  const toggle = (w: string) => (e: MouseEvent) => {
    e.stopPropagation();
    const next = { ...collapsed, [w]: !collapsed[w] };
    setCollapsed(next);
    writeCollapseCookie(next);
  };
  const rows = props.rows.filter((r) => r.kind !== 'act' || !collapsed[r.wbs]);
  const href = (id: string) => `${props.hrefOf.base}?${props.hrefOf.query}act=${encodeURIComponent(id)}`;
  const askRemove = (r: PlanRowView) =>
    setRemoving({ kind: r.kind === 'wp' ? 'wp' : 'act', id: r.id, label: `${r.id} · ${r.name}`, count: r.kind === 'wp' ? props.rows.filter((x) => x.kind === 'act' && x.wbs === r.id).length : 0 });
  const table =
    props.view === 'structure' ? (
      <StructureTable {...props} rows={rows} collapsed={collapsed} toggle={toggle} href={href} askRemove={askRemove} />
    ) : (
      <ProgressTable {...props} rows={rows} collapsed={collapsed} toggle={toggle} href={href} askRemove={askRemove} />
    );
  return (
    <>
      {table}
      {props.canEdit && props.canRemove && <ConfirmRemove code={props.code} target={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}

interface TableProps extends PlanTableProps {
  toggle: (w: string) => (e: MouseEvent) => void;
  href: (id: string) => string;
  askRemove: (r: PlanRowView) => void;
}

/** Runs a Server Function in a transition; errors become a toast. */
function useAction() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const run = (fn: () => Promise<PlanActionResult>) =>
    start(async () => {
      const r = await fn();
      if ('error' in r) toast.show(r.error);
    });
  return { pending, run };
}

// ── Removal confirmation (docs/spec/05 OQ 8: the prototype removes without asking; edits are now persisted) ──
// S-5: the confirmation stays; the removal goes to the Plan trash and the toast offers "Undo" (also under "Recently deleted").

function ConfirmRemove({ code, target, onClose }: { code: string; target: RemoveTarget | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [pending, start] = useTransition();
  const undo = (trashId: string) =>
    start(async () => {
      const r = await restoreRow(code, trashId);
      toast.show('error' in r ? r.error : r.toast);
    });
  const confirm = () => {
    if (!target) return;
    start(async () => {
      const r = await removeRow(code, target.kind, target.id);
      if ('error' in r) toast.show(r.error);
      else toast.show(r.toast, { action: { label: t('Undo'), onClick: () => undo(r.trashId) } });
      onClose();
    });
  };
  return (
    <Dialog open={!!target} onClose={onClose} title={t('Remove')} width={440}>
      {target && <p className={s.confirmText}>{removeQuestion(target.kind, target.label, target.count, lang)}</p>}
      <DialogActions>
        <Button variant="secondary" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" icon={Trash} onClick={confirm} disabled={pending} aria-busy={pending || undefined}>
          {t('Remove')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Editable cells ─────────────────────────────────────────────────────────────────────────────────────

interface EditableProps {
  value: string;
  save: (v: string) => Promise<PlanActionResult>;
  type?: 'text' | 'number';
  /** Commit after this idle time while typing (number inputs, spinner clicks); text commits on blur / Enter. */
  debounceMs?: number;
  /** Errors are shown on the input (accent ring + title) instead of a toast (predecessors). */
  inlineError?: boolean;
  className?: string;
  alignRight?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  label: string;
}

/** `.input` cell that keeps a local draft and commits it through a Server Function. */
function EditableInput({ value, save, type = 'text', debounceMs, inlineError, className, alignRight, placeholder, min, max, step, label }: EditableProps) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusedRef = useRef(false);
  /** Last value sent, and the normalised value the server answered with (e.g. "150" → "100"). */
  const lastSent = useRef<string | null>(null);
  const normalized = useRef<string | null>(null);
  const toast = useToast();
  const [, start] = useTransition();
  if (value !== prev) {
    // Server value changed (after a commit or someone else's edit): adopt it unless the user is typing.
    setPrev(value);
    if (!focused) setDraft(value);
  }
  const send = (v: string) => {
    clearTimeout(timer.current);
    if (v === value && lastSent.current === null) return;
    if (v === lastSent.current) {
      if (!focusedRef.current && normalized.current != null) setDraft(normalized.current);
      return;
    }
    lastSent.current = v;
    start(async () => {
      const r = await save(v);
      if ('error' in r) {
        lastSent.current = null;
        normalized.current = null;
        if (inlineError) setError(r.error);
        else {
          toast.show(r.error);
          setDraft(value);
        }
        return;
      }
      setError(null);
      normalized.current = r.value ?? null;
      if (!focusedRef.current && r.value != null) setDraft(r.value);
    });
  };
  return (
    <Input
      size="cell"
      type={type}
      min={min}
      max={max}
      step={step}
      alignRight={alignRight}
      className={cx(className, error && s.invalid)}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      title={error ?? undefined}
      onClick={stop}
      onFocus={() => {
        focusedRef.current = true;
        setFocused(true);
      }}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (error) setError(null);
        if (debounceMs) {
          clearTimeout(timer.current);
          timer.current = setTimeout(() => send(v), debounceMs);
        }
      }}
      onBlur={() => {
        focusedRef.current = false;
        setFocused(false);
        send(draft);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') send(draft);
        if (e.key === 'Escape') {
          clearTimeout(timer.current);
          setDraft(value);
          setError(null);
        }
      }}
    />
  );
}

function OwnerSelect({ value, options, save, label }: { value: string; options: { value: string; label: string }[]; save: (v: string) => Promise<PlanActionResult>; label: string }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  const { run } = useAction();
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <Select
      size="cell"
      value={draft}
      aria-label={label}
      onClick={stop}
      options={options}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (v !== CURRENT_OWNER) run(() => save(v));
      }}
    />
  );
}

// ── Shared cells ───────────────────────────────────────────────────────────────────────────────────────

function NameCell({ r, collapsed, toggle, children }: { r: PlanRowView; collapsed: Record<string, boolean>; toggle: TableProps['toggle']; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div role="cell" className={s.nameCell} style={{ '--indent': `${r.indent}px` } as CSSProperties}>
      {r.kind === 'wp' && (
        <button type="button" className={s.caret} onClick={toggle(r.wbs)} aria-expanded={!collapsed[r.wbs]} aria-label={t(collapsed[r.wbs] ? 'Expand' : 'Collapse')}>
          {collapsed[r.wbs] ? <CaretRight /> : <CaretDown />}
        </button>
      )}
      {children}
    </div>
  );
}

// ── Structure view (1045–1070) ─────────────────────────────────────────────────────────────────────────

function StructureTable({ rows, code, selected, canEdit, canRemove, owners, collapsed, toggle, href, askRemove }: TableProps) {
  const { t } = useI18n();
  const { run } = useAction();
  const edit = (id: string, field: ActivityField) => (v: string) => editActivity(code, id, field, v);
  return (
    <div className={s.structure} role="table" aria-label={t('Work breakdown structure')}>
      <div className={cx(s.sGrid, s.head)} role="row">
        <span role="columnheader">{t('ID')}</span>
        <span role="columnheader">{t('Activity')}</span>
        <span role="columnheader">{t('Owner')}</span>
        <span role="columnheader">{t('Dur')}</span>
        <span role="columnheader">{t('Budget k€')}</span>
        <span role="columnheader">{t('Predecessors')}</span>
        <span role="columnheader">{t('Constraint')}</span>
        <span role="columnheader" className={s.right}>
          {t('Actions')}
        </span>
      </div>
      {rows.map((r) => {
        const act = r.kind === 'act';
        const sum = r.kind === 'wp';
        return (
          <div key={r.kind + r.id} role="row" className={cx(s.sGrid, s.row, selected === r.id && s.selected)}>
            <span role="cell" className={s.idCell}>
              {act ? (
                <Link href={href(r.id)} scroll={false} className={s.idLink}>
                  {r.id}
                  {r.mark && <span className={s.mark} />}
                </Link>
              ) : (
                <span className={s.idPlain}>
                  {r.id}
                  {r.mark && <span className={s.mark} />}
                </span>
              )}
            </span>
            <NameCell r={r} collapsed={collapsed} toggle={toggle}>
              {r.kind === 'root' || !canEdit ? (
                <span className={cx(s.ellipsis, act ? s.w400 : s.w500)}>{r.name}</span>
              ) : (
                <EditableInput
                  value={r.nameValue}
                  label={t(sum ? 'Work package' : 'Activity')}
                  className={sum ? s.w500 : undefined}
                  save={sum ? (v) => renamePackage(code, r.id, v) : edit(r.id, 'name')}
                />
              )}
            </NameCell>
            <span role="cell" className={s.flexCell}>
              {act &&
                (canEdit ? (
                  <OwnerSelect {...ownerSelectOptions(r, owners)} label={t('Owner')} save={edit(r.id, 'owner')} />
                ) : (
                  <span className={s.readText}>{r.ownerName}</span>
                ))}
            </span>
            <span role="cell" className={s.numCell}>
              {act && (canEdit ? <EditableInput type="number" min={1} value={r.durValue} label={t('Dur')} debounceMs={700} save={edit(r.id, 'dur')} /> : r.durLabel)}
              {sum && r.dur}
            </span>
            <span role="cell" className={s.budgetCell}>
              {act && canEdit ? <EditableInput type="number" min={0} value={r.budget} label={t('Budget k€')} debounceMs={700} save={edit(r.id, 'budget')} /> : r.budget}
            </span>
            <span role="cell" className={s.flexCell}>
              {act &&
                (canEdit ? (
                  <EditableInput value={r.predsValue} label={t('Predecessors')} placeholder="—" inlineError save={edit(r.id, 'preds')} />
                ) : (
                  <span className={s.readText}>{r.predsLabel}</span>
                ))}
            </span>
            <span role="cell" className={cx(s.consCell, r.consLo && s.lo)}>{r.cons}</span>
            <span role="cell" className={s.actions}>
              {canEdit && sum && (
                <IconButton icon={Plus} size={24} muted label={t('Add activity')} onClick={() => openPlanForm('plan', { wp: r.wpOption ?? r.id })} />
              )}
              {canEdit && act && (
                <>
                  <IconButton icon={ArrowUp} size={24} muted label={t('Move up')} onClick={() => run(() => moveActivity(code, r.id, -1))} />
                  <IconButton icon={ArrowDown} size={24} muted label={t('Move down')} onClick={() => run(() => moveActivity(code, r.id, 1))} />
                </>
              )}
              {canEdit && canRemove && r.kind !== 'root' && <IconButton icon={Trash} size={24} muted label={t('Remove')} onClick={() => askRemove(r)} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Progress view (1071–1104) ──────────────────────────────────────────────────────────────────────────

function ProgressTable({ rows, code, selected, canEdit: canEditAll, progressIds, collapsed, toggle, href }: TableProps) {
  const { t: baseT, lang } = useI18n();
  const t = planT(baseT, lang);
  const router = useRouter();
  const { run } = useAction();
  return (
    <div className={s.progress} role="table" aria-label={t('Progress update')}>
      <div className={cx(s.pGrid, s.head)} role="row">
        <span role="columnheader">{t('ID')}</span>
        <span role="columnheader">{t('Activity')}</span>
        <span role="columnheader">{t('Start')}</span>
        <span role="columnheader">{t('Finish')}</span>
        <span role="columnheader">{t('BL finish')}</span>
        <span role="columnheader">{t('Var')}</span>
        <span role="columnheader">{t('Progress')}</span>
        <span role="columnheader">{t('TF')}</span>
        <span role="columnheader">{t('Status')}</span>
        <span role="columnheader">{t('Owner')}</span>
        <span role="columnheader">{t('To-dos')}</span>
      </div>
      {rows.map((r) => {
        const act = r.kind === 'act';
        const canEdit = canEditAll || (act && !!progressIds?.includes(r.id));
        return (
          <div
            key={r.kind + r.id}
            role="row"
            className={cx(s.pGrid, s.row, s.clickRow, selected === r.id && s.selected)}
            onClick={act ? () => router.push(href(r.id), { scroll: false }) : undefined}
          >
            <span role="cell" className={s.idCell}>
              {act ? (
                <Link href={href(r.id)} scroll={false} className={s.idLink} onClick={stop}>
                  {r.id}
                </Link>
              ) : (
                r.id
              )}
            </span>
            <NameCell r={r} collapsed={collapsed} toggle={toggle}>
              <span className={cx(s.ellipsis, act ? s.w400 : s.w500)}>{r.name}</span>
              {r.critical && <Lightning className={s.lightning} aria-label={t('Behind')} />}
            </NameCell>
            <span role="cell" className={s.tab}>{r.start}</span>
            <span role="cell" className={s.tab}>{r.finish}</span>
            <span role="cell" className={cx(s.tab, s.muted)}>{r.bl}</span>
            <span role="cell" className={cx(s.varCell, r.varLo && s.lo)}>{r.variance}</span>
            <span role="cell" className={s.progCell}>
              <ProgressBar value={r.pct / 100} color={BAR[r.bar]} ariaLabel={t('Progress')} />
              {act && canEdit && (
                <EditableInput
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  alignRight
                  className={s.pctInput}
                  value={String(r.pct)}
                  label={t('Progress')}
                  debounceMs={600}
                  save={(v) => editActivity(code, r.id, 'pct', v)}
                />
              )}
              {(r.kind === 'wp' || (act && !canEdit)) && <span className={s.pctText}>{r.pct}%</span>}
              {act && canEdit && (
                <IconButton
                  icon={Check}
                  size={24}
                  muted
                  label={t('Mark complete')}
                  onClick={(e) => {
                    e.stopPropagation();
                    run(() => editActivity(code, r.id, 'pct', '100'));
                  }}
                />
              )}
            </span>
            <span role="cell" className={cx(s.tfCell, r.tfLo && s.lo)}>{r.tf}</span>
            <span role="cell">
              <span className={cx(r.statusClass, s.status)}>{r.statusText}</span>
            </span>
            <span role="cell" className={s.ownerCell}>{act && r.owner && <Avatar initials={r.owner} title={r.ownerName} size={24} fontSize={10} />}</span>
            <span role="cell" className={s.todoCell}>
              {r.todos && (
                <>
                  <CheckSquare className={s.todoIcon} aria-hidden />
                  {r.todos}
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
