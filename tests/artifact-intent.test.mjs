import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntentDecision,applyArtifactPatch,migrateArtifactState} from '../src/interaction-intent.mjs';

test('semantic edit targets only the current artifact, mixed input requires clarification',()=>{
  const current={artifactId:'a1',head:'v1',contentHash:'h1'};
  assert.equal(parseIntentDecision({kind:'edit',target:'a1'},current).kind,'edit');
  assert.throws(()=>parseIntentDecision({kind:'edit',target:'a2'},current),/当前/);
  assert.throws(()=>parseIntentDecision({kind:'execute',target:'a1'},current));
  assert.equal(parseIntentDecision({kind:'mixed',message:'调整图表后是否还要出发？'},current).kind,'mixed');
  assert.throws(()=>parseIntentDecision({kind:'edit',target:'a1'},null));
});
test('state defaults never reset existing input and explicit key migration preserves values',()=>{
 assert.deepEqual(migrateArtifactState({quantity:4},{quantity:1,color:'blue'}),{quantity:4,color:'blue'});
 assert.deepEqual(migrateArtifactState({quantity:4,obsolete:true},{count:1},{map:{quantity:'count'},drop:['obsolete']}),{count:4});
 assert.throws(()=>migrateArtifactState({quantity:4},{},{map:{quantity:'__proto__'}}));
 assert.deepEqual(migrateArtifactState(null,{quantity:1}),null);
});
test('patches require exact revision and hash and retain untouched action contracts',()=>{
  const base={title:'路线',view:[{type:'react',source:'old',css:'light'}],actions:[{id:'approved'}]};
  const current={artifactId:'a1',head:'v1',contentHash:'h1'};
  const patch={baseRevision:'v1',baseHash:'h1',changes:[{path:['view',0,'css'],value:'dark'}]};
  const next=applyArtifactPatch(base,patch,current);
  assert.equal(next.view[0].css,'dark');assert.equal(base.view[0].css,'light');assert.deepEqual(next.actions,base.actions);
  assert.throws(()=>applyArtifactPatch(base,{...patch,baseRevision:'old'},current),/版本/);
  assert.throws(()=>applyArtifactPatch(base,{...patch,changes:[{path:['__proto__','x'],value:true}]},current));
  assert.throws(()=>applyArtifactPatch(base,{...patch,changes:[{path:['actions'],value:[]}]},current));
});
test('state key migrations preserve chains and swaps from the original snapshot',()=>{
 assert.deepEqual(migrateArtifactState({a:1,b:2},{},{map:{a:'b',b:'c'}}),{b:1,c:2});
 assert.deepEqual(migrateArtifactState({a:1,b:2},{},{map:{a:'b',b:'a'}}),{b:1,a:2});
 assert.throws(()=>migrateArtifactState({a:1,b:2},{},{map:{a:'c',b:'c'}}),/重复/);
});
