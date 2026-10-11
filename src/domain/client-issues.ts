// Client issues handled by the project manager (R-137, owner's answer L-6 "a": taken in charge by the project manager,
// answer to the client; statuses Open → In progress → Closed; the client is told of the answer and of the closure).
// Pure rules (no I/O): which step the project manager may take, the answer form, and the texts of the notifications.
import type { ClientIssueStatus } from '@/server/db/codes';

/** Roles that handle client issues: the project's manager (ownership checked by the caller) and the portfolio director. */
export const CLIENT_ISSUE_HANDLER_ROLES: readonly string[] = ['pm', 'director'];

/** Answer recorded with every new issue — it is not an answer of the project manager (closing needs a real one). */
export const ISSUE_ACKNOWLEDGEMENT = 'Acknowledged — response within 2 working days';

export const ISSUE_ANSWER_MAX = 2000;

export type IssueStep = 'take' | 'answer' | 'close';

/**
 * Steps offered on an issue: an Open issue is taken in charge (→ In progress) or answered (answering takes it in charge);
 * an In progress issue is answered again or closed; a Closed issue offers nothing (the client raises a new one).
 * Closing needs an answer other than the automatic acknowledgement (given before, or in the closing form).
 */
export function issueSteps(status: ClientIssueStatus): IssueStep[] {
  if (status === 'open') return ['take', 'answer', 'close'];
  if (status === 'in_progress') return ['answer', 'close'];
  return [];
}

/** The answer the client sees is a real one (not the automatic acknowledgement, not blank). */
export const hasRealAnswer = (response: string | null | undefined) => !!response?.trim() && response.trim() !== ISSUE_ACKNOWLEDGEMENT;

export type ParsedAnswer = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * The answer typed in "Answer" (required) or "Close" (optional when the issue already has a real answer). Trimmed,
 * bounded; `required` false → '' gives null (keep the current answer).
 */
export function parseIssueAnswer(v: unknown, required: boolean): ParsedAnswer {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) return required ? { ok: false, error: 'Write the answer to the client' } : { ok: true, value: null };
  if (t.length > ISSUE_ANSWER_MAX) return { ok: false, error: 'The answer is too long' };
  if (t === ISSUE_ACKNOWLEDGEMENT) return { ok: false, error: 'Write the answer to the client' };
  return { ok: true, value: t };
}

/** Notification texts (EN source strings; the bell translates them). */
export const ISSUE_NOTICE = {
  raised: 'Client issue raised',
  answered: 'Your issue was answered',
  closed: 'Your issue was closed',
} as const;
