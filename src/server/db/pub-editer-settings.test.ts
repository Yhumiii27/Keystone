// D9-04 (owner, 10 Nov 2026; migration 0078_pub_editer_settings): keystone.pub_editer opens the public holidays and the Settings
// thresholds to Matrix. Their rules lived in TypeScript only and are reproduced in SQL: this file runs the SAME cases through
// the TypeScript validators (the ones the Settings writers use) and through pub_editer, and expects the same accept / refuse —
// and, when accepted, the same stored result as Keystone reads it — so that the two cannot drift. A new field, a new bound or a
// new accepted form in TypeScript makes a case disagree here. On an in-memory PGlite seeded with the demo data; each case runs in
// a transaction rolled back afterwards.
import { and, desc, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseHolidayEntry } from '@/domain/admin';
import { isCcbThreshold } from '@/domain/change-control';
import { DRIFT_STANDARD, DRIFT_THRESHOLD_FIELDS, driftOrderBroken, parseDriftThreshold, usableDriftThresholds, type DriftThresholdKey } from '@/domain/drift-forecast';
import { DEFAULT_HEALTH_THRESHOLDS, healthThresholdsRefusal, usableThresholds } from '@/domain/health';
import { isHoursVariancePct, usableHoursVariance } from '@/domain/hr';
import { DCMA_STANDARD, DCMA_THRESHOLD_FIELDS, parseDcmaThreshold, usableDcmaThresholds, type DcmaThresholdKey } from '@/domain/schedule-quality';
import {
  SUPPLIER_SLIP_ESCALATION_FIELDS, isSupplierSlipDays, parseSupplierSlipEscalation, usableSupplierSlipDays, usableSupplierSlipEscalation, type SupplierSlipEscalationKey,
} from '@/domain/supplier-slip-alerts';
import {
  APP_SETTING_CCB, APP_SETTING_DCMA, APP_SETTING_DRIFT, APP_SETTING_HEALTH, APP_SETTING_HOURS_VARIANCE, APP_SETTING_SUPPLIER_SLIP, APP_SETTING_SUPPLIER_SLIP_ESCALATION,
} from './codes';
import { openDatabase } from './open';
import { appSettings, auditEntries, referenceValues } from './schema';
import type { DB } from './types';

let db: DB;
/** The business year of pub_editer: the real date in Europe/Paris (KEYSTONE_CLOCK unset on the servers, R-013). */
let year: number;

beforeAll(async () => {
  db = await openDatabase();
  year = (await db.execute(sql`select extract(year from (now() at time zone 'Europe/Paris'))::int as y`)).rows.map((r) => (r as { y: number }).y)[0];
}, 60_000);

const PAR = 'Camille Admin-IT';
const MOTIF = 'Seuils revus avec le PMO';
type Row = Record<string, unknown>;
type Q = Pick<DB, 'execute'>;
type Outcome = { ok: true; row: Row } | { ok: false; code: string; message: string };

/**
 * pub_editer with the values given as JSON text (so that Matrix's raw forms — 1e400, strings — reach it as sent). Inside a
 * transaction (`inTx`), the call runs under a savepoint so that a refusal leaves the transaction usable.
 */
async function call(q: Q, table: string, action: string, cle: Row | null, valuesJson: string | null, inTx = true): Promise<Outcome> {
  if (inTx) await q.execute(sql`savepoint pub_editer_case`);
  try {
    const r = await q.execute(sql`select pub_editer(${table}, ${action}, ${cle ? JSON.stringify(cle) : null}::jsonb, ${valuesJson}::jsonb, ${PAR}, ${MOTIF}) as row`);
    if (inTx) await q.execute(sql`release savepoint pub_editer_case`);
    return { ok: true, row: (r.rows[0] as { row: Row }).row };
  } catch (e) {
    if (inTx) await q.execute(sql`rollback to savepoint pub_editer_case`);
    const err = ((e as { cause?: unknown }).cause ?? e) as { code?: string; message: string };
    return { ok: false, code: err.code ?? '', message: err.message };
  }
}

