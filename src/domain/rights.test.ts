// Delivery 7 lot "rights": the pure rules of src/domain/rights.ts (P-1, P-2, P-8a, P-9a, P-9b, P-10a, P-10b, L-4b, R-9,
// NEW-D2-1, NEW-D3-1), for the 8 personas and the signed-in users (matched by person rather than by short name).
import { describe, expect, it } from 'vitest';
import type { RoleKey } from '@/config/screens';
import D7_RIGHTS from '@/i18n/extra/d7-rights.json';
import { makeT } from '@/i18n/translate';
import {
  canDecideDepartment, canDepositInCodex, canEditActivityProgress, canEditPlanStructure, canManageTeam, canSeeSupplierPrices, canSyncCodex,
  canViewDepartmentApprovals, canViewPersonWork, canWriteMinutes, clientRefusedProject, clientRefusedScreen, clientSeesMeeting, clientSeesTarget,
  isOrganizer, isProjectTeamRole, PRICES_HIDDEN, PROJECT_TEAM_ROLE_LABEL, projectAccess, type ProjectFacts, type RightsViewer, type TeamMember,
} from './rights';

const member = (short: string, role: TeamMember['role'], personId = `id-${short}`, primary = false): TeamMember => ({ personId, short, name: short, role, primary });
const HARBOR: ProjectFacts = {
  client: 'Port authority',
  pm: 'R. Aubert',
  pmPersonId: 'id-R. Aubert',
  team: [member('R. Aubert', 'pm', 'id-R. Aubert', true), member('C. Petit', 'pm'), member('L. Marchand', 'deputy'), member('A. Girard', 'referent'), member('J. Weber', 'team')],
};
const viewer = (role: RoleKey, short: string, extra: Partial<RightsViewer> = {}): RightsViewer => ({ role, short, name: short, personId: null, organisation: null, ...extra });

describe('R-041 · projectAccess (P-2, L-4b)', () => {
  it('the team decides: PM of record, co-PM and deputy lead; referents and members edit; the others read', () => {
    const of = (v: RightsViewer) => {
      const a = projectAccess(v, HARBOR);
      return [a.teamRole, a.member, a.lead, a.pm, a.readOnly, a.refused];
    };
    expect(of(viewer('pm', 'R. Aubert'))).toEqual(['pm', true, true, true, false, false]);
    expect(of(viewer('pm', 'C. Petit'))).toEqual(['pm', true, true, true, false, false]); // several PMs
    expect(of(viewer('member', 'L. Marchand'))).toEqual(['deputy', true, true, true, false, false]);
    expect(of(viewer('englead', 'A. Girard'))).toEqual(['referent', true, false, false, false, false]);
    expect(of(viewer('member', 'J. Weber'))).toEqual(['team', true, false, false, false, false]);
    expect(of(viewer('quality', 'G. Comte'))).toEqual([null, false, false, false, true, false]);
    expect(of(viewer('pm', 'S. Perrin'))).toEqual([null, false, false, false, true, false]); // a PM of other projects reads this one
    // The director: every project, PM rights, but not "the project's PM" (P-9b) unless on the team.
    expect(of(viewer('director', 'M. Lefebvre'))).toEqual([null, true, true, false, false, false]);
  });

  it('signed-in users are matched by person, not by short name', () => {
    expect(projectAccess(viewer('pm', 'R. Aubert', { personId: 'someone-else' }), HARBOR).teamRole).toBeNull();
    expect(projectAccess(viewer('pm', 'X. Other', { personId: 'id-R. Aubert' }), HARBOR).teamRole).toBe('pm');
    expect(projectAccess(viewer('member', 'X. Other', { personId: 'id-A. Girard' }), HARBOR).teamRole).toBe('referent');
  });

  it('the highest team role wins when a person has several rows; the PM of record is pm even without a row', () => {
    const p = { ...HARBOR, team: [member('A. Girard', 'team'), member('A. Girard', 'deputy')] };
    expect(projectAccess(viewer('englead', 'A. Girard'), p).teamRole).toBe('deputy');
    expect(projectAccess(viewer('pm', 'R. Aubert'), { ...HARBOR, team: [] }).teamRole).toBe('pm');
  });

  it('the client: their organisation\'s projects only (P-10a); never a team role, never lead', () => {
    const own = projectAccess(viewer('client', 'N. Bensaïd', { organisation: 'Port authority' }), HARBOR);
    expect([own.member, own.client, own.lead, own.readOnly, own.refused, own.teamRole]).toEqual([true, true, false, false, false, null]);
    const other = projectAccess(viewer('client', 'N. Bensaïd', { organisation: 'Northgate' }), HARBOR);
    expect([other.member, other.readOnly, other.refused]).toEqual([false, true, true]);
    expect(projectAccess(viewer('client', 'N. Bensaïd'), HARBOR).refused).toBe(true); // no organisation → nothing
  });

  it('the team is managed by the director and the PMs (not deputies, referents or members)', () => {
    const can = (v: RightsViewer) => canManageTeam(v.role, projectAccess(v, HARBOR));
    expect([can(viewer('director', 'M. Lefebvre')), can(viewer('pm', 'R. Aubert')), can(viewer('pm', 'C. Petit'))]).toEqual([true, true, true]);
    expect([can(viewer('member', 'L. Marchand')), can(viewer('englead', 'A. Girard')), can(viewer('pm', 'S. Perrin'))]).toEqual([false, false, false]);
    expect([isProjectTeamRole('deputy'), isProjectTeamRole('owner'), isProjectTeamRole(3)]).toEqual([true, false, false]);
  });
});

