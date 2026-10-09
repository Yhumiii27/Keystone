// Local rule-based transcript analyser (chapter 4, S-10 default when no ANTHROPIC_API_KEY is configured): deterministic,
// French and English, the transcript never leaves Keystone. Each speaker turn is cut into sentences and ";" clauses, and a
// clause becomes at most one proposal, by the first rule that matches:
//   1. a label — "Decision:", "Décision —", "Action (pour) <Name> :", "Risk:", "Risque :", "Question :";
//   2. a question — ends with "?", or starts with "Est-ce que";
//   3. a decision — "we decided / agreed to", "decision", "approved", "that is the answer to give", "on valide", "c'est
//      acté", "décidé", "validé", "il est convenu"…;
//   4. an action — a commitment of the speaker ("I will / we'll / I need to", "je vais / nous allons / je dois / je m'en
//      charge de", "j'enverrai") or of a named person ("<Name> will / to / must", "<Nom> doit / va / se charge de", "action
//      pour <Nom>"); owner = the speaker or that name (resolved against the speakers and the invitees), due = the first
//      calendar date of the clause ("by 6 October", "pour le 10/10", "d'ici le 3 octobre") — weekdays and "next week" give
//      no date, a date is never invented;
//   5. a risk — "risk", "could delay", "concern", "risque", "pourrait retarder", "point bloquant"…;
//   6. a client question — "client question", "le client demande"…
// Meeting-flow phrases ("we will start with", "on va commencer par") are not actions. The summary lists the decisions and
// counts the rest, in the transcript's language.
import { normaliseDue } from '@/domain/meetings';
import { fold, parseTranscript } from './parse';
import type { AnalysisInput, AnalysisResult, ProposalDraft, TranscriptAnalyzerImpl, TranscriptLanguage } from './types';

/** Word-bounded, case-insensitive pattern (JS `\b` ignores accented letters). */
const W = (src: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, 'iu');
const AP = `['’]`;

