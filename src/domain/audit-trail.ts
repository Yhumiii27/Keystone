// Audit trail rules (R-168, spec 11 §3.12): who is a system actor (no user account behind the row), and the generic shapes
// of a stored change text that the screens render in the viewer's language (R-184) without passing typed values through the
// translator. Pure: no I/O, no translation.

/**
 * Actors that are not people: the systems and connectors Keystone exchanges with, Keystone itself (its jobs and automatic
 * steps) and IT's configuration file. Their audit rows carry no user (R-168), whatever person might share the name.
 */
export const SYSTEM_ACTORS: readonly string[] = [
  'System', 'Keystone', 'Lucca', 'Codex', 'Cursus', 'Vigie', 'Sage X3', 'SolidWorks PDM', 'PDM', 'MS Project', 'Microsoft Teams',
  'Outlook / Exchange', 'E-mail (SMTP)', 'IT · configuration file',
];
const SYSTEMS = new Set(SYSTEM_ACTORS.map((s) => s.toLowerCase()));

/** A system actor (one of SYSTEM_ACTORS, any case) or no actor at all. */
export const isSystemActor = (name: string | null | undefined): boolean => {
  const n = (name ?? '').trim().toLowerCase();
  return !n || SYSTEMS.has(n);
};

/** One " · " segment of a stored change text, recognised by shape. */
export type ChangeSegment =
  | { kind: 'status'; from: string; to: string }
  | { kind: 'field'; field: string; from: string; to: string }
  | { kind: 'word'; word: ChangeWord }
  | { kind: 'text'; text: string };

/** Words a writer stores alone as a change ("added", "removed", "enabled"…). */
export const CHANGE_WORDS = ['added', 'removed', 'created', 'deleted', 'enabled', 'disabled', 'restored', 'data scope changed', 'options changed'] as const;
export type ChangeWord = (typeof CHANGE_WORDS)[number];
const WORDS = new Set<string>(CHANGE_WORDS);

/**
 * A change text in its generic shapes: "status: Draft → In review" (status labels are Keystone's vocabulary), "frequency:
 * Every hour → Daily" (a field with its old and new values as typed), a lone word ("added"), else free text.
 */
export function parseChange(change: string): ChangeSegment[] {
  return change.split(' · ').map((seg): ChangeSegment => {
    const status = /^status: (.+?) → (.+)$/.exec(seg);
    if (status) return { kind: 'status', from: status[1], to: status[2] };
    if (WORDS.has(seg)) return { kind: 'word', word: seg as ChangeWord };
    const field = /^([a-z][a-z ]{0,30}): (.*?) → (.*)$/.exec(seg);
    if (field) return { kind: 'field', field: field[1], from: field[2], to: field[3] };
    return { kind: 'text', text: seg };
  });
}
