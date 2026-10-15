// "Score a proposal" (prototype AF catalogue `portfolio`, design line 3690; docs/spec/03 §6.6, 01 §8) and the
// validation of what it submits. Pure module shared by the client button (FormDialog, `translate`) and the Server
// Function. Labels are the prototype's English source strings; the proposal select carries project codes.
// Delivery 8 (L-5a = a, R-134): the form scores the 5 axes of the ranking — the prototype's three plus "Resource fit"
// and "Client priority" (default 3, like the others: FormDialog defaults are static, so a proposal's current scores are
// not prefilled). The prototype's labels are kept: "Financial return" scores the "Margin / NPV" axis.
import type { FormDef, FormValues } from '@/components/app/form-def';
import { validScore } from '@/domain/portfolio-finance';

/** AF_RESULT.portfolio */
export const SCORE_SAVED = 'Score saved';
export const COMMENT_MAX = 1000;

/** `options` = pipeline projects of the whole portfolio (`PIPE`): value = code, label = "#044 · Westfield Solar Array". */
export function scoreProposalForm(options: { value: string; label: string }[]): FormDef {
  return {
    title: 'Score a proposal',
    submit: 'Save score',
    kind: 'run',
    fields: [
      { id: 'project', label: 'Proposal', type: 'select', options },
      { id: 'fit', label: 'Strategic fit (1–5)', type: 'number', defaultValue: '3', required: true },
      { id: 'fin', label: 'Financial return (1–5)', type: 'number', defaultValue: '3', required: true },
      { id: 'risk', label: 'Risk (1–5, 5 = low)', type: 'number', defaultValue: '3', required: true },
      // L-5a: the two axes the prototype's form left out.
      { id: 'res', label: 'Resource fit (1–5)', type: 'number', defaultValue: '3', required: true },
      { id: 'client', label: 'Client priority (1–5)', type: 'number', defaultValue: '3', required: true },
      { id: 'comment', label: 'Comment', type: 'textarea' },
    ],
  };
}

export type Parse<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ScoreProposalInput {
  projectCode: string;
  fit: number;
  /** "Financial return" scores the Margin / NPV axis. */
  margin: number;
  /** 5 = low risk (Risk level axis). */
  risk: number;
  /** Resource fit and Client priority axes (L-5a). */
  res: number;
  client: number;
  comment: string | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** `pipeline` = codes the form offers; a blank proposal falls back to the first one (select default). */
export function parseScoreProposal(values: FormValues | unknown, pipeline: string[]): Parse<ScoreProposalInput> {
  const v = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
  const projectCode = str(v.project) || pipeline[0] || '';
  if (!pipeline.includes(projectCode)) return { ok: false, error: 'Choose a project in the pipeline' };
  const fit = validScore(str(v.fit));
  const margin = validScore(str(v.fin));
  const risk = validScore(str(v.risk));
  const res = validScore(str(v.res));
  const client = validScore(str(v.client));
  if (fit == null || margin == null || risk == null || res == null || client == null) return { ok: false, error: 'Scores are whole numbers from 1 to 5' };
  const comment = str(v.comment);
  if (comment.length > COMMENT_MAX) return { ok: false, error: 'The comment is too long' };
  return { ok: true, value: { projectCode, fit, margin, risk, res, client, comment: comment || null } };
}