const ROLLBACK = new Error('rollback');
/** Runs `fn` in a transaction that is always rolled back (each case starts from the same database). */
async function rolledBack<T>(fn: (tx: Q) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await db.transaction(async (tx) => {
    out = await fn(tx as unknown as Q);
    throw ROLLBACK;
  }).catch((e) => {
    if (e !== ROLLBACK) throw e;
  });
  return out as T;
}

// ── Public holidays ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Entries Matrix might send: Settings' own form, French months, every quirk of the date parser, lengths, non-strings. */
const HOLIDAY_CASES: unknown[] = [
  '14 Jul · Fête nationale', '  14 juil. · Fête nationale  ', '14 juillet · Fête nationale', '14 JUIL. · Fête', '1 FÉVR. · Chandeleur', '1 févr · x',
  '15 août · Assomption', '15 AOÛT · Assomption', '25 Déc · Noël', '25 décembre · Noël', '1 mai · Fête du travail', '8 mars · x', '1 sept. · Rentrée',
  '5 may · x', '5 mayo · x', '5 Mayo · x', '5 Mayday · x', '7 Jul · a · b', '1 Nov · Toussaint',
  '31 Feb · X', '29 Feb · X', '30 Apr · X', '31 Apr · X', '29 Feb 2028 · X', '29 Feb ’28 · X', "29 Feb '27 · X", '1 Jan 2027 · X', '1 Jan 27 · X',
  '1 Jan 999 · X', '1 Jan 0999 · X', '1 Jan 1000 · X', '31 Dec 9999 · X', '1 Jan 10000 · X', '1 Jan 2027x · X', '1 Jan 1a · X', '1 Jan -27 · X', '1 Jan +27 · X',
  '1 Jan 0x10 · X', '1 Jan abc · X', '1 Jan 2027 extra · X',
  '0x1F Dec · X', '0x1f Dec · X', '0x Dec · X', '0xg Dec · X', '+5 May · X', '-5 May · X', '05 May · X', '005 May · X', '14x Jul · X', '1e1 Jul · X',
  '32 Jan · X', '0 Jan · X', '5 May A · X', '5 May  A · X', '5 A · X',
  '5 May', '5 May ·X', '5 May· X', '5 May·X', 'Fête · 14 Jul', '14 · Jul', '· 14 Jul', 'Jul 14 · X', '14Jul · X',
  '14\tJul · X', '14 Jul · X', '14 juil. · X', '　 14 Jul · X ﻿', '14 Jul ·\nX', '14 Jul · X\nY', '14 juil. · X\nY', '14 juil.\n· X', '14 Jul · X',
  '', '   ', 'x'.repeat(130), `1 Jan · ${'é'.repeat(112)}`, `1 Jan · ${'é'.repeat(113)}`, `1 Jan · ${'😀'.repeat(56)}`, `1 Jan · ${'😀'.repeat(57)}`, '1 Jan · 😀',
  `  1 Jan · ${'x'.repeat(112)}   `, '😀 Jan · X', '1 😀Jan · X',
  14, null, true, ['14 Jul · X'], { label: '14 Jul · X' },
];

