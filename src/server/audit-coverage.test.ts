// R-168 (spec 11 §3.12): every audit row of a change carries the values before / after (the fields that changed) and, when
// the actor gives one, the reason. This guard reads the sources (like use-server-exports.test.ts): each call of an audit
// writer — writeAudit, addAudit, trace and the modules' own audit helpers below — must pass `before`, `after` or `reason`
// (an object literal with one of these keys, a spread such as `...changedValues(…)`, or a `changedValues(…)` argument).
// The calls that legitimately carry none are listed in ALLOWED with why; a new writer either fills them or is added there.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

/** Writers checked everywhere. */
const WRITERS = new Set(['writeAudit', 'addAudit', 'trace']);
/** A module's own audit helpers (positional arguments; their last object carries the values). */
const LOCAL_WRITERS: Record<string, readonly string[]> = {
  'src/server/dal/contract.ts': ['audit'],
  'src/server/dal/meetings-core.ts': ['auditMeeting'],
  'src/server/dal/meetings-transcripts.ts': ['auditMeeting'],
  'src/server/dal/tasks.ts': ['auditTask'],
  'src/server/dal/resources.ts': ['audit'],
  'src/server/dal/hr.ts': ['auditSettings', 'traceRate'],
  'src/server/dal/supplier-schedules.ts': ['audit'],
  'src/server/dal/shipments.ts': ['contentTrace'],
};

/**
 * Why a call carries no before / after / reason:
 * - creation: a new record — the change text describes it, its row is the "after" (R-168 brief: pure creations skipped);
 * - event: something happened without a stored value changing (sign-in / out, a comment, a file attached, an export, a sync run);
 * - system: a connector, an import or the antivirus wrote it (the run's own record holds the detail);
 * - wrapper: a helper that forwards its caller's values (the callers are checked).
 */
type Why = 'creation' | 'event' | 'system' | 'wrapper';
const ALLOWED: Record<string, readonly [Why, number?]> = {
  // wrappers
  'src/server/dal/notifications.ts › addAudit': ['wrapper'],
  'src/server/dal/contract.ts › trace': ['wrapper'],
  // creations
  'src/server/dal/activity-todos.ts › addActivityTodo': ['creation'],
  'src/server/dal/bom.ts › insertBomLine': ['creation'],
  'src/server/dal/claims.ts › openClaim': ['creation'],
  'src/server/dal/claims.ts › planIntervention': ['creation'],
  'src/server/dal/contract.ts › addAmendment': ['creation'],
  'src/server/dal/contract.ts › addBond': ['creation'],
  'src/server/dal/contract.ts › addPaymentMilestone': ['creation'],
  'src/server/dal/deliveries.ts › announceDelivery': ['creation'],
  'src/server/dal/documents.ts › depositInCodex': ['creation'],
  'src/server/dal/fleet.ts › addMachine': ['creation'],
  'src/server/dal/fleet.ts › registerDeliveredMachines': ['creation', 2],
  'src/server/dal/hr.ts › addSkill': ['creation'],
  'src/server/dal/hr.ts › auditSettings': ['wrapper'],
  'src/server/dal/interfaces.ts › createInterface': ['creation'],
  'src/server/dal/itp.ts › addItpInspection': ['creation'],
  'src/server/dal/mtypes.ts › createMachineType': ['creation'],
  'src/server/dal/parts.ts › createPart': ['creation'],
  'src/server/dal/parts.ts › registerEquivalent': ['creation'],
  'src/server/dal/pid.ts › mapPidTag': ['creation'],
  'src/server/dal/purchasing.ts › createDraftPurchaseOrders': ['creation'],
  'src/server/dal/purchasing.ts › createRfq': ['creation'],
  'src/server/dal/quality.ts › createDeliverable': ['creation'],
  'src/server/dal/requests.ts › insertResourceRequest': ['creation'],
  'src/server/dal/rex.ts › addLesson': ['creation'],
  'src/server/dal/risks.ts › run': ['creation'],
  'src/server/dal/settings.ts › addLocation': ['creation'],
  'src/server/dal/settings.ts › addReferenceValue': ['creation'],
  'src/server/dal/site.ts › saveDailyReport': ['creation'],
  'src/server/dal/spares-orders.ts › createSparesPurchaseOrders': ['creation'],
  'src/server/dal/stakeholders.ts › addStakeholder': ['creation'],
  'src/server/dal/resources.ts › createScenario': ['creation'],
  'src/server/dal/meetings-transcripts.ts › applyTranscriptToMinutes': ['creation'],
  'src/server/dal/meetings-transcripts.ts › addTranscriptQuestion': ['creation'],
  'src/server/dal/supplier-schedules.ts › createSupplierSchedule': ['creation'],
  'src/server/dal/tasks.ts › addChecklistItem': ['creation'],
  'src/server/dal/persons-directory.ts › importStaffDirectory': ['system', 2],
  // events
  'src/app/api/interchange/mspdi/[code]/route.ts › GET': ['event'],
  'src/server/dal/deliveries.ts › attachReceiptDocument': ['event'],
  'src/server/dal/engineering.ts › generateEngOutput': ['event'],
  'src/server/dal/photos.ts › addPhoto': ['event'],
  'src/server/dal/task-files.ts › attachTaskFile': ['event'],
  'src/server/dal/trends.ts › recordStatusReport': ['event'],
  'src/server/dal/users.ts › recordSignOut': ['event'],
  'src/server/dal/users.ts › run': ['event'],
  'src/server/dal/shipment-documents.ts › fileShippingDocumentOn': ['event'],
  'src/server/dal/resources.ts › selectScenario': ['event'],
  'src/server/dal/tasks.ts › addTaskComment': ['event', 2],
  'src/server/dal/meetings-transcripts.ts › importTranscript': ['event'],
  'src/server/dal/meetings-transcripts.ts › analyseTranscript': ['system'],
  // systems
  'src/server/dal/drawings.ts › syncPdmVault': ['system'],
  'src/server/dal/engineering.ts › importEngList': ['system'],
  'src/server/dal/integrations.ts › syncConnector': ['system'],
  'src/server/dal/orders.ts › pushPurchaseOrderToX3': ['system'],
  'src/server/dal/pid-import.ts › applyPidImport': ['system'],
  'src/server/dal/site.ts › syncCursus': ['system'],
  'src/server/dal/stock.ts › importStockFromX3': ['system'],
  'src/server/dal/stock.ts › pushStockToX3': ['system'],
  'src/server/integrations/codex/mirror.ts › applyCodexIndex': ['system'],
  'src/server/integrations/cursus/connector.ts › queue': ['system'],
  'src/server/integrations/cursus/inbox.ts › receiveCursusEvent': ['system'],
  'src/server/interchange/table-import.ts › writeTableImport': ['system'],
  'src/server/storage/scan.ts › scanUpload': ['system'],
};

