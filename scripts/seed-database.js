const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { migrate } = require('../database/migrate');

const output = path.join(__dirname, '..', 'data', 'sonia4.seed.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(output + suffix, { force: true });
const database = migrate(output);
const adminHash = bcrypt.hashSync('seed-only-password', 4);

database.exec('BEGIN');
try {
  database.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run('seed-admin', adminHash, 'admin');
  database.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run('seed-manager', bcrypt.hashSync('seed-manager-password', 4), 'manager');
  database.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run('seed-production', bcrypt.hashSync('seed-production-password', 4), 'production_staff');
  const flock = database.prepare('INSERT INTO flocks(batch,breed,received,date_received,supplier,house) VALUES(?,?,?,?,?,?)').run('SEED-001', 'Layers', 100, '2026-01-01', 'Seed Supplier', 'House A');
  database.prepare('INSERT INTO feed_entries(type,supplier,received_kg,total_cost,cost_per_kg,consumed_kg,date,flock_id) VALUES(?,?,?,?,?,?,?,?)').run('Layers', 'Seed Supplier', 50, 5000, 100, 5, '2026-01-02', Number(flock.lastInsertRowid));
  database.prepare('INSERT INTO production(date,flock_id,trays,loose_eggs,mortality) VALUES(?,?,?,?,?)').run('2026-01-02', Number(flock.lastInsertRowid), 2, 4, 0);
  const customer = database.prepare('INSERT INTO customers(name,phone,location,customer_code) VALUES(?,?,?,?)').run('Seed Customer', '0700000000', 'Seed Town', 'CUS-0001');
  database.prepare('INSERT INTO sales(date,customer_id,type,quantity,price_per_tray,total,payment_status,amount_paid) VALUES(?,?,?,?,?,?,?,?)').run('2026-01-02', Number(customer.lastInsertRowid), 'Eggs', 2, 400, 800, 'Paid', 800);
  database.exec('COMMIT');
} catch (error) {
  database.exec('ROLLBACK');
  database.close();
  throw error;
}

database.close();
console.log(`Seed database created at ${output}`);
