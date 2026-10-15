// @mentions in task comments (R-8b a, R-149): "@Julien Wagner" or "@J. Wagner" names a person. Pure: the DAL resolves the
// mentions of a posted comment among the people who can be told (an active internal account), the task sheet highlights them.
//
// Rule: an "@" at the start of the text or after a character that is not a letter or a digit (an e-mail address is not a
// mention), followed by a person's full name or short name, ignoring case and accents, and ending at the end of the text or
// before a character that is not a letter or a digit ("@J. Wagner," matches, "@J. Wagnerx" does not). Several names can
// match at one "@": the longest wins ("@Julien Wagner" over a shorter "@Julien"). A name held by several people (two persons
// with the same full name) is ambiguous and mentions nobody — their unique short name does. No suggestion list in this
// delivery (absent from the prototype — owner to confirm): the names are typed.

/** A person who can be mentioned: `key` identifies them (person id in the DAL), full name nullable, short name unique. */
export interface MentionCandidate {
  key: string;
  fullName: string | null;
  shortName: string;
}

/** One mention found in a text: its character range (the "@" included) and the person's key. */
export interface MentionMatch {
  start: number;
  end: number;
  key: string;
}

const WORD = /[\p{L}\p{N}]/u;

/** Lower case without accents; any white space as one plain space. One output char per input char (mapping kept). */
function foldChar(c: string): string {
  if (/\s/u.test(c)) return ' ';
  return c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function fold(s: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    for (const ch of foldChar(s[i])) {
      folded += ch;
      map.push(i);
    }
  }
  map.push(s.length);
  return { folded, map };
}

const foldName = (s: string) => fold(s.trim().replace(/\s+/g, ' ')).folded;

/** Names → the keys holding them (a name held by two persons is ambiguous). Longest names first. */
function nameIndex(people: readonly MentionCandidate[]): { name: string; keys: Set<string> }[] {
  const byName = new Map<string, Set<string>>();
  for (const p of people) {
    for (const n of [p.fullName, p.shortName]) {
      const f = n ? foldName(n) : '';
      if (!f) continue;
      byName.set(f, (byName.get(f) ?? new Set()).add(p.key));
    }
  }
  return [...byName.entries()].map(([name, keys]) => ({ name, keys })).sort((a, b) => b.name.length - a.name.length);
}

/** Every mention of the text, in order (non-overlapping). */
export function findMentions(text: string, people: readonly MentionCandidate[]): MentionMatch[] {
  if (!text || !people.length || !text.includes('@')) return [];
  const names = nameIndex(people);
  const { folded, map } = fold(text);
  const out: MentionMatch[] = [];
  let i = 0;
  while (i < folded.length) {
    const at = folded.indexOf('@', i);
    if (at < 0) break;
    i = at + 1;
    if (at > 0 && WORD.test(folded[at - 1])) continue;
    const rest = folded.slice(at + 1);
    const hit = names.find((n) => rest.startsWith(n.name) && !WORD.test(rest[n.name.length] ?? ''));
    if (!hit || hit.keys.size !== 1) continue;
    const endFolded = at + 1 + hit.name.length;
    out.push({ start: map[at], end: map[endFolded], key: [...hit.keys][0] });
    i = endFolded;
  }
  return out;
}

/** Distinct keys of the people mentioned, in order of first mention. */
export function mentionedKeys(text: string, people: readonly MentionCandidate[]): string[] {
  return [...new Set(findMentions(text, people).map((m) => m.key))];
}

/** The text cut into plain parts and mentions (the task sheet highlights the mentions). */
export function mentionParts(text: string, people: readonly MentionCandidate[]): { text: string; mention: boolean }[] {
  const parts: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of findMentions(text, people)) {
    if (m.start > last) parts.push({ text: text.slice(last, m.start), mention: false });
    parts.push({ text: text.slice(m.start, m.end), mention: true });
    last = m.end;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false });
  return parts;
}

/** Notification excerpt of a comment: one line, at most `max` characters ("…" when cut). */
export function mentionExcerpt(text: string, max = 120): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : line.slice(0, max - 1).trimEnd() + '…';
}
