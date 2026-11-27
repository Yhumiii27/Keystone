// Personas available in "View as" (PERSONAS, design line 3747) — the demo mode's users (KEYSTONE_AUTH=demo). With
// Microsoft Entra ID (KEYSTONE_AUTH=entra) the viewer is the signed-in user instead (src/server/auth/viewer.ts), with
// the same shape (R-039: person, e-mail, roles, department).
import { initials, shortName } from '@/lib/format';
import type { RoleKey } from './screens';

export interface Persona {
  /** Active role: the screens, gating and rights in force. */
  role: RoleKey;
  name: string;
  /** EN source string — render through t(). */
  title: string;
  initials: string;
  /** Short form used in project data, e.g. "R. Aubert" (persons.short_name, unique). */
  short: string;
  /** Every role the user holds, in priority order (a demo persona holds its own role only). */
  roles: RoleKey[];
  /** Sign-in e-mail (lower case). */
  email: string | null;
  /** Department the user belongs to (EN name, "Engineering"); null when none. */
  department: string | null;
  /** persons.id of a signed-in user; null for the demo personas (the data layer resolves them by role). */
  personId: string | null;
  /** users.id of a signed-in user; null for the demo personas (the data layer resolves them by role). */
  userId: string | null;
}

// [role, name, title, e-mail, department] — departments as seeded for these persons (DEPTS heads, DEPT_OF).
const P: [RoleKey, string, string, string, string | null][] = [
  ['director', 'Marie Lefebvre', 'Portfolio director', 'marie.lefebvre@atrium.example', null],
  ['pm', 'Romain Aubert', 'Project manager', 'romain.aubert@atrium.example', null],
  ['depthead', 'Marion Kerviel', 'Head of engineering', 'marion.kerviel@atrium.example', 'Engineering'],
  ['member', 'Julien Wagner', 'Structural engineer', 'julien.wagner@atrium.example', 'Engineering'],
  ['englead', 'Antoine Girard', 'Engineering lead', 'antoine.girard@atrium.example', null],
  ['quality', 'Gabriel Comte', 'Quality manager', 'gabriel.comte@atrium.example', 'Quality'],
  ['procurement', 'Fabien Bertrand', 'Procurement & stock', 'fabien.bertrand@atrium.example', 'Controls & planning'],
  // R-044 (P-4, P-12 c): the Finance persona — the cost controller of the resource pool (no prototype persona).
  ['finance', 'Léa Marchand', 'Cost controller', 'lea.marchand@atrium.example', 'Controls & planning'],
  // R-158 (owner's decision 7, 25 Oct 2026): the Logistics persona — prepares and follows the shipments (no prototype persona;
  // the person is created with its user, src/server/db/seed/users.ts).
  ['logistics', 'Camille Verdier', 'Logistics coordinator', 'camille.verdier@atrium.example', 'Controls & planning'],
  // D9-06 (owner, 10 Nov 2026): the Client persona is removed — clients never see Keystone.
];

export const PERSONAS: Persona[] = P.map(([role, name, title, email, department]) => ({
  role, name, title, initials: initials(name), short: shortName(name), roles: [role], email, department,
  personId: null, userId: null,
}));
export const PERSONA_BY_ROLE = Object.fromEntries(PERSONAS.map((p) => [p.role, p])) as Record<RoleKey, Persona>;
export const DEFAULT_ROLE: RoleKey = 'director';
export const isRole = (v: unknown): v is RoleKey => typeof v === 'string' && v in PERSONA_BY_ROLE;

/** A viewer, or a role standing for its demo persona (data-layer functions accept both; tests pass roles). */
export type PersonaRef = RoleKey | Persona;
export const personaOf = (v: PersonaRef): Persona => (typeof v === 'string' ? PERSONA_BY_ROLE[v] : v);
