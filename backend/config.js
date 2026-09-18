const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');

const ROOT_DIR = path.join(__dirname, '..');
const environment = process.env.NODE_ENV || 'development';

// Load the environment-specific file first, then allow the shared .env to fill gaps.
dotenv.config({ path: path.join(ROOT_DIR, `.env.${environment}`) });
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const config = {
  environment,
  isProduction: environment === 'production',
  rootDir: ROOT_DIR,
  port: Number(process.env.PORT || 3000),
  dataDir: path.join(ROOT_DIR, process.env.DATA_DIR || 'data'),
  backupDir: path.join(ROOT_DIR, process.env.BACKUP_DIR || 'backups'),
  databasePath: path.join(ROOT_DIR, process.env.DATABASE_PATH || 'data/sonia4.db'),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || null,
  sessionSecret: process.env.SESSION_SECRET || null,
  firstEggDate: process.env.FIRST_EGG_DATE || '2025-08-14'
};

function createDevelopmentSecret() {
  return crypto.randomBytes(48).toString('hex');
}

module.exports = { config, createDevelopmentSecret };
