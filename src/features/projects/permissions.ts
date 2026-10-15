// Who may create projects (docs/spec/03 §0.2 primary actions, OQ13): "New project" is the primary action of Home,
// Portfolio overview and Projects. P-3 (R-045): only the portfolio director and the project managers create projects — the
// department heads no longer do (the prototype showed them the button on the Portfolio overview); the Server Function refuses
// them too.
import type { RoleKey } from '@/config/screens';

export const CREATE_PROJECT_ROLES: readonly RoleKey[] = ['director', 'pm'];

export const canCreateProject = (role: RoleKey) => CREATE_PROJECT_ROLES.includes(role);
