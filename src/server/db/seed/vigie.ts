// Vigie ECO mirror seed: the prototype's ECOS as Vigie would report them (status, effectivity and lock derived once
// by prototypeEcoSnapshot), written through the connector's own mirror writer. No progress is queued.
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { upsertMirror } from '@/server/integrations/vigie/mirror';
import { mirrorSeedInstant, prototypeEcoSnapshot, type ProtoEcoRow } from '@/server/integrations/vigie/prototype-snapshot';
import type { Tx } from '../types';
import type { ProtoPart } from './catalogue';

export async function seedVigie(tx: Tx): Promise<void> {
  const records = prototypeEcoSnapshot({
    ecos: PROTO.ECOS as ProtoEcoRow[],
    projects: (PROTO_GEN.initialProjects as { code: string; status: string; pm: string }[]).map(({ code, status, pm }) => ({ code, status, pm })),
    usage: Object.fromEntries((PROTO.PARTS as ProtoPart[]).map((p) => [p.ref, p.usage])),
    projectNames: PROTO.PROJ_NAMES,
    fleet: PROTO.FLEET,
    asMaintained: PROTO.AS_MAINT,
    englead: 'Antoine Girard',
    quality: 'Gabriel Comte',
  });
  await upsertMirror(tx, records, mirrorSeedInstant());
}
