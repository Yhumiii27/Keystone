// R-186 (AC-4): the demo machine catalogue — a few entries built on the standard machine types, in each status: EMP-40T v1
// published and its v2 draft (a new version being prepared), MEMU-16 v1 published, SPUR-2X v1 retired. Dated before the demo
// day (DEMO_TODAY_ISO, 25 Sep 2026). The production seed has no catalogue entry (the director and the engineering lead create
// them). Typed text is French data, shown as typed.
import { addDaysIso } from '../codes';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { eq, sql } from 'drizzle-orm';
import { auditEntries, machineCatalogueEntries } from '../schema';
import type { DB, Tx } from '../types';

const at = (daysBefore: number) => new Date(`${addDaysIso(DEMO_TODAY_ISO, -daysBefore)}T08:00:00Z`);

type Entry = typeof machineCatalogueEntries.$inferInsert;

const EMP_40T = {
  code: 'EMP-40T', machineTypeCode: 'EMP', variant: 'Quai 40 t', label: 'Portique de manutention 40 t',
  description: 'Portique sur rails pour quai portuaire, levage 40 t, portée 30 m, pilotage cabine.',
  nominalCapacity: 40, capacityUnit: 't',
} as const;

/** The demo catalogue versions (DEMO_CATALOGUE.length rows). */
export const DEMO_CATALOGUE: Entry[] = [
  {
    ...EMP_40T, version: 1, status: 'published', indicativePriceKeur: 4200, leadTimeWeeks: 52,
    options: [
      { code: 'TELE', libelle: 'Télécommande radio', prix_indicatif_keur: 18 },
      { code: 'ANTI-COL', libelle: 'Anticollision laser', prix_indicatif_keur: 45 },
    ],
    publishedAt: at(120), createdAt: at(150), updatedAt: at(120),
  },
  {
    ...EMP_40T, version: 2, status: 'draft', indicativePriceKeur: 4350, leadTimeWeeks: 48,
    options: [
      { code: 'TELE', libelle: 'Télécommande radio', prix_indicatif_keur: 18 },
      { code: 'ANTI-COL', libelle: 'Anticollision laser', prix_indicatif_keur: 45 },
      { code: 'SUPERV', libelle: 'Supervision à distance', prix_indicatif_keur: 60 },
    ],
    createdAt: at(10), updatedAt: at(3),
  },
  {
    code: 'MEMU-16', version: 1, machineTypeCode: 'MEMU', variant: 'Unité mobile 16 t/h', label: 'Unité mobile de fabrication 16 t/h',
    description: 'Unité mobile de fabrication sur conteneurs, 16 t/h, mise en service sur site en 4 semaines.', nominalCapacity: 16, capacityUnit: 't/h',
    indicativePriceKeur: 1850, leadTimeWeeks: 36, status: 'published',
    options: [{ code: 'GEN', libelle: 'Groupe électrogène embarqué', prix_indicatif_keur: 95 }],
    publishedAt: at(90), createdAt: at(100), updatedAt: at(90),
  },
  {
    code: 'SPUR-2X', version: 1, machineTypeCode: 'SPUR', variant: null, label: 'Unité de purification double ligne',
    description: 'Remplacée par une offre sur mesure.', nominalCapacity: null, capacityUnit: null, indicativePriceKeur: 2600, leadTimeWeeks: 40,
    status: 'retired', options: [], publishedAt: at(300), retiredAt: at(60), createdAt: at(320), updatedAt: at(60),
  },
];

export async function seedDemoCatalogue(tx: Tx): Promise<void> {
  await tx.insert(machineCatalogueEntries).values(DEMO_CATALOGUE);
}

/**
 * A demo database seeded before R-186: no catalogue row and no catalogue change in the audit trail (a catalogue whose drafts were
 * all discarded is left as it is). Backfilled once (index.ts).
 */
export async function demoCatalogueToBackfill(db: DB | Tx): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(machineCatalogueEntries);
  if (n > 0) return false;
  const [{ a }] = await db.select({ a: sql<number>`count(*)::int` }).from(auditEntries).where(eq(auditEntries.entityType, 'machine_catalogue_entry'));
  return a === 0;
}