const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

const VALUE_KEYS = new Set(['before', 'after', 'reason']);
const isChangedValues = (n: ts.Expression): boolean =>
  (ts.isCallExpression(n) && n.expression.getText() === 'changedValues')
  || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && isChangedValues(n.left));
/** The argument carries before / after / reason. */
const carriesValues = (arg: ts.Expression): boolean =>
  isChangedValues(arg)
  || (ts.isConditionalExpression(arg) && (carriesValues(arg.whenTrue) || carriesValues(arg.whenFalse)))
  || (ts.isObjectLiteralExpression(arg) && arg.properties.some((p) => ts.isSpreadAssignment(p) || (!!p.name && VALUE_KEYS.has(p.name.getText()))));

function enclosingFunction(n: ts.Node): string {
  for (let p = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent)) return p.parent.name.getText();
  }
  return '<module>';
}

/** "file › function" → number of audit calls there without before / after / reason. */
function callsWithoutValues(): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of files(SRC)) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const text = fs.readFileSync(f, 'utf8');
    const names = new Set([...WRITERS, ...(LOCAL_WRITERS[rel] ?? [])]);
    if (![...names].some((n) => text.includes(`${n}(`))) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text) && !n.arguments.some(carriesValues)) {
        const key = `${rel} › ${enclosingFunction(n)}`;
        out.set(key, (out.get(key) ?? 0) + 1);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

describe('audit trail before / after / reason (R-168)', () => {
  const found = callsWithoutValues();

  it('every audit call of a change carries before / after / reason, or is listed with why', () => {
    const unlisted = [...found].filter(([k, n]) => (ALLOWED[k]?.[1] ?? (ALLOWED[k] ? 1 : 0)) < n).map(([k, n]) => `${k} (${n})`);
    expect(unlisted).toEqual([]);
  });

  it('lists no call that now carries its values (stale entries)', () => {
    const stale = Object.entries(ALLOWED).filter(([k, [, n = 1]]) => (found.get(k) ?? 0) < n).map(([k]) => k);
    expect(stale).toEqual([]);
  });

  it('finds the audit writers it guards (the scan is not empty)', () => {
    expect(found.size).toBeGreaterThan(10);
  });
});
