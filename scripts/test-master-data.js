const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3014';

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Login failed for ${username}`);
  return { cookie: response.headers.get('set-cookie')?.split(';')[0], body };
}

async function request(session, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'content-type': 'application/json', cookie: session.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function expect(condition, message) { if (!condition) throw new Error(message); }
function status(result, expected, message) { expect(result.status === expected, `${message}: expected ${expected}, received ${result.status}`); }

async function main() {
  const admin = await login('seed-admin', 'seed-only-password');
  const manager = await login('seed-manager', 'seed-manager-password');

  status(await request(manager, 'POST', '/api/flocks', { batch: 'MD-MANAGER' }), 403, 'Manager cannot create flock');
  status(await request(manager, 'POST', '/api/customers', { name: 'MD Manager' }), 403, 'Manager cannot create customer');
  status(await request(manager, 'POST', '/api/suppliers', { name: 'MD Manager Supplier' }), 403, 'Manager cannot create supplier');

  const flock = await request(admin, 'POST', '/api/flocks', { batch: 'MD-001', breed: 'Layers', placement_date: '2026-09-18', initial_bird_count: 120, status: 'Active' });
  status(flock, 200, 'Admin creates flock');
  const flockId = flock.body.id;
  const activeFlocks = await request(manager, 'GET', '/api/flocks?active_only=1');
  expect(activeFlocks.body.some(row => row.id === flockId), 'Active flock is available for lookup');
  status(await request(manager, 'POST', '/api/production', { date: '2026-09-18', flock_id: flockId, trays: 1, loose_eggs: 0, mortality: 3 }), 200, 'Production records mortality');
  const flockRows = (await request(admin, 'GET', '/api/flocks?include_voided=1')).body;
  expect(flockRows.find(row => row.id === flockId).current_bird_count === 117, 'Current bird count is maintained');
  status(await request(admin, 'PUT', `/api/flocks/${flockId}`, { status: 'Closed' }), 200, 'Admin closes flock');
  expect(!(await request(manager, 'GET', '/api/flocks?active_only=1')).body.some(row => row.id === flockId), 'Closed flock is excluded from lookups');
  expect((await request(manager, 'GET', '/api/flocks?include_voided=1')).body.some(row => row.id === flockId), 'Closed flock remains in history');

  const customer = await request(admin, 'POST', '/api/customers', { name: 'Master Customer', phone: '0700000001', email: 'customer@example.test', location: 'Farm Town' });
  status(customer, 200, 'Admin creates customer');
  const customers = (await request(admin, 'GET', '/api/customers')).body;
  const customerRow = customers.find(row => row.id === customer.body.id);
  expect(/^CUS-\d{4}$/.test(customerRow.customer_code) && customerRow.email === 'customer@example.test', 'Customer ID and email are stored');
  status(await request(admin, 'PUT', `/api/customers/${customer.body.id}`, { status: 'Inactive' }), 200, 'Admin deactivates customer');
  expect(!(await request(manager, 'GET', '/api/customers?active_only=1')).body.some(row => row.id === customer.body.id), 'Inactive customer is excluded from lookups');

  const supplier = await request(admin, 'POST', '/api/suppliers', { name: 'Master Supplier', phone: '0700000002', location: 'Supplier Town', products: 'Layers Mash, Growers' });
  status(supplier, 200, 'Admin creates supplier');
  expect(/^SUP-\d{4}$/.test(supplier.body.supplier_code), 'Supplier ID is generated');
  status(await request(admin, 'POST', '/api/purchases', { category: 'Feed', item: 'Master feed', supplier_id: supplier.body.id, date: '2026-09-18', quantity: 1, unit_cost: 100 }), 200, 'Purchase references supplier');
  status(await request(admin, 'POST', '/api/debts', { supplier_id: supplier.body.id, opening_debt: 100, feed_credit: 50, paid: 20 }), 200, 'Debt references supplier');
  const supplierRows = (await request(manager, 'GET', '/api/suppliers')).body;
  const supplierRow = supplierRows.find(row => row.id === supplier.body.id);
  expect(supplierRow.outstanding_balance === 130, 'Supplier balance is calculated');
  const history = await request(manager, 'GET', `/api/suppliers/${supplier.body.id}/history`);
  expect(history.body.purchases.length === 1 && history.body.outstanding_balance === 130, 'Supplier history is available');

  console.log('Master-data smoke test passed.');
}

main().catch(error => { console.error(error.message); process.exit(1); });
