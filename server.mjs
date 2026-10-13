import {DynamicInteractions} from './src/server-dynamic.mjs';
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ApiError, modelConfig, modelStatus, validateRequest, generate } from './src/server-model.mjs';
import { validateAssistRequest, assist } from './src/server-workflows.mjs';
import { generateNarrative } from './src/server-narrative.mjs';
import {BranchLedger} from './src/server-branch-ledger.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
function json(res,status,value) {if(!res.destroyed&&!res.writableEnded){if(res.generationStream){res.end(JSON.stringify(status>=400?{type:'error',...value}:{type:'result',value})+'\n');return;}res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}}
function generationProgress(req,res){
 if(!req.headers.accept?.includes('application/x-ndjson'))return ()=>{};
 res.generationStream=true;res.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no'});res.flushHeaders();
 return stage=>{if(!res.destroyed&&!res.writableEnded&&['preparing','writing','checking','saving'].includes(stage))res.write(JSON.stringify({type:'progress',stage})+'\n');};
}
function checkOrigin(req,server) {
  const host=req.headers.host||'';
  let parsed;
  try {parsed=new URL(`http://${host}`);}catch{throw new ApiError(403,'FORBIDDEN','请求来源不受信任。');}
  if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||Number(parsed.port||80)!==server.address().port||parsed.username||parsed.password||parsed.pathname!=='/')throw new ApiError(403,'FORBIDDEN','请通过本机应用地址访问。');
  if((req.headers.origin&&req.headers.origin!==`http://${host}`)||['cross-site','same-site'].includes(req.headers['sec-fetch-site']))throw new ApiError(403,'FORBIDDEN','跨来源请求已拒绝。');
}
async function readBody(req,max=262144) {
  if(Number(req.headers['content-length'])>max){req.resume();throw new ApiError(413,'BODY_TOO_LARGE','请求内容过大，故事没有改变。');}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new ApiError(415,'CONTENT_TYPE','请使用 JSON 请求。');
  let length=0;const chunks=[];
  for await(const chunk of req){length+=chunk.length;if(length>max)throw new ApiError(413,'BODY_TOO_LARGE','请求内容过大，故事没有改变。');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'INVALID_JSON','请求不是有效的 JSON，故事没有改变。');}
}
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}

