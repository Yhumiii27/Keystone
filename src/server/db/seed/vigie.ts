// Vigie mirrors seed: the prototype's ECOS as Vigie would report them (status, effectivity and lock derived once by
// prototypeEcoSnapshot), the project NCRs (HLT_NCRS + the generated NCR-040/041 of the other projects with data) and the
// site HSE register (SITE_HSE), written through the connector's own mirror writers. No progress is queued.
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { upsertMirror } from '@/server/integrations/vigie/mirror';
import {
  mirrorSeedInstant, prototypeEcoSnapshot, prototypeHseSnapshot, prototypeNcrSnapshot, type ProtoEcoRow, type ProtoNcrRow,
} from '@/server/integrations/vigie/prototype-snapshot';
import { upsertHseMirror, upsertNcrMirror } from '@/server/integrations/vigie/quality-mirror';
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

/** Delivery 5: the Vigie NCR and site HSE mirrors. */
export async function seedVigieQuality(tx: Tx): Promise<void> {
  const at = mirrorSeedInstant();
  await upsertNcrMirror(tx, prototypeNcrSnapshot(PROTO.HLT_NCRS as ProtoNcrRow[], Object.keys(PROTO_GEN.projectData)), at);
  await upsertHseMirror(tx, prototypeHseSnapshot(PROTO.SITE_HSE as [string, string, string][], PROTO.SITE.code as string), at);
}
