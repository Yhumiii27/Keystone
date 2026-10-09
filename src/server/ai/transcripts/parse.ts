// Meeting transcript import (chapter 4, S-10): pasted text, WebVTT (Teams `<v Name>` voice tags, Zoom / Meet "Name: text"
// cues) and SubRip (.srt) → speaker turns and the readable text Keystone stores ("Speaker: text", one turn per line, no
// cue numbers, timecodes or tags). Speaker labels are recognised at the start of a line ("A. Girard: …", "Romain Aubert : …",
// "[09:03] Léa Fabre: …", a Teams "Name  0:03" header line) and inside a paragraph after a sentence end ("… rev D. C. Morvan:
// …", the prototype's transcripts). Words such as "Decision:", "Action:", "Note:" are cues, never speakers. Pure and
// deterministic.
import type { ParsedTranscript, TranscriptFormat, TranscriptLanguage, TranscriptSegment } from './types';

const UC = 'A-ZÀ-ÖØ-Þ';
const NAME_WORD = `[${UC}][\\p{L}'’-]*`;
const INITIAL = `[${UC}]\\.(?:-?[${UC}]\\.)?`;
const PARTICLE = '(?:de|du|des|da|di|van|von|der|le|la|el|al|dos|das)';
const ORG = `(?:\\s*\\([^()\\n]{1,40}\\))?`;
/** "A. Girard", "J.-P. Martin", "Romain Aubert", "Anne-Sophie de La Tour", "Marie", optionally "(Nordvolt)". */
const NAME = `(?:${INITIAL}\\s?${NAME_WORD}(?:[\\s-]${NAME_WORD})?|${NAME_WORD}(?:\\s(?:${PARTICLE}\\s)?${NAME_WORD}){0,3})${ORG}`;
/** Inside a paragraph only initials + surname or two to three capitalised words count ("C. Morvan:", "Léa Fabre:"). */
const INLINE_NAME = `(?:${INITIAL}\\s?${NAME_WORD}(?:[\\s-]${NAME_WORD})?|${NAME_WORD}\\s${NAME_WORD}(?:\\s${NAME_WORD})?)${ORG}`;
const STAMP = String.raw`\[?\(?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\]?\)?`;

const LINE_LABEL = new RegExp(`^\\s*(?:${STAMP}\\s*[-–]?\\s*)?(${NAME})\\s?:\\s*(.*)$`, 'u');
const NAME_THEN_STAMP = new RegExp(`^\\s*(${NAME})\\s+${STAMP}\\s*$`, 'u');
const NAME_ONLY = new RegExp(`^\\s*(${NAME})\\s*$`, 'u');
const STAMP_ONLY = new RegExp(`^\\s*${STAMP}\\s*$`, 'u');
const INLINE_LABEL = new RegExp(`(${INLINE_NAME})\\s?:\\s`, 'gu');

/** First words that make a "Word:" a cue or a heading, not a speaker (accents folded, lower case). */
const NOT_SPEAKER = new Set([
  'decision', 'decisions', 'decide', 'decided', 'action', 'actions', 'risk', 'risks', 'risque', 'risques', 'question', 'questions', 'note', 'notes', 'nb', 'info',
  'information', 'informations', 'agenda', 'point', 'points', 'sujet', 'objet', 'subject', 're', 'date', 'time', 'heure', 'lieu', 'location', 'attendees',
  'participants', 'presents', 'absents', 'absent', 'summary', 'resume', 'conclusion', 'conclusions', 'next', 'prochaines', 'prochaine', 'todo', 'remarque',
  'rappel', 'reminder', 'warning', 'attention', 'important', 'url', 'http', 'https', 'update', 'status', 'statut', 'minutes', 'transcript', 'transcription',
  'meeting', 'reunion', 'webvtt', 'kind', 'language', 'style', 'region', 'the', 'a', 'an', 'le', 'la', 'les', 'un', 'une', 'our', 'notre', 'this', 'ce', 'cette',
  'phase', 'lot', 'step', 'etape', 'option', 'answer', 'reponse', 'source', 'ref', 'reference', 'total', 'cost', 'cout', 'budget', 'planning', 'schedule', 'ordre',
  'scope', 'perimetre', 'issue', 'probleme', 'result', 'resultat', 'outcome', 'goal', 'objectif',
]);

export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").toLowerCase();

