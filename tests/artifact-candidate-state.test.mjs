import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSession} from '../src/core.js';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';
import {ArtifactService} from '../src/server-artifact-service.mjs';

test('candidate verification uses exactly the migrated state that will be committed',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'artifact-candidate-state-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const world={id:'candidate-state',version:1,title:'避雨',opening:'干粮共十二份。',location:'屋檐',identity:'旅人',rules:[],characters:[]};
 const session=createSession(world,{},'real'),ledger=new BranchLedger(join(dir,'branches'));await ledger.register('owner',{session,worlds:[world]});
 let value={schemaVersion:1,id:'allocation',revision:1,title:'试算',summary:'仅本地试算',fields:[],steps:[],actions:[],view:[{type:'cards',items:[{title:'干粮',body:'共十二份'}]}]};
 const dynamic=new DynamicInteractions(ledger,{}, {model:async()=>({value:structuredClone(value),metrics:{kind:'prepare'}})}),verified=[];
 const service=new ArtifactService({ledger,dynamic,directory:join(dir,'artifacts'),verify:async(_definition,ctx)=>verified.push(structuredClone(ctx.state))});t.after(()=>service.close());
 const body={sessionId:session.id,branchId:session.activeBranch,baseVersion:0,intent:'整理',retry:true};
 const first=await(await service.start('owner',{...body,requestId:'first'})).done;
 await service.saveState('owner',{...body,artifactId:first.artifact.artifactId,revisionId:first.artifact.head,expectedStateRevision:first.artifact.stateRevision,state:{quantity:0}});
 value={...value,title:'新标题',stateMigration:{map:{quantity:'count'}}};
 const second=await(await service.start('owner',{...body,requestId:'second'})).done;
 assert.deepEqual(second.artifact.state,{count:0});assert.deepEqual(verified,[{},{count:0}]);
});
