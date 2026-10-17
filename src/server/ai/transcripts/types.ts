// Meeting transcript analysis (chapter 4, S-10) — shared types of the parser, the two analysers and the DAL.
// Pure module (no server-only import): the local analyser and its tests use it too.
import type { TranscriptProposalType } from '@/server/db/codes';

export type TranscriptLanguage = 'fr' | 'en';
export type TranscriptFormat = 'text' | 'vtt' | 'srt';

/** One speaker turn ("A. Girard: …"); speaker null when the transcript has no labels. */
export interface TranscriptSegment {
  speaker: string | null;
  text: string;
}

export interface ParsedTranscript {
  format: TranscriptFormat;
  /** Readable text stored by Keystone: one "Speaker: text" line per turn (no cue numbers, timecodes or tags). */
  text: string;
  segments: TranscriptSegment[];
  /** Distinct speaker labels in order of appearance. */
  speakers: string[];
  language: TranscriptLanguage;
  words: number;
}

/** What an analyser receives. */
export interface AnalysisInput {
  /** Stored (normalised) transcript text. */
  text: string;
  meetingTitle: string;
  /** ISO date of the meeting (year of the due dates said without one). */
  meetingDate: string;
  /** Business date (R-013): due texts are written against its year ("6 Oct" in that year, "10 Jan 2027" outside it). */
  today: string;
  /** Invitees as listed on the meeting ("A. Girard", "K. Lindqvist (Nordvolt)") — owners may be resolved to these names. */
  participants: string[];
}

/** One proposal for the minutes / tasks / risk register / client questions, before any human review. */
export interface ProposalDraft {
  type: TranscriptProposalType;
  /** Text in the transcript's language. */
  text: string;
  /** Actions: a person or organisation named in the transcript (the speaker for "I will" / "je vais"), else null. */
  owner: string | null;
  /** Actions: due as a calendar date stated in the transcript — "6 Oct" (business year) / "10 Jan 2027" — and its ISO date; else null. */
  due: string | null;
  dueDate: string | null;
  /** Speaker label and the verbatim excerpt the proposal comes from. */
  speaker: string | null;
  quote: string | null;
}

export interface AnalysisResult {
  summary: string;
  language: string;
  proposals: ProposalDraft[];
  /** Model that actually answered (Claude: `response.model`, which names the fallback model after a server-side refusal fallback). */
  servedBy?: string | null;
}

export type AnalyzerId = 'local' | 'claude';

export interface TranscriptAnalyzerImpl {
  id: AnalyzerId;
  /** Model id (Claude) or null (local rules). */
  model: string | null;
  analyse(input: AnalysisInput): Promise<AnalysisResult>;
}

/** Result of an analysis run as stored: who analysed, and the notice shown when Claude failed and the local analyser stood in. */
export interface AnalysisOutcome extends AnalysisResult {
  analyzer: AnalyzerId;
  model: string | null;
  /** EN source text, translated per " · " segment ("Claude could not be reached · local analysis used instead"). */
  notice: string | null;
}