describe('D9-04: a public holiday sent by Matrix follows the Settings rule (parseHolidayEntry)', () => {
  it('adds: the same cases accepted and refused; the stored entry and its date are those of Settings', async () => {
    const disagree: string[] = [];
    for (const raw of HOLIDAY_CASES) {
      const ts = parseHolidayEntry(raw, year);
      const out = await rolledBack(async (tx) => {
        // An empty list: the date and label rules of the database (one holiday per date, duplicates) are tested apart.
        await tx.execute(sql`delete from reference_values where list_key = 'holidays'`);
        return call(tx, 'reference_values', 'ajouter', null, JSON.stringify({ list_key: 'holidays', label: raw }));
      });
      const sqlSide = out.ok ? { label: out.row.label, date: out.row.code } : null;
      if (JSON.stringify(ts) !== JSON.stringify(sqlSide)) disagree.push(`${JSON.stringify(raw)}: TypeScript ${JSON.stringify(ts)} · SQL ${JSON.stringify(out.ok ? sqlSide : out.message)}`);
      if (!out.ok) expect(out.code).toBe('P0K02');
    }
    expect(disagree).toEqual([]);
  });

  it('corrects: the same rule, in the year of the entry being corrected (a 2025 holiday stays in 2025)', async () => {
    const disagree: string[] = [];
    for (const raw of HOLIDAY_CASES) {
      const ts = parseHolidayEntry(raw, 2025);
      const out = await rolledBack(async (tx) => {
        await tx.execute(sql`delete from reference_values where list_key = 'holidays'`);
        const r = await tx.execute(sql`insert into reference_values (list_key, code, label, position, active, is_default) values ('holidays', '2025-05-08', '8 May · Victoire 1945', 0, true, true) returning id`);
        return call(tx, 'reference_values', 'corriger', { id: (r.rows[0] as { id: string }).id }, JSON.stringify({ label: raw }));
      });
      const sqlSide = out.ok ? { label: out.row.label, date: out.row.code } : null;
      if (JSON.stringify(ts) !== JSON.stringify(sqlSide)) disagree.push(`${JSON.stringify(raw)}: TypeScript ${JSON.stringify(ts)} · SQL ${JSON.stringify(out.ok ? sqlSide : out.message)}`);
    }
    expect(disagree).toEqual([]);
  });

  it('one active holiday per date, no duplicate label; a removed one comes back with its label; the audit row carries the date', async () => {
    // Each refusal aborts the transaction: the rules are checked one per transaction.
    const setup = async (tx: Q) => {
      await tx.execute(sql`delete from reference_values where list_key = 'holidays'`);
      const a = await call(tx, 'reference_values', 'ajouter', null, JSON.stringify({ list_key: 'holidays', label: '1 nov. · Toussaint' }));
      expect(a).toMatchObject({ ok: true, row: { label: '1 Nov · Toussaint', code: `${year}-11-01`, active: true, is_default: false } });
      const b = await call(tx, 'reference_values', 'ajouter', null, JSON.stringify({ list_key: 'holidays', label: '11 Nov · Armistice' }));
      return { a: (a as { row: Row }).row.id as string, b: (b as { row: Row }).row.id as string };
    };
    expect(await rolledBack(async (tx) => {
      await setup(tx);
      return call(tx, 'reference_values', 'ajouter', null, JSON.stringify({ list_key: 'holidays', label: '1 Nov · All Saints' }));
    })).toMatchObject({ ok: false, code: 'P0K03', message: `Un jour férié est déjà inscrit le ${year}-11-01` });
    expect(await rolledBack(async (tx) => {
      await setup(tx);
      return call(tx, 'reference_values', 'ajouter', null, JSON.stringify({ list_key: 'holidays', label: '1 NOV · toussaint' }));
    })).toMatchObject({ ok: false, code: 'P0K03', message: '« 1 Nov · toussaint » est déjà dans la liste' });
    expect(await rolledBack(async (tx) => {
      const { b } = await setup(tx);
      return call(tx, 'reference_values', 'corriger', { id: b }, JSON.stringify({ label: '1 Nov · Armistice' }));
    })).toMatchObject({ ok: false, code: 'P0K03', message: `Un jour férié est déjà inscrit le ${year}-11-01` });
    expect(await rolledBack(async (tx) => {
      const { a, b } = await setup(tx);
      await call(tx, 'reference_values', 'retirer', { id: a }, null);
      // The retired entry still holds its date (its code): the correction is refused, the entry comes back by « ajouter ».
      return call(tx, 'reference_values', 'corriger', { id: b }, JSON.stringify({ label: '1 Nov · Armistice' }));
    })).toMatchObject({ ok: false, code: 'P0K03', message: expect.stringContaining('retiré porte déjà la date') });
    await rolledBack(async (tx) => {
      const { a } = await setup(tx);
      expect(await call(tx, 'reference_values', 'retirer', { id: a }, null)).toMatchObject({ ok: true, row: { active: false } });
      expect(await call(tx, 'reference_values', 'ajouter', null, JSON.stringify({ list_key: 'holidays', label: '1 Nov · Toussaint' })))
        .toMatchObject({ ok: true, row: { id: a, active: true, code: `${year}-11-01` } });
      expect(await call(tx, 'reference_values', 'corriger', { id: a }, JSON.stringify({ label: '2 nov. · Toussaint (reportée)' })))
        .toMatchObject({ ok: true, row: { id: a, label: '2 Nov · Toussaint (reportée)', code: `${year}-11-02` } });
      // One transaction: every row has the same occurred_at — the correction is the one that moved the date.
      const [audit] = await (tx as unknown as DB).select().from(auditEntries)
        .where(and(eq(auditEntries.entityId, a), eq(auditEntries.area, 'Matrix'), sql`${auditEntries.change} like '%code:%'`));
      expect(audit).toMatchObject({
        actorName: PAR, reason: MOTIF, objectRef: 'Settings · Public holidays 2026 — France', entityType: 'reference_value',
        before: { code: `${year}-11-01`, label: '1 Nov · Toussaint' }, after: { code: `${year}-11-02`, label: '2 Nov · Toussaint (reportée)' },
      });
      expect(audit.change).toMatch(/^Matrix \(.+\) · code: \d{4}-11-01 → \d{4}-11-02 · label: 1 Nov · Toussaint → 2 Nov · Toussaint \(reportée\)$/);
      return null;
    });
  });
});

