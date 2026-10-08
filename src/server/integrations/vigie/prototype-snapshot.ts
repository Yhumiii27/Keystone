// Seed of the Vigie ECO mirror: the prototype's ECOS (3432) as Vigie would report them. The prototype derived the
// displayed status, the effectivity targets and their dispositions at render time (`allEcos` / `ecoTargets`,
// logic 4182–4193) from the project stages, the installed base (FLEET 3729, AS_MAINT 3722) and the approvals;
// Vigie computes them now, so the seed materialises that derivation once. Pure (no database).
import {
  STATUS_ISO, ecoStatus, isoOfDisplayDate, parisInstant, stage as stageCodec, OPEN_BOM_STAGES,
  type EcoApproverKey, type EcoDecision, type EcoDisposition, type EcoType, type Interchangeability, type StageCode,
} from '@/server/db/codes';
import type { VigieEcoRecord } from './types';

/** Prototype ECO row (ECOS 3432). */
export interface ProtoEcoRow {
  id: string;
  title: string;
  type: EcoType;
  status: string;
  interch?: Interchangeability | null;
  from: string;
  to: string;
  disp?: Record<string, EcoDisposition>;
  dnote?: Record<string, string>;
  parts: string[];
  /** 3-letter project keys ("HLT"). */
  projects: string[];
  by: string;
  date: string;
  cost: number;
  sched: number;
  stock: string;
  docs: string[];
  appr: Record<EcoApproverKey, EcoDecision>;
}

export interface SnapshotContext {
  ecos: ProtoEcoRow[];
  /** Portfolio projects in register order (`allP`): code, stage label, PM short name. */
  projects: { code: string; status: string; pm: string }[];
  /** `PARTS[].usage` by reference. */
  usage: Record<string, Record<string, number>>;
  /** PROJ_NAMES (short display names by 3-letter key). */
  projectNames: Record<string, string>;
  /** FLEET rows: [id, type, name, client, location, project, warranty start, warranty end, warranty status]. */
  fleet: string[][];
  /** AS_MAINT: machine id → { gen, parts: { ref: revision } }. */
  asMaintained: Record<string, { gen: string; parts: Record<string, string> }>;
  /** Fixed approvers of the englead and quality keys (ecoVals 4363). */
  englead: string;
  quality: string;
}

const KEYS: EcoApproverKey[] = ['englead', 'quality', 'pm'];

/** Refresh time stamped on the seeded mirror: the status date (Fri 25 Sep 2026) at 07:30, Paris (no Vigie sync exists yet). */
export const MIRROR_SEED_TIME = '07:30';
export const mirrorSeedInstant = () => parisInstant(STATUS_ISO, MIRROR_SEED_TIME);

/** The ECOs as Vigie reports them (status, effectivity, pending dispositions and lock derived as in the prototype). */
export function prototypeEcoSnapshot(c: SnapshotContext): VigieEcoRecord[] {
  /** projOf3: first project whose code starts with the key. */
  const projOf3 = (k: string) => c.projects.find((p) => p.code.startsWith(k)) ?? null;
  const usedIn = (ref: string) => Object.keys(c.usage[ref] ?? {}).filter((k) => (c.usage[ref][k] ?? 0) > 0);
  const openBom = (label: string) => {
    let code: StageCode | null = null;
    try { code = stageCodec.code(label); } catch { code = null; }
    return !!code && OPEN_BOM_STAGES.includes(code);
  };
  return c.ecos.map((e) => {
    const inter = e.interch === undefined ? null : e.interch;
    const disp = e.disp ?? {};
    const notes = e.dnote ?? {};
    const keys = [...new Set([...e.projects, ...e.parts.flatMap(usedIn)])];
    const projects = keys.map((k) => {
      const pr = projOf3(k);
      const open = !!pr && openBom(pr.status);
      const explicit = disp[k];
      const d = explicit !== undefined ? explicit : open ? 'update' : null;
      return {
        targetType: 'project' as const, targetRef: pr?.code ?? k, label: c.projectNames[k] ?? k, disposition: d, isAutomatic: explicit === undefined && open,
        note: notes[k] || null, fittedPartRef: null, fittedRevision: null,
      };
    });
    const machines = c.fleet
      .filter((m) => c.asMaintained[m[0]] && e.parts.some((r) => c.asMaintained[m[0]].parts[r] !== undefined))
      .map((m) => {
        const am = c.asMaintained[m[0]];
        const ref = e.parts.find((r) => am.parts[r] !== undefined)!;
        const explicit = disp[m[0]];
        const d = explicit !== undefined ? explicit : inter === 'no' ? 'pinned' : null;
        return {
          targetType: 'machine' as const, targetRef: m[0], label: m[2], disposition: d, isAutomatic: explicit === undefined && inter === 'no',
          note: notes[m[0]] || null, fittedPartRef: ref, fittedRevision: am.parts[ref],
        };
      });
    const effectivity = [...projects, ...machines];
    const pending = effectivity.filter((t) => !t.disposition).length;
    const allOk = KEYS.every((k) => e.appr[k] === 'ok');
    const anyRej = KEYS.some((k) => e.appr[k] === 'rejected');
    const base = ecoStatus.code(e.status);
    const locked = allOk && base !== 'draft' && !anyRej && (pending > 0 || inter === null);
    const status = anyRej ? 'rejected' : allOk && base !== 'draft' ? (locked ? 'in_approval' : 'released') : base;
    const pms = e.projects.map((k) => projOf3(k)?.pm || k).join(', ');
    const approver: Record<EcoApproverKey, string> = { englead: c.englead, quality: c.quality, pm: pms };
    return {
      number: e.id, title: e.title, type: e.type, status, interchangeability: inter, fromRevision: e.from, toRevision: e.to, costEur: e.cost,
      scheduleDays: e.sched, stockImpact: e.stock, documentRefs: e.docs, requestedBy: e.by, raisedOn: isoOfDisplayDate(e.date)!,
      pendingDispositions: pending, locked, parts: e.parts,
      projects: e.projects.map((k) => projOf3(k)?.code ?? k),
      approvals: KEYS.map((k) => ({ key: k, decision: e.appr[k], approver: approver[k], decidedBy: e.appr[k] === 'pending' ? null : approver[k], decidedAt: null })),
      effectivity, updatedAt: null,
    };
  });
}
