const ROLES = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'manager',
  PRODUCTION_STAFF: 'production_staff'
});

const PERMISSIONS = Object.freeze({
  [ROLES.ADMIN]: ['*'],
  [ROLES.MANAGER]: [
    'dashboard:read',
    'flocks:read',
    'production:read', 'production:write',
    'feed:read',
    'purchases:read', 'purchases:write',
    'customers:read',
    'suppliers:read',
    'sales:read', 'sales:write',
    'expenses:read', 'expenses:write',
    'pricing:read',
    'audit:read',
    'reports:read'
  ],
  [ROLES.PRODUCTION_STAFF]: [
    'dashboard:read',
    'flocks:read',
    'production:read', 'production:write',
    'feed:read', 'feed:write'
  ]
});

function permissionsForRole(role) {
  return PERMISSIONS[role] || [];
}

function can(role, permission) {
  const permissions = permissionsForRole(role);
  return permissions.includes('*') || permissions.includes(permission);
}

module.exports = { ROLES, PERMISSIONS, permissionsForRole, can };