describe('R-042 / R-043 · the client (P-1, P-10a, P-10b)', () => {
  it('refused outside their workspace; internal roles never refused', () => {
    expect([clientRefusedScreen('client', 'budget'), clientRefusedScreen('client', 'procurement'), clientRefusedScreen('client', 'client')]).toEqual([true, true, false]);
    expect((['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement'] as RoleKey[]).some((r) => clientRefusedScreen(r, 'budget'))).toBe(false);
    expect([clientRefusedProject({ role: 'client', organisation: 'Port authority' }, HARBOR), clientRefusedProject({ role: 'client', organisation: 'X' }, HARBOR)]).toEqual([false, true]);
    expect(clientRefusedProject({ role: 'pm', organisation: null }, HARBOR)).toBe(false);
  });

  it('meetings, notifications and search targets', () => {
    expect([clientSeesMeeting('external'), clientSeesMeeting('internal'), clientSeesMeeting('weekly')]).toEqual([true, false, false]);
    expect(clientSeesTarget('client', { tab: 'progress' }, true)).toBe(true);
    expect(clientSeesTarget('client', {}, false)).toBe(false); // another organisation's project
    expect(clientSeesTarget('home', {}, null)).toBe(true);
    for (const s of ['procurement', 'orders', 'deliveries', 'stock', 'budget', 'plan']) expect(clientSeesTarget(s, {}, true), s).toBe(false);
    expect([clientSeesTarget('quality', { ncr: 'NCR-1' }, true), clientSeesTarget('quality', { tab: 'ncr' }, true), clientSeesTarget('quality', { filter: 'open' }, true)]).toEqual([false, false, false]);
  });
});

describe('R-046 · supplier prices (NEW-D2-1)', () => {
  it('the director, the PMs and procurement', () => {
    const roles: RoleKey[] = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
    expect(roles.filter(canSeeSupplierPrices)).toEqual(['director', 'pm', 'procurement']);
  });
});

describe('R-047 · Codex (NEW-D3-1)', () => {
  it('deposit and new revision: the project\'s internal team inside the workspace; sync: the director', () => {
    const team = projectAccess(viewer('englead', 'A. Girard'), HARBOR);
    const off = projectAccess(viewer('quality', 'G. Comte'), HARBOR);
    const client = projectAccess(viewer('client', 'N. B', { organisation: 'Port authority' }), HARBOR);
    expect([canDepositInCodex('englead', false, team), canDepositInCodex('englead', true, team), canDepositInCodex('quality', false, off), canDepositInCodex('client', false, client)]).toEqual([true, false, false, false]);
    expect([canSyncCodex('director', false), canSyncCodex('director', true), canSyncCodex('pm', false)]).toEqual([true, false, false]);
  });
});

describe('R-048 · department heads (P-8a)', () => {
  it('decide their own departments\' requests; the director decides all; the others never', () => {
    expect([canDecideDepartment('depthead', ['Engineering'], 'Engineering'), canDecideDepartment('depthead', ['Engineering'], 'Procurement')]).toEqual([true, false]);
    expect(canDecideDepartment('director', [], 'Procurement')).toBe(true);
    // Any head with the Approvals screen (the quality manager heads Quality) decides for their own department only.
    expect([canDecideDepartment('quality', ['Quality'], 'Quality'), canDecideDepartment('quality', ['Quality'], 'Engineering'), canDecideDepartment('quality', [], 'Quality')]).toEqual([true, false, false]);
    expect(canDecideDepartment('client', ['Engineering'], 'Engineering')).toBe(false);
    expect([canViewDepartmentApprovals('depthead', ['Engineering'], 'Procurement'), canViewDepartmentApprovals('director', [], 'Procurement'), canViewDepartmentApprovals('pm', [], 'Procurement')]).toEqual([false, true, true]);
  });
});

