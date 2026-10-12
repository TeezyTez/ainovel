import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {validateArchive} from '../src/core.js';
import {dynamicView} from '../src/dynamic-ui.js';
const root=resolve('test-results'),runs=[],records=new Map(),durations=[];let calls=0,failedCalls=0;
for(const name of (await readdir(root)).filter(x=>x.startsWith('dynamic-live-')).sort()){
  let manifest;try{manifest=JSON.parse(await readFile(join(root,name,'manifest.json'),'utf8'));}catch{continue;}
  runs.push({path:name,passed:manifest.cases.filter(c=>c.passed).length,total:manifest.cases.length,implementationHash:manifest.implementationHash});
  for(const c of manifest.cases){const entry=records.get(c.id)??{id:c.id,attempts:0,successes:0,failures:[]};entry.attempts++;if(c.passed){entry.successes++;entry.evidence=join(name,c.id);entry.steps=c.steps;entry.actionModes=c.actionModes;entry.receipt=c.receipt;}else entry.failures.push({run:name,error:c.error});records.set(c.id,entry);
    try{const traces=JSON.parse(await readFile(join(root,name,c.id,'model.json'),'utf8'));calls+=traces.length;failedCalls+=traces.filter(x=>x.error).length;for(const t of traces)if(t.metrics)durations.push(t.metrics.durationMs);}catch{}
  }
}
for(const entry of records.values()){
  if(!entry.evidence)throw new Error('没有成功的真实模型证据：'+entry.id);
  const archive=validateArchive(JSON.parse(await readFile(join(root,entry.evidence,'archive.json'),'utf8'))),b=archive.sessions[0].branches[0];
  if(b.dynamic.definition){const d=b.dynamic.definition,params=b.turns.find(t=>t.operation)?.operation.request.params??Object.fromEntries(d.fields.filter(f=>f.default!==undefined).map(f=>[f.id,f.default]));for(let i=0;i<Math.max(1,d.steps.length);i++)dynamicView(d,b.initialState,params,i);}
  entry.replayed=true;
}
if(records.size<14)throw new Error('真实验收情境不足14项。');
const files=['server.mjs','src/core.js','src/server-branch-ledger.mjs','src/server-public-archive.mjs','src/server-dynamic.mjs','src/server-dynamic-model.mjs','src/dynamic-rules.js','src/dynamic-ui.js','src/dynamic-ui.css','src/app.js','src/branch-client.js','src/reading-ui.js','src/ui-controls.js'];
const hash=createHash('sha256');for(const file of files)hash.update(file).update(await readFile(file));durations.sort((a,b)=>a-b);
const report={verifiedAt:new Date().toISOString(),implementationHash:hash.digest('hex'),files,scope:'最终代码重放已保存的真实模型产物；不是重新调用模型，也不掩盖各轮失败。',runs,recordedCalls:calls,failedTransportOrFormatCalls:failedCalls,successfulCallLatencyMs:{median:durations[Math.floor(durations.length/2)],max:durations.at(-1)},tokenUsage:null,cases:[...records.values()]};
await writeFile(join(root,'dynamic-evidence-index.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:records.size,replayed:report.cases.filter(c=>c.replayed).length,implementationHash:report.implementationHash,recordedCalls:calls,latency:report.successfulCallLatencyMs,runs},null,2));
