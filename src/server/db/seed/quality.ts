// Quality seed: the client deliverables register with RACI-B (HLT_DELIVS 3515 for HLT-026; the prototype's generated
// D-110…D-113 — HLT_DELIVS[0..3] with R = the project's PM — for the 5 other projects with data; none for projects
// without data). The prototype's `acc` text is split into dates and people (schema/quality.ts). NCRs are seeded into
// the Vigie mirror (seed/vigie.ts).
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { RACI_CODES, addDaysIso, deliverableStatus, deliverableType, isoOfDisplayDate, type DeliverableStatus } from '../codes';
import { deliverableRaci, deliverables } from '../schema';
import type { Tx } from '../types';
import { must, newId, personIdOrNull, type SeedCtx } from './context';
import { forwardIso } from './dates';

export interface ProtoDeliverable {
  id: string; title: string; type: string; wbs: string; due: string; status: string; raci: Record<'R' | 'A' | 'C' | 'I' | 'B', string>; rev: string; acc: string;
}

const HLT = 'HLT-026';

/** Deliverables of a project as the prototype builds them (`allDlv` 4630). */
export function protoDeliverables(code: string, pm: string): ProtoDeliverable[] {
  const base = PROTO.HLT_DELIVS as ProtoDeliverable[];
  if (code === HLT) return base;
  return base.slice(0, 4).map((d, i) => ({ ...d, id: 'D-1' + (10 + i), raci: { ...d.raci, R: pm } }));
}

/** The acceptance fields behind a prototype `acc` text. */
export function acceptanceOf(acc: string, status: DeliverableStatus): {
  issueOn: string | null; submittedOn: string | null; acceptanceDueOn: string | null; acceptedOn: string | null; acceptedByName: string | null;
  rejectedOn: string | null; reviewComments: string | null;
} {
  const none = { issueOn: null, submittedOn: null, acceptanceDueOn: null, acceptedOn: null, acceptedByName: null, rejectedOn: null, reviewComments: null };
  if (!acc || acc === '—') return none;
  let m = /^Accept by (.+)$/.exec(acc);
  if (m) {
    const due = isoOfDisplayDate(m[1])!;
    return { ...none, acceptanceDueOn: due, submittedOn: addDaysIso(due, -10) };
  }
  m = /^Issue (.+)$/.exec(acc);
  if (m) return { ...none, issueOn: isoOfDisplayDate(m[1]) };
  m = /^(\d{1,2} \w{3}) · (.+)$/.exec(acc);
  if (m && status === 'accepted') return { ...none, acceptedOn: isoOfDisplayDate(m[1]), acceptedByName: m[2] };
  if (m && status === 'rejected') return { ...none, rejectedOn: isoOfDisplayDate(m[1]), reviewComments: m[2] };
  throw new Error(`Seed: unparseable acceptance "${acc}"`);
}

export async function seedQuality(tx: Tx, ctx: SeedCtx): Promise<void> {
  const pmOf = new Map(PROTO_GEN.initialProjects.map((p) => [p.code as string, p.pm as string]));
  const rows: (typeof deliverables.$inferInsert)[] = [];
  const raci: (typeof deliverableRaci.$inferInsert)[] = [];
  for (const code of Object.keys(PROTO_GEN.projectData)) {
    const projectId = must(ctx.projectByCode, code, 'project');
    protoDeliverables(code, pmOf.get(code) ?? '').forEach((d, position) => {
      const status = deliverableStatus.code(d.status);
      const acc = acceptanceOf(d.acc, status);
      const id = newId();
      rows.push({
        id, projectId, number: d.id, title: d.title, type: deliverableType.code(d.type), wbsCode: d.wbs, wbsNodeId: ctx.wbs.get(code)?.get(d.wbs) ?? null,
        dueOn: forwardIso(d.due, status === 'accepted' || status === 'rejected'), status, revision: d.rev && d.rev !== '—' ? d.rev : null, ...acc,
        acceptedByPersonId: personIdOrNull(ctx, acc.acceptedByName), position,
      });
      for (const role of RACI_CODES) if (d.raci[role]) raci.push({ deliverableId: id, role, name: d.raci[role], personId: personIdOrNull(ctx, d.raci[role]) });
    });
  }
  if (rows.length) await tx.insert(deliverables).values(rows);
  if (raci.length) await tx.insert(deliverableRaci).values(raci);
}
