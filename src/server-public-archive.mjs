import {clone,applyEvents,validateArchive} from './core.js';
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,clone(value[k])]));
const publicEvents=(events,ids)=>events.filter(e=>e.visibility==='player'&&e.type!=='flag'&&(e.type!=='relation'||ids.has(e.entity))).map(e=>pick(e,['type','entity','value','visibility','sourceTurn','branchId']));
export function publicWorldForBranch(data,branchId){
  const branch=data.session.branches.find(b=>b.id===branchId),world=data.worlds.find(w=>w.id+'@'+w.version===branch.worldKey);
  if(!data.session.privateLedger)return clone(world);
  const evidence=[branch.opening??world.opening,...branch.turns.map(t=>t.prose)];
  return {...pick(world,['id','version','title','description','tagline','era','identity','location','opening','tags','custom','demoCompatible']),rules:[],characters:world.characters.filter(c=>evidence.some(p=>p.includes(c.name))).map(c=>({id:c.id,name:c.name,public:evidence.find(p=>p.includes(c.name)).split(/(?<=[。！？\n])/).find(p=>p.includes(c.name))??c.name}))};
}

// Replay a separate public archive; never redact a private state in place.
export function publicArchive(data){
  if(!data.session.privateLedger)return {session:clone(data.session),worlds:clone(data.worlds)};
  const session=pick(data.session,['id','title','worldId','player','mode','activeBranch','saves','archived','createdAt','updatedAt','preferences','privateLedger']);
  const worlds=data.worlds.map(world=>{
    const prose=data.session.branches.filter(b=>b.worldKey===world.id+'@'+world.version).flatMap(b=>[b.opening??world.opening,...b.turns.map(t=>t.prose)]);
    return {...pick(world,['id','version','title','description','tagline','era','identity','location','opening','rules','tags','custom','demoCompatible']),characters:world.characters.filter(c=>prose.some(p=>p.includes(c.name))).map(c=>({id:c.id,name:c.name,public:prose.find(p=>p.includes(c.name)).split(/(?<=[。！？\n])/).find(p=>p.includes(c.name))??c.name}))};
  });
  session.branches=data.session.branches.map(branch=>{
    const world=worlds.find(w=>w.id+'@'+w.version===branch.worldKey),opening=branch.opening??world.opening;
    const initialEvidence=[opening,...branch.initialState.facts],known=new Set(world.characters.filter(c=>initialEvidence.some(p=>p.includes(c.name))).map(c=>c.id));
    const initialCharacters=world.characters.filter(c=>known.has(c.id));
    const result=pick(branch,['id','name','worldKey','opening','parentBranch','parentTurn','draft','readingPosition','archived','dynamic','openingInteraction']);
    result.initialState={...pick(branch.initialState,['version','step','location','time','facts','inventory','experience','game']),flags:{},relations:Object.fromEntries(initialCharacters.map(c=>[c.id,'尚待相识'])),characters:Object.fromEntries(initialCharacters.map(c=>[c.id,{name:c.name,status:'在场或有待遇见'}]))};
    let before=result.initialState;
    result.turns=branch.turns.map(turn=>{
      const value=pick(turn,['id','parentId','requestId','input','prose','status','suggestions','ended','createdAt','revisions','polishUndoIndex','experience','game','gameAction','operation','narration','actionIntent','interactionSnapshot']);
      for(const c of world.characters)if(turn.prose.includes(c.name))known.add(c.id);
      value.events=publicEvents(turn.events,known);
      value.state=applyEvents(before,value.events,value.experience,{game:value.game,gameAction:value.gameAction,branchId:branch.id,operation:value.operation});
      value.memory={sourceTurn:turn.id,branchId:branch.id,summary:turn.prose.slice(0,240),facts:value.events.filter(e=>e.type==='fact').map(e=>e.value)};
      before=value.state;return value;
    });return result;
  });
  validateArchive({schemaVersion:1,sessions:[session],worlds});return {session,worlds};
}

export function publicResponse(data,response,branchId){
  if(!data.session.privateLedger)return {...response,authoritativeBranch:data.session.branches.find(b=>b.id===branchId)};
  const {session}=publicArchive(data),branch=session.branches.find(b=>b.id===branchId),world=publicWorldForBranch(data,branchId),turn=branch.turns.find(t=>t.id===response.committedTurn?.id);
  return {...pick(response,['requestId','baseVersion','prose','suggestions','ended','receipt']),events:turn?.events??[],...(turn?.experience?{experience:turn.experience}:{}),...(turn?.game?{game:turn.game}:{}),...(turn?.gameAction?{gameAction:turn.gameAction}:{}),...(turn?{committedTurn:turn}:{}),authoritativeBranch:branch,world};
}
