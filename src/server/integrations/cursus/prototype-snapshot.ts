// Seed of the Cursus mirror: the prototype's SITE_DOCS (3574) as Cursus would report them — one person per row with
// their visa, vaccination and clearance approvals, the verdict and when it was received. Pure (no database).
import { cursusClearance, cursusVaccination, cursusVerdict, cursusVisa, parseStampText } from '@/server/db/codes';
import type { CursusClearanceRecord } from './types';

/** Prototype row: [who, visa, vaccinations, clearances & badges, note, verdict, received "26 Sep 07:00"]. */
export type ProtoSiteDocRow = [string, string, string, string, string, string, string];

/** Time of the last Cursus sync in the prototype (CONNECTORS: "26 Sep 07:00 · 5 people · HLT-026"). */
export const CURSUS_SEED_SYNC = '26 Sep 07:00';

/** Cursus reason codes implied by the approvals (Cursus `resourceStatus`: HABILITATION, FORMALITES_VOYAGE). */
export function reasonCodesOf(r: Pick<CursusClearanceRecord, 'visa' | 'vaccination' | 'clearance'>): string[] {
  const codes: string[] = [];
  if (r.clearance !== 'ok') codes.push('HABILITATION');
  if (r.visa === 'pending' || r.vaccination === 'pending') codes.push('FORMALITES_VOYAGE');
  return codes;
}

export function prototypeClearanceSnapshot(rows: ProtoSiteDocRow[], projectCode: string): CursusClearanceRecord[] {
  return rows.map(([who, visa, vacc, hab, note, verdict, received]) => {
    const rec = { visa: cursusVisa.code(visa), vaccination: cursusVaccination.code(vacc), clearance: cursusClearance.code(hab) };
    return {
      projectCode, chantierId: null, matricule: null, personName: who, ...rec, clearanceNote: note, verdict: cursusVerdict.code(verdict),
      reasonCodes: reasonCodesOf(rec), receivedAt: parseStampText(received).toISOString(),
    };
  });
}
