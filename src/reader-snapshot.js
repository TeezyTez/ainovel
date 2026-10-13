// Empty legacy nodes mean the latest state; the opening is always explicit.
export function readerSnapshot(branch,node){
 if(node==='opening')return {state:branch.initialState,sourceNode:null};
 if(node){const turn=branch.turns.find(turn=>turn.id===node);return turn?{state:turn.state,sourceNode:turn.id}:null;}
 return {state:branch.turns.at(-1)?.state||branch.initialState,sourceNode:undefined};
}
