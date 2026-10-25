// Production seed (R-011, A-15 "Données réelles seulement"): reference data only. In production Keystone shows only what
// it recorded itself or received from Codex, the PDM, Vigie, Cursus or Sage, so this seed loads no project, no person and
// no record of the prototype — only what the screens need to start:
// - lifecycle stages, transitions and stage deliverables; machine types (payment pattern, phases, cost categories, ITP
//   systems) and the New project templates;
// - the four built-in work calendars;
// - the Settings lists (skills, cost categories, statuses, risk categories, deliverable types, public holidays, location
//   types), the health thresholds, the connectors (listed "Ready", never synced) and the import / export formats;
// - the document types and their approval circuits (without approvers: people come from sign-in, R-039);
// - departments and zones without heads or managers, countries and cities;
// - leave types, the skills matrix columns, the what-if levers, the scoring axes and the departments' demand rates;
// - the engineering disciplines (no lead), consistency rules, import tools and column mapping;
// - R-158: the 11 Incoterms 2020 with their split of responsibilities (Settings › Incoterms);
// - R-178: the five premium multipliers of the rate grid, as PLACEHOLDER factors for the direction to confirm (A-10 — shown
//   and editable on Rate cards; src/domain/rate-defaults.ts), first versions from 1 Jan 2026.
// Clients, suppliers, storage locations, rate roles and people are entered by EPC2i (or arrive through sign-in and connectors).
import type { Tx } from '../types';
import { builtinCalendarRows } from './chapter4';
import { newCtx } from './context';
import { seedDocumentTypes } from './documents';
import { seedEngineeringReference, seedMachineTypeAggregate } from './engineering';
import { seedDepartments, seedGeography } from './organisation';
import { seedPortfolioReference } from './portfolio';
import { seedPrioritisationReference } from './prioritisation';
import { seedRateMultipliers, seedResourceReference } from './resources';
import { seedSettings } from './settings';
import { seedIncoterms } from './shipments';
import { calendars } from '../schema';

/** Lead shown for a discipline without a lead (production). */
export const NO_LEAD = '—';

export async function seedReferenceData(tx: Tx): Promise<void> {
  const ctx = newCtx();
  await seedDepartments(tx, ctx);
  await seedGeography(tx, () => null);
  await seedPortfolioReference(tx, ctx, { rexReferences: false });
  await tx.insert(calendars).values(builtinCalendarRows());
  await seedSettings(tx, { demo: false });
  await seedDocumentTypes(tx);
  await seedResourceReference(tx);
  await seedRateMultipliers(tx);
  await seedPrioritisationReference(tx, ctx);
  await seedEngineeringReference(tx, () => ({ leadName: NO_LEAD, leadPersonId: null }));
  await seedMachineTypeAggregate(tx);
  // R-158 (owner's decision 9): the 11 Incoterms 2020.
  await seedIncoterms(tx);
}
