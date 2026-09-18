const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3013';

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Login failed: ${username}`);
  return { cookie: response.headers.get('set-cookie')?.split(';')[0], body };
}

async function request(session, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'content-type': 'application/json', cookie: session.cookie },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function expect(condition, message) { if (!condition) throw new Error(message); }
function expectStatus(result, status, message) { expect(result.status === status, `${message}: expected ${status}, received ${result.status}`); }

async function main() {
  const admin = await login('seed-admin', 'seed-only-password');
  const manager = await login('seed-manager', 'seed-manager-password');
  const staff = await login('seed-production', 'seed-production-password');

  expectStatus(await request(admin, 'PUT', '/api/pricing/egg_tray', { value: 400 }), 200, 'Set test price');

  const beforeProduction = (await request(manager, 'GET', '/api/dashboard')).body.metrics.eggs;
  const createdProduction = await request(manager, 'POST', '/api/production', { date: '2026-09-18', flock_id: 1, trays: 1, loose_eggs: 0, mortality: 0 });
  expectStatus(createdProduction, 200, 'Create incorrect production');
  const productionId = createdProduction.body.id;
  expect((await request(manager, 'GET', '/api/dashboard')).body.metrics.eggs === beforeProduction + 30, 'Production create changes dashboard total');
  expectStatus(await request(manager, 'PUT', `/api/production/${productionId}`, { trays: 2, loose_eggs: 0 }), 200, 'Edit production');
  expect((await request(manager, 'GET', '/api/dashboard')).body.metrics.eggs === beforeProduction + 60, 'Production edit changes dashboard total');
  expectStatus(await request(manager, 'POST', `/api/production/${productionId}/void`, {}), 400, 'Void requires reason');
  expectStatus(await request(manager, 'POST', `/api/production/${productionId}/void`, { reason: 'Incorrect test entry' }), 200, 'Void production');
  expect((await request(manager, 'GET', '/api/dashboard')).body.metrics.eggs === beforeProduction, 'Voided production excluded from dashboard');
  expectStatus(await request(manager, 'DELETE', `/api/production/${productionId}`), 404, 'Hard delete is unavailable');

  const baselineRevenue = (await request(manager, 'GET', '/api/dashboard')).body.metrics.revenue;
  const createdSale = await request(manager, 'POST', '/api/sales', { date: '2026-09-18', customer_id: 1, quantity: 1, payment_status: 'Paid', amount_paid: 400 });
  expectStatus(createdSale, 200, 'Create incorrect sale');
  const saleId = createdSale.body.id;
  const beforeSale = (await request(manager, 'GET', '/api/dashboard')).body.metrics.revenue;
  expect(beforeSale === baselineRevenue + 400, 'Sale contributes to dashboard revenue');
  expectStatus(await request(manager, 'PUT', `/api/sales/${saleId}`, { quantity: 2 }), 200, 'Edit sale');
  expect((await request(manager, 'GET', '/api/dashboard')).body.metrics.revenue === beforeSale + 400, 'Sale edit changes dashboard revenue');
  expectStatus(await request(manager, 'POST', `/api/sales/${saleId}/void`, { reason: 'Duplicate sale' }), 200, 'Void sale');
  expect((await request(manager, 'GET', '/api/dashboard')).body.metrics.revenue === baselineRevenue, 'Voided sale excluded from dashboard');

  const staffEntry = await request(staff, 'POST', '/api/production', { date: '2026-09-18', flock_id: 1, trays: 1, loose_eggs: 0, mortality: 0 });
  expectStatus(staffEntry, 200, 'Staff creates same-day production');
  expectStatus(await request(staff, 'PUT', `/api/production/${staffEntry.body.id}`, { trays: 2 }), 200, 'Staff edits own same-day production');
  const managerRecord = await request(manager, 'POST', '/api/production', { date: '2026-09-18', flock_id: 1, trays: 1, loose_eggs: 0, mortality: 0 });
  expectStatus(managerRecord, 200, 'Create manager-owned production');
  expectStatus(await request(staff, 'PUT', `/api/production/${managerRecord.body.id}`, { trays: 9 }), 403, 'Staff cannot edit another user record');

  const audit = await request(admin, 'GET', '/api/audit-log');
  expectStatus(audit, 200, 'Admin reads audit log');
  const productionAudit = audit.body.filter(row => row.record_id === productionId);
  expect(productionAudit.some(row => row.action === 'update' && row.old_values && row.new_values), 'Production edit has before/after audit values');
  expect(productionAudit.some(row => row.action === 'void' && row.old_values && row.new_values), 'Production void has before/after audit values');
  const saleAudit = audit.body.filter(row => row.record_id === saleId);
  expect(saleAudit.some(row => row.action === 'update' && row.old_values && row.new_values), 'Sale edit has before/after audit values');

  console.log('Audit/edit/void smoke test passed.');
}

main().catch(error => { console.error(error.message); process.exit(1); });
