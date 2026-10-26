import 'server-only';
// Approval-item provider contract (docs/spec/00 §7.8): each module that needs a decision registers one provider
// per kind; the registry (./index.ts) asks every provider for the viewer's items and builds the inbox.
import type { ApprovalItem, ApprovalKind } from '@/domain/approvals';
import type { Lang } from '@/i18n/translate';
import type { ApproverIdentity } from '@/server/dal/myapprovals-identity';
import type { ProjectRow } from '@/server/dal/projects';

export interface ApprovalContext {
  /** Who is asking: role, name and what they are responsible for in the database. */
  viewer: ApproverIdentity;
  /**
   * Current project (last project used; prototype `state.project`). Project-bound kinds — purchase orders,
   * deliveries, change requests, client deliverables, NCRs — cover this project only, as in the prototype
   * (08 §7.5 "current-project …"). Null when the code is unknown.
   */
  project: ProjectRow | null;
  /** Money in titles is formatted for the language (prototype `f()`). */
  lang: Lang;
  /** Business date (R-013): the item dates show their year outside its year. */
  today: string;
}

export interface ApprovalProvider {
  kind: ApprovalKind;
  /** `project` = depends on the current project (the sidebar badge is computed per project). */
  scope: 'global' | 'project';
  /** Where the items come from: the database (connector mirrors included) — every kind since Delivery 5. */
  source: 'db';
  /** Items waiting for the viewer, in the module's list order. */
  items(ctx: ApprovalContext): Promise<ApprovalItem[]>;
  /** The viewer's decisions on this kind ("Decided this week"); 0 when the kind keeps no trace of them. */
  decided(ctx: ApprovalContext): Promise<number>;
  /**
   * R-017 (project-bound kinds): the codes of the projects where `items` can return something for this viewer, read in one
   * query (a superset: `items` still decides); `items` is then asked for those projects only when the badges or the alerts
   * cover the whole portfolio. Omitted = every project.
   */
  candidates?(ctx: ApprovalContext): Promise<ReadonlySet<string>>;
  /**
   * R-017 (project-bound kinds): the item count of every project of `codes` in a few reads — the shell's per-project badges use
   * it instead of `items` project by project (the count `items(ctx).length` would give; absent = 0). Omitted = `items`.
   */
  countByProject?(ctx: ApprovalContext, codes: readonly string[]): Promise<ReadonlyMap<string, number>>;
}