// ── Sentences ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Words that start a sentence — "rev D. Then …" splits, "S. Haddad" does not. */
const STARTERS = new Set([
  'the', 'we', 'i', 'it', 'this', 'that', 'then', 'so', 'and', 'but', 'on', 'for', 'ok', 'okay', 'yes', 'no', 'decision', 'action', 'next', 'let', "let's",
  'le', 'la', 'les', 'nous', 'je', 'il', 'elle', 'ils', 'on', 'pour', 'ok', 'oui', 'non', 'donc', 'alors', 'ensuite', 'et', 'mais', 'un', 'une', 'ce', 'cette',
  'decision', 'action', 'risque', 'question', 'est-ce',
]);
const ABBREVIATIONS = new Set(['m', 'mme', 'mlle', 'mm', 'dr', 'pr', 'st', 'ste', 'rev', 'ref', 'cf', 'env', 'approx', 'vs', 'no', 'n°', 'p', 'pp', 'art', 'fig', 'mr', 'mrs', 'ms', 'inc', 'ltd', 'co', 'e.g', 'i.e']);

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?…]+["”»)]*(?=\s+\S)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length;
    const before = text.slice(start, m.index);
    const lastWord = /(\S+)$/.exec(before)?.[1] ?? '';
    const nextWord = /^\s+(\S+)/.exec(text.slice(end))?.[1] ?? '';
    const lw = fold(lastWord).replace(/^[("«“]+/, '');
    const isInitial = m[0] === '.' && /^[A-ZÀ-Þ]$/.test(lastWord) && /^[A-ZÀ-Þ]/.test(nextWord) && !STARTERS.has(fold(nextWord).replace(/[^a-z'-]/g, ''));
    const isAbbrev = m[0] === '.' && ABBREVIATIONS.has(lw);
    const nextLower = /^[a-zà-ÿ]/.test(nextWord);
    if (isInitial || isAbbrev || nextLower) continue;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** ";" clauses of a sentence (each side at least three words). */
function clauses(sentence: string): string[] {
  const parts = sentence.split(/\s*;\s*/);
  if (parts.length < 2 || parts.some((p) => p.split(/\s+/).length < 3)) return [sentence];
  return parts.map((p, i) => (i < parts.length - 1 ? p.replace(/[,]+$/, '') + '.' : p));
}

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const MONTH = `(janvier|janv|january|jan|f[ée]vrier|f[ée]vr|february|feb|mars|march|mar|avril|avr|april|apr|mai|may|juin|june|jun|juillet|juil|july|jul|ao[uû]t|august|aug|septembre|september|sept|sep|octobre|october|oct|novembre|november|nov|d[ée]cembre|december|d[ée]c)\\.?`;
const MONTH_PREFIX: [string, number][] = [
  ['janv', 0], ['jan', 0], ['fev', 1], ['feb', 1], ['mar', 2], ['avr', 3], ['apr', 3], ['mai', 4], ['may', 4], ['juin', 5], ['jun', 5], ['juil', 6], ['jul', 6],
  ['aou', 7], ['aug', 7], ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11],
];
const monthIndex = (w: string) => {
  const f = fold(w).replace(/\.$/, '');
  return MONTH_PREFIX.find(([p]) => f.startsWith(p))?.[1] ?? -1;
};
const DATE_PATTERNS: { re: RegExp; read: (m: RegExpExecArray) => [number, number, number | null] }[] = [
  { re: W(`(\\d{1,2})(?:er|st|nd|rd|th)?\\s+${MONTH}(?:\\s+(\\d{4}))?`), read: (m) => [+m[1], monthIndex(m[2]), m[3] ? +m[3] : null] },
  { re: W(`${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`), read: (m) => [+m[2], monthIndex(m[1]), m[3] ? +m[3] : null] },
  { re: W(`(\\d{4})-(\\d{2})-(\\d{2})`), read: (m) => [+m[3], +m[2] - 1, +m[1]] },
  { re: W(`(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?`), read: (m) => [+m[1], +m[2] - 1, m[3] ? +m[3] + (m[3].length === 2 ? 2000 : 0) : null] },
];
const DUE_PREP = new RegExp(`(?<![\\p{L}])(?:by|before|until|till|no later than|due|on|for|pour le|pour|d${AP}ici le|d${AP}ici au|d${AP}ici|avant le|avant|au plus tard le|jusqu${AP}au|le)\\s*$`, 'iu');
const DUE_PREP_CUT = new RegExp(`\\s*,?\\s*(?:(?<![\\p{L}])(?:by|before|until|till|no later than|due|on|for|pour le|pour|d${AP}ici le|d${AP}ici au|d${AP}ici|avant le|avant|au plus tard le|jusqu${AP}au|le))?\\s*$`, 'iu');
const pad2 = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

export interface FoundDate {
  iso: string;
  start: number;
  end: number;
  /** Introduced by "by", "before", "pour le", "d'ici le"… */
  due: boolean;
}

/** Calendar dates stated in a text (year of the meeting when none is said; a month long gone means next year). */
export function findDates(text: string, meetingDate: string): FoundDate[] {
  const [my, mm] = meetingDate.split('-').map(Number);
  const found: FoundDate[] = [];
  for (const { re, read } of DATE_PATTERNS) {
    const g = new RegExp(re.source, 'giu');
    for (let m = g.exec(text); m; m = g.exec(text)) {
      const [d, mo, y0] = read(m);
      if (mo < 0 || mo > 11) continue;
      const y = y0 ?? (mo < mm - 1 - 2 ? my + 1 : my);
      if (d < 1 || d > daysIn(y, mo) || y < 2000 || y > 2100) continue;
      const start = m.index;
      if (found.some((f) => start < f.end && m!.index + m![0].length > f.start)) continue;
      found.push({ iso: `${y}-${pad2(mo + 1)}-${pad2(d)}`, start, end: start + m[0].length, due: DUE_PREP.test(text.slice(Math.max(0, start - 24), start)) });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Due of an action: the first date introduced by a due word, else the first date. The text loses that phrase. */
function dueOf(text: string, meetingDate: string): { due: string | null; dueDate: string | null; text: string } {
  const dates = findDates(text, meetingDate);
  const pick = dates.find((d) => d.due) ?? dates[0];
  if (!pick) return { due: null, dueDate: null, text };
  const head = text.slice(0, pick.start).replace(DUE_PREP_CUT, '');
  const tail = text.slice(pick.end).replace(/^\s*(?:at the latest|au plus tard|latest)\b/i, '');
  return { due: normaliseDue(pick.iso), dueDate: pick.iso, text: `${head}${tail}`.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim() };
}

// ── Names ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const UC = 'A-ZÀ-ÖØ-Þ';
const NAME_WORD = `[${UC}][\\p{L}'’-]*`;
const OWNER_NAME = `(?:[${UC}]\\.(?:-?[${UC}]\\.)?\\s?${NAME_WORD}(?:\\s${NAME_WORD})?|${NAME_WORD}(?:\\s${NAME_WORD}){0,2})`;
const NOT_A_NAME = new Set([
  'the', 'this', 'that', 'it', 'he', 'she', 'they', 'we', 'you', 'i', 'there', 'here', 'what', 'which', 'who', 'our', 'your', 'their', 'my', 'each', 'both', 'all',
  'any', 'none', 'someone', 'somebody', 'everyone', 'everybody', 'nobody', 'one', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ce', 'cela', 'ca', 'le',
  'la', 'les', 'l', 'un', 'une', 'chacun', 'personne', 'tout', 'tous', 'qui', 'notre', 'votre', 'leur', 'mon', 'ma', 'mes', 'phase', 'lot', 'decision', 'action',
  'and', 'et', 'but', 'mais', 'so', 'donc', 'then', 'ensuite', 'also', 'aussi', 'if', 'si', 'when', 'quand',
]);

/** Names a proposal owner may resolve to: the speakers, the invitees and their organisations ("K. Lindqvist (Nordvolt)"). */
function knownNames(speakers: string[], participants: string[]): string[] {
  const out: string[] = [];
  for (const raw of [...speakers, ...participants]) {
    const name = raw.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (name) out.push(name);
    const org = /\(([^)]+)\)/.exec(raw)?.[1]?.trim();
    if (org) out.push(org);
  }
  return [...new Set(out)];
}

/**
 * The owner name as said, resolved against the known names: "Julien" → "Julien Wagner", "Wagner" → "J. Wagner" when that
 * is the only match; otherwise as said (it is present in the transcript).
 */
export function resolveOwner(said: string, known: string[]): string {
  const s = fold(said.trim());
  const exact = known.find((k) => fold(k) === s);
  if (exact) return exact;
  const parts = (k: string) => fold(k).split(/[\s.]+/).filter(Boolean);
  const byFirst = known.filter((k) => parts(k).length > 1 && parts(k)[0] === s);
  if (byFirst.length === 1) return byFirst[0];
  const byLast = known.filter((k) => parts(k).length > 1 && parts(k)[parts(k).length - 1] === s);
  if (byLast.length === 1) return byLast[0];
  const initial = /^([a-z])\.?\s*(.+)$/.exec(s);
  if (initial) {
    const byInitial = known.filter((k) => parts(k)[0]?.[0] === initial[1] && parts(k)[parts(k).length - 1] === initial[2]);
    if (byInitial.length === 1) return byInitial[0];
  }
  return said.trim();
}

const isName = (s: string) => !NOT_A_NAME.has(fold(s.split(/\s+/)[0]).replace(/[^a-z]/g, ''));

/**
 * Owner named in a clause, or null when the words are not a person: a known name (speaker, invitee, organisation, first or
 * last name of one), an initial + surname ("J. Wagner") or a first name + surname. A lone capitalised word that is not known
 * ("Delivery will take…", "Steel to arrive…") is not an owner.
 */
function namedOwner(said: string, known: string[]): string | null {
  if (!isName(said)) return null;
  const resolved = resolveOwner(said, known);
  if (known.includes(resolved)) return resolved;
  const words = said.trim().split(/\s+/);
  return /^[A-ZÀ-Þ]\./.test(said.trim()) || words.length >= 2 ? resolved : null;
}

// ── Cues ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const LABEL = new RegExp(
  `^(d[ée]cision|decided|action|risk|risque|question)s?(?:\\s+(?:pour|for|à)\\s+(${OWNER_NAME}))?(?:\\s*[:—–]\\s*|\\s+-\\s+)(.+)$`,
  'iu',
);
const QUESTION_END = /[?？]\s*["”»)]*\s*$/;
const QUESTION_START = W(`est-ce qu|est-ce que`);
const DECISION = [
  W(`(?:we|i|they)\\s+(?:have\\s+)?(?:decided|agreed)`), W(`we\\s+agree\\s+(?:to|that|on)`), W(`it\\s+(?:is|was|has been)\\s+(?:decided|agreed)`),
  W(`decision|decided|approved|signed off|go-ahead`), W(`(?:that|this)\\s+is\\s+the\\s+answer`), W(`answer\\s+to\\s+(?:give|bring|send)`),
  W(`on\\s+(?:valide|acte|retient|arr[êe]te|d[ée]cide|part\\s+sur)`), W(`(?:nous\\s+)?(?:validons|actons|d[ée]cidons|retenons)`),
  W(`c${AP}est\\s+(?:valid[ée]|act[ée]|d[ée]cid[ée]|arr[êe]t[ée])`), W(`d[ée]cid(?:é|ée|és|ées)|d[ée]cision|valid(?:é|ée|és|ées)|act(?:é|ée|és|ées)|approuv(?:é|ée|és|ées)`),
  W(`il\\s+est\\s+convenu|d${AP}un\\s+commun\\s+accord|on\\s+est\\s+d${AP}accord\\s+pour|r[ée]ponse\\s+[àa]\\s+(?:donner|apporter|transmettre)`),
];
const RISK = [
  W(`risks?|risky|at\\s+risk|could\\s+(?:delay|slip|impact|block)|might\\s+(?:delay|slip|not\\s+make)|may\\s+(?:delay|slip)|threat|concerns?|concerned|worried|bottleneck|blocking`),
  W(`risques?|risqu[ée]e?s?|menace|inqui[ée]t\\p{L}*|crain\\p{L}*|pourrai(?:t|ent)\\s+(?:retarder|bloquer|d[ée]caler|impacter)|point\\s+(?:dur|bloquant)|bloquant|alerte|danger`),
];
const CLIENT_QUESTION = W(`client\\s+question|question\\s+(?:from|of)\\s+the\\s+client|the\\s+client\\s+(?:asks|asked|wants\\s+to\\s+know)|questions?\\s+du\\s+client|questions?\\s+client|le\\s+client\\s+(?:demande|aimerait\\s+savoir|veut\\s+savoir)`);

const LEAD = `(?:(?:ok|okay|yes|sure|agreed|noted|right|fine|so|then|and|also|d${AP}accord|oui|bon|alors|donc|et|aussi|ensuite|parfait|entendu|not[ée]),?\\s+)*`;
const FLOW = `(?:start|begin|discuss|talk|look\\s+at|go\\s+through|go\\s+over|move\\s+on|continue|wrap\\s+up|recap|commencer|d[ée]marrer|passer|parler|voir|regarder|reprendre|terminer|finir|continuer|faire\\s+(?:un|le)\\s+(?:point|tour)|aborder|encha[iî]ner|revenir)`;
const EN_SELF = new RegExp(
  `^${LEAD}(?:i|we)\\s*(?:${AP}ll|will|shall|am\\s+going\\s+to|${AP}m\\s+going\\s+to|are\\s+going\\s+to|${AP}re\\s+going\\s+to|need\\s+to|have\\s+to|must|take\\s+the\\s+action\\s+to)\\s+(?:also\\s+|then\\s+)?(?!\\s*${FLOW}(?![\\p{L}]))(.+)$`,
  'iu',
);
const EN_LET_ME = new RegExp(`^${LEAD}let\\s+me\\s+(?!\\s*${FLOW}(?![\\p{L}]))(.+)$`, 'iu');
const FR_SELF = new RegExp(
  `^${LEAD}(?:je\\s+vais|nous\\s+allons|je\\s+dois|nous\\s+devons|je\\s+m${AP}engage\\s+[àa]|nous\\s+nous\\s+engageons\\s+[àa]|je\\s+me\\s+charge\\s+d(?:e\\s+|${AP})|je\\s+m${AP}occupe\\s+d(?:e\\s+|${AP})|on\\s+va|on\\s+doit)\\s*(?:aussi\\s+|également\\s+|ensuite\\s+)?(?!\\s*${FLOW}(?![\\p{L}]))(.+)$`,
  'iu',
);
const FR_FUTURE = new RegExp(`^${LEAD}(?:j${AP}|je\\s+)\\p{L}+rai(?![\\p{L}])|^${LEAD}nous\\s+\\p{L}+rons(?![\\p{L}])`, 'iu');
const EN_NAMED = new RegExp(`^(${OWNER_NAME})\\s+(?:will|${AP}ll|is\\s+going\\s+to|to|must|needs\\s+to|has\\s+to|shall|should|is\\s+to)\\s+(?:also\\s+|then\\s+)?(?!be\\s)([a-z].*)$`, 'u');
const FR_NAMED = new RegExp(
  `^(${OWNER_NAME})\\s+(?:doit|devra|va|se\\s+charge\\s+d(?:e\\s+|${AP})|s${AP}occupe\\s+d(?:e\\s+|${AP})|prend\\s+l${AP}action\\s+d(?:e\\s+|${AP}))\\s*(?:aussi\\s+|également\\s+|ensuite\\s+)?([a-zà-ÿ].*)$`,
  'u',
);
const FR_NAMED_ANY = new RegExp(`(?:[àa]\\s+charge\\s+d(?:e\\s+|${AP})|action\\s+(?:pour|[àa])\\s+|il\\s+faut\\s+qu(?:e\\s+|${AP}))(${OWNER_NAME})`, 'u');

const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,:;—–-]+/, '').replace(/[\s,;:.]+$/, '').trim();

interface Clause {
  speaker: string | null;
  text: string;
}

interface Ctx {
  meetingDate: string;
  known: string[];
}

function action(c: Clause, ctx: Ctx, owner: string | null, rest: string): ProposalDraft {
  const d = dueOf(rest, ctx.meetingDate);
  const text = tidy(d.text);
  return { type: 'action', text: capitalise(text.length >= 3 ? text : tidy(c.text)), owner, due: d.due, dueDate: d.dueDate, speaker: c.speaker, quote: c.text };
}

function commitment(c: Clause, ctx: Ctx, s: string): ProposalDraft | null {
  let m: RegExpExecArray | null;
  if ((m = EN_SELF.exec(s) ?? EN_LET_ME.exec(s) ?? FR_SELF.exec(s))) return action(c, ctx, c.speaker, m[m.length - 1]);
  if (FR_FUTURE.test(s)) return action(c, ctx, c.speaker, s.replace(new RegExp(`^${LEAD}`, 'iu'), ''));
  let owner: string | null;
  if ((m = EN_NAMED.exec(s) ?? FR_NAMED.exec(s)) && (owner = namedOwner(m[1], ctx.known))) return action(c, ctx, owner, m[2]);
  if ((m = FR_NAMED_ANY.exec(s)) && (owner = namedOwner(m[1], ctx.known))) return action(c, ctx, owner, s);
  return null;
}

const decisionText = (s: string) =>
  capitalise(
    tidy(
      s
        .replace(/^(?:so,?\s+)?(?:we|i)\s+(?:have\s+)?(?:decided|agreed)\s+(?:to|that)\s+/i, '')
        .replace(new RegExp(`^(?:on|nous)\\s+(?:a|avons)\\s+d[ée]cid[ée]\\s+(?:de\\s+|d${AP}|que\\s+)`, 'iu'), ''),
    ),
  );

/** One clause → at most one proposal (rules in the header). */
export function classifyClause(c: Clause, ctx: Ctx): ProposalDraft | null {
  const s = c.text.replace(/^[-•*]\s+/, '').trim();
  if (s.length < 4) return null;
  const base = { owner: null, due: null, dueDate: null, speaker: c.speaker, quote: c.text };
  const label = LABEL.exec(s);
  if (label) {
    const kind = fold(label[1]);
    const rest = label[3].trim();
    if (kind.startsWith('deci')) return { ...base, type: 'decision', text: decisionText(rest) };
    if (kind === 'risk' || kind === 'risque') return { ...base, type: 'risk', text: capitalise(tidy(rest)) };
    if (kind === 'question') return { ...base, type: 'question', text: capitalise(rest.trim()) };
    const named = label[2] ? namedOwner(label[2], ctx.known) : null;
    return named ? action(c, ctx, named, rest) : (commitment({ ...c, text: rest }, ctx, rest) ?? action(c, ctx, null, rest));
  }
  if (QUESTION_END.test(s) || QUESTION_START.test(s.slice(0, 12))) return { ...base, type: 'question', text: s };
  if (DECISION.some((re) => re.test(s))) return { ...base, type: 'decision', text: decisionText(s) };
  const act = commitment(c, ctx, s);
  if (act) return act;
  if (RISK.some((re) => re.test(s))) return { ...base, type: 'risk', text: capitalise(tidy(s)) };
  if (CLIENT_QUESTION.test(s)) return { ...base, type: 'question', text: capitalise(tidy(s)) };
  return null;
}

// ── Summary ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const shorten = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Decisions listed, the rest counted, in the transcript's language. */
export function localSummary(ps: ProposalDraft[], lang: TranscriptLanguage): string {
  const of = (t: ProposalDraft['type']) => ps.filter((p) => p.type === t);
  const [dec, act, risk, q] = [of('decision'), of('action'), of('risk'), of('question')];
  if (!ps.length)
    return lang === 'fr' ? 'Aucune décision, action, risque ou question relevé dans la transcription.' : 'No decision, action, risk or question found in the transcript.';
  const parts: string[] = [];
  if (dec.length) parts.push(`${lang === 'fr' ? 'Décisions' : 'Decisions'} — ${dec.map((d) => shorten(d.text)).join(lang === 'fr' ? ' ; ' : '; ')}.`);
  const owners = [...new Set(act.map((a) => a.owner).filter((o): o is string => !!o))];
  if (act.length) parts.push(`${plural(act.length, 'action', 'actions')}${owners.length ? ` (${owners.join(', ')})` : ''}.`);
  if (risk.length) parts.push(lang === 'fr' ? `${plural(risk.length, 'risque', 'risques')} signalé${risk.length > 1 ? 's' : ''}.` : `${plural(risk.length, 'risk', 'risks')} raised.`);
  if (q.length)
    parts.push(lang === 'fr' ? `${plural(q.length, 'question', 'questions')} à traiter.` : `${plural(q.length, 'question', 'questions')} to answer.`);
  return capitalise(parts.join(' '));
}

// ── Analyser ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Runs the rules on a transcript. Same input → same output. */
export function analyseLocally(input: AnalysisInput, maxProposals = 60): AnalysisResult {
  const parsed = parseTranscript(input.text);
  const ctx: Ctx = { meetingDate: /^\d{4}-\d{2}-\d{2}$/.test(input.meetingDate) ? input.meetingDate : '2026-01-01', known: knownNames(parsed.speakers, input.participants) };
  const seen = new Set<string>();
  const proposals: ProposalDraft[] = [];
  for (const seg of parsed.segments)
    for (const sentence of splitSentences(seg.text))
      for (const clause of clauses(sentence)) {
        const p = classifyClause({ speaker: seg.speaker, text: clause }, ctx);
        if (!p || !p.text) continue;
        const key = `${p.type}|${fold(p.text)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        proposals.push({ ...p, text: p.text.slice(0, 1000), quote: p.quote ? p.quote.slice(0, 400) : null });
      }
  const kept = proposals.slice(0, maxProposals);
  return { summary: localSummary(kept, parsed.language), language: parsed.language, proposals: kept };
}

export const localAnalyzer: TranscriptAnalyzerImpl = {
  id: 'local',
  model: null,
  analyse: async (input) => analyseLocally(input),
};
