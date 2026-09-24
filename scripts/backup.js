const {DatabaseSync,backup}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const {config}=require('../backend/config');
async function createBackup(source=config.databasePath,directory=config.backupDir){
  if(!fs.existsSync(source))throw new Error('Source database does not exist');
  fs.mkdirSync(directory,{recursive:true});
  const filename=path.join(directory,`sonia4-${new Date().toISOString().replace(/[:.]/g,'-')}-${require('node:crypto').randomBytes(3).toString('hex')}.db`);
  const db=new DatabaseSync(source,{readOnly:true});
  try{await backup(db,filename)}finally{db.close()}
  const check=new DatabaseSync(filename,{readOnly:true});
  try{const result=check.prepare('PRAGMA integrity_check').get();if(Object.values(result)[0]!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup verification failed')}finally{check.close()}
  return filename;
}
if(require.main===module)createBackup().then(f=>console.log(`Verified backup: ${f}`)).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={createBackup};