// ── Settings thresholds ─────────────────────────────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>;
interface SettingRule {
  key: string;
  /** The fields as TypeScript lists them (a field added in TypeScript and missing in SQL disagrees). */
  fields: readonly string[];
  /** What Keystone reads from a stored value (the readers' "usable…" functions). */
  usable: (stored: unknown) => unknown;
  /** The Settings writer's rule: the document it would store, or null when it refuses. */
  write: (stored: unknown, vals: Doc) => Doc | null;
}

const each = <K extends string>(fields: readonly { key: K }[]) => fields.map((f) => f.key);
const onlyKnown = (vals: Doc, fields: readonly string[]) => Object.keys(vals).length > 0 && Object.keys(vals).every((k) => fields.includes(k));

const RULES: SettingRule[] = [
  {
    key: APP_SETTING_HEALTH, fields: ['risk', 'off'], usable: (s) => usableThresholds(s as never),
    // setHealthThresholds: { risk: input.risk ?? cur.risk, off: input.off ?? cur.off }, then healthThresholdsRefusal.
    write: (s, v) => {
      if (!onlyKnown(v, ['risk', 'off'])) return null;
      const cur = usableThresholds(s as never);
      const next = { risk: v.risk ?? cur.risk, off: v.off ?? cur.off };
      return healthThresholdsRefusal(next) ? null : next;
    },
  },
  {
    key: APP_SETTING_HOURS_VARIANCE, fields: ['pct'], usable: usableHoursVariance,
    write: (_s, v) => (onlyKnown(v, ['pct']) && isHoursVariancePct(v.pct) ? { pct: v.pct } : null),
  },
  {
    key: APP_SETTING_CCB, fields: ['keur'], usable: (s) => {
      const keur = s && typeof s === 'object' ? (s as Doc).keur : undefined;
      return isCcbThreshold(keur) ? keur : 50;
    },
    write: (_s, v) => (onlyKnown(v, ['keur']) && isCcbThreshold(v.keur) ? { keur: Math.round(v.keur * 100) / 100 } : null),
  },
  {
    key: APP_SETTING_DCMA, fields: each(DCMA_THRESHOLD_FIELDS), usable: usableDcmaThresholds,
    write: (s, v) => {
      if (!onlyKnown(v, each(DCMA_THRESHOLD_FIELDS))) return null;
      const next: Doc = { ...usableDcmaThresholds(s) };
      for (const [k, raw] of Object.entries(v)) {
        const n = parseDcmaThreshold(k as DcmaThresholdKey, raw);
        if (n === null) return null;
        next[k] = n;
      }
      return next;
    },
  },
  {
    key: APP_SETTING_DRIFT, fields: each(DRIFT_THRESHOLD_FIELDS), usable: usableDriftThresholds,
    // setDriftThreshold, for several fields at once: each parsed, then the ordered pairs checked on the result.
    write: (s, v) => {
      if (!onlyKnown(v, each(DRIFT_THRESHOLD_FIELDS))) return null;
      const next: Doc = { ...usableDriftThresholds(s) };
      for (const [k, raw] of Object.entries(v)) {
        const n = parseDriftThreshold(k as DriftThresholdKey, raw);
        if (n === null) return null;
        next[k] = n;
      }
      return driftOrderBroken(next as never) ? null : next;
    },
  },
  {
    key: APP_SETTING_SUPPLIER_SLIP, fields: ['days'], usable: usableSupplierSlipDays,
    write: (_s, v) => (onlyKnown(v, ['days']) && isSupplierSlipDays(v.days) ? { days: v.days } : null),
  },
  {
    key: APP_SETTING_SUPPLIER_SLIP_ESCALATION, fields: each(SUPPLIER_SLIP_ESCALATION_FIELDS), usable: usableSupplierSlipEscalation,
    write: (s, v) => {
      if (!onlyKnown(v, each(SUPPLIER_SLIP_ESCALATION_FIELDS))) return null;
      const next: Doc = { ...usableSupplierSlipEscalation(s) };
      for (const [k, raw] of Object.entries(v)) {
        const n = parseSupplierSlipEscalation(k as SupplierSlipEscalationKey, raw);
        if (n === null) return null;
        next[k] = n;
      }
      return next;
    },
  },
];

