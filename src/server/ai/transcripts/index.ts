import 'server-only';
// Transcript analysis entry point (chapter 4, S-10): picks the analyser — Claude when configured and asked for ('auto' or
// 'claude'), the local rules otherwise or on request ('local') — and falls back to the local rules with a notice when Claude
// fails (key refused, rate limit, unreachable, refusal, truncated or unreadable answer, transcript too long).
import { claudeSettings, TRANSCRIPT_AI } from '../config';
import { ClaudeAnalysisError, CLAUDE_FAILURE_NOTICE, createClaudeAnalyzer, failureOf, LOCAL_FALLBACK_NOTICE } from './claude';
import { analyseLocally } from './local';
import type { AnalysisInput, AnalysisOutcome, TranscriptAnalyzerImpl } from './types';
import { log } from '@/server/log';

export type AnalysisEngine = 'auto' | 'local' | 'claude';

export interface AnalyseOptions {
  engine?: AnalysisEngine;
  /** Claude analyser to use instead of the configured one (tests); null = none. */
  claude?: TranscriptAnalyzerImpl | null;
}

const local = (input: AnalysisInput, notice: string | null): AnalysisOutcome => ({
  ...analyseLocally(input, TRANSCRIPT_AI.maxProposals),
  analyzer: 'local',
  model: null,
  notice,
});

/** Analyses a transcript. Never throws for a Claude failure: the local analysis comes back with a notice instead. */
export async function analyseTranscriptText(input: AnalysisInput, opts: AnalyseOptions = {}): Promise<AnalysisOutcome> {
  const engine = opts.engine ?? 'auto';
  if (engine === 'local') return local(input, null);
  let claude = opts.claude;
  if (claude === undefined) {
    const s = claudeSettings();
    claude = s ? createClaudeAnalyzer(s) : null;
  }
  if (!claude) return local(input, null);
  try {
    if (input.text.length > TRANSCRIPT_AI.maxClaudeChars) throw new ClaudeAnalysisError('too_long');
    const { servedBy, ...r } = await claude.analyse(input);
    return { ...r, analyzer: 'claude', model: servedBy || claude.model, notice: null };
  } catch (e) {
    const f = failureOf(e);
    log.error('Claude transcript analysis failed (local analysis used)', { component: 'ai', code: f.code, status: f.status ?? null, message: f.message });
    return local(input, `${CLAUDE_FAILURE_NOTICE[f.code]} · ${LOCAL_FALLBACK_NOTICE}`);
  }
}

export { parseTranscript, detectLanguage } from './parse';
export type { AnalysisInput, AnalysisOutcome, ParsedTranscript, ProposalDraft } from './types';
