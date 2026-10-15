// Integration review of delivery 8: the client's global search and the client portal do not share one rule.
// `clientSeesChangeRequest` (search, like the Changes page) lets the client find every change request of the project;
// the portal lists only those waiting for the client (`crAwaitsClient`, R-069 / P-6b). This test pins that difference, which
// the module's header now states, so an answer to "internal CRs shown to the client" knows every place to change.
import { describe, expect, it } from 'vitest';
import type { ChangeStep, StepDecision } from '@/server/db/codes';
import { clientSeesChangeRequest } from './client-visibility';
import { crAwaitsClient } from './rexclient';

const cr = (id: string, decisions: Record<ChangeStep, StepDecision>) => ({
  id, status: 'in_review' as const,
  chain: (Object.keys(decisions) as ChangeStep[]).map((step) => ({ step, decision: decisions[step] })),
});

describe('client rules for change requests (P-10b search, R-069 portal)', () => {
  it('a request at the PM step: found by the client’s search, not yet in the portal', () => {
    const atPm = cr('CR-101', { pm: 'pending', director: 'pending', client: 'pending', ccb: 'na' });
    expect([clientSeesChangeRequest(atPm), crAwaitsClient(atPm)]).toEqual([true, false]);
  });

  it('a request at the client step: in both', () => {
    const atClient = cr('CR-102', { pm: 'ok', director: 'ok', client: 'pending', ccb: 'na' });
    expect([clientSeesChangeRequest(atClient), crAwaitsClient(atClient)]).toEqual([true, true]);
  });
});
