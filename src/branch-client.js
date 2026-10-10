const TOKEN_KEY='fangtang:owner:v1',JOURNAL_KEY='fangtang:pending:v1';
export class BranchClient{
 constructor(storage,fetcher=fetch){this.storage=storage;this.fetcher=fetcher.bind(globalThis);this.registered=new Set();}
 owner(){let token=this.storage.getItem(TOKEN_KEY);if(!token){token=crypto.randomUUID()+crypto.randomUUID();this.storage.setItem(TOKEN_KEY,token);}return token;}
 async request(path,body,signal){const response=await this.fetcher(path,{method:'POST',headers:{'content-type':'application/json','x-branch-owner':this.owner()},body:JSON.stringify(body),signal});const data=await response.json();if(!response.ok){const error=new Error(data.error||'本机故事服务暂不可用。');error.code=data.code;throw error;}return data;}
 async register(session,worlds,signal){const key=session.id+':'+session.activeBranch;if(this.registered.has(key))return null;const data=await this.request('/api/branch/register',{session,worlds},signal);this.registered.add(key);return data;}
 read(session,requestId){return this.request('/api/branch/read',{sessionId:session.id,branchId:session.activeBranch,...(requestId?{requestId}:{})});}
 generate(body,signal){return this.request('/api/generate',body,signal);}
 journal(value){if(value===undefined){try{return JSON.parse(this.storage.getItem(JOURNAL_KEY)||'null');}catch{return null;}}if(value===null)this.storage.removeItem(JOURNAL_KEY);else this.storage.setItem(JOURNAL_KEY,JSON.stringify(value));}
}

// Install confirmed history without losing any current local editing state.
export function mergeConfirmedBranch(local,confirmed){
 if(local.id!==confirmed.id||local.worldKey!==confirmed.worldKey)throw new Error('恢复结果不属于当前分支。');
 const before=local.turns.at(-1)?.state.version??local.initialState.version,after=confirmed.turns.at(-1)?.state.version??confirmed.initialState.version;
 if(after<before)throw new Error('服务端记录较旧，已保留当前存档。');
 const personal={draft:local.draft,readingPosition:local.readingPosition,...(local.personal?{personal:structuredClone(local.personal)}:{}),name:local.name,...(local.archived!==undefined?{archived:local.archived}:{})};
 return {...structuredClone(confirmed),...personal};
}
export function mergeConfirmedBranches(local,confirmed){
 const remaining=new Map(local.map(branch=>[branch.id,branch]));
 const merged=confirmed.map(branch=>{const previous=remaining.get(branch.id);remaining.delete(branch.id);return previous?mergeConfirmedBranch(previous,branch):structuredClone(branch);});
 return [...merged,...remaining.values()];
}