/** Bounds of a field as TypeScript declares them (used to build the boundary cases). */
function boundsOf(key: string, field: string): { min: number; max: number } {
  const all = [...DCMA_THRESHOLD_FIELDS, ...DRIFT_THRESHOLD_FIELDS, ...SUPPLIER_SLIP_ESCALATION_FIELDS] as readonly { key: string; min: number; max: number }[];
  if (key === APP_SETTING_DCMA) return DCMA_THRESHOLD_FIELDS.find((f) => f.key === field)!;
  if (key === APP_SETTING_DRIFT) return DRIFT_THRESHOLD_FIELDS.find((f) => f.key === field)!;
  if (key === APP_SETTING_SUPPLIER_SLIP_ESCALATION) return SUPPLIER_SLIP_ESCALATION_FIELDS.find((f) => f.key === field)!;
  return { [APP_SETTING_HEALTH]: { min: 0, max: 2 }, [APP_SETTING_HOURS_VARIANCE]: { min: 1, max: 50 }, [APP_SETTING_CCB]: { min: 0, max: 1_000_000 }, [APP_SETTING_SUPPLIER_SLIP]: { min: 1, max: 60 } }[key]
    ?? all.find((f) => f.key === field)!;
}

/** JSON texts of the values tried on every field (raw, so that 1e400 and strings reach both sides as Matrix sends them). */
function valueCases(min: number, max: number): string[] {
  const nums = [min, max, min - 1, max + 1, min - 0.001, max + 0.001, min + 0.5, (min + max) / 2, min + 0.0005, min + 0.0004999, min + 1.0005, min + 0.12345, Math.floor((min + max) / 3)];
  const out = nums.map((n) => JSON.stringify(n));
  out.push(
    JSON.stringify(String(min)), JSON.stringify(` ${max} `), JSON.stringify(String(min + 0.5).replace('.', ',')), JSON.stringify(`${Math.ceil(min)}.`), JSON.stringify(` ${Math.ceil(min) + 1}\t`),
    JSON.stringify(String(Math.ceil(min) + 1).padStart(6, '0')), JSON.stringify(`${max}0000`), JSON.stringify('-1'), JSON.stringify('1e1'), JSON.stringify('abc'), JSON.stringify(''),
    JSON.stringify('0.95000000000000000001'), JSON.stringify(`${max}.0000000000000000001`),
    '1e400', '-1e400', '1e-400', `${max}.0000000000000000001`, `${max}e0`, '-0', 'true', 'null', '[]', '{}',
  );
  return [...new Set(out)];
}

