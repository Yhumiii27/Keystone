// R-017 — times the main server reads of each screen on the current database (grown by npm run load:seed), and prints a table.
//   KEYSTONE_DATA_DIR=/tmp/ks-load npm run load:measure            PGlite
//   DATABASE_URL=postgres://… npm run load:measure                  PostgreSQL server
// Options: --runs=5 (warm runs per screen), --project=HLT-026, --only=docs,orders (screens), --json (machine-readable),
// --budget (exit code 1 when a screen is over its warm budget: 300 ms on PGlite, 150 ms on PostgreSQL — npm run load:check).
//
// Each screen's loader calls the DAL readers its page calls (src/app/(app)/…/page.tsx), as the director (who sees everything),
// inside an emulated request: React's `cache()` memoises per request in the app, so each run gets a fresh request cache
// (the memoised readers — listProjects, listVaultDocuments… — are shared by the readers of one page, never across runs).
// Columns: "cold" = the first run in this process (database and process caches empty); "after a write" = the median of runs
// with the process read caches emptied first (src/server/cache/read-cache.ts — what a page costs right after a change);
// "warm" = the median of runs served by those caches (the database unchanged since the previous run). "SQL" counts the
// statements of one "after a write" run (N+1 loops show up there). The shell's badges run on every page (the app layout).
// Not a CI job (the Actions minutes are counted): run it by hand after a change that touches a reader.
process.env.KEYSTONE_CLOCK ??= '2026-09-25';
import Module from 'node:module';
import { loadEnvFiles } from '@/server/config/env-files';

// Outside Next, next/navigation (imported by src/server/project-context.ts for its redirects) cannot load under the
// react-server condition: a stub stands for it (the measured readers never redirect).
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === 'next/navigation') return { redirect: () => { throw new Error('redirect'); }, notFound: () => { throw new Error('notFound'); } };
  return load.call(this, request, ...rest);
};

const argOf = (name: string) => process.argv.find((x) => x.startsWith(`--${name}=`))?.split('=')[1];

type Loader = () => Promise<unknown>;

