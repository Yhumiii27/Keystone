// Events Cursus pushes to Keystone (R-029, R-031, NEW-CURSUS-7 "a") — the envelope and the known event types, validated with
// zod. Pure module. Cursus's contract is authoritative (Cursus owns the data): Cursus docs/API-KEYSTONE.md « Événements envoyés
// par Cursus » and the `evenement` webhook of its docs/keystone-openapi.json; Keystone's notes: docs/integrations/cursus-contract.md.
// Envelope { id, type, emis_le, donnees } — `data` (Keystone's earlier proposal) is still accepted as an alias of `donnees`.
// Known types:
// - heures.validees  { matricule, semaine, projets: { "<project code>": hours }, lignes?: [{ projet, activite?, heures, date? }] }
//                    — validated hours of a person's week; stored, never applied (the Cursus timesheet link awaits the owner,
//                    R-030); `lignes` is the per-task proposal of NEW-CURSUS-5 "c". Replacement key: matricule + week.
// - absence.validee  { absence, matricule, du, au } (Cursus) — also { id?, start | debut, end | fin, nature? } (earlier
//                    proposal). Cursus never sends the nature: without it the absence is "Absence" (R-031); a half day comes
//                    as the whole day. The nature, when sent, is reduced to Leave / Absence and never stored (R-173).
//                    Replacement key: Cursus's absence id (`absence`, else `id`), else matricule + dates — so a correction of
//                    the dates replaces the previous weeks.
// - absence.annulee  same data: the absence is removed from the leave calendar (same replacement key as the validation).
// - verdict.modifie  { chantier, … } — a site's people Go / No Go changed: Keystone refreshes that site (HTTP mode).
// - demande.decision { demande, decision (Cursus: acceptee / refusee) or statut, … } — a decision on a travel request: the
//                    request and its decision are stored only (other fields dropped).
// Any other type (deplacement.modifie, deplacement.annule…) is accepted and ignored (Cursus may add types before Keystone
// reads them).
import { z } from 'zod';
import { MAX_ABSENCE_DAYS, absenceKey, isIsoDate } from './absences';
import { leaveTypeOfNature, type LeaveType } from '@/server/db/codes';

/** Largest request body the endpoint reads (256 KB). */
export const MAX_CURSUS_EVENT_BYTES = 256 * 1024;
/** How long the inbox keeps an event (job "cursus-events-purge"). */
export const CURSUS_EVENT_RETENTION_MONTHS = 13;

export const CURSUS_EVENT_TYPES = ['heures.validees', 'absence.validee', 'absence.annulee', 'verdict.modifie', 'demande.decision'] as const;
export type CursusEventType = (typeof CURSUS_EVENT_TYPES)[number];
/** The event types about one absence: they share its replacement key (the latest emitted wins, Cursus's ordering rule). */
export const ABSENCE_EVENT_TYPES = ['absence.validee', 'absence.annulee'] as const;
/** The types whose replacement key names the same object as `type` (an absence: validated or cancelled). */
export const sameObjectTypes = (type: string): string[] => ((ABSENCE_EVENT_TYPES as readonly string[]).includes(type) ? [...ABSENCE_EVENT_TYPES] : [type]);

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
const ident = (max: number) => z.string().trim().min(1).max(max).regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/, 'must be letters, digits and . _ : @ -');
const matricule = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be a matricule');
const projectCode = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be a project code');
const hours = z.number().finite().min(0).max(168);
/** A week: ISO week "2026-W40" or the week's Monday "2026-09-28". */
const week = z.string().trim().refine((v) => /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(v) || isIsoDate(v), 'must be an ISO week (2026-W40) or a date');

export const cursusEnvelope = z.object({
  id: ident(200),
  type: z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'must be an event type'),
  emis_le: z.string().trim().refine((v) => ISO_INSTANT.test(v) && !Number.isNaN(Date.parse(v)), 'must be an ISO 8601 timestamp'),
  /** Cursus's name of the event's content. */
  donnees: z.record(z.string(), z.unknown()).optional(),
  /** Keystone's earlier name (still accepted). */
  data: z.record(z.string(), z.unknown()).optional(),
});

const hoursData = z.object({
  matricule,
  semaine: week,
  projets: z.record(projectCode, hours).refine((r) => Object.keys(r).length <= 200, 'too many projects'),
  lignes: z.array(z.object({ projet: projectCode, activite: z.string().trim().max(64).optional(), heures: hours, date: z.string().refine(isIsoDate).optional() })).max(500).optional(),
});

const absenceData = z.object({
  /** Cursus's absence id (an integer in Cursus's contract; a string accepted). */
  absence: z.union([z.number().int().nonnegative(), ident(100)]).optional(),
  matricule,
  du: z.string().refine(isIsoDate, 'must be a date').optional(),
  au: z.string().refine(isIsoDate, 'must be a date').optional(),
  start: z.string().refine(isIsoDate, 'must be a date').optional(),
  end: z.string().refine(isIsoDate, 'must be a date').optional(),
  debut: z.string().refine(isIsoDate, 'must be a date').optional(),
  fin: z.string().refine(isIsoDate, 'must be a date').optional(),
  nature: z.string().max(100).optional(),
  id: ident(100).optional(),
});

