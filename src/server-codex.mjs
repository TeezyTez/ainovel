import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const proposalSchema={type:'object',additionalProperties:false,required:['requestId','baseVersion','prose','events','suggestions','ended'],properties:{requestId:{type:'string'},baseVersion:{type:'integer'},prose:{type:'string'},ended:{type:'boolean'},events:{type:'array',items:{type:'object',additionalProperties:false,required:['type','entity','value','visibility'],properties:{type:{type:'string',enum:['fact','item-add','item-remove','relation','location','flag']},entity:{type:['string','null']},value:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'}]},visibility:{type:'string',enum:['player','hidden']}}}},suggestions:{type:'array',items:{type:'object',additionalProperties:false,required:['id','text'],properties:{id:{type:'string'},text:{type:'string'}}}}}};
const disabled=['shell_tool','unified_exec','apps','plugins','browser_use','browser_use_external','browser_use_full_cdp_access','computer_use','in_app_browser','multi_agent','hooks','image_generation','view_image','shell_snapshot','code_mode_host','goals','sleep_tool'];

function execute(config,args,{input='',signal,cwd}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new Error('cancelled'));
    const child=spawn(config.cliPath,[...(config.cliPrefix||[]),...args],{cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{...process.env,...(config.authHome?{CODEX_HOME:config.authHome}:{}),...(config.proxy?{HTTPS_PROXY:config.proxy,HTTP_PROXY:config.proxy}:{})}});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    let stdout='',stderr='',size=0,overflow=false;
    const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
    const collect=which=>chunk=>{size+=chunk.length;if(size>1048576){overflow=true;child.kill();return;}if(which==='out')stdout+=chunk.toString();else stderr+=chunk.toString();};
    child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));
    child.once('error',error=>{signal?.removeEventListener('abort',abort);reject(error);});
    child.once('close',code=>{signal?.removeEventListener('abort',abort);if(signal?.aborted||overflow)reject(new Error('cancelled or oversized'));else resolve({code,stdout,stderr});});
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}

const statusCache=new WeakMap();
export async function codexStatus(config) {
  const cached=statusCache.get(config);if(cached&&Date.now()-cached.time<30000)return cached.promise;
  const promise=execute(config,['login','status'],{signal:AbortSignal.timeout(10000)}).then(r=>r.code===0&&/Logged in using ChatGPT/i.test(r.stdout+r.stderr)).catch(()=>false);
  statusCache.set(config,{time:Date.now(),promise});return promise;
}

export async function runCodex(config,system,content,signal,{schema=proposalSchema}={}) {
  const dir=await mkdtemp(join(tmpdir(),'cijian-narrator-'));
  const schemaFile=join(dir,'response.json'),instructionsFile=join(dir,'instructions.txt');
  try {
    await writeFile(schemaFile,JSON.stringify(schema));
    await writeFile(instructionsFile,system+'\n你只负责生成符合给定 schema 的 JSON。不得调用任何工具。事件 entity 无需指定时输出 null。');
    const args=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--color','never','--cd',dir,'--output-schema',schemaFile,'--enable','skip_host_skill_discovery','-c',`model_instructions_file=${JSON.stringify(instructionsFile)}`,'-c','web_search="disabled"','-c','project_doc_max_bytes=0','-c','model_reasoning_effort="low"'];
    for(const feature of disabled)args.push('--disable',feature);
    if(config.model)args.push('--model',config.model);
    args.push('-');
    const result=await execute(config,args,{input:content,signal,cwd:dir});
    if(result.code!==0)throw new Error('Codex CLI failed');
    const events=result.stdout.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
    if(events.some(e=>e.type==='error'||e.type==='turn.failed'||(e.item&&['command_execution','mcp_tool_call','web_search','file_change'].includes(e.item.type))))throw new Error('Unexpected CLI operation');
    const message=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').at(-1)?.item.text;
    const proposal=JSON.parse(message);
    if(Array.isArray(proposal.events))proposal.events=proposal.events.map(e=>{const copy={...e};if(copy.entity===null)delete copy.entity;return copy;});
    return proposal;
  } finally {
    // Remove only the exact files we created; never recursively remove CLI output.
    await Promise.all([unlink(schemaFile).catch(()=>{}),unlink(instructionsFile).catch(()=>{})]);
    await rmdir(dir).catch(()=>{});
  }
}