/** Is this label a person / organisation rather than a cue word or heading? */
export function isSpeakerLabel(label: string): boolean {
  const l = label.trim();
  if (l.length < 2 || l.length > 60) return false;
  const words = l.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/);
  if (!words[0] || words.length > 5) return false;
  if (words.length === 1 && words[0].replace(/[.'’-]/g, '').length < 2) return false;
  if (/^[A-ZÀ-Þ]\.(?:-?[A-ZÀ-Þ]\.)?$/.test(words[0]) && words.length > 1) return true; // "A. Girard"
  return !NOT_SPEAKER.has(fold(words[0]).replace(/[^a-z]/g, ''));
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lrm;': '', '&rlm;': '' };
const clean = (s: string) =>
  s
    .replace(/&(?:amp|lt|gt|nbsp|quot|#39|apos|lrm|rlm);/g, (e) => ENTITIES[e] ?? e)
    .replace(/[​‎‏﻿]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .trim();

/** Splits a paragraph on speaker labels that follow a sentence end ("… rev D. C. Morvan: The I/O list …"). */
export function splitInlineSpeakers(text: string, speaker: string | null): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let current = speaker;
  let from = 0;
  INLINE_LABEL.lastIndex = 0;
  for (let m = INLINE_LABEL.exec(text); m; m = INLINE_LABEL.exec(text)) {
    const before = text.slice(0, m.index).trimEnd();
    const atBoundary = m.index === 0 || /[.!?…»"”)]$/.test(before);
    if (!atBoundary || !isSpeakerLabel(m[1])) {
      INLINE_LABEL.lastIndex = m.index + 1;
      continue;
    }
    const chunk = text.slice(from, m.index).trim();
    if (chunk) out.push({ speaker: current, text: chunk });
    current = clean(m[1]);
    from = m.index + m[0].length;
  }
  const rest = text.slice(from).trim();
  if (rest) out.push({ speaker: current, text: rest });
  return out;
}

/** Consecutive turns of the same speaker become one. */
function merge(segs: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const s of segs) {
    const text = clean(s.text);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker) last.text = `${last.text} ${text}`;
    else out.push({ speaker: s.speaker ? clean(s.speaker) : null, text });
  }
  return out;
}

/** "Name: text" at the start of a cue / line → [speaker, text]. */
function lineLabel(line: string): [string, string] | null {
  const m = LINE_LABEL.exec(line);
  return m && isSpeakerLabel(m[1]) ? [m[1], m[2]] : null;
}

function parseCues(raw: string, kind: 'vtt' | 'srt'): TranscriptSegment[] {
  const segs: TranscriptSegment[] = [];
  for (const block of raw.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    if (kind === 'vtt' && /^(?:WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0].trim())) continue;
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing < 0) continue;
    let payload = lines.slice(timing + 1).join(' ');
    let speaker: string | null = null;
    const voice = /<v(?:\.[^\s>]+)*\s+([^>]+)>/.exec(payload);
    if (voice) speaker = clean(voice[1]);
    payload = payload.replace(/\{\\[^}]*\}/g, '').replace(/<[^>]*>/g, '');
    if (!speaker) {
      const l = lineLabel(payload);
      if (l) [speaker, payload] = l;
    }
    segs.push({ speaker, text: payload });
  }
  return segs;
}

function parsePlain(raw: string): TranscriptSegment[] {
  const segs: TranscriptSegment[] = [];
  let speaker: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join(' ').trim();
    if (text) segs.push({ speaker, text });
    buf = [];
  };
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    if (STAMP_ONLY.test(line)) continue;
    const header = NAME_THEN_STAMP.exec(line) ?? (STAMP_ONLY.test(lines[i + 1] ?? '') ? NAME_ONLY.exec(line) : null);
    if (header && isSpeakerLabel(header[1])) {
      flush();
      speaker = clean(header[1]);
      continue;
    }
    const l = lineLabel(line);
    if (l) {
      flush();
      speaker = clean(l[0]);
      buf.push(l[1]);
      continue;
    }
    buf.push(line.replace(new RegExp(`^\\s*${STAMP}\\s*[-–]?\\s*`, 'u'), ''));
  }
  flush();
  return segs;
}

/** Format of an upload or a paste: the extension first, then the content (WEBVTT header, SRT cue numbering). */
export function detectFormat(fileName: string | null | undefined, raw: string): TranscriptFormat {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName ?? '')?.[1]?.toLowerCase();
  if (ext === 'vtt' || /^\s*WEBVTT/.test(raw)) return 'vtt';
  if (ext === 'srt' || /^\s*\d+\s*\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(raw)) return 'srt';
  return 'text';
}

const FR_WORDS = new Set(['le', 'la', 'les', 'de', 'des', 'du', 'et', 'est', 'une', 'un', 'pour', 'que', 'qui', 'nous', 'je', 'pas', 'avec', 'sur', 'dans', 'ce', 'cette', 'il', 'elle', 'au', 'aux', 'mais', 'va', 'vais', 'sont', 'ete', 'faut', 'doit', 'avant', 'plus', 'tres', 'bien', 'oui', 'donc', 'alors', "c'est", "j'ai", 'ca']);
const EN_WORDS = new Set(['the', 'and', 'is', 'to', 'of', 'we', 'will', 'for', 'with', 'that', 'it', 'be', 'by', 'this', 'are', 'was', 'i', 'you', 'they', 'have', 'not', 'need', 'should', 'before', 'yes', 'so', 'our', "let's", "i'll", "we'll"]);

/** "fr" or "en" by common-word counts (English when undecided). */
export function detectLanguage(text: string): TranscriptLanguage {
  let fr = 0;
  let en = 0;
  for (const w of fold(text).match(/[a-z']+/g) ?? []) {
    if (FR_WORDS.has(w)) fr++;
    else if (EN_WORDS.has(w)) en++;
  }
  return fr > en ? 'fr' : 'en';
}

/** Parses a transcript (pasted text or an uploaded .txt / .vtt / .srt) into speaker turns and the text Keystone stores. */
export function parseTranscript(raw: string, fileName?: string | null): ParsedTranscript {
  const src = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const format = detectFormat(fileName, src);
  const base = format === 'text' ? parsePlain(src) : parseCues(src, format);
  const segments = merge(base.flatMap((s) => splitInlineSpeakers(clean(s.text), s.speaker ? clean(s.speaker) : null)));
  const speakers = [...new Set(segments.map((s) => s.speaker).filter((s): s is string => !!s))];
  const text = segments.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join('\n');
  return { format, text, segments, speakers, language: detectLanguage(text), words: (text.match(/[\p{L}\p{N}]+/gu) ?? []).length };
}
