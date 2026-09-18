const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3012';

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) throw new Error(`Login failed for ${username}: ${response.status}`);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  return { cookie, permissions: (await response.json()).permissions };
}

async function request(session, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: session.cookie },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return response.status;
}

function expect(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

async function main() {
  const admin = await login('seed-admin', 'seed-only-password');
  const manager = await login('seed-manager', 'seed-manager-password');
  const production = await login('seed-production', 'seed-production-password');

  expect(admin.permissions.includes('*'), true, 'Admin wildcard permission');
  expect(manager.permissions.includes('production:write'), true, 'Manager production permission');
  expect(manager.permissions.includes('flocks:write'), false, 'Manager master-record restriction');
  expect(production.permissions.includes('feed:write'), true, 'Production Staff feed permission');
  expect(production.permissions.includes('sales:read'), false, 'Production Staff finance restriction');

  await expectStatus(admin, 'POST', '/api/flocks', { batch: 'ACL-ADMIN', breed: 'Layers', placement_date: '2026-09-18', initial_bird_count: 10 }, 200, 'Admin creates flock');
  await expectStatus(admin, 'POST', '/api/customers', { name: 'ACL Admin Customer' }, 200, 'Admin creates customer');
  await expectStatus(admin, 'POST', '/api/debts', { supplier: 'ACL Admin Supplier' }, 200, 'Admin creates supplier');
  await expectStatus(admin, 'PUT', '/api/pricing/egg_tray', { value: 425 }, 200, 'Admin manages pricing');
  await expectStatus(admin, 'POST', '/api/users', { username: 'acl-user', password: 'acl-password', role: 'manager' }, 200, 'Admin manages users');

  await expectStatus(manager, 'POST', '/api/flocks', { batch: 'ACL-MANAGER' }, 403, 'Manager cannot create flock');
  await expectStatus(manager, 'POST', '/api/customers', { name: 'ACL Manager Customer' }, 403, 'Manager cannot create customer');
  await expectStatus(manager, 'POST', '/api/debts', { supplier: 'ACL Manager Supplier' }, 403, 'Manager cannot create supplier');
  await expectStatus(manager, 'PUT', '/api/pricing/egg_tray', { value: 450 }, 403, 'Manager cannot manage pricing');
  await expectStatus(manager, 'POST', '/api/production', { date: '2026-09-18', flock_id: 1, trays: 1, loose_eggs: 2 }, 200, 'Manager records production');
  await expectStatus(manager, 'POST', '/api/purchases', { category: 'Other', item: 'ACL purchase', date: '2026-09-18', quantity: 1, unit_cost: 10 }, 200, 'Manager records purchase');
  await expectStatus(manager, 'POST', '/api/expenses', { category: 'Other', item: 'ACL expense', date: '2026-09-18', amount: 10 }, 200, 'Manager records expense');
  await expectStatus(manager, 'POST', '/api/sales', { date: '2026-09-18', customer_id: 1, quantity: 1 }, 200, 'Manager records sale');

  await expectStatus(production, 'POST', '/api/production', { date: '2026-09-18', flock_id: 1, trays: 1, loose_eggs: 1 }, 200, 'Production Staff records production');
  await expectStatus(production, 'POST', '/api/feed', { type: 'Layers', received_kg: 1, total_cost: 10, consumed_kg: 1, date: '2026-09-18', flock_id: 1 }, 200, 'Production Staff records feed');
  await expectStatus(production, 'GET', '/api/purchases', undefined, 403, 'Production Staff cannot read purchases');
  await expectStatus(production, 'POST', '/api/purchases', { category: 'Other', item: 'ACL blocked purchase' }, 403, 'Production Staff cannot record purchases');
  await expectStatus(production, 'GET', '/api/sales', undefined, 403, 'Production Staff cannot read sales');
  await expectStatus(production, 'POST', '/api/expenses', { category: 'Other', item: 'ACL blocked expense' }, 403, 'Production Staff cannot record expenses');
  await expectStatus(production, 'POST', '/api/flocks', { batch: 'ACL-STAFF' }, 403, 'Production Staff cannot create flock');
  await expectStatus(admin, 'PUT', '/api/users/2', { is_active: false }, 200, 'Admin deactivates user');
  await expectStatus(manager, 'GET', '/api/auth/me', undefined, 401, 'Inactive session is rejected');

  console.log('Access-control smoke test passed for Admin, Manager, and Production Staff.');
}

async function expectStatus(session, method, path, body, expected, label) {
  expect(await request(session, method, path, body), expected, label);
}

main().catch(error => { console.error(error.message); process.exit(1); });
