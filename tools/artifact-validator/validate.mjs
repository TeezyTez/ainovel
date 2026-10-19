import {validateArtifactScripts} from './server-interactive-artifact.mjs';
import {applyPatch,prepareState} from './retained-state.mjs';
import {gameplay} from './gameplay-worker.mjs';
import {createHash} from 'node:crypto';
import {validateDefinition,canonical,inspect} from './dynamic-rules.js';
import {validateGameUpdate,advanceGame,gameSchema} from './game-state.js';
import {validateReactBundle} from './react-artifact.js';
import {cleanArtifactState} from './interactive-artifact.js';
const check=(ok)=>{if(!ok)throw Error('invalid_artifact');};
try {
 let input='';for await(const part of process.stdin){input+=part;check(Buffer.byteLength(input)<=4194304);}
 const request=JSON.parse(input);
 if(typeof request.op==='string'&&request.op.startsWith('gameplay-')){const out=JSON.stringify(gameplay(request));check(Buffer.byteLength(out)<=2097152);process.stdout.write(out);process.exit(0);}
 if(request.op==='bundle'){validateReactBundle(request.value);process.stdout.write(JSON.stringify({key:createHash('sha256').update(canonical(request.node)).digest('hex'),bundle:request.value}));process.exit(0);}
 inspect(request.value??{});
 if(request.op==='schema'){process.stdout.write(JSON.stringify(gameSchema));process.exit(0);}
 if(request.op==='state'){process.stdout.write(JSON.stringify(cleanArtifactState(request.value)));process.exit(0);}
 let {value,context}=request;let migration,patch=false;
 if(request.op==='prepare'){
 migration=value?.stateMigration;
 patch=value?.decision==='patch';
 if(value===null||value?.needed===false||value?.decision==='none')value={definition:null,game:null,reason:typeof value?.reason==='string'?value.reason:'当前阅读无需辅助界面'};
 else if(value?.decision==='patch')value={definition:applyPatch(context.pending,value,context.artifact),game:request.previous?.sourceGame??null,reason:typeof value.reason==='string'?value.reason:'更新显示'};
 else if(value?.schemaVersion===1){const {stateMigration,...definition}=value;value={definition,game:null,reason:'公开交互界面'};}
 else if(value&&Object.hasOwn(value,'definition')){const {stateMigration,...rest}=value;value=rest;}
 }
 check(value&&Object.keys(value).every(k=>['definition','game','reason'].includes(k))&&typeof value.reason==='string'&&value.reason.length<=2000);
 const game=value.game??{entities:[],surfaces:[],spatial:null,journeys:null};
 validateGameUpdate(game,context.prose);
 const snapshot=context.gameplay?.game??advanceGame(undefined,game,context.scope.baseVersion,{clock:context.time});
 const state={version:context.scope.baseVersion,game:snapshot,facts:context.facts,inventory:context.gameplay?.inventory??[],location:context.gameplay?.location??context.location,time:context.time,
  experience:context.gameplay?.experience??{objects:[],clock:{label:context.time,precision:/\b\d{1,2}:\d{2}\b/.test(context.time)?'exact':'vague'}}};
 let definition=value.definition??null;
 if(definition){
  definition=structuredClone(definition);definition.scope=context.scope;definition.revision=context.presentationRevision;validateDefinition(definition,state);validateArtifactScripts(definition);
  for(const a of definition.actions){check(a.evidence.every(q=>context.prose.includes(q)));}
  let scripts=0;const walk=(n)=>{if(['interactive','react'].includes(n.type)){scripts++;check(request.allowScripts===true);}for(const child of n.children??[])walk(child);};definition.view.forEach(walk);check(scripts<=1);
 }
 const payload={schemaVersion:1,scope:context.scope,sourceGame:game,definition,definitionDigest:definition?createHash('sha256').update(canonical(definition)).digest('hex'):'',state,reason:value.reason,capabilities:{attempt:true,deterministic:context.deterministic===true}};
 const output=JSON.stringify(payload);check(Buffer.byteLength(output)<=262144);if(request.op==='prepare'){
 const local=prepareState(request.previousState??{},request.previous?.definition,definition,{patch,migration});process.stdout.write(JSON.stringify({payload,state:local}));
 }else process.stdout.write(output);
}catch{process.stderr.write('invalid_artifact');process.exitCode=1;}
