// Real-provider HTTP/browser smoke test. Uses only a new temporary ledger and origin.
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../server.mjs';
import {createSession,validateArchive} from '../src/core.js';
import {BranchClient} from '../src/branch-client.js';
import {defaultSettings,STORAGE_KEY} from '../src/storage.js';

if(!process.argv.includes('--live')){
  console.log('Run --live to verify real dialogue and receipt recovery, or --live --browser for an isolated browser story. Uses model allowance.');
  process.exit(0);
}
process.loadEnvFile('.env');
const world={id:'dialogue-verification',version:1,title:'对话恢复验证 · 独立测试',identity:'避雨的读者',location:'旧书店',rules:['现代日常生活。'],characters:[{id:'keeper',name:'沈砚',public:'书店店主',secret:''}],opening:'你走进旧书店避雨。店主说：“我叫沈砚。你想找什么书？”'};
const session=createSession(world,{},'real');
session.preferences.length='简短';
const directory=await mkdtemp(join(tmpdir(),'dialogue-verification-'));
const server=createServer({ledgerDirectory:directory});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
const client=new BranchClient(storage,(path,options)=>fetch(origin+path,options));
await client.register(session,[world]);

if(process.argv.includes('--browser')){
  const archive={schemaVersion:1,worlds:[world],sessions:[session],settings:{...defaultSettings},telemetry:[]};
  const script=`if(!localStorage.getItem(${JSON.stringify(STORAGE_KEY)})){localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(JSON.stringify(archive))});localStorage.setItem('fangtang:owner:v1',${JSON.stringify(client.owner())});}location.replace('/#/story/${session.id}');`;
  const handler=server.listeners('request')[0];server.removeAllListeners('request');
  server.on('request',(req,res)=>{
    if(req.url!=='/__fixture')return handler(req,res);
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end('<!doctype html><meta charset="utf-8"><script>'+script.replaceAll('<','\\u003c')+'</script>');
  });
  console.log(JSON.stringify({url:origin+'/__fixture',ledger:directory,pid:process.pid}));
}else{
  try{
    const started=Date.now(),stages=[];
    const body={sessionId:session.id,branchId:session.activeBranch,baseVersion:0,requestId:crypto.randomUUID(),input:'我问沈砚：“你今天过得怎么样？有没有适合雨天读的书？”'};
    const result=await client.generate(body,AbortSignal.timeout(180000),stage=>{stages.push(stage);console.log('stage:',stage);});
    assert.ok(result.prose?.trim());
    assert.equal(result.authoritativeBranch.turns.length,1);
    assert.equal(result.receipt.version,1);
    const recovered=await client.read(session,body.requestId);
    assert.equal(recovered.receipt.receipt.turnId,result.receipt.turnId);
    const duplicate=await client.generate(body,AbortSignal.timeout(10000));
    assert.equal(duplicate.receipt.turnId,result.receipt.turnId);
    assert.equal(duplicate.authoritativeBranch.turns.length,1);
    session.branches=[result.authoritativeBranch];
    validateArchive({schemaVersion:1,worlds:[world],sessions:[session]});
    console.log(JSON.stringify({passed:true,elapsedMs:Date.now()-started,stages,prose:result.prose,checks:['real dialogue','committed version','receipt recovery','idempotent retry','archive validation'],ledger:directory},null,2));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
