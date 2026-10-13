const TOKEN_KEY='fangtang:owner:v1',JOURNAL_KEY='fangtang:pending:v1';
export class BranchClient{
 constructor(storage,fetcher=fetch){this.storage=storage;this.fetcher=fetcher.bind(globalThis);this.registered=new Set();}
 owner(){let token=this.storage.getItem(TOKEN_KEY);if(!token){token=crypto.randomUUID()+crypto.randomUUID();this.storage.setItem(TOKEN_KEY,token);}return token;}
 async request(path,body,signal){const response=await this.fetcher(path,{method:'POST',headers:{'content-type':'application/json','x-branch-owner':this.owner()},body:JSON.stringify(body),signal});const data=await response.json();if(!response.ok){const error=new Error(data.error||'本机故事服务暂不可用。');error.code=data.code;throw error;}return data;}
 async register(session,worlds,signal){const key=session.id+':'+session.activeBranch;if(this.registered.has(key))return null;const data=await this.request('/api/branch/register',{session,worlds},signal);this.registered.add(key);return data;}
 read(session,requestId){return this.request('/api/branch/read',{sessionId:session.id,branchId:session.activeBranch,...(requestId?{requestId}:{})});}
 async generate(body,signal,onProgress){
  const response=await this.fetcher('/api/generate',{method:'POST',headers:{'content-type':'application/json','accept':'application/x-ndjson','x-branch-owner':this.owner()},body:JSON.stringify(body),signal});
  const failure=data=>Object.assign(new Error(data.error||'本机故事服务暂不可用。'),{code:data.code});
  if(!response.headers?.get('content-type')?.includes('application/x-ndjson')){const data=await response.json();if(!response.ok)throw failure(data);return data;}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result,complete=false;
  const line=value=>{if(!value.trim())return;const event=JSON.parse(value);if(event.type==='error')throw failure(event);if(event.type==='progress'&&['preparing','writing','checking','saving'].includes(event.stage))onProgress?.(event.stage);if(event.type==='result'){result=event.value;complete=true;}};
  try{while(true){const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});let cut;while((cut=buffer.indexOf('\n'))>=0){line(buffer.slice(0,cut));buffer=buffer.slice(cut+1);}if(done){if(buffer.trim())line(buffer);break;}}}finally{reader.releaseLock();}
  if(!complete)throw failure({code:'INCOMPLETE_RESPONSE',error:'连接中断，正在保留本次请求。可恢复进度或重试。'});return result;
 }
 journal(value,scope=value){
  const scoped=scope?.sessionId&&scope?.branchId,key=scoped?`fangtang:pending:v2:${encodeURIComponent(scope.sessionId)}:${encodeURIComponent(scope.branchId)}`:JOURNAL_KEY;
  const read=key=>{try{return JSON.parse(this.storage.getItem(key)||'null');}catch{return null;}};
  const legacy=scoped?read(JOURNAL_KEY):null,matching=legacy?.sessionId===scope?.sessionId&&legacy?.branchId===scope?.branchId;
  if(value===undefined)return read(key)||(matching?legacy:null);
  if(value===null)this.storage.removeItem(key);else this.storage.setItem(key,JSON.stringify(value));
  // Remove the old single journal only after its own branch has been saved or confirmed.
  if(scoped&&matching)this.storage.removeItem(JOURNAL_KEY);
 }
}

// Install confirmed history without losing any current local editing state.
export function mergeConfirmedBranch(local,confirmed){
 if(local.id!==confirmed.id||local.worldKey!==confirmed.worldKey)throw new Error('恢复结果不属于当前分支。');
 const before=local.turns.at(-1)?.state.version??local.initialState.version,after=confirmed.turns.at(-1)?.state.version??confirmed.initialState.version;
 if(after<before)throw new Error('服务端记录较旧，已保留当前存档。');
 const personal={...(local.dynamicDraftHistory?{dynamicDraftHistory:structuredClone(local.dynamicDraftHistory)}:{}),...(local.dynamicDraft?{dynamicDraft:structuredClone(local.dynamicDraft)}:{}),draft:local.draft,readingPosition:local.readingPosition,...(local.personal?{personal:structuredClone(local.personal)}:{}),name:local.name,...(local.archived!==undefined?{archived:local.archived}:{})};
 return {...structuredClone(confirmed),...personal};
}
export function mergeConfirmedBranches(local,confirmed){
 const remaining=new Map(local.map(branch=>[branch.id,branch]));
 const merged=confirmed.map(branch=>{const previous=remaining.get(branch.id);remaining.delete(branch.id);return previous?mergeConfirmedBranch(previous,branch):structuredClone(branch);});
 return [...merged,...remaining.values()];
}
