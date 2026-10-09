import 'server-only';
// AI settings of Keystone (chapter 4, questionnaire S-10 — meeting transcripts). Every default the product owner may change
// lives in TRANSCRIPT_AI; the environment only says whether Claude may be used and with which model.
//
// - Claude analyses a transcript ONLY when ANTHROPIC_API_KEY is set (the key is passed explicitly to the SDK, so another
//   credential found on the machine — ANTHROPIC_AUTH_TOKEN, an `ant` profile — never enables it). The transcript then leaves
//   Keystone: the meeting screen says so before and after the analysis.
// - Without the key — or with KEYSTONE_AI=off — the local rule-based analyser runs (src/server/ai/transcripts/local.ts); the
//   transcript stays in Keystone.
// - KEYSTONE_AI_MODEL overrides the model id; KEYSTONE_AI_FALLBACKS=off drops the server-side refusal fallback (needed for a
//   model that does not accept it).
// - Under Vitest Claude is never enabled unless KEYSTONE_AI_ALLOW_IN_TESTS=1 (tests mock the SDK; no test reaches the network).

export const TRANSCRIPT_AI = {
  /** Default model (exact id). */
  model: 'claude-opus-5-5',
  /** Structured output effort (Claude Opus 5.5 default is medium — set explicitly). */
  effort: 'medium' as const,
  /** Output budget of one analysis (non-streaming request). */
  maxTokens: 16_000,
  /** Server-side refusal fallback: Anthropic routes a declined request to its recommended model (beta). */
  refusalFallbacks: 'default' as const,
  refusalFallbackBeta: 'server-side-fallback-2026-07-01' as const,
  /** Request timeout and retries of the SDK client (429 / 5xx / connection errors are retried). */
  timeoutMs: 180_000,
  maxRetries: 1,
  /** Largest transcript sent to Claude (characters); longer transcripts are analysed locally. */
  maxClaudeChars: 400_000,
  /** At most this many proposals are kept from one analysis. */
  maxProposals: 60,
} as const;

export interface ClaudeSettings {
  apiKey: string;
  model: string;
  /** Send `fallbacks: 'default'` with its beta header. */
  fallbacks: boolean;
}

type Env = Record<string, string | undefined>;

/** Claude settings when Claude may analyse transcripts, else null (local analyser). */
export function claudeSettings(env: Env = process.env): ClaudeSettings | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  if ((env.KEYSTONE_AI ?? '').trim().toLowerCase() === 'off') return null;
  if (env.VITEST && env.KEYSTONE_AI_ALLOW_IN_TESTS !== '1') return null;
  const model = env.KEYSTONE_AI_MODEL?.trim() || TRANSCRIPT_AI.model;
  return { apiKey, model, fallbacks: (env.KEYSTONE_AI_FALLBACKS ?? '').trim().toLowerCase() !== 'off' };
}

/** What the meeting screen tells the user before an analysis: Claude (with its model) or the local analyser. */
export interface TranscriptAiInfo {
  claude: boolean;
  model: string | null;
}

export function transcriptAiInfo(env: Env = process.env): TranscriptAiInfo {
  const s = claudeSettings(env);
  return { claude: !!s, model: s?.model ?? null };
}
