const ROLES=Object.freeze({ADMIN:'admin',MANAGER:'manager',PRODUCTION_STAFF:'production_staff'});
const operational=['dashboard:read','flocks:read','production:read','production:write','feed:read','feed:write','settings:read'];
const PERMISSIONS={admin:['*'],manager:[...operational,'purchases:read','purchases:write','suppliers:read','customers:read','sales:read','sales:write','expenses:read','expenses:write','pricing:read','audit:read','reports:read'],production_staff:operational};
const permissionsForRole=role=>PERMISSIONS[role]||[];
const can=(role,permission)=>permissionsForRole(role).includes('*')||permissionsForRole(role).includes(permission);
module.exports={ROLES,permissionsForRole,can};
