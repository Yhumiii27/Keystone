// Cursus staff directory → Keystone persons (R-027, NEW-CURSUS-2 "a") — pure matching. Cursus is the HR source of EPC2i's
// staff: each entry is { matricule, nom, prenom, email, equipe }. Rules (defaults, owner to confirm in
// docs/delivery-8/notes-connectors.md):
// - an entry matches the person carrying its matricule; else the one EPC2i person (no client organisation) with its work
//   e-mail (case-insensitive) — external contacts are never matched nor touched;
// - an e-mail held by several persons matches nobody and is reported (sign-in refuses such an e-mail too); an e-mail held by an
//   external contact is reported (no second person with an existing e-mail is ever created);
// - an entry matching nobody becomes a new person: full name "Prénom Nom", short name "P. Nom" (made unique with " (2)",
//   " (3)"…), initials "PN" — never a user account nor a role (Entra ID gives them at sign-in, R-038);
// - a matched person keeps its short name (records cite people by it), its full name and its e-mail when it has them (a
//   name typed in Keystone and the sign-in identity are never overwritten); missing ones are filled in;
// - the team maps to a department only when the names are exactly equal; otherwise the team is kept as text and logged;
// - nothing is ever deleted (a person absent from the directory stays).

export interface DirectoryEntry {
  matricule: string;
  nom: string;
  prenom: string;
  email: string | null;
  equipe: string | null;
}

export interface DirectoryPerson {
  id: string;
  fullName: string | null;
  shortName: string;
  email: string | null;
  matricule: string | null;
  clientId: string | null;
  departmentId: string | null;
  directoryTeam: string | null;
}

export interface DirectoryUpdate {
  personId: string;
  /** Only the fields that change. */
  set: { matricule?: string; fullName?: string; email?: string; departmentId?: string; directoryTeam?: string | null };
}

export interface DirectoryCreate {
  matricule: string;
  fullName: string;
  shortName: string;
  initials: string;
  email: string | null;
  departmentId: string | null;
  directoryTeam: string | null;
}

export interface DirectoryReport {
  matricule: string;
  /** EN reason (no name or e-mail: logs and audit stay free of personal data beyond the matricule). */
  reason: string;
}

export interface DirectoryPlan {
  /** Persons matched (changed or not): their id per matricule. */
  matched: { matricule: string; personId: string }[];
  updates: DirectoryUpdate[];
  creates: DirectoryCreate[];
  reports: DirectoryReport[];
  /** Teams that match no department (kept as text). */
  unmatchedTeams: string[];
}

const MATRICULE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;
const clean = (s: unknown, max = 120) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** A raw directory row as Cursus sends it, validated (null when unusable). */
export function directoryEntryOf(raw: unknown): DirectoryEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const matricule = clean(r.matricule, 64);
  const nom = clean(r.nom);
  const prenom = clean(r.prenom);
  if (!MATRICULE.test(matricule) || !nom || !prenom) return null;
  const email = clean(r.email, 320).toLowerCase();
  const equipe = clean(r.equipe);
  return { matricule, nom, prenom, email: EMAIL.test(email) ? email : null, equipe: equipe || null };
}

/** "J. Wagner" from Julien / Wagner (first letter of each part of a compound first name: "J.-P. Martin"). */
export function shortNameOf(prenom: string, nom: string): string {
  const initials = prenom.split('-').map((p) => p.trim()).filter(Boolean).map((p) => `${[...p][0].toUpperCase()}.`).join('-');
  return `${initials} ${nom}`.trim();
}

/** "JW" (first letters of the first and last names). */
export function initialsOf(prenom: string, nom: string): string {
  return `${[...prenom][0] ?? ''}${[...nom][0] ?? ''}`.toUpperCase();
}

