const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
async function restore(source,destination){
  if(!source||!destination)throw new Error('Usage: node scripts/restore.js BACKUP NEW_DATABASE_PATH');
  if(fs.existsSync(destination))throw new Error('Destination exists. Restore to a new path, verify it, then switch DATABASE_PATH while the server is stopped.');
  if(!fs.existsSync(source))throw new Error('Backup not found');
  const db=new DatabaseSync(source,{readOnly:true});
  try{if(Object.values(db.prepare('PRAGMA integrity_check').get())[0]!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup is not valid');fs.mkdirSync(path.dirname(path.resolve(destination)),{recursive:true});await backup(db,destination)}finally{db.close()}
  console.log(`Restored to ${path.resolve(destination)}. Verify the restored application before switching production paths.`);
}
if(require.main===module)restore(process.argv[2],process.argv[3]).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={restore};
