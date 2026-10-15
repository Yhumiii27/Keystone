// E-2b = a (docs/DECISIONS.md, Delivery 8 R-104) applied to the prototype's "Compare revisions" before the golden
// generators run it, after E-2a (./proto-e2a.ts, whose `__e2a` valuation it reuses): a substitution "A → B" costs the new
// quantity at B's price minus the old quantity at A's price — the prototype priced only the quantity change of the new
// part, so a substitution at equal quantity showed "—" (09 OQ8). A quantity or an added line (same part, or no old
// quantity) gives the same value as before; a line whose old or new part is unknown keeps the quantity-only rule. The
// cost-delta total ("+€… per crane") sums the same line values (it used the last purchase price; the E-2a valuation gives
// the same figures on the seed). Each swap fails loudly when its text is missing, so a change of the design file or of the
// E-2a patch cannot shift the goldens silently.
// Used by scripts/proto-golden-bom.ts and scripts/proto-golden-d4.ts on the design file's lines (0-based array), after applyE2a.

/** The E-2b line value, as a JS expression over `line`, `a`, `b` and the E-2a valuation `__e2a` (prototype scope). */
const DELTA =
  "(()=>{const __s=line.split(' / ').pop().split(' → ');const __p=partOf(__s[__s.length-1]);const __o=partOf(__s[0]);" +
  'const __a=parseInt(a)||0,__b=parseInt(b)||0;return __p&&__o?__b*__e2a(__p)-__a*__e2a(__o):(__b-__a)*(__p?__e2a(__p):0);})()';

/** Patches the prototype lines in place (Compare revisions, design lines 4266–4267) and returns them. */
export function applyE2b(lines: string[]): string[] {
  const at = (n: number) => n - 1; // design line number → array index
  const swap = (n: number, from: string, to: string) => {
    const i = at(n);
    if (!lines[i].includes(from)) throw new Error(`E-2b patch: "${from}" not found on design line ${n}`);
    lines[i] = lines[i].replace(from, to);
  };
  // Row delta: the line's cost change (sign and amount), "—" when it is 0.
  swap(4266, 'const d=(parseInt(b)||0)-(parseInt(a)||0);', `const d=${DELTA};`);
  swap(4266, 'money$(Math.abs(d)*__e2a(p))', 'money$(Math.abs(d))');
  // Total: Σ of the same line values.
  swap(4267, 'return s+((parseInt(b)||0)-(parseInt(a)||0))*(p?lastPrice(p):0);', `return s+${DELTA};`);
  return lines;
}
