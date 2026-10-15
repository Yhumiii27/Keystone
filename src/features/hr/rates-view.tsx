'use client';
// Rate cards body (docs/spec/06 §2, template 1421–1448): KPIs, masked banner, "Cost rates by role" and "Multipliers".
// Base rates and multipliers recompute the table and the KPIs live while typing (as the prototype) and are saved
// on blur / Enter (the prototype kept them in session state only — 06 OQ6). Values are masked ("•••") for every
// role but the director, the PMs and Finance (`canSeeRates`); edits need `canEdit` (director and Finance — P-12 c, R-044).
// R-083 (A-10, R-4a): the grid is dated. The card shows the rates in force on a date (`?on=`, default the business date);
// an edit writes the version of that date ("Edits take effect from"), each rate says since when it applies and lists its
// other versions.
import { CalendarBlank, LockSimple } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { Callout } from '@/components/app/Callout';
import { FilterBar, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { FlexRow, SectionCard } from '@/components/app/SectionCard';
import { LO, OK } from '@/components/app/tones';
import { cx } from '@/components/ds/cx';
import { Table, Td, Th } from '@/components/ds/Table';
import { showToast } from '@/components/ds/Toast';
import { MASK, eurRate, isExternalRole, multiplierHint, parseRateInput, premiumText, rateKpis } from '@/domain/hr';
import { useI18n } from '@/i18n/client';
import { dataText } from '@/i18n/data-text';
import { setBaseRateAction, setMultiplierAction, type HrEditResult } from './actions';
import { hrT } from './i18n';
import s from './hr.module.css';

/** A version of a rate or factor as shown: its value and effective date (English display date, translated here). */
export interface VersionView {
  value: number;
  /** "1 Jan 2026". */
  from: string;
}

export interface RatesViewProps {
  /** ISO date the card shows (`?on=`) and the date edits take effect from. */
  on: string;
  /** Card path (the date selector adds `?on=`). */
  base: string;
  /** In force on `on`: value (null = no version yet / masked), "since" date, the role's other versions (masked: none). */
  roles: { role: string; baseRateEur: number | null; since: string | null; others: VersionView[] }[];
  multipliers: { key: string; label: string; factor: number | null; since: string | null; others: VersionView[] }[];
  /** `canSeeRates` (director, PMs, Finance). */
  canSee: boolean;
  /** Edits allowed (`canEditRates`: director and Finance, inside the workspace). */
  canEdit: boolean;
}

type Field = { kind: 'rate' | 'mult'; key: string };
const fid = (f: Field) => `${f.kind}:${f.key}`;

export function RatesView({ on, base, roles, multipliers, canSee, canEdit }: RatesViewProps) {
  const { t: baseT, lang } = useI18n();
  const t = hrT(baseT, lang);
  const router = useRouter();
  // `saved`: values saved during this session (over the server props); `draft`: text typed and not saved yet.
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const inflight = useRef(new Set<string>());
  const [, startTransition] = useTransition();

  const stored = (f: Field): number | null =>
    saved[fid(f)] ?? (f.kind === 'rate' ? roles.find((r) => r.role === f.key)?.baseRateEur : multipliers.find((m) => m.key === f.key)?.factor) ?? null;
  const live = (f: Field): number | null => {
    const raw = draft[fid(f)];
    return raw === undefined ? stored(f) : raw.trim() === '' ? stored(f) : parseRateInput(raw);
  };
  const clearDraft = (id: string) =>
    setDraft((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  const liveRoles = roles.map((r) => ({ ...r, baseRateEur: live({ kind: 'rate', key: r.role }) }));
  const liveMults = multipliers.map((m) => ({ ...m, factor: live({ kind: 'mult', key: m.key }) }));
  // KPIs on the grid as it stands on the date (a role or factor without a version counts as 0, as the prototype's NaN → 0).
  const k = rateKpis(
    liveRoles.map((r) => ({ role: r.role, baseRateEur: r.baseRateEur ?? 0 })),
    liveMults.map((m) => ({ key: m.key, label: m.label, factor: m.factor ?? 0 })),
  );

  const save = (f: Field) => {
    const id = fid(f);
    const raw = draft[id];
    if (raw === undefined || inflight.current.has(id)) return;
    if (raw.trim() === '') {
      clearDraft(id);
      return;
    }
    const v = parseRateInput(raw);
    if (v === stored(f)) {
      clearDraft(id);
      return;
    }
    inflight.current.add(id);
    startTransition(async () => {
      let r: HrEditResult;
      try {
        r = f.kind === 'rate' ? await setBaseRateAction(f.key, v, on) : await setMultiplierAction(f.key, v, on);
      } catch (e) {
        r = { error: e instanceof Error ? e.message : String(e) };
      }
      inflight.current.delete(id);
      if ('error' in r) showToast(r.error);
      else {
        const value = r.value;
        setSaved((cur) => ({ ...cur, [id]: value }));
      }
      clearDraft(id);
    });
  };
  const onKey = (f: Field) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') save(f);
    if (e.key === 'Escape') clearDraft(fid(f));
  };
  const input = (f: Field, cls: string, label: string, step?: number) => (
    <input
      className={cx('input', cls)}
      type="number"
      step={step}
      min={0}
      value={draft[fid(f)] ?? (stored(f) == null ? '' : String(stored(f)))}
      aria-label={label}
      onChange={(e) => {
        const v = e.target.value;
        setDraft((cur) => ({ ...cur, [fid(f)]: v }));
      }}
      onBlur={() => save(f)}
      onKeyDown={onKey(f)}
    />
  );
  /** "since 1 Jan 2026 · 70 € from 1 Jan 2025" (R-083: the version in force and the other versions). */
  const versionsText = (since: string | null, others: VersionView[], fmt: (v: number) => string) =>
    [since ? t(`since ${since}`) : t('No rate on this date'), ...others.map((o) => t(`${fmt(o.value)} from ${o.from}`))].join(' · ');
  const money = (v: number | null) => (v == null ? '—' : eurRate(v));

  const masked = !canSee;
  const premium = k.contractorPremiumPct;
  const internalSub = k.internalCount === 1 ? 'Cost rate · 1 role' : `Cost rate · ${k.internalCount} roles`;
  const onChangeDate = (v: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) router.push(`${base}?on=${v}`);
  };

  return (
    <>
      <FilterBar>
        <FilterLabel icon={CalendarBlank}>{t(canEdit ? 'Rates in force on · edits take effect from' : 'Rates in force on')}</FilterLabel>
        <input className={cx('input', s.dateInput)} type="date" value={on} aria-label={t('Rates in force on')} onChange={(e) => onChangeDate(e.target.value)} />
        {canEdit && <FilterNote>{t('Each change is dated; an earlier date revalues the hours worked since then')}</FilterNote>}
      </FilterBar>
      <KpiGrid min={150}>
        <KpiTile label={t('Standard week')} value="35 h" sub={t('Overtime beyond 8 h/day')} color={OK} />
        <KpiTile label={t('Average internal rate')} value={masked ? MASK : eurRate(k.avgInternalRate) + '/h'} sub={t(internalSub)} color={OK} />
        <KpiTile
          label={t('Contractor premium')}
          value={masked ? MASK : premium == null ? '—' : premiumText(premium)}
          sub={t('vs internal structural engineer')}
          color={OK}
        />
        <KpiTile label={t('Weekend multiplier')} value={k.weekendMultiplier == null ? '—' : '×' + k.weekendMultiplier} sub={t('Sunday / public holiday')} color={OK} />
        <KpiTile label={t('Visibility')} value={t(masked ? 'Masked' : 'Full')} sub={t('Director, project managers and Finance')} color={masked ? LO : OK} />
      </KpiGrid>
      {masked && (
        <Callout icon={LockSimple}>{t('Rates are visible to the director, project managers and Finance only — switch role (bottom-left) to see them.')}</Callout>
      )}
      {canSee && !canEdit && <Callout icon={LockSimple}>{t('Rates are edited by the portfolio director and Finance')}</Callout>}
      <FlexRow>
        <SectionCard flex="2.4 1 560px" scroll title={t('Cost rates by role')} subtitle={t('Base €/h is editable · multiplied rates update live · hours come from Lucca')}>
          <Table>
            <thead>
              <tr>
                <Th>{t('Role')}</Th>
                <Th align="right">{t('Base €/h')}</Th>
                <Th align="right">{t('Overtime')}</Th>
                <Th align="right">{t('Saturday')}</Th>
                <Th align="right">{t('Sun / holiday')}</Th>
                <Th align="right">{t('Night')}</Th>
                <Th align="right">{t('On-call')}</Th>
              </tr>
            </thead>
            <tbody>
              {liveRoles.map((r) => (
                <tr key={r.role}>
                  <Td>
                    <span className={s.roleCell}>
                      {dataText(r.role, lang)}
                      {isExternalRole(r.role) && <span className={cx('tag', 'tag-outline', s.extTag)}>{t('External')}</span>}
                    </span>
                    {!masked && <span className={s.versions}>{versionsText(r.since, r.others, eurRate)}</span>}
                  </Td>
                  <Td align="right">
                    {masked ? (
                      <span className={s.masked}>{MASK}</span>
                    ) : canEdit ? (
                      input({ kind: 'rate', key: r.role }, s.rateInput, `${dataText(r.role, lang)} · ${t('Base €/h')}`)
                    ) : (
                      <span className={s.num}>{money(r.baseRateEur)}</span>
                    )}
                  </Td>
                  {liveMults.map((m) => (
                    <Td key={m.key} align="right" className={s.mulCell}>
                      {masked ? MASK : r.baseRateEur == null || m.factor == null ? '—' : eurRate(r.baseRateEur * m.factor)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </SectionCard>
        <SectionCard flex="1 1 260px" gap={10} title={t('Multipliers')} subtitle={t('Applied to the base rate · 35 h week')}>
          {liveMults.map((m) => (
            <div key={m.key} className={s.multRow}>
              <span className={s.multText}>
                <span className={s.multLabel}>{t(m.label)}</span>
                <span className={s.multHint}>{t(multiplierHint(m.key))}</span>
                <span className={s.multHint}>{versionsText(m.since, m.others, (v) => `×${v}`)}</span>
              </span>
              {canEdit ? input({ kind: 'mult', key: m.key }, s.multInput, t(m.label), 0.05) : <span className={s.multValue}>{m.factor ?? '—'}</span>}
            </div>
          ))}
          <span className={s.footNote}>
            {t('Lucca sends hours by type (normal, overtime, Saturday, Sunday, night, on-call); Keystone values them with these rates to produce actual labor cost.')}
          </span>
        </SectionCard>
      </FlexRow>
    </>
  );
}
