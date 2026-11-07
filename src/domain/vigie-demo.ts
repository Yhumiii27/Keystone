// D13 (Vigie, CV-07): an NCR's number is Vigie's EV-… reference. The demo data set — the prototype's NCRs, numbered "NCR-026"…
// "NCR-030" on Harbor Line and "NCR-040" / "NCR-041" generated on each other project with data — is numbered as Vigie would:
//   HLT-026 "NCR-0nn" → "EV-2026-0nn" (the prototype's digits kept, so the demo stays recognisable);
//   the generated pair of the n-th other project (NDC-031, RCF-019, ERP-202, WSA-044, MSR-012) → "EV-2026-040" + 2n and + 2n + 1
//   (Vigie's references are unique across projects, the prototype repeated NCR-040 / NCR-041 on each).
// Used by the prototype loader (src/server/prototype), the NCR snapshot (src/server/integrations/vigie/prototype-snapshot.ts) and
// the golden tests, which map the prototype's render values through `demoNcrText` before comparing. Pure.

/** Year of the demo references. */
export const DEMO_NCR_YEAR = 2026;
/** The projects with data whose NCRs the prototype generated ("NCR-040", "NCR-041"), in the prototype's order. */
export const DEMO_GENERATED_NCR_PROJECTS: readonly string[] = ['NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'];

const PROTO_NCR_RE = /\bNCR-0(\d\d)\b/g;

/** Vigie's reference of a prototype NCR number on a project ("NCR-029" → "EV-2026-029"; "NCR-041" on RCF-019 → "EV-2026-043"). */
export function demoNcrNumber(protoId: string, projectCode?: string | null): string {
  const m = /^NCR-0(\d\d)$/.exec(protoId.trim());
  if (!m) return protoId;
  const n = Number(m[1]);
  const i = projectCode ? DEMO_GENERATED_NCR_PROJECTS.indexOf(projectCode) : -1;
  const value = (n === 40 || n === 41) && i >= 0 ? 40 + 2 * i + (n - 40) : n;
  return `EV-${DEMO_NCR_YEAR}-${String(value).padStart(3, '0')}`;
}

/** Every prototype NCR number of a text, as Vigie numbers it (`demoNcrNumber`; the project decides the generated pair). */
export function demoNcrText<T>(value: T, projectCode?: string | null): T {
  return (typeof value === 'string' ? value.replace(PROTO_NCR_RE, (x) => demoNcrNumber(x, projectCode)) : value) as T;
}

/** A JSON value with every prototype NCR number renumbered (keys included: the prototype's French dictionary is keyed by text). */
export function demoNcrDeep<T>(value: T, projectCode?: string | null): T {
  if (typeof value === 'string') return demoNcrText(value, projectCode);
  if (Array.isArray(value)) return value.map((v) => demoNcrDeep(v, projectCode)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [demoNcrText(k, projectCode), demoNcrDeep(v, projectCode)])) as T;
  return value;
}

const PROJECT_CODE_RE = /^[A-Z]{3}-\d{3}$/;

/**
 * The prototype's golden values (src/features/<screen>/*.golden.json, generated from the design file) with their NCR numbers as
 * the demo data set now has them (D13): a subtree under a project-code key ("NDC-031": …) takes that project's numbering, the
 * rest Harbor Line's. The golden tests compare Keystone with the prototype through this, so the prototype comparison stays.
 */
export function demoNcrGolden<T>(value: T, projectCode?: string | null): T {
  if (typeof value === 'string') return demoNcrText(value, projectCode);
  if (Array.isArray(value)) return value.map((v) => demoNcrGolden(v, projectCode)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => {
      const code = PROJECT_CODE_RE.test(k) ? k : projectCode;
      return [demoNcrText(k, code), demoNcrGolden(v, code)];
    })) as T;
  return value;
}
