// Test harness (not imported by the app): evaluates the prototype's own component logic (design file lines
// 3096–5239: data, dictionaries, `class Component` with renderValsEN / renderVals) in a node:vm sandbox, so the
// Meetings golden tests compare the rebuild with the prototype's output in EN and in FR (renderVals runs the
// prototype's deepTr). The sandbox keeps its own built-ins: deepTr only walks objects whose prototype is the
// sandbox's Object.prototype, so host built-ins must not be injected.
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export type ProtoLang = 'en' | 'fr';

export interface Prototype {
  /** Render values for a state patch (director, HLT-026, Meetings by default), EN or FR (raw; see `plain`). */
  render: (state?: Record<string, any>, lang?: ProtoLang) => any;
  /** Initial `state.mtg` of the prototype. */
  mtg0: () => any;
  /** Initial `state.added`. */
  added0: () => any;
}

/** Plain JSON copy of render values (drops handlers; sandbox objects become host objects). */
export const plain = (v: any) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

let cached: Prototype | null = null;

export function loadPrototype(): Prototype {
  if (cached) return cached;
  const file = path.resolve(__dirname, '../../../design/Keystone PM v8.dc.html');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const ctx: any = {
    console,
    window: { addEventListener() {}, removeEventListener() {} },
    React: { createRef: () => ({ current: null }) },
    DCLogic: class {
      props: any;
      state: any;
      constructor(props: any) {
        this.props = props || {};
      }
      setState(p: any) {
        const u = typeof p === 'function' ? p(this.state) : p;
        this.state = { ...this.state, ...u };
      }
    },
  };
  vm.createContext(ctx);
  vm.runInContext(lines.slice(3095, 5239).join('\n') + '\n;globalThis.__C = Component;', ctx);
  const fresh = () => new ctx.__C({});
  cached = {
    render(state = {}, lang = 'en') {
      const c = fresh();
      c.state = { ...c.state, role: 'director', project: 'HLT-026', screen: 'meetings', ...state, lang };
      return lang === 'fr' ? c.renderVals() : c.renderValsEN();
    },
    mtg0: () => plain(fresh().state.mtg),
    added0: () => plain(fresh().state.added),
  };
  return cached;
}
