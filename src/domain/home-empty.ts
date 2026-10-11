// Home of a database without any project (R-011): a new production database starts with reference data only, so the Homes
// built around the current project (director, project manager, quality, procurement, client) have nothing to show until the
// first project is created. Greeting as usual, no KPI (no figure is invented), an explanatory row and an empty queue.
import { greeting, type HomeView, type Persona } from './home';

export const NO_PROJECT_TITLE = 'No project yet';
export const NO_PROJECT_SUB = 'Projects appear here once they are created';

export function noProjectHome(persona: Persona): HomeView {
  return {
    ...greeting(persona),
    kpis: [],
    left: { title: 'My projects', rows: [{ title: NO_PROJECT_TITLE, sub: NO_PROJECT_SUB, tag: '', tagClass: '', href: '' }] },
    right: { title: 'Waiting for me', rows: [] },
  };
}
