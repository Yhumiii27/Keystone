// E-2a = a / A-11 = a (docs/DECISIONS.md, Delivery 7 R-103) applied to the prototype's BOM logic before the golden
// generators run it, so every derived value follows the owner's rule: the project BOM is valued at the ordered price
// (an article on one of the project's orders that is Ordered, Partially received or Received — the seed's order lines
// carry the catalogue price), else the last purchase price, else the catalogue price; the flat list, its sort by total,
// the supplier values, the BOM value, the assembly roll-up, the node's costed roll-up (with its "Price basis" row) and
// the revision comparison use it. The PU/PR list (spares to buy) stays at the last purchase price.
// Used by scripts/proto-golden-bom.ts and scripts/proto-golden-d4.ts on the design file's lines (0-based array).

import D7 from '../src/i18n/extra/d7-operations.json';

/** The new English texts and their French (src/i18n/extra/d7-operations.json), added to the prototype dictionary. */
const E2A_TEXTS = ['Ordered, else last purchase, else catalogue price', 'Rolled-up cost', 'Price basis', 'Roll-up of components', 'Ordered price', 'Catalogue price'] as const;

/** Patches the prototype lines in place (the BOM block, design lines 4200–4266) and returns them. */
export function applyE2a(lines: string[]): string[] {
  const at = (n: number) => n - 1; // design line number → array index
  const swap = (n: number, from: string, to: string, all = false) => {
    const i = at(n);
    if (!lines[i].includes(from)) throw new Error(`E-2a patch: "${from}" not found on design line ${n}`);
    lines[i] = all ? lines[i].split(from).join(to) : lines[i].replace(from, to);
  };
  const fr = Object.fromEntries(E2A_TEXTS.map((k) => [k, (D7 as Record<string, string>)[k]]));
  swap(3756, 'const trFR=', `Object.assign(FR_DICT,${JSON.stringify(fr)});const trFR=`);
  // The valuation helper, declared before the BOM sorters (same render scope: `project`, `genPOs`, `lastPrice`).
  swap(4207, 'const bomSorters=', "const __ordE2a=new Set(genPOs(project).filter(o=>['Ordered','Partially received','Received'].includes(o.status)).flatMap(o=>o.lines.map(l=>l[0])));const __e2a=p=>__ordE2a.has(p.ref)?p.price:lastPrice(p);const bomSorters=");
  swap(4207, 'a.price*a.usage[PD.p3]-b.price*b.usage[PD.p3]', '__e2a(a)*a.usage[PD.p3]-__e2a(b)*b.usage[PD.p3]');
  for (let n = 4208; n <= 4225; n++) if (lines[at(n)].includes('p.price*p.usage[PD.p3]')) swap(n, 'p.price*p.usage[PD.p3]', '__e2a(p)*p.usage[PD.p3]', true);
  swap(4208, '.map(p=>partRow(p,p.usage[PD.p3]))', '.map(p=>partRow({...p,price:__e2a(p)},p.usage[PD.p3]))');
  swap(4222, "sub:'At unit list price'", "sub:'Ordered, else last purchase, else catalogue price'");
  swap(4231, 'return p?lastPrice(p):0;', 'return p?__e2a(p):0;');
  swap(4245, "cost:[['Rolled-up cost (last purchase)',money$(unit)],",
    "cost:[['Rolled-up cost',money$(unit)],['Price basis',has?'Roll-up of components':__ordE2a.has(node.ref)?'Ordered price':LAST_PRICE[node.ref]!=null?'Last purchase price':'Catalogue price'],");
  swap(4266, 'money$(Math.abs(d)*lastPrice(p))', 'money$(Math.abs(d)*__e2a(p))');
  return lines;
}
