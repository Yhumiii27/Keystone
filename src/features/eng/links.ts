// URLs of the Engineering synthesis and the four discipline screens (docs/spec/09 §7–8, 00 §8.3). Pure: usable from
// Server and Client Components. URL state:
//   /projects/[code]/engineering                                 Synthesis
//   /projects/[code]/engineering/{process|mechanical|electrical|automation}   discipline screen
//   ?status=open|sent_back|resolved                              consistency-check chip (discipline screens; default All)
//   ?import=<discipline>&doc=<document>&tool=<n>                 import wizard open for that discipline and document
//                                                                (tool = ENG_TOOLS position; missing / unknown: the document's tool)
import { screenHref } from '@/config/screens';
import { SCREEN_OF_DISCIPLINE, type CheckFilter, type Discipline, type ImportTarget } from '@/domain/engineering';

export interface EngQuery {
  status?: CheckFilter | null;
  import?: ImportTarget | null;
}

function withQuery(base: string, q: EngQuery): string {
  const u = new URLSearchParams();
  if (q.status && q.status !== 'all') u.set('status', q.status);
  if (q.import) {
    u.set('import', q.import.disc);
    u.set('doc', q.import.doc);
    u.set('tool', String(q.import.tool));
  }
  const qs = u.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Synthesis `/projects/{code}/engineering`. */
export const synthesisHref = (code: string, q: EngQuery = {}) => withQuery(screenHref('eng', { code }), { ...q, status: null });

/** Discipline screen `/projects/{code}/engineering/{segment}` (the chip filter resets when coming from elsewhere). */
export const disciplineHref = (code: string, disc: Discipline, q: EngQuery = {}) => withQuery(screenHref(SCREEN_OF_DISCIPLINE[disc], { code }), q);

/** The engineering screen `disc` (null = Synthesis) with the wizard open on `target`, keeping the chip filter. */
export const importHref = (code: string, disc: Discipline | null, target: ImportTarget, status?: CheckFilter | null) =>
  disc ? disciplineHref(code, disc, { status, import: target }) : synthesisHref(code, { import: target });
