import 'server-only';
// Read-only access to the prototype data set (design file lines 3095–3762, evaluated to JSON by
// design/_extracted). Seeders read from here; screens must go through the DAL (src/server/dal), which
// may read from here only for modules that are not yet modelled in the database (mark those TODO(db)).
import { demoNcrDeep } from '@/domain/vigie-demo';
import data from './prototype-data.json';
import generated from './prototype-generated.json';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * D13 (Vigie CV-07): an NCR's number is Vigie's EV-… reference. Every NCR number of the data set is renumbered ("NCR-029" →
 * "EV-2026-029", src/domain/vigie-demo.ts): the NCRs, the NCR links of daily reports, punch items, notifications and
 * contingency draw-downs, the texts that cite them and the French dictionary's keys. The generated NCR-040 / NCR-041 are
 * renumbered per project by the NCR snapshot. The golden tests read the prototype's values through `demoNcrGolden`.
 */
export const PROTO = demoNcrDeep(data) as Record<string, any>;
export const PROTO_GEN = generated as { initialProjects: any[]; projectData: Record<string, any>; genPOs: Record<string, any>; nextProjectId: string };
