'use client';
// Settings — personalisable lists body (docs/spec/10 §1.3–1.5, template 1573–1597): KPI tiles, "Project health rules"
// card (thresholds saved on blur / Enter, validated), and the seven list cards (remove ×, location type, "Add an entry"
// + Add). Every edit is persisted through src/features/admin/actions.ts; outside the workspace (member, client) the
// controls are hidden and the thresholds read-only. No toast on success, as in the prototype; refusals toast.
// "Rate cards" links to the Rate cards screen (the prototype styled it as a link without one, 10 OQ2).
// Chapter 4 (A-13, A-14): only the portfolio director edits (`canEdit`); the other roles of the workspace get a read-only
// note. "Remove" toasts whether the value was deleted or deactivated (still in use / a default). The health card states
// the one rule every screen applies.
import {
  CalendarX, Certificate, Coins, CurrencyEur, Files, Flag, Heartbeat, LockSimple, Plus, Warehouse, Warning, X,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, useTransition, type KeyboardEvent } from 'react';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { screenHref } from '@/config/screens';
import { Button, IconButton } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Segmented } from '@/components/ds/Segmented';
import { showToast } from '@/components/ds/Toast';
import type { SettingsIcon } from '@/domain/admin';
import { REQUIRED_STAGES } from '@/domain/settings-rules';
import { useI18n } from '@/i18n/client';
import type { LocationType } from '@/server/db/codes';
import { addSettingsEntryAction, removeSettingsEntryAction, setHealthThresholdAction, type AdminActionResult } from './actions';
import type { SettingsCardView, SettingsView } from './model';
import s from './admin.module.css';
import st from './settings-ch4.module.css';

/** A-13: the one health rule and where it applies (EN source; FR in src/i18n/extra/ch4-settings.json). */
const HEALTH_RULE_SCOPE = 'One rule everywhere: CPI clamped to 0.70–1.25, then the lower of CPI and SPI · Overview, Projects, My projects, world map';

const ICONS: Record<SettingsIcon, Icon> = {
  warehouse: Warehouse, certificate: Certificate, coins: Coins, flag: Flag, warning: Warning, files: Files, 'calendar-x': CalendarX,
};

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

export function SettingsBody({ view, canEdit, directorOnlyNote = false }: { view: SettingsView; canEdit: boolean; directorOnlyNote?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={s.root}>
      {directorOnlyNote && (
        <div className={st.note} role="note">
          <LockSimple className={s.accent} aria-hidden />
          {t('Read-only · Settings are edited by the portfolio director')}
        </div>
      )}
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} className={s.kpiPlainSub} />
        ))}
      </KpiGrid>
      <div className={cx('card', 'elev-sm', s.healthCard)}>
        <div className={s.healthHead}>
          <Heartbeat className={s.accent} aria-hidden />
          <div className={s.healthTitle}>
            <div className="card-title">{t('Project health rules')}</div>
            <span className={s.muted12}>{view.health.text}</span>
            <span className={st.rule}>{t(HEALTH_RULE_SCOPE)}</span>
          </div>
          <ThresholdField key={`risk-${view.health.riskText}`} which="risk" label={t('At risk below')} initial={view.health.riskText} canEdit={canEdit} />
          <ThresholdField key={`off-${view.health.offText}`} which="off" label={t('Off track below')} initial={view.health.offText} canEdit={canEdit} />
        </div>
        {/* Three flex items 8px apart, as the prototype's text nodes and span in its flex row (template 1581). */}
        <div className={s.rateNote}>
          <CurrencyEur className={s.accent} aria-hidden />
          {t('Labor rates and multipliers are edited on the')}
          <Link href={screenHref('rates')} className={s.rateCards}>
            {t('Rate cards')}
          </Link>
          {t('page (directors and PMs).')}
        </div>
      </div>
      <div className={s.cardGrid}>
        {view.cards.map((c) => (
          <ListCard key={c.key} card={c} locTypes={view.locTypes} canEdit={canEdit} />
        ))}
      </div>
    </div>
  );
}

/** Threshold input (`input.input[type=number][step=0.01]`, 84px): saved on blur / Enter when changed. */
function ThresholdField({ which, label, initial, canEdit }: { which: 'risk' | 'off'; label: string; initial: string; canEdit: boolean }) {
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const id = `threshold-${which}`;
  const commit = () => {
    if (!canEdit || pending || value.trim() === initial) return;
    start(async () => {
      if (!(await attempt(setHealthThresholdAction(which, value)))) setValue(initial);
    });
  };
  return (
    <div className={cx('field', s.thresholdField)}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={cx('input', s.thresholdInput)}
        type="number"
        step="0.01"
        value={value}
        readOnly={!canEdit}
        aria-busy={pending || undefined}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </div>
  );
}

function ListCard({ card, locTypes, canEdit }: { card: SettingsCardView; locTypes: { value: LocationType; label: string }[]; canEdit: boolean }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [locType, setLocType] = useState<LocationType>(locTypes[0]?.value ?? 'central_warehouse');
  const [pending, start] = useTransition();
  const I = ICONS[card.icon];
  const add = () => {
    if (!draft.trim() || pending) return;
    start(async () => {
      if (await attempt(addSettingsEntryAction(card.key, draft, card.isLoc ? locType : undefined))) setDraft('');
    });
  };
  const remove = (id: string) => start(async () => void (await attempt(removeSettingsEntryAction(card.key, id))));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };
  return (
    <section className={cx('card', 'elev-sm', s.listCard)} aria-busy={pending || undefined}>
      <div className={s.listHead}>
        <I className={s.listIcon} aria-hidden />
        <div className={s.listTitle}>
          <div className="card-title">{card.title}</div>
          <span className={cx(s.muted12, s.pretty)}>{card.sub}</span>
        </div>
        <span className="tag tag-neutral">{card.count}</span>
      </div>
      <div className={s.items}>
        {card.items.map((it) => (
          <div key={it.id} className={cx(s.item, !canEdit && s.itemRo)}>
            <span className={s.itemText}>
              <span className={s.itemLabel}>{it.label}</span>
              {it.sub != null && <span className={s.itemSub}>{it.sub}</span>}
            </span>
            {/* A-14: the stages the lifecycle needs (Initiative, Clos, Annulé) cannot be removed. */}
            {canEdit && !(card.key === 'statuses' && (REQUIRED_STAGES as readonly string[]).includes(it.id)) && (
              <IconButton icon={X} label={`${t('Remove')} · ${it.label}`} title={t('Remove')} size={26} className={s.removeBtn} disabled={pending} onClick={() => remove(it.id)} />
            )}
          </div>
        ))}
      </div>
      {canEdit && card.isLoc && (
        <Segmented wrap options={locTypes.map((o) => ({ value: o.value, label: o.label }))} value={locType} onChange={setLocType} label={t('Location type')} />
      )}
      {canEdit && (
        <div className={s.addRow}>
          <input
            className={cx('input', s.addInput)}
            value={draft}
            placeholder={t('Add an entry')}
            aria-label={`${card.title} · ${t('Add an entry')}`}
            maxLength={120}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />
          <Button variant="secondary" size="sm" icon={Plus} disabled={pending} onClick={add}>
            {t('Add')}
          </Button>
        </div>
      )}
    </section>
  );
}
