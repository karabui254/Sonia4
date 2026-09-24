const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.name.endsWith('.js')?[path.join(dir,e.name)]:[])}
for(const file of ['backend','database','scripts','frontend/js'].flatMap(files)){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status)process.exit(r.status)}
console.log('JavaScript syntax checks passed.');