/** Stored documents tried before each change: none, the defaults, a partial or broken document, strings, a non-object. */
function storedCases(rule: SettingRule): (string | undefined)[] {
  const out: (string | undefined)[] = [undefined, '"not an object"', '[]', '{}'];
  if (rule.key === APP_SETTING_HEALTH) out.push('{"risk": 0.95, "off": 0.8}', '{"risk": 0.8, "off": 0.95}', '{"risk": "0.95", "off": 0.8}', '{"risk": 1.5}');
  if (rule.key === APP_SETTING_DCMA) out.push('{"highFloatDays": "30", "cpliMin": "0,9", "logicPct": 200}', JSON.stringify({ ...DCMA_STANDARD, leadsCount: 1.5 }));
  if (rule.key === APP_SETTING_DRIFT) out.push('{"cpiHigh": 0.99}', '{"cpiHigh": 0.5, "probabilityLowPct": "60", "spreadDays": 7.5}', JSON.stringify({ ...DRIFT_STANDARD, progressEarlyPct: 70 }));
  if (rule.key === APP_SETTING_SUPPLIER_SLIP_ESCALATION) out.push('{"days": "12", "impactDays": 7}', '{"days": 200}');
  if (rule.key === APP_SETTING_CCB) out.push('{"keur": 100.256}', '{"keur": -5}');
  if (rule.key === APP_SETTING_HOURS_VARIANCE) out.push('{"pct": 7}', '{"pct": 7.5}');
  if (rule.key === APP_SETTING_SUPPLIER_SLIP) out.push('{"days": 8}', '{"days": "8"}');
  return out;
}

async function trySetting(rule: SettingRule, stored: string | undefined, valuesJson: string): Promise<{ out: Outcome; read: unknown }> {
  return rolledBack(async (tx) => {
    await tx.execute(sql`delete from app_settings where key = ${rule.key}`);
    if (stored !== undefined) await tx.execute(sql`insert into app_settings (key, value) values (${rule.key}, ${stored}::jsonb)`);
    const out = await call(tx, 'app_settings', 'corriger', { key: rule.key }, valuesJson);
    const r = await tx.execute(sql`select value from app_settings where key = ${rule.key}`);
    return { out, read: rule.usable((r.rows[0] as { value?: unknown } | undefined)?.value ?? null) };
  });
}

