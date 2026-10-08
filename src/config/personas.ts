// Personas available in "View as" (PERSONAS, design line 3747). Stand-in for real authentication.
import { initials, shortName } from '@/lib/format';
import type { RoleKey } from './screens';

export interface Persona {
  role: RoleKey;
  name: string;
  /** EN source string — render through t(). */
  title: string;
  initials: string;
  /** Short form used in project data, e.g. "R. Aubert". */
  short: string;
}

const P: [RoleKey, string, string][] = [
  ['director', 'Marie Lefebvre', 'Portfolio director'],
  ['pm', 'Romain Aubert', 'Project manager'],
  ['depthead', 'Marion Kerviel', 'Head of engineering'],
  ['member', 'Julien Wagner', 'Structural engineer'],
  ['englead', 'Antoine Girard', 'Engineering lead'],
  ['quality', 'Gabriel Comte', 'Quality manager'],
  ['procurement', 'Fabien Bertrand', 'Procurement & stock'],
  ['client', 'Nadia Bensaïd', 'Client — Port authority'],
];

export const PERSONAS: Persona[] = P.map(([role, name, title]) => ({ role, name, title, initials: initials(name), short: shortName(name) }));
export const PERSONA_BY_ROLE = Object.fromEntries(PERSONAS.map((p) => [p.role, p])) as Record<RoleKey, Persona>;
export const DEFAULT_ROLE: RoleKey = 'director';
export const isRole = (v: unknown): v is RoleKey => typeof v === 'string' && v in PERSONA_BY_ROLE;

/** Client organisation owned by the client persona (isMineP for role client). */
export const CLIENT_ORG = 'Port authority';
