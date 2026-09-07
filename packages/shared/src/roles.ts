/** Farm-scoped roles and what each may do (scope FR-ACC-02). */

export const ROLES = ['owner', 'manager', 'worker', 'vet', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'animals:read',
  'animals:write',
  'breeding:write',
  'health:read',
  'health:write',
  'finance:read',
  'finance:write',
  'reports:read',
  'members:manage',
  'billing:manage',
  'farm:delete',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL,
  manager: ALL.filter((p) => p !== 'billing:manage' && p !== 'farm:delete'),
  // A hired shepherd records what he sees. He never sees what the flock is worth.
  worker: ['animals:read', 'animals:write', 'breeding:write', 'health:read', 'health:write'],
  // A visiting vet touches health only, and their membership carries an expiry.
  vet: ['animals:read', 'health:read', 'health:write'],
  viewer: ['animals:read', 'health:read', 'reports:read'],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
