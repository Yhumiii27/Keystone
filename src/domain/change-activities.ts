// Change request ↔ plan activities (Delivery 7, NEW-D2-2 = a, R-062): besides its work packages, a change request may
// name the plan activities it touches and the new duration it asks for (optional). The links are edited while the
// request is open (Draft, In review) by the project team that edits the plan (the project's PM or the director — a client
// raising a request does not see the plan); once the request is approved, the next "Reschedule" applies the new
// durations to the plan (the CPM then dates them). Pure rules; English source strings.
import type { ChangeStatus } from '@/server/db/codes';

/** Activity code of the plan ("A1250", imported codes too): letters, digits, dots, dashes, underscores (≤ 40). */
export const isPlanActivityCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(v);

/** Largest new duration accepted (working days). */
export const MAX_CR_ACTIVITY_DAYS = 3650;
/** Most activities one request may name. */
export const MAX_CR_ACTIVITIES = 50;

export interface CrActivityInput {
  code: string;
  /** New duration in working days; null = touched without a new duration. */
  newDurationDays: number | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A new duration typed in a field: blank → null, else a whole number of working days 0 … 3650. */
export function parseNewDuration(v: unknown): Parsed<number | null> {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : v == null ? '' : null;
  if (s === null) return { ok: false, error: 'Enter the new duration in working days' };
  if (!s) return { ok: true, value: null };
  if (!/^\d{1,4}$/.test(s) || Number(s) > MAX_CR_ACTIVITY_DAYS) return { ok: false, error: 'Enter the new duration in working days' };
  return { ok: true, value: Number(s) };
}

/**
 * The "Activities touched" field of the change-request form: codes separated by commas, spaces or semicolons, each
 * optionally followed by "=" and its new duration ("A1250=28, A1320"). Blank → none. A code given twice is refused.
 */
export function parseCrActivities(text: unknown): Parsed<CrActivityInput[]> {
  const s = typeof text === 'string' ? text.trim() : '';
  if (!s) return { ok: true, value: [] };
  const out: CrActivityInput[] = [];
  for (const token of s.split(/[\s,;]+/).filter(Boolean)) {
    const [code, days, ...rest] = token.split('=');
    if (rest.length || !isPlanActivityCode(code)) return { ok: false, error: 'Enter activity codes such as A1250 or A1250=28' };
    const d = days === undefined ? ({ ok: true, value: null } as const) : parseNewDuration(days);
    if (!d.ok || (days !== undefined && d.value === null)) return { ok: false, error: 'Enter activity codes such as A1250 or A1250=28' };
    if (out.some((o) => o.code === code)) return { ok: false, error: 'An activity is listed twice' };
    out.push({ code, newDurationDays: d.value });
  }
  if (out.length > MAX_CR_ACTIVITIES) return { ok: false, error: 'Too many activities' };
  return { ok: true, value: out };
}

/** The links of a request are edited while it is open (Draft or In review); decided requests are frozen. */
export const crActivitiesEditable = (status: ChangeStatus) => status === 'draft' || status === 'in_review';

/** Who edits the links: viewers who may edit the request's project, except the client (the plan is internal). */
export const canEditCrActivities = (viewer: { role: string }, canEditProject: boolean) => canEditProject && viewer.role !== 'client';

/** A link the next "Reschedule" applies: its request approved, a new duration given, not applied yet. */
export const isPendingDuration = (l: { newDurationDays: number | null; appliedAt: unknown }, status: ChangeStatus) =>
  status === 'approved' && l.newDurationDays != null && !l.appliedAt;

/** Duration change of a link: "20d → 28d"; "20d" without a new duration; "— → 28d" when the activity is gone. */
export function durationChangeText(currentDays: number | null, newDays: number | null): string {
  const cur = currentDays == null ? '—' : `${currentDays}d`;
  return newDays == null ? cur : `${cur} → ${newDays}d`;
}
