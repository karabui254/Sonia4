const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const target=path.join(root,'dist','runtime-'+new Date().toISOString().replace(/[:.]/g,'-'));
// Explicit allowlist: never traverse data, backups, environment or test folders.
const files=['backend','database','frontend','scripts/backup.js','scripts/restore.js','.node-version','.env.example','README.md','docs/MVP-READINESS.md','package.json','package-lock.json'];
fs.mkdirSync(target,{recursive:true});
for(const file of files)fs.cpSync(path.join(root,file),path.join(target,file),{recursive:true,errorOnExist:true,force:false});
const manifest=JSON.parse(fs.readFileSync(path.join(target,'package.json')));
manifest.scripts={start:'node backend/server.js','db:migrate':'node database/migrate.js',backup:'node scripts/backup.js','db:restore':'node scripts/restore.js'};
fs.writeFileSync(path.join(target,'package.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Production runtime prepared: '+target);
