// "Score a proposal" (prototype AF catalogue `portfolio`, design line 3690; docs/spec/03 §6.6, 01 §8) and the
// validation of what it submits. Pure module shared by the client button (FormDialog, `translate`) and the Server
// Function. Labels are the prototype's English source strings; the proposal select carries project codes.
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
  if (fit == null || margin == null || risk == null) return { ok: false, error: 'Scores are whole numbers from 1 to 5' };
  const comment = str(v.comment);
  if (comment.length > COMMENT_MAX) return { ok: false, error: 'The comment is too long' };
  return { ok: true, value: { projectCode, fit, margin, risk, comment: comment || null } };
}