describe('R-049 · someone else\'s My work (R-9)', () => {
  const jw = { name: 'Julien Weber', department: 'Engineering', projects: ['HLT-026'] };
  it('self, the director, the head of the department, the PMs of the person\'s projects', () => {
    const none = { headedDepartments: [], leadProjects: [] };
    expect(canViewPersonWork({ role: 'member', name: 'Julien Weber' }, none, jw)).toBe(true);
    expect(canViewPersonWork({ role: 'director', name: 'Marie Lefebvre' }, none, jw)).toBe(true);
    expect(canViewPersonWork({ role: 'depthead', name: 'Sophie Perrin' }, { headedDepartments: ['Engineering'], leadProjects: [] }, jw)).toBe(true);
    expect(canViewPersonWork({ role: 'depthead', name: 'Sophie Perrin' }, { headedDepartments: ['Procurement'], leadProjects: [] }, jw)).toBe(false);
    expect(canViewPersonWork({ role: 'pm', name: 'Romain Aubert' }, { headedDepartments: [], leadProjects: ['HLT-026'] }, jw)).toBe(true);
    expect(canViewPersonWork({ role: 'pm', name: 'Romain Aubert' }, { headedDepartments: [], leadProjects: ['NDC-031'] }, jw)).toBe(false);
    expect(canViewPersonWork({ role: 'quality', name: 'Gabriel Comte' }, none, jw)).toBe(false);
  });
});

describe('R-050 · minutes (P-9b)', () => {
  const m = { organizerPersonId: null, organizer: 'Gabriel Comte' };
  it('the organiser and the project\'s PM write and send; the director only as organiser or on the team; the client never', () => {
    const pm = projectAccess(viewer('pm', 'R. Aubert'), HARBOR);
    const ref = projectAccess(viewer('englead', 'A. Girard'), HARBOR);
    const dir = projectAccess(viewer('director', 'M. Lefebvre'), HARBOR);
    expect(canWriteMinutes(viewer('pm', 'R. Aubert'), pm, m)).toBe(true);
    expect(canWriteMinutes(viewer('englead', 'A. Girard'), ref, m)).toBe(false);
    expect(canWriteMinutes({ ...viewer('quality', 'G. Comte'), name: 'Gabriel Comte' }, projectAccess(viewer('quality', 'G. Comte'), HARBOR), m)).toBe(true);
    expect(canWriteMinutes(viewer('director', 'M. Lefebvre'), dir, m)).toBe(false);
    expect(canWriteMinutes(viewer('client', 'G. Comte'), { pm: true }, { organizerPersonId: null, organizer: 'G. Comte' })).toBe(false);
    // By person when both are known (a namesake is not the organiser).
    expect(isOrganizer({ personId: 'p1', name: 'Gabriel Comte', short: 'G. Comte' }, { organizerPersonId: 'p2', organizer: 'Gabriel Comte' })).toBe(false);
    expect(isOrganizer({ personId: null, name: 'X', short: 'G. Comte' }, { organizerPersonId: 'p2', organizer: 'G. Comte' })).toBe(true);
    expect(isOrganizer({ personId: null, name: 'X', short: 'Y' }, { organizerPersonId: null, organizer: '' })).toBe(false);
  });
});

describe('R-061 · plan structure (P-9a)', () => {
  it('structure: the PM team and the director; progress: also the owner of the activity', () => {
    const lead = { lead: true };
    const mem = { lead: false };
    expect([canEditPlanStructure(true, lead), canEditPlanStructure(true, mem), canEditPlanStructure(false, lead)]).toEqual([true, false, false]);
    expect([canEditActivityProgress(true, mem, true), canEditActivityProgress(true, mem, false), canEditActivityProgress(false, lead, true)]).toEqual([true, false, false]);
  });
});

describe('French (src/i18n/extra/d7-rights.json)', () => {
  it('every string of the lot is registered and translated; the team role labels and the price hint too', () => {
    const t = makeT('fr');
    expect(Object.entries(D7_RIGHTS as Record<string, string>).filter(([en, fr]) => t(en) !== fr).map(([en]) => en)).toEqual([]);
    expect(Object.values(PROJECT_TEAM_ROLE_LABEL).map(t)).toEqual(['Chef de projet', 'Chef de projet adjoint', 'Référent', 'Membre de l’équipe']);
    expect(t(PRICES_HIDDEN)).not.toBe(PRICES_HIDDEN);
  });
});