/** A short name not in `taken` (" (2)", " (3)"… on collision); adds it to `taken`. */
export function uniqueShortName(base: string, taken: Set<string>): string {
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} (${i})`;
  taken.add(name.toLowerCase());
  return name;
}

/** What importing `entries` does to `persons` (pure; the DAL applies it in one transaction). */
export function planDirectoryImport(
  entries: readonly DirectoryEntry[], persons: readonly DirectoryPerson[], departments: readonly { id: string; name: string }[],
): DirectoryPlan {
  const plan: DirectoryPlan = { matched: [], updates: [], creates: [], reports: [], unmatchedTeams: [] };
  const byMatricule = new Map(persons.filter((p) => p.matricule).map((p) => [p.matricule!, p]));
  const byEmail = new Map<string, DirectoryPerson[]>();
  for (const p of persons) if (p.email) byEmail.set(p.email.toLowerCase(), [...(byEmail.get(p.email.toLowerCase()) ?? []), p]);
  const deptByName = new Map(departments.map((d) => [d.name, d.id]));
  const taken = new Set(persons.map((p) => p.shortName.toLowerCase()));
  const seen = new Set<string>();
  const claimed = new Set<string>();
  const createdEmails = new Set<string>();
  const teams = new Set<string>();
  for (const raw of entries) {
    // E-mails compare case-insensitively whoever built the entry (directoryEntryOf already lower-cases them).
    const e = { ...raw, email: raw.email ? raw.email.trim().toLowerCase() || null : null };
    if (seen.has(e.matricule)) {
      plan.reports.push({ matricule: e.matricule, reason: 'Matricule listed twice in the directory' });
      continue;
    }
    seen.add(e.matricule);
    const dept = e.equipe ? (deptByName.get(e.equipe) ?? null) : null;
    if (e.equipe && !dept) teams.add(e.equipe);
    const team = { departmentId: dept, directoryTeam: dept ? null : e.equipe };
    let person = byMatricule.get(e.matricule) ?? null;
    if (!person && e.email) {
      const holders = byEmail.get(e.email) ?? [];
      if (holders.length > 1) {
        plan.reports.push({ matricule: e.matricule, reason: 'E-mail held by several persons: not matched' });
        continue;
      }
      if (holders.length === 1) {
        const h = holders[0];
        if (h.clientId) {
          plan.reports.push({ matricule: e.matricule, reason: 'E-mail held by an external contact: not matched' });
          continue;
        }
        if (h.matricule && h.matricule !== e.matricule) {
          plan.reports.push({ matricule: e.matricule, reason: 'E-mail held by a person with another matricule: not matched' });
          continue;
        }
        person = h;
      }
    }
    if (person) {
      if (person.clientId) {
        plan.reports.push({ matricule: e.matricule, reason: 'Matricule held by an external contact: not touched' });
        continue;
      }
      if (claimed.has(person.id)) {
        plan.reports.push({ matricule: e.matricule, reason: 'Person already matched by another entry' });
        continue;
      }
      claimed.add(person.id);
      plan.matched.push({ matricule: e.matricule, personId: person.id });
      const set: DirectoryUpdate['set'] = {};
      if (person.matricule !== e.matricule) set.matricule = e.matricule;
      if (!person.fullName) set.fullName = `${e.prenom} ${e.nom}`;
      // A missing work e-mail is filled in only when no other person holds it (sign-in refuses an ambiguous e-mail).
      if (!person.email && e.email && !(byEmail.get(e.email)?.length) && !createdEmails.has(e.email)) {
        set.email = e.email;
        createdEmails.add(e.email);
      }
      if (team.departmentId && team.departmentId !== person.departmentId) set.departmentId = team.departmentId;
      if (team.directoryTeam !== person.directoryTeam) set.directoryTeam = team.directoryTeam;
      if (Object.keys(set).length) plan.updates.push({ personId: person.id, set });
      continue;
    }
    if (e.email && createdEmails.has(e.email)) {
      plan.reports.push({ matricule: e.matricule, reason: 'E-mail given to another new person of the directory: not created' });
      continue;
    }
    if (e.email) createdEmails.add(e.email);
    plan.creates.push({
      matricule: e.matricule, fullName: `${e.prenom} ${e.nom}`, shortName: uniqueShortName(shortNameOf(e.prenom, e.nom), taken), initials: initialsOf(e.prenom, e.nom),
      email: e.email, departmentId: team.departmentId, directoryTeam: team.directoryTeam,
    });
  }
  plan.unmatchedTeams = [...teams].sort();
  return plan;
}
