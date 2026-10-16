// Isolated audit: synthetic public state, real validator; no app/model/database access.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const formalRoot = process.env.ELSELIFE_AUDIT_ROOT || 'C:/workspace/elselife';
const {advanceGame} = await import(pathToFileURL(resolve(formalRoot, 'tools/artifact-validator/game-state.js')));
const quote = '铜币共有5枚。';
const game = advanceGame(undefined, {
  entities: [{id:'coins',kind:'meter',name:'铜币',detail:'',status:'',value:5,max:null,unit:'枚',quote}],
  surfaces: [{id:'status',kind:'status',title:'铜币',description:'',entityIds:['coins'],links:[],actions:[],quote}],
  spatial: null, journeys: null,
}, 1, {clock:'暮色'});
const context = {
  scope:{worldKey:'audit',sessionId:'audit',branchId:'b',sceneId:'',sourceTurnId:null,baseVersion:1},
  presentationRevision:1, facts:[quote], prose:quote, location:'', time:'暮色',
  gameplay:{game,inventory:[],location:''},
};
const result = spawnSync(process.execPath, [resolve(formalRoot, 'tools/artifact-validator/validate.mjs')], {
  input:JSON.stringify({op:'prepare',context,previousState:{},value:{decision:'none',reason:'本段只需阅读'}}),
  encoding:'utf8', timeout:10000,
});
if (result.error || result.status !== 0) throw Error(result.error?.message || result.stderr);
const {payload} = JSON.parse(result.stdout);
const report = {
  observedAt:new Date().toISOString(),
  scope:'Real Node preparation worker with synthetic state; no Flutter runtime or end-to-end claim.',
  requestedDecision:'none',
  definitionIsNull:payload.definition === null,
  sourceGameSurfaceCount:payload.sourceGame.surfaces.length,
  authoritativeSurfaceCount:payload.state.game.surfaces.length,
  outputDecision:payload.decision ?? null,
  payloadKeys:Object.keys(payload),
  interpretation:'The worker retains authoritative game surfaces but does not carry an explicit none presentation decision. Frontend display consequences require separate source/runtime evidence.',
};
writeFileSync(new URL('./2026-10-16-artifact-none-result.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