describe('D9-04: a Settings threshold sent by Matrix follows the Settings writers (same cases through TypeScript and SQL)', () => {
  for (const rule of RULES) {
    it(`${rule.key}: every field, its bounds and forms, over several stored documents`, async () => {
      const disagree: string[] = [];
      let accepted = 0;
      let refused = 0;
      const cases: { stored: string | undefined; values: string }[] = [];
      for (const field of rule.fields) {
        const { min, max } = boundsOf(rule.key, field);
        for (const v of valueCases(min, max)) cases.push({ stored: undefined, values: `{"${field}": ${v}}` });
        // A few values over each stored document (the change starts from what Keystone reads).
        for (const stored of storedCases(rule)) for (const v of [JSON.stringify(min), JSON.stringify(max), JSON.stringify((min + max) / 2)]) cases.push({ stored, values: `{"${field}": ${v}}` });
      }
      // Several fields at once, an unknown field, nothing.
      cases.push({ stored: undefined, values: JSON.stringify(Object.fromEntries(rule.fields.map((f) => [f, boundsOf(rule.key, f).max]))) });
      cases.push({ stored: undefined, values: JSON.stringify(Object.fromEntries(rule.fields.map((f) => [f, boundsOf(rule.key, f).min]))) });
      cases.push({ stored: undefined, values: '{"inconnu": 1}' }, { stored: undefined, values: '{}' });
      if (rule.key === APP_SETTING_HEALTH) cases.push({ stored: undefined, values: '{"risk": null}' }, { stored: undefined, values: '{"risk": null, "off": 0.95}' }, { stored: undefined, values: '{"off": 0.97}' });
      if (rule.key === APP_SETTING_DRIFT) {
        cases.push({ stored: undefined, values: '{"cpiHigh": 0.97, "cpiReview": 0.98}' }, { stored: undefined, values: '{"cpiHigh": 0.97}' });
        cases.push({ stored: undefined, values: '{"progressEarlyPct": "60", "progressReliablePct": "55"}' }, { stored: undefined, values: '{"probabilityVeryLowPct": 50}' });
      }
      for (const c of cases) {
        const expected = rule.write(c.stored === undefined ? null : JSON.parse(c.stored), JSON.parse(c.values, (_k, v) => v));
        const { out, read } = await trySetting(rule, c.stored, c.values);
        const label = `${c.values} over ${c.stored ?? 'nothing stored'}`;
        if (!!expected !== out.ok) disagree.push(`${label}: TypeScript ${expected ? 'accepts' : 'refuses'} · SQL ${out.ok ? 'accepts' : `refuses (${out.message})`}`);
        else if (expected && JSON.stringify(read) !== JSON.stringify(rule.usable(expected))) disagree.push(`${label}: TypeScript stores ${JSON.stringify(rule.usable(expected))} · SQL ${JSON.stringify(read)}`);
        if (out.ok) accepted++;
        else {
          refused++;
          expect(['P0K01', 'P0K02', 'P0K03']).toContain(out.code);
        }
      }
      expect(disagree).toEqual([]);
      expect(accepted).toBeGreaterThan(0);
      expect(refused).toBeGreaterThan(0);
    });
  }

  it('the SQL field lists are exactly the TypeScript ones (a field missing on either side is refused or unknown)', async () => {
    for (const rule of RULES) {
      const out = await rolledBack((tx) => call(tx, 'app_settings', 'corriger', { key: rule.key }, '{"__aucun__": 1}'));
      expect(out).toMatchObject({ ok: false, code: 'P0K01' });
      expect((out as { message: string }).message).toContain(`(seuils : ${[...rule.fields].sort().join(', ')})`);
    }
  });

  it('defaults in SQL are the TypeScript defaults (nothing stored: a value equal to the default changes nothing)', async () => {
    const defaults: Record<string, Doc> = {
      [APP_SETTING_HEALTH]: { ...DEFAULT_HEALTH_THRESHOLDS }, [APP_SETTING_HOURS_VARIANCE]: { pct: usableHoursVariance(null) }, [APP_SETTING_CCB]: { keur: 50 },
      [APP_SETTING_DCMA]: { ...DCMA_STANDARD }, [APP_SETTING_DRIFT]: { ...DRIFT_STANDARD }, [APP_SETTING_SUPPLIER_SLIP]: { days: usableSupplierSlipDays(null) },
      [APP_SETTING_SUPPLIER_SLIP_ESCALATION]: { ...usableSupplierSlipEscalation(null) },
    };
    for (const rule of RULES) {
      const { out } = await trySetting(rule, undefined, JSON.stringify(defaults[rule.key]));
      // Nothing changed → nothing written: the function returns the values in force, which are the defaults.
      expect(out).toMatchObject({ ok: true, row: { key: rule.key, value: defaults[rule.key] } });
    }
  });
});

