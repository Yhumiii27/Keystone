import 'server-only';
// My work read model (docs/spec/10 §6.4 a, c): the person whose work is shown — name, initials, job title, weekly
// loads from the shared resource pool — and the people a manager can switch to. Tasks themselves come from
// src/server/dal/tasks.ts (listTasks / getTask).
import { cache } from 'react';
import { getPersonByName } from './people';
import { getResourcePool } from './resources';

export interface MyWorkPerson {
  /** Full name ("Hélène Sauvage"). */
  name: string;
  initials: string;
  /** EN source string ("QA / QC"); null when unknown. */
  jobTitle: string | null;
  /** Weekly loads % of the 8-week pool window (first = next week); null when the person is not in the pool. */
  loads: number[] | null;
}

export interface MyWorkPersonOption {
  name: string;
  initials: string;
  jobTitle: string | null;
}

const pool = cache(getResourcePool);

/** Person by full or short name with their pool loads; null when unknown. */
export async function getMyWorkPerson(name: string): Promise<MyWorkPerson | null> {
  const [p, { people }] = await Promise.all([getPersonByName(name), pool()]);
  if (!p) return null;
  const inPool = people.find((x) => x.name === p.name);
  return { name: p.name, initials: p.initials, jobTitle: p.jobTitle, loads: inPool ? inPool.loads : null };
}

/** People a manager can open My work for: the resource pool (PEOPLE order — Resources rows, Approvals team list). */
export async function listMyWorkPeople(): Promise<MyWorkPersonOption[]> {
  const { people } = await pool();
  return people.map((p) => ({ name: p.name, initials: p.initials, jobTitle: p.jobTitle }));
}
