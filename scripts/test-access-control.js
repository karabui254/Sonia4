// Compatibility entry point: tests now create isolated databases and servers.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const result=spawnSync(process.execPath,['--test',path.join(__dirname,'workflow.test.js')],{stdio:'inherit'});
process.exit(result.status||0);