describe('D9-04: the Settings thresholds as Matrix finds them', () => {
  it('only « corriger », keyed {"key": …}, on the open settings', async () => {
    expect(await rolledBack((tx) => call(tx, 'app_settings', 'ajouter', null, '{"pct": 5}'))).toMatchObject({ ok: false, code: 'P0K01', message: expect.stringContaining('paramètres de Keystone sont fixes') });
    expect(await rolledBack((tx) => call(tx, 'app_settings', 'retirer', { key: APP_SETTING_HEALTH }, null))).toMatchObject({ ok: false, code: 'P0K01' });
    expect(await rolledBack((tx) => call(tx, 'app_settings', 'corriger', { id: '00000000-0000-0000-0000-000000000000' }, '{"pct": 5}'))).toMatchObject({ ok: false, code: 'P0K02', message: 'Clé invalide : {"key": "<paramètre>"} attendu' });
    for (const key of ['settings.defaults', 'reminders.preferences', 'inconnu']) {
      const out = await rolledBack((tx) => call(tx, 'app_settings', 'corriger', { key }, '{"x": 1}'));
      expect(out).toMatchObject({ ok: false, code: 'P0K01', message: expect.stringContaining(`Paramètre « ${key} » non modifiable depuis Matrix`) });
    }
  });

  it('writes the setting with the Matrix user, audits before / after with the reason; nothing changed = nothing written', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from app_settings where key = ${APP_SETTING_DRIFT}`);
      const out = await call(tx, 'app_settings', 'corriger', { key: APP_SETTING_DRIFT }, '{"tcpiHigh": "1,2", "spreadDays": 45}');
      expect(out).toMatchObject({ ok: true, row: { key: APP_SETTING_DRIFT, updated_by_name: `${PAR} (Matrix)`, value: { ...DRIFT_STANDARD, tcpiHigh: 1.2, spreadDays: 45 } } });
      const t = tx as unknown as DB;
      const [audit] = await t.select().from(auditEntries).where(and(eq(auditEntries.area, 'Matrix'), eq(auditEntries.entityType, 'app_setting'))).orderBy(desc(auditEntries.occurredAt), desc(auditEntries.id)).limit(1);
      expect(audit).toMatchObject({
        actorName: PAR, reason: MOTIF, objectRef: 'Drift forecast thresholds', entityId: null, projectId: null,
        before: { tcpiHigh: 1.1, spreadDays: 30 }, after: { tcpiHigh: 1.2, spreadDays: 45 },
      });
      expect(audit.change).toMatch(/^Matrix \(.+\) · spreadDays: 30 → 45 · tcpiHigh: 1\.1 → 1\.2$/);
      const n = async () => (await t.select({ n: sql<number>`count(*)::int` }).from(auditEntries)).map((r) => r.n)[0];
      const before = await n();
      expect(await call(tx, 'app_settings', 'corriger', { key: APP_SETTING_DRIFT }, '{"tcpiHigh": 1.2}')).toMatchObject({ ok: true });
      expect(await n()).toBe(before);
      const [stored] = await t.select().from(appSettings).where(eq(appSettings.key, APP_SETTING_DRIFT));
      expect(stored.updatedByPersonId).toBeNull();
      return null;
    });
  });

  it('a refusal writes nothing', async () => {
    const [before] = await db.select().from(appSettings).where(eq(appSettings.key, APP_SETTING_HEALTH));
    const out = await call(db, 'app_settings', 'corriger', { key: APP_SETTING_HEALTH }, '{"off": 0.99}', false);
    expect(out).toMatchObject({ ok: false, code: 'P0K03' });
    const [after] = await db.select().from(appSettings).where(eq(appSettings.key, APP_SETTING_HEALTH));
    expect(after).toEqual(before);
    expect((await db.select().from(referenceValues).where(eq(referenceValues.listKey, 'holidays'))).length).toBeGreaterThan(0);
  });
});
