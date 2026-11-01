'use client';
// R-203 (K-203): the grid of a dashboard. The widgets' bodies are rendered on the server with the viewer's rights and passed in
// as nodes; this component lays them out (a responsive grid: small = one column, medium = two, wide = the whole row) and, for
// the owner, edits the layout: add a widget from the catalogue, change its filters, resize, remove, and reorder — with
// "Move earlier" / "Move later" buttons (the keyboard way, R-183) or by dragging a widget onto another (optional, mouse).
// Every change sends the whole new layout to `saveDashboardAction`, which validates it (zod + the role's widgets) again.
import { ArrowDown, ArrowUp, DotsSixVertical, PencilSimple, Plus, SquaresFour, Trash, X } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useId, useRef, useState, useTransition, type DragEvent, type ReactNode } from 'react';
import { EmptyState } from '@/components/app/EmptyState';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Select } from '@/components/ds/Field';
import { useToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import {
  DASHBOARD_MAX_WIDGETS, LIST_LIMIT_MAX, PERIODS, PERIOD_LABEL, SCOPES, SCOPE_LABEL, SIZE_LABEL, WIDGET_KIND_DEF, WIDGET_SIZES, addWidget, defaultWidget,
  moveWidget, moveWidgetTo, removeWidget, replaceWidget, resizeWidget, type DashboardLayout, type Widget, type WidgetDraft, type WidgetKind, type WidgetSize,
} from '@/domain/dashboards';
import { useI18n } from '@/i18n/client';
import { dataText } from '@/i18n/data-text';
import type { RoleKey } from '@/config/screens';
import { saveDashboardAction } from './actions';
import s from './dashboards.module.css';

export interface GridItem {
  widget: Widget;
  /** Already translated (label · project). */
  title: string;
  body: ReactNode;
}

export interface WidgetCatalogue {
  role: RoleKey;
  kinds: WidgetKind[];
  /** Metrics the role may see, per KPI kind (EN labels). */
  metrics: Partial<Record<'portfolio-kpi' | 'my-kpi' | 'project-kpi', { value: string; label: string }[]>>;
  /** Projects the viewer can read (label = typed name). */
  projects: { code: string; label: string }[];
  /** Current project (the default of a new project widget). */
  project: string | null;
  /** Portfolio zones (Settings labels, as the zone bar). */
  zones: { value: string; label: string }[];
}

export function DashboardGrid({ dashboardId, layout, items, editable, catalogue }: {
  dashboardId: string;
  layout: DashboardLayout;
  items: GridItem[];
  editable: boolean;
  catalogue: WidgetCatalogue | null;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ mode: 'add' } | { mode: 'edit'; widget: Widget } | null>(null);
  const [pending, start] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const focusAfter = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLParagraphElement>(null);

  // R-183: after a move or a removal re-renders the grid, the focus goes back to the same control of the moved widget (or to
  // the grid's "Add a widget" button when the widget is gone) instead of the top of the page.
  useEffect(() => {
    const sel = focusAfter.current;
    if (!sel || !root.current) return;
    focusAfter.current = null;
    const el = root.current.querySelector<HTMLElement>(sel) ?? root.current.querySelector<HTMLElement>('[data-control="add"]');
    el?.focus();
  }, [items]);

  const save = (next: DashboardLayout, focus: string | null, announce?: string) =>
    start(async () => {
      try {
        const r = await saveDashboardAction({ id: dashboardId, layout: next });
        if (!r.ok) {
          toast.showEn(r.error);
          return;
        }
        focusAfter.current = focus;
        if (announce && status.current) status.current.textContent = announce;
      } catch {
        toast.showEn('The dashboard could not be saved');
      }
    });

  const sel = (id: string, control: string) => `[data-widget="${id}"] [data-control="${control}"]`;
  const move = (w: Widget, delta: number) => {
    const next = moveWidget(layout, w.id, delta);
    const at = next.widgets.findIndex((x) => x.id === w.id) + 1;
    // At an end, the button that was pressed disappears: the focus goes to the other one.
    const control = (delta < 0 && at === 1) || (delta > 0 && at === next.widgets.length) ? (delta < 0 ? 'later' : 'earlier') : delta < 0 ? 'earlier' : 'later';
    save(next, sel(w.id, control), `${t('Moved to place')} ${at} / ${next.widgets.length}`);
  };
  const remove = (w: Widget) => save(removeWidget(layout, w.id), '[data-control="add"]', t('Widget removed'));
  const resize = (w: Widget, size: WidgetSize) => save(resizeWidget(layout, w.id, size), sel(w.id, 'size'));

  const onDrop = (e: DragEvent, target: Widget) => {
    e.preventDefault();
    if (!dragId || dragId === target.id) return setDragId(null);
    const index = layout.widgets.findIndex((x) => x.id === target.id);
    setDragId(null);
    save(moveWidgetTo(layout, dragId, index), null);
  };

  const canEdit = editable && !!catalogue;
  const full = layout.widgets.length >= DASHBOARD_MAX_WIDGETS;
  return (
    <div className={s.gridWrap} ref={root}>
      {canEdit && (
        <div className={s.gridBar}>
          {editing && (
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setForm({ mode: 'add' })} disabled={pending || full} data-control="add" aria-haspopup="dialog">
              {t('Add a widget')}
            </Button>
          )}
          <Button variant={editing ? 'secondary' : 'primary'} size="sm" icon={editing ? X : SquaresFour} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
            {editing ? t('Done') : t('Edit the layout')}
          </Button>
          {editing && full && <span className={s.hint}>{t('This dashboard is full')}</span>}
        </div>
      )}
      <p className={s.srOnly} aria-live="polite" ref={status} />
      {!items.length ? (
        <EmptyState variant="boxed">{canEdit ? t('No widget yet — choose “Edit the layout”, then “Add a widget”') : t('No widget on this dashboard')}</EmptyState>
      ) : (
        <ul className={s.grid} aria-label={t('Widgets')} aria-busy={pending}>
          {items.map(({ widget: w, title, body }, i) => (
            <li
              key={w.id}
              data-widget={w.id}
              className={cx(s.cell, s[`size_${w.size}`], dragId === w.id && s.dragging)}
              draggable={editing && canEdit}
              onDragStart={(e) => {
                setDragId(w.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => editing && dragId && e.preventDefault()}
              onDrop={(e) => onDrop(e, w)}
            >
              <section className={cx('card', 'elev-sm', s.widget)} aria-labelledby={`${dashboardId}-${w.id}-title`}>
                <header className={s.widgetHead}>
                  {editing && <DotsSixVertical className={s.handle} aria-hidden />}
                  <h3 className={s.widgetTitle} id={`${dashboardId}-${w.id}-title`}>
                    {title}
                  </h3>
                </header>
                {editing && canEdit && (
                  <div className={s.controls} role="group" aria-label={`${t('Arrange')} · ${title}`}>
                    {i > 0 && (
                      <Button variant="ghost" size="compact" icon={ArrowUp} onClick={() => move(w, -1)} disabled={pending} data-control="earlier" aria-label={`${t('Move earlier')} · ${title}`}>
                        {t('Earlier')}
                      </Button>
                    )}
                    {i < items.length - 1 && (
                      <Button variant="ghost" size="compact" icon={ArrowDown} onClick={() => move(w, 1)} disabled={pending} data-control="later" aria-label={`${t('Move later')} · ${title}`}>
                        {t('Later')}
                      </Button>
                    )}
                    <Select
                      size="sm"
                      value={w.size}
                      onChange={(e) => resize(w, e.target.value as WidgetSize)}
                      disabled={pending}
                      data-control="size"
                      aria-label={`${t('Width')} · ${title}`}
                      options={WIDGET_SIZES.map((z) => ({ value: z, label: t(SIZE_LABEL[z]) }))}
                    />
                    <Button variant="ghost" size="compact" icon={PencilSimple} onClick={() => setForm({ mode: 'edit', widget: w })} disabled={pending} data-control="edit" aria-haspopup="dialog" aria-label={`${t('Filters')} · ${title}`}>
                      {t('Filters')}
                    </Button>
                    <Button variant="ghost" size="compact" icon={Trash} onClick={() => remove(w)} disabled={pending} data-control="remove" aria-label={`${t('Remove')} · ${title}`}>
                      {t('Remove')}
                    </Button>
                  </div>
                )}
                <div className={s.widgetBody}>{body}</div>
              </section>
            </li>
          ))}
        </ul>
      )}
      {canEdit && form && (
        <WidgetDialog
          catalogue={catalogue!}
          initial={form.mode === 'edit' ? form.widget : null}
          pending={pending}
          onClose={() => setForm(null)}
          onSubmit={(w) => {
            const next = 'id' in w ? replaceWidget(layout, w as Widget) : addWidget(layout, w);
            const id = 'id' in w ? (w as Widget).id : next.widgets.at(-1)?.id;
            setForm(null);
            save(next, id ? sel(id, 'edit') : null, form.mode === 'add' ? t('Widget added') : undefined);
          }}
        />
      )}
    </div>
  );
}

type Draft = Record<string, string | number | null>;

/** Add or edit a widget: its kind (add only), then the filters of that kind. */
function WidgetDialog({ catalogue, initial, pending, onClose, onSubmit }: {
  catalogue: WidgetCatalogue;
  initial: Widget | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (w: WidgetDraft | Widget) => void;
}) {
  const { t, lang } = useI18n();
  const ids = { kind: useId(), metric: useId(), project: useId(), scope: useId(), zone: useId(), period: useId(), limit: useId(), size: useId() };
  const firstProject = catalogue.projects.find((p) => p.code === catalogue.project)?.code ?? catalogue.projects[0]?.code ?? null;
  const fresh = (kind: WidgetKind): Draft => defaultWidget(kind, { role: catalogue.role, project: firstProject }) as unknown as Draft;
  const [draft, setDraft] = useState<Draft>(() => (initial ? ({ ...initial } as unknown as Draft) : fresh(catalogue.kinds[0])));
  const kind = draft.kind as WidgetKind;
  const def = WIDGET_KIND_DEF[kind];
  const set = (k: string, v: string | number | null) => setDraft((d) => ({ ...d, [k]: v }));
  const has = (k: string) => k in draft;
  const metrics = kind === 'portfolio-kpi' || kind === 'my-kpi' || kind === 'project-kpi' ? catalogue.metrics[kind] ?? [] : [];
  const blocked = pending || (def.project && !draft.project);
  return (
    <Dialog open onClose={onClose} title={initial ? t('Widget filters') : t('Add a widget')} subtitle={t(def.hint)} width={520} placement="center" maxHeight="88vh">
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) onSubmit(draft as unknown as Widget);
        }}
      >
        {!initial && (
          <Field label={t('Widget')} required htmlFor={ids.kind}>
            <Select id={ids.kind} value={kind} onChange={(e) => setDraft(fresh(e.target.value as WidgetKind))} autoFocus
              options={catalogue.kinds.map((k) => ({ value: k, label: t(WIDGET_KIND_DEF[k].label) }))} />
          </Field>
        )}
        {has('metric') && (
          <Field label={t('Indicator')} required htmlFor={ids.metric}>
            <Select id={ids.metric} value={String(draft.metric)} onChange={(e) => set('metric', e.target.value)} options={metrics.map((m) => ({ value: m.value, label: t(m.label) }))} />
          </Field>
        )}
        {has('project') && (
          <Field label={t('Project')} required={def.project} htmlFor={ids.project}>
            <Select id={ids.project} value={String(draft.project ?? '')} onChange={(e) => set('project', e.target.value || null)}
              options={[...(def.project ? [] : [{ value: '', label: t('All my projects') }]), ...catalogue.projects.map((p) => ({ value: p.code, label: dataText(p.label, lang) }))]} />
          </Field>
        )}
        {has('scope') && (
          <Field label={t('Projects')} htmlFor={ids.scope}>
            <Select id={ids.scope} value={String(draft.scope)} onChange={(e) => set('scope', e.target.value)} options={SCOPES.map((v) => ({ value: v, label: t(SCOPE_LABEL[v]) }))} />
          </Field>
        )}
        {has('zone') && (
          <Field label={t('Zone')} htmlFor={ids.zone}>
            <Select id={ids.zone} value={String(draft.zone ?? '')} onChange={(e) => set('zone', e.target.value || null)}
              options={[{ value: '', label: t('All zones') }, ...catalogue.zones.map((z) => ({ value: z.value, label: dataText(z.label, lang) }))]} />
          </Field>
        )}
        {has('period') && (
          <Field label={t('Period')} htmlFor={ids.period}>
            <Select id={ids.period} value={String(draft.period)} onChange={(e) => set('period', e.target.value)} options={PERIODS.map((v) => ({ value: v, label: t(PERIOD_LABEL[v]) }))} />
          </Field>
        )}
        {has('limit') && (
          <Field label={t('Rows shown')} htmlFor={ids.limit}>
            <Select id={ids.limit} value={String(draft.limit)} onChange={(e) => set('limit', Number(e.target.value))}
              options={[3, 5, 8, 10, 15, LIST_LIMIT_MAX].map((n) => ({ value: String(n), label: String(n) }))} />
          </Field>
        )}
        <Field label={t('Width')} htmlFor={ids.size}>
          <Select id={ids.size} value={String(draft.size)} onChange={(e) => set('size', e.target.value)} options={WIDGET_SIZES.map((z) => ({ value: z, label: t(SIZE_LABEL[z]) }))} />
        </Field>
        {def.project && !catalogue.projects.length && <p className={s.hint}>{t('No project with data to choose from')}</p>}
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={blocked}>
            {initial ? t('Apply') : t('Add')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