async function main(): Promise<void> {
  loadEnvFiles(process.cwd());
  const React = await import('react');
  const { getDb } = await import('@/server/db/client');
  const { getConfig } = await import('@/server/config');
  const { personaOf } = await import('@/config/personas');
  const dal = {
    home: await import('@/server/dal/home'),
    register: await import('@/server/dal/projects-register'),
    portfolio: await import('@/server/dal/portfolio'),
    projects: await import('@/server/dal/projects'),
    plan: await import('@/server/dal/plan'),
    planTrash: await import('@/server/dal/plan-trash'),
    schedule: await import('@/server/dal/schedule'),
    capex: await import('@/server/dal/capex-milestones'),
    budget: await import('@/server/dal/budget'),
    estimate: await import('@/server/dal/estimate-class'),
    itp: await import('@/server/dal/itp'),
    equipment: await import('@/server/dal/project-equipment'),
    docs: await import('@/server/dal/documents'),
    orders: await import('@/server/dal/orders'),
    resources: await import('@/server/dal/resources'),
    requests: await import('@/server/dal/requests'),
    catalogue: await import('@/server/dal/machine-catalogue'),
    mtypes: await import('@/server/dal/mtypes'),
    mywork: await import('@/server/dal/mywork-data'),
    kpis: await import('@/server/dal/kpis'),
    tasks: await import('@/server/dal/tasks'),
    notifications: await import('@/server/dal/notifications'),
    integrations: await import('@/server/dal/integrations'),
    connectors: await import('@/server/dal/admin-connectors'),
    aftersales: await import('@/server/dal/aftersales'),
    pipeline: await import('@/server/dal/pipeline'),
    shell: await import('@/server/dal/shell'),
    context: await import('@/server/project-context'),
  };
  const readCache = await import('@/server/cache/read-cache');
  const db = await getDb();
  const driver = getConfig().database.driver;

  // SQL statements, counted on the driver client (PGlite.query / pg Pool.query).
  let statements = 0;
  const client = (db as unknown as { $client: { query: (...a: unknown[]) => unknown } }).$client;
  const original = client.query.bind(client);
  client.query = (...a: unknown[]) => {
    statements++;
    return original(...a);
  };

  // An emulated request: React's server cache dispatcher with a fresh cache per run.
  const internals = (React as unknown as { __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { A: unknown } })
    .__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const inRequest = async <T,>(f: () => Promise<T>): Promise<T> => {
    const caches = new Map<unknown, unknown>();
    const previous = internals?.A;
    if (internals) {
      internals.A = {
        getCacheForType: (create: () => unknown) => {
          if (!caches.has(create)) caches.set(create, create());
          return caches.get(create);
        },
        cacheSignal: () => null,
        getOwner: () => null,
      };
    }
    try {
      return await f();
    } finally {
      if (internals) internals.A = previous;
    }
  };

  const director = personaOf('director');
  const pm = personaOf('pm');
  const projectsList = await dal.projects.listProjects();
  const code = argOf('project') ?? (projectsList.find((p) => p.code === 'HLT-026')?.code ?? projectsList.find((p) => p.hasData)?.code ?? projectsList[0].code);
  const lang = 'fr' as const;

  const screens: [string, Loader][] = [
    ['home (director)', () => dal.home.getHomeView({ role: 'director', persona: { name: director.name, title: director.title }, projectCode: code, zone: null, lang })],
    ['home (pm)', () => dal.home.getHomeView({ role: 'pm', persona: { name: pm.name, title: pm.title }, projectCode: code, zone: null, lang })],
    ['portfolio overview', () => dal.portfolio.getPortfolioOverview(null, lang)],
    ['portfolio register', async () => Promise.all([dal.register.getRegisterData(), dal.context.projectAccessResolver(director)])],
    ['portfolio schedule', () => dal.pipeline.getPortfolioSchedule(null)],
    ['project header', () => dal.projects.getProject(code)],
    ['plan', async () => {
      await Promise.all([dal.plan.getPlanData(code), dal.plan.getPlanSettings(code)]);
      await Promise.all([dal.plan.getPlanTodos(code), dal.plan.getPlanRequests(code), dal.planTrash.listPlanTrash(code)]);
    }],
    ['schedule', () => Promise.all([dal.schedule.getScheduleData(code), dal.capex.listCapexMilestones(code)])],
    ['budget', async () => { await dal.budget.getBudgetData(code); await dal.estimate.getBudgetEstimate(code); }],
    ['itp', async () => {
      await dal.equipment.listProjectEquipments(code);
      await Promise.all([dal.itp.getItpPlan(code), dal.itp.listPunchItems(code), dal.itp.projectMachineTypeLabel(code)]);
    }],
    // The vault page reads the project's records (and the QMS ones) for "Current project", every record for "All projects".
    ['docs (vault, current project)', () => Promise.all([dal.docs.listProjectDocuments(code), dal.docs.getCodexSyncState()])],
    ['docs (vault, all projects)', () => Promise.all([dal.docs.listVaultDocuments(), dal.docs.getCodexSyncState()])],
    ['docs (one record)', async () => {
      const first = (await dal.docs.listProjectDocuments(code))[0];
      if (first) await dal.docs.getDocumentRecord(first.number);
    }],
    ['orders', () => dal.orders.getOrdersScreen(code, director.name)],
    ['resources', async () => {
      const win = await dal.resources.getLoadWindow();
      await Promise.all([
        dal.resources.getResourcePool(win.weeks), dal.resources.getCapacityDemand(win.weeks), dal.requests.listResourceRequests({ status: 'pending' }),
      ]);
      await dal.resources.getPortfolioLaborCost(null);
      await dal.mywork.myWorkAccess(director);
    }],
    // Streamed after the rest of the page (Suspense, R-017): the portfolio's what-if levers.
    ['resources: suggestions (streamed)', () => dal.resources.getRebalancingSuggestions()],
    ['catalogue', () => Promise.all([dal.catalogue.listCatalogue(), dal.mtypes.listMachineTypes(), dal.catalogue.listCataloguePublication(), dal.catalogue.listCatalogueUses()])],
    ['my work', async () => {
      await dal.mywork.myWorkAccess(pm);
      await dal.mywork.getMyWorkPerson(pm.name);
      await Promise.all([dal.tasks.listTasks({ person: pm.name }), dal.kpis.loggedThisWeek(pm.name), dal.kpis.loadNextWeeks(pm.name)]);
    }],
    ['activity & audit', async () => {
      await Promise.all([dal.notifications.listActivity(), dal.connectors.listAdminConnectors(), dal.integrations.listImportFormats(), dal.notifications.listAudit(), dal.integrations.getPlumbingCounts()]);
      await dal.notifications.countUnreadNotifications(director);
    }],
    ['installed base', () => dal.aftersales.getFleetScreen(null)],
    ['shell badges (director)', () => dal.shell.getShellNav(director)],
    ['shell badges (pm)', () => dal.shell.getShellNav(pm)],
  ];
  const only = argOf('only')?.split(',');
  const selected = only ? screens.filter(([n]) => only.some((o) => n.startsWith(o))) : screens;
  const runs = Number(argOf('runs') ?? 5);
  const time = async (f: Loader) => {
    const s0 = statements;
    const t0 = performance.now();
    await inRequest(f);
    return { ms: performance.now() - t0, q: statements - s0 };
  };
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const results: { screen: string; cold: number; afterWrite: number; warm: number; queries: number; warmQueries: number }[] = [];
  for (const [name, f] of selected) {
    readCache.clearReadCache();
    const cold = await time(f);
    const fresh: number[] = [];
    const warm: number[] = [];
    let q = 0;
    let wq = 0;
    for (let i = 0; i < runs; i++) {
      readCache.clearReadCache();
      const r = await time(f);
      fresh.push(r.ms);
      q = r.q;
    }
    for (let i = 0; i < runs; i++) {
      const r = await time(f);
      warm.push(r.ms);
      wq = r.q;
    }
    results.push({ screen: name, cold: cold.ms, afterWrite: median(fresh), warm: median(warm), queries: q, warmQueries: wq });
  }
  const budget = driver === 'postgres' ? 150 : 300;
  if (process.argv.includes('--json')) console.log(JSON.stringify({ driver, project: code, results }, null, 1));
  else {
    const counts = await Promise.all(['projects', 'activities', 'documents', 'purchase_orders', 'audit_entries', 'persons'].map(async (t) => {
      const { sql } = await import('drizzle-orm');
      const r = await db.execute<{ n: number }>(sql.raw(`select count(*)::int n from ${t}`));
      return `${t} ${r.rows[0].n}`;
    }));
    console.log(`Driver ${driver} · project ${code} · ${counts.join(' · ')} · warm budget ${budget} ms`);
    console.log('| Screen | Cold (ms) | After a write (ms) | Warm (ms) | SQL after a write | SQL warm |');
    console.log('|---|---:|---:|---:|---:|---:|');
    for (const r of results) console.log(`| ${r.screen} | ${r.cold.toFixed(0)} | ${r.afterWrite.toFixed(0)} | ${r.warm.toFixed(0)} | ${r.queries} | ${r.warmQueries} |`);
  }
  // The streamed card is not on the page's critical path: reported, not budgeted.
  const over = results.filter((r) => r.warm > budget && !r.screen.includes('(streamed)'));
  if (process.argv.includes('--budget')) {
    if (over.length) {
      console.log(`Over the ${budget} ms warm budget: ${over.map((r) => `${r.screen} (${r.warm.toFixed(0)} ms)`).join(', ')}`);
      process.exit(1);
    }
    console.log(`Every measured screen is within the ${budget} ms warm budget.`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
