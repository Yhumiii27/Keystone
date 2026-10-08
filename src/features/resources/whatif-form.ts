// "New scenario" action form (AF `whatif`, docs/spec/05 §4.5, 01 §8 row whatif): definition + input validation.
// Pure module shared by the client button (FormDialog `translate`) and the Server Function. Select values are codes.
import type { FormDef, FormValues } from '@/components/app/form-def';

export type ScenarioBasis = 'current_plan' | 'baseline' | 'last_approved';

export const SCENARIO_BASES: { value: ScenarioBasis; label: string }[] = [
  { value: 'current_plan', label: 'Current plan' },
  { value: 'baseline', label: 'Baseline BL1' },
  { value: 'last_approved', label: 'Last approved scenario' },
];

export const SCENARIO_HORIZONS: { value: string; label: string }[] = [
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
];

export const SCENARIO_NAME_MAX = 60;
export const HYPOTHESES_MAX = 2000;

export const NEW_SCENARIO_FORM: FormDef = {
  title: 'New scenario',
  submit: 'Create scenario',
  kind: 'create',
  fields: [
    { id: 'name', label: 'Scenario name', type: 'text', required: true },
    { id: 'basis', label: 'Basis', type: 'select', options: SCENARIO_BASES },
    { id: 'horizon', label: 'Horizon', type: 'select', options: SCENARIO_HORIZONS },
    { id: 'note', label: 'Hypotheses', type: 'textarea' },
  ],
};

/** Toast of the prototype (AF_RESULT.whatif). */
export const NEW_SCENARIO_RESULT = 'Scenario created';

export interface NewScenarioRequest {
  name: string;
  basis: ScenarioBasis;
  horizonMonths: number;
  hypotheses: string;
}

export type NewScenarioParse = { ok: true; value: NewScenarioRequest } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Validates the submitted values (untrusted). Errors are EN source strings (render through t()). */
export function parseNewScenario(values: FormValues | unknown, existingNames: string[] = []): NewScenarioParse {
  const v = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
  const name = str(v.name).replace(/\s+/g, ' ');
  const basis = str(v.basis) || SCENARIO_BASES[0].value;
  const horizon = str(v.horizon) || SCENARIO_HORIZONS[0].value;
  const hypotheses = str(v.note);
  if (!name) return { ok: false, error: 'Scenario name is required' };
  if (name.length > SCENARIO_NAME_MAX) return { ok: false, error: 'Scenario name is too long' };
  if (existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'A scenario with this name already exists' };
  if (!SCENARIO_BASES.some((b) => b.value === basis)) return { ok: false, error: 'Unknown basis' };
  if (!SCENARIO_HORIZONS.some((h) => h.value === horizon)) return { ok: false, error: 'Unknown horizon' };
  if (hypotheses.length > HYPOTHESES_MAX) return { ok: false, error: 'Hypotheses are too long' };
  return { ok: true, value: { name, basis: basis as ScenarioBasis, horizonMonths: Number(horizon), hypotheses } };
}
