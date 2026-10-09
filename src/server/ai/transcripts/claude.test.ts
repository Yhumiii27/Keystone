// Claude transcript analyser (S-10) with the SDK mocked — no test reaches the network. Checks the request (model, effort,
// max_tokens, structured output, refusal fallback beta; no sampling or thinking parameters, no prefill), the guards against
// invention (owner / speaker / quote must be in the transcript, a due date only when its day is written), the failure
// codes (refusal, max_tokens, null parsed_output, typed SDK errors) and the fallback to the local rules with a notice.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { parseMock, ctorOpts } = vi.hoisted(() => ({ parseMock: vi.fn(), ctorOpts: [] as unknown[] }));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  const Real = actual.default as unknown as Record<string, unknown>;
  class FakeAnthropic {
    beta = { messages: { parse: parseMock } };
    constructor(opts: unknown) {
      ctorOpts.push(opts);
    }
  }
  // Keep the SDK's typed errors (Anthropic.RateLimitError…) on the fake client class.
  const fake = FakeAnthropic as unknown as Record<string, unknown>;
  for (let c: unknown = Real; c && c !== Function.prototype; c = Object.getPrototypeOf(c))
    for (const k of Object.getOwnPropertyNames(c)) if (!['length', 'name', 'prototype'].includes(k) && !(k in fake)) fake[k] = (c as Record<string, unknown>)[k];
  return { ...actual, default: FakeAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';
import { claudeSettings, transcriptAiInfo, TRANSCRIPT_AI } from '../config';
import { analyseWithClaude, ClaudeAnalysisError, createClaudeAnalyzer, guardAnalysis, SYSTEM_PROMPT, userContent, type ClaudeAnalysis } from './claude';
import { analyseTranscriptText } from './index';
import type { AnalysisInput } from './types';

const INPUT: AnalysisInput = {
  text: 'Romain Aubert: Bonjour. Léa Fabre: On valide la grue de 300 t. Julien Wagner: Je vais envoyer le plan de levage pour le 9 octobre.',
  meetingTitle: 'Levage',
  meetingDate: '2026-10-07',
  participants: ['R. Aubert', 'L. Fabre', 'K. Lindqvist (Nordvolt)'],
};
const SETTINGS = { apiKey: 'sk-test', model: 'claude-opus-5-5', fallbacks: true };

const answer = (out: ClaudeAnalysis | null, stop = 'end_turn', extra: Record<string, unknown> = {}) => ({
  id: 'msg_1', model: 'claude-opus-5-5', role: 'assistant', stop_reason: stop, stop_details: null, content: [], parsed_output: out, ...extra,
});
const OK: ClaudeAnalysis = {
  language: 'fr',
  summary: 'Grue de 300 t validée ; plan de levage attendu le 9 octobre.',
  items: [
    { type: 'decision', text: 'Grue de 300 t validée', owner: null, due_date: null, speaker: 'Léa Fabre', quote: 'On valide la grue de 300 t.' },
    { type: 'action', text: 'Envoyer le plan de levage', owner: 'Julien Wagner', due_date: '2026-10-09', speaker: 'Julien Wagner', quote: 'Je vais envoyer le plan de levage pour le 9 octobre.' },
    // Invented: an owner absent from the transcript, a date whose day is not written, a quote that is not an excerpt.
    { type: 'action', text: 'Réserver le grutier', owner: 'Paul Martin', due_date: '2026-10-12', speaker: 'Inconnu', quote: 'Paul réserve le grutier' },
    { type: 'action', text: 'Confirmer les dimensions', owner: 'Nordvolt', due_date: 'next friday', speaker: null, quote: null },
    { type: 'decision', text: 'Grue de 300 t validée', owner: null, due_date: null, speaker: null, quote: null },
  ],
};

beforeEach(() => {
  parseMock.mockReset();
  ctorOpts.length = 0;
});

describe('Claude transcript analyser', () => {
  it('sends one structured-output request with the Opus 5.5 rules and the refusal fallback', async () => {
    parseMock.mockResolvedValue(answer(OK));
    await analyseWithClaude(INPUT, SETTINGS);
    expect(ctorOpts).toEqual([{ apiKey: 'sk-test', timeout: TRANSCRIPT_AI.timeoutMs, maxRetries: TRANSCRIPT_AI.maxRetries }]);
    const req = parseMock.mock.calls[0][0];
    expect(req).toMatchObject({
      model: 'claude-opus-5-5', max_tokens: 16000, system: SYSTEM_PROMPT, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'stream']) expect(req, k).not.toHaveProperty(k);
    expect(req.messages).toEqual([{ role: 'user', content: userContent(INPUT) }]);
    expect(req.messages.at(-1).role).toBe('user'); // no assistant prefill
    expect(req.messages[0].content).toContain('<transcript>\nRomain Aubert: Bonjour.');
    expect(req.messages[0].content).toContain('Invitees: R. Aubert, L. Fabre, K. Lindqvist (Nordvolt)');
    // Without the fallback (KEYSTONE_AI_FALLBACKS=off) neither the beta header nor the parameter is sent.
    await analyseWithClaude(INPUT, { ...SETTINGS, fallbacks: false });
    expect(parseMock.mock.calls[1][0]).not.toHaveProperty('fallbacks');
    expect(parseMock.mock.calls[1][0]).not.toHaveProperty('betas');
  });

  it('keeps only what the transcript supports (owners, speakers, quotes, stated days); duplicates dropped', async () => {
    parseMock.mockResolvedValue(answer(OK));
    const r = await analyseWithClaude(INPUT, SETTINGS);
    expect(r.language).toBe('fr');
    expect(r.proposals.map((p) => [p.type, p.text, p.owner, p.due, p.dueDate, p.speaker, p.quote])).toEqual([
      ['decision', 'Grue de 300 t validée', null, null, null, 'Léa Fabre', 'On valide la grue de 300 t.'],
      ['action', 'Envoyer le plan de levage', 'Julien Wagner', '9 Oct', '2026-10-09', 'Julien Wagner', 'Je vais envoyer le plan de levage pour le 9 octobre.'],
      ['action', 'Réserver le grutier', null, null, null, null, null],
      ['action', 'Confirmer les dimensions', 'Nordvolt', null, null, null, null], // "Nordvolt" is an invitee organisation
    ]);
    expect(guardAnalysis({ ...OK, language: 'français' }, INPUT).language).toBe('fr');
  });

  it('refusal, max_tokens and a null parsed_output are failures', async () => {
    parseMock.mockResolvedValueOnce(answer(null, 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } }));
    await expect(analyseWithClaude(INPUT, SETTINGS)).rejects.toMatchObject({ code: 'refusal' });
    parseMock.mockResolvedValueOnce(answer(OK, 'max_tokens'));
    await expect(analyseWithClaude(INPUT, SETTINGS)).rejects.toMatchObject({ code: 'max_tokens' });
    parseMock.mockResolvedValueOnce(answer(null));
    await expect(analyseWithClaude(INPUT, SETTINGS)).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(analyseWithClaude({ ...INPUT, text: 'x'.repeat(TRANSCRIPT_AI.maxClaudeChars + 1) }, SETTINGS)).rejects.toMatchObject({ code: 'too_long' });
  });

  it('typed SDK errors map to failure codes', async () => {
    const api = (status: number) => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: 'm' } }, 'm', new Headers());
    const cases: [unknown, string][] = [
      [api(401), 'auth'], [api(403), 'permission'], [api(429), 'rate_limit'], [api(400), 'bad_request'], [api(404), 'bad_request'], [api(500), 'unavailable'],
      [api(529), 'unavailable'], [new Anthropic.APIConnectionError({ message: 'down' }), 'connection'], [new Anthropic.APIConnectionTimeoutError(), 'connection'],
      [new Anthropic.AnthropicError('Failed to parse structured output'), 'invalid_output'], [new TypeError('boom'), 'error'],
    ];
    for (const [err, code] of cases) {
      parseMock.mockRejectedValueOnce(err);
      const e = await analyseWithClaude(INPUT, SETTINGS).catch((x) => x);
      expect(e, code).toBeInstanceOf(ClaudeAnalysisError);
      expect(e.code, code).toBe(code);
    }
  });
});