export function createServer({env=process.env,root=ROOT,cacheLimit=100,cacheTtlMs=300000,narrate=generateNarrative,worldAssist=assist,dynamicModel,ledgerDirectory=resolve(root,'.data','branches')}={}) {
  const config=modelConfig(env),cache=new Map(),ledger=new BranchLedger(ledgerDirectory),dynamic=new DynamicInteractions(ledger,config,dynamicModel?{model:dynamicModel}:{});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      checkOrigin(req,server);
      const url=new URL(req.url,`http://${req.headers.host}`);
      if(url.pathname==='/api/config'&&req.method==='GET')return json(res,200,await modelStatus(config));
      if(url.pathname==='/api/world/start'&&req.method==='POST'){
        const owner=ledger.owner(req),raw=await readBody(req),body=validateAssistRequest({...raw,kind:'world'}),controller=new AbortController();res.once('close',()=>controller.abort());
        if(!config.available)throw new ApiError(503,'MODEL_UNAVAILABLE','尚未配置真实模型，开局未改变。');
        return json(res,200,await ledger.start(owner,{...body,...(raw.preferences?{preferences:raw.preferences}:{})},(value,signal)=>worldAssist(value,config,signal),controller.signal));
      }
      if(['/api/interaction/prepare','/api/interaction/execute','/api/interaction/narrate'].includes(url.pathname)&&req.method==='POST'){
        const owner=ledger.owner(req),body=await readBody(req),controller=new AbortController();res.once('close',()=>controller.abort());
        return json(res,200,await dynamic[url.pathname.split('/').at(-1)](owner,body,controller.signal));
      }
      if(['/api/branch/register','/api/branch/read','/api/branch/edit'].includes(url.pathname)&&req.method==='POST'){
        const owner=ledger.owner(req),body=await readBody(req,url.pathname.endsWith('/register')?10*1024*1024:262144);
        if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError(400,'INVALID_REQUEST','请求格式无效。');
        return json(res,200,await ledger[url.pathname.split('/').at(-1)](owner,body));
      }
      if(['/api/generate','/api/assist'].includes(url.pathname)&&req.method==='POST') {
        const assisting=url.pathname==='/api/assist';
        const raw=await readBody(req);
        if(!assisting&&raw.sessionId!==undefined){
          const owner=ledger.owner(req),controller=new AbortController();res.once('close',()=>controller.abort());
          if(!config.available)throw new ApiError(503,'MODEL_UNAVAILABLE','尚未配置真实模型，故事未改变。');
          const onProgress=generationProgress(req,res);onProgress('preparing');
          delete raw.interpreted;
          if(!raw.control&&!raw.gameAction){let result=await dynamic.input(owner,raw,controller.signal);if(result.compose){await dynamic.prepare(owner,{...raw,intent:raw.input,retry:true},controller.signal);result=await dynamic.input(owner,{...raw,compositionAttempted:true},controller.signal);}if(result.handled){if(result.clarify)throw new ApiError(409,'CLARIFY_ACTION',result.clarify);return json(res,200,result);}if(result.interpreted)raw.interpreted=result.interpreted;}
          const result=await ledger.generate(owner,raw,async(body,signal)=>{const direct=config.narrativeEngine==='direct'&&!body.gameAction;if(direct)onProgress('writing');const value=await (direct?generate:narrate)(raw.interpreted?{...body,input:body.input+'\n[行动解释，仅为申请，不能据此宣布成功] '+JSON.stringify(raw.interpreted)}:body,config,signal,{onProgress});onProgress('saving');return value;},controller.signal);
          return json(res,200,result);
        }
        const body=(assisting?validateAssistRequest:validateRequest)(raw);
        const cacheKey=JSON.stringify([assisting?body.kind:'generate',body.requestId]);
        if(!config.available)throw new ApiError(503,'MODEL_UNAVAILABLE','尚未配置真实模型。请配置服务端 .env，原输入和故事已保留。');
        const hash=createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
        const now=Date.now();for(const [id,entry] of cache)if(entry.done&&entry.expires<=now)cache.delete(id);
        let entry=cache.get(cacheKey);
        if(entry&&entry.hash!==hash)throw new ApiError(409,'REQUEST_CONFLICT','同一请求标识已用于不同输入，请重新发送。');
        if(!entry) {
          while(cache.size>=cacheLimit){const old=[...cache].find(([,value])=>value.done);if(!old)throw new ApiError(429,'BUSY','正在处理较多请求，请稍后重试。');cache.delete(old[0]);}
          if([...cache.values()].filter(value=>!value.done).length>=4)throw new ApiError(429,'BUSY','正在处理较多请求，请稍后重试。');
          entry={hash,controller:new AbortController(),clients:new Set(),done:false,expires:0};
          cache.set(cacheKey,entry);
          entry.promise=(assisting?assist:config.narrativeEngine==='direct'&&!body.gameAction?generate:narrate)(body,config,entry.controller.signal).then(value=>({status:200,value}),error=>({status:error.status||500,value:{code:error.code||'SERVER_ERROR',error:error instanceof ApiError?error.message:'生成服务暂时不可用，故事没有改变。'}})).then(result=>{
            entry.done=true;entry.expires=Date.now()+cacheTtlMs;
            if(result.status!==200&&cache.get(cacheKey)===entry)cache.delete(cacheKey);
            return result;
          });
        }
        entry.clients.add(res);
        const release=()=>{entry.clients.delete(res);if(!entry.done&&!entry.clients.size){entry.controller.abort();if(cache.get(cacheKey)===entry)cache.delete(cacheKey);}};
        res.once('close',release);
        if(res.destroyed){release();return;}
        const result=await entry.promise;json(res,result.status,result.value);return;
      }
      if(url.pathname.startsWith('/api/'))return json(res,405,{error:'不支持这个接口或请求方法。',code:'METHOD_NOT_ALLOWED'});
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'不支持这个请求方法。'});
      const path=url.pathname==='/'?'/index.html':url.pathname;
      if(!(/^\/(?:index\.html|favicon\.svg)$/.test(path)||/^\/src\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(path)))return json(res,404,{error:'页面不存在。'});
      try {
        const base=await realpath(root),file=await realpath(resolve(base,'.'+path)),rel=relative(base,file);
        if(rel.startsWith('..')||isAbsolute(rel)||(await stat(file)).size>2097152)return json(res,404,{error:'页面不存在。'});
        const bytes=await readFile(file),type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)];
        res.writeHead(200,{'content-type':`${type}; charset=utf-8`,'cache-control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
      } catch {json(res,404,{error:'页面不存在。'});}
    } catch(error) {if(env.MODEL_DIAGNOSTICS==='1'&&error.diagnostic){const {stage,rule,path,reason}=error.diagnostic;console.warn(JSON.stringify({code:error.code,stage,rule,path,reason}));}json(res,error instanceof ApiError?error.status:500,{code:error instanceof ApiError?error.code:'SERVER_ERROR',error:error instanceof ApiError?error.message:'服务暂时不可用，原故事没有改变。'});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  server.on('close',()=>{for(const entry of cache.values())entry.controller.abort();cache.clear();});
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {process.loadEnvFile(resolve(ROOT,'.env'));}catch(error){if(error.code!=='ENOENT'){console.error('无法读取 .env 配置，请检查文件格式与权限。');process.exit(1);}}
  const port=Number(process.env.PORT)||4173;
  const server=createServer();
  server.on('error',()=>{console.error('服务启动失败，请检查端口是否被占用。');process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`人生复本已启动：http://127.0.0.1:${port}（故事保存在此设备浏览器）`));
}
