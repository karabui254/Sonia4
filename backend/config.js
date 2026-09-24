const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const ROOT_DIR = path.resolve(__dirname, '..');
const environment = process.env.NODE_ENV || 'development';
if (environment !== 'test') {
  dotenv.config({path:path.join(ROOT_DIR, `.env.${environment}`), quiet:true});
  dotenv.config({path:path.join(ROOT_DIR,'.env'), quiet:true});
}
const resolvePath = value => path.isAbsolute(value) ? path.normalize(value) : path.resolve(ROOT_DIR,value);
const dataDir = resolvePath(process.env.DATA_DIR || 'data');
const config = {
  environment, isProduction:environment==='production', rootDir:ROOT_DIR,
  port:Number(process.env.PORT || 3000), host:process.env.HOST || (environment==='production'?'0.0.0.0':'127.0.0.1'), dataDir,
  databasePath:resolvePath(process.env.DATABASE_PATH || path.join(dataDir,'sonia4.db')),
  backupDir:resolvePath(process.env.BACKUP_DIR || path.join(dataDir,'backups')),
  sessionPath:resolvePath(process.env.SESSION_PATH || path.join(dataDir,'sessions.db')),
  adminUsername:process.env.ADMIN_USERNAME || 'admin', adminPassword:process.env.ADMIN_PASSWORD || null,
  sessionSecret:process.env.SESSION_SECRET || null,
  timezone:process.env.FARM_TIMEZONE || 'Africa/Nairobi'
};
if(!Number.isInteger(config.port)||config.port<1||config.port>65535) throw new Error('Invalid PORT');
new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone}).format();
if(config.isProduction && (!config.sessionSecret || config.sessionSecret.length<32 || config.sessionSecret.includes('replace-with'))) throw new Error('Set a strong SESSION_SECRET (at least 32 characters)');
if(config.isProduction && config.adminPassword?.includes('replace-with')) throw new Error('Replace the template ADMIN_PASSWORD');
module.exports={config,resolvePath,createDevelopmentSecret:()=>crypto.randomBytes(48).toString('hex')};
