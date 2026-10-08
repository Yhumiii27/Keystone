// Who may create projects (docs/spec/03 §0.2 primary actions, OQ13): "New project" is the primary action of Home
// (director, pm), Portfolio overview (director, pm, department head) and Projects (director, pm).
import type { RoleKey } from '@/config/screens';

export const CREATE_PROJECT_ROLES: readonly RoleKey[] = ['director', 'pm', 'depthead'];

export const canCreateProject = (role: RoleKey) => CREATE_PROJECT_ROLES.includes(role);