const verdictData = z.object({ chantier: ident(100) });
// R-173 (minimisation): only the request and its decision are kept, never other fields Cursus may add.
const requestData = z.object({
  demande: z.union([ident(100), z.number().int().nonnegative()]),
  /** Cursus: acceptee / refusee. */
  decision: z.string().trim().max(40).optional(),
  /** Keystone's earlier proposal. */
  statut: z.string().trim().max(40).optional(),
});

interface EventBase {
  id: string;
  type: string;
  emittedAt: Date;
  /** Replacement key (an event with the same type and key replaces the previous one); null when none. */
  replaceKey: string | null;
  matricule: string | null;
  /** What the inbox stores (minimised). */
  data: Record<string, unknown>;
}

export type CursusEvent =
  | (EventBase & { kind: 'hours'; week: string; projects: Record<string, number> })
  | (EventBase & { kind: 'absence'; absence: { matricule: string; start: string; end: string; type: LeaveType; id: string | null } })
  | (EventBase & { kind: 'absence-cancelled'; absence: { matricule: string; start: string; end: string; id: string | null } })
  | (EventBase & { kind: 'verdict'; chantier: string })
  | (EventBase & { kind: 'request' })
  | (EventBase & { kind: 'unknown' });

export type ParseResult = { ok: true; event: CursusEvent } | { ok: false; error: string };

const issue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.join('.') || 'body'}: ${i.message}` : 'invalid';
};

/** Validates a received body (already JSON-parsed): the envelope, then the data of a known type. */
export function parseCursusEvent(body: unknown): ParseResult {
  const env = cursusEnvelope.safeParse(body);
  if (!env.success) return { ok: false, error: `Invalid event · ${issue(env.error)}` };
  const { id, type, emis_le } = env.data;
  const data = env.data.donnees ?? env.data.data ?? {};
  const base = { id, type, emittedAt: new Date(emis_le) };
  switch (type) {
    case 'heures.validees': {
      const d = hoursData.safeParse(data);
      if (!d.success) return { ok: false, error: `Invalid heures.validees · ${issue(d.error)}` };
      return {
        ok: true,
        event: { ...base, kind: 'hours', week: d.data.semaine, projects: d.data.projets, matricule: d.data.matricule, replaceKey: `${d.data.matricule}|${d.data.semaine}`, data: d.data },
      };
    }
    case 'absence.validee':
    case 'absence.annulee': {
      const d = absenceData.safeParse(data);
      if (!d.success) return { ok: false, error: `Invalid ${type} · ${issue(d.error)}` };
      const start = d.data.du ?? d.data.start ?? d.data.debut;
      const end = d.data.au ?? d.data.end ?? d.data.fin;
      if (!start || !end) return { ok: false, error: `Invalid ${type} · du and au are required` };
      if (end < start) return { ok: false, error: `Invalid ${type} · the absence ends before it starts` };
      // Refused here (400: Cursus must not retry it as is) rather than failing the storage (503: retried forever).
      if (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) > MAX_ABSENCE_DAYS * 86_400_000)
        return { ok: false, error: `Invalid ${type} · longer than ${MAX_ABSENCE_DAYS} days` };
      const cursusId = d.data.absence ?? d.data.id;
      const absenceId = cursusId == null ? null : String(cursusId);
      const replaceKey = absenceKey({ id: absenceId, matricule: d.data.matricule, start, end });
      const ref = { matricule: d.data.matricule, start, end, ...(absenceId ? { id: absenceId } : {}) };
      if (type === 'absence.annulee') {
        const a = { matricule: d.data.matricule, start, end, id: absenceId };
        return { ok: true, event: { ...base, kind: 'absence-cancelled', absence: a, matricule: a.matricule, replaceKey, data: ref } };
      }
      // R-173: the nature (the reason) is reduced to Leave / Absence here and never stored. Cursus never sends it: Absence.
      const a = { matricule: d.data.matricule, start, end, type: leaveTypeOfNature(d.data.nature), id: absenceId };
      return {
        ok: true,
        event: { ...base, kind: 'absence', absence: a, matricule: a.matricule, replaceKey, data: { matricule: a.matricule, start, end, type: a.type, ...(absenceId ? { id: absenceId } : {}) } },
      };
    }
    case 'verdict.modifie': {
      const d = verdictData.safeParse(data);
      if (!d.success) return { ok: false, error: `Invalid verdict.modifie · ${issue(d.error)}` };
      return { ok: true, event: { ...base, kind: 'verdict', chantier: d.data.chantier, matricule: null, replaceKey: null, data: { chantier: d.data.chantier } } };
    }
    case 'demande.decision': {
      const d = requestData.safeParse(data);
      if (!d.success) return { ok: false, error: `Invalid demande.decision · ${issue(d.error)}` };
      // Cursus names the decision `decision` (acceptee / refusee); `statut` is Keystone's earlier name — both stored as `statut`.
      const statut = d.data.decision ?? d.data.statut;
      return { ok: true, event: { ...base, kind: 'request', matricule: null, replaceKey: null, data: { demande: d.data.demande, ...(statut ? { statut } : {}) } } };
    }
    default:
      // Unknown types are accepted and ignored; their data is not kept (nothing reads it, it may hold personal data).
      return { ok: true, event: { ...base, kind: 'unknown', matricule: null, replaceKey: null, data: {} } };
  }
}

/** Events received before this instant are purged (13 months before `now`, calendar months). */
export function cursusEventsCutoff(now: Date, months = CURSUS_EVENT_RETENTION_MONTHS): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}