describe('analyser choice and fallback', () => {
  it('Claude only with ANTHROPIC_API_KEY (never under Vitest unless allowed); model override; kill switch', () => {
    expect(claudeSettings({})).toBeNull();
    expect(claudeSettings({ ANTHROPIC_API_KEY: 'k' })).toEqual({ apiKey: 'k', model: 'claude-opus-5-5', fallbacks: true });
    expect(claudeSettings({ ANTHROPIC_API_KEY: 'k', VITEST: 'true' })).toBeNull();
    expect(claudeSettings({ ANTHROPIC_API_KEY: 'k', VITEST: 'true', KEYSTONE_AI_ALLOW_IN_TESTS: '1', KEYSTONE_AI_MODEL: 'claude-sonnet-5-5', KEYSTONE_AI_FALLBACKS: 'off' }))
      .toEqual({ apiKey: 'k', model: 'claude-sonnet-5-5', fallbacks: false });
    expect(claudeSettings({ ANTHROPIC_API_KEY: 'k', KEYSTONE_AI: 'off' })).toBeNull();
    expect(claudeSettings({ ANTHROPIC_AUTH_TOKEN: 't' })).toBeNull();
    expect(transcriptAiInfo({ ANTHROPIC_API_KEY: 'k' })).toEqual({ claude: true, model: 'claude-opus-5-5' });
    expect(transcriptAiInfo({})).toEqual({ claude: false, model: null });
  });

  it('auto without a key → local; with Claude → claude; Claude failing → local with a notice; local on request', async () => {
    const local = await analyseTranscriptText(INPUT);
    expect(local).toMatchObject({ analyzer: 'local', model: null, notice: null });
    expect(parseMock).not.toHaveBeenCalled();

    parseMock.mockResolvedValueOnce(answer(OK));
    const claude = createClaudeAnalyzer(SETTINGS);
    expect(await analyseTranscriptText(INPUT, { claude })).toMatchObject({ analyzer: 'claude', model: 'claude-opus-5-5', notice: null, summary: OK.summary });

    // After a server-side refusal fallback the response names the model that answered: that one is recorded.
    parseMock.mockResolvedValueOnce(answer(OK, 'end_turn', { model: 'claude-opus-5' }));
    expect(await analyseTranscriptText(INPUT, { claude })).toMatchObject({ analyzer: 'claude', model: 'claude-opus-5', notice: null });

    parseMock.mockRejectedValueOnce(Anthropic.APIError.generate(429, undefined, 'slow down', new Headers()));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fb = await analyseTranscriptText(INPUT, { claude });
    expect(fb).toMatchObject({ analyzer: 'local', model: null, notice: 'Claude is busy (rate limit), try again later · local analysis used instead' });
    expect(fb.proposals).toEqual(local.proposals);
    errSpy.mockRestore();

    expect(await analyseTranscriptText(INPUT, { claude, engine: 'local' })).toMatchObject({ analyzer: 'local', notice: null });
    expect(parseMock).toHaveBeenCalledTimes(3);
  });
});
