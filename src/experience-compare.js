import {publicSituation} from './experience-state.js';
export function compareSituations(leftBranch,leftWorld,leftTurn,rightBranch,rightWorld,rightTurn){
  const before=publicSituation(leftBranch,leftWorld,leftTurn),after=publicSituation(rightBranch,rightWorld,rightTurn);
  const names=new Set([...before.objects,...after.objects].map(o=>o.id)),a=new Map(before.objects.map(o=>[o.id,o])),b=new Map(after.objects.map(o=>[o.id,o]));
  const display=o=>o?{name:o.name,kind:o.kind,summary:o.summary,status:o.status,certainty:o.certainty,fields:o.fields}:null;
  return {before:before.summary,after:after.summary,changes:[...names].flatMap(id=>{const left=display(a.get(id)),right=display(b.get(id));return JSON.stringify(left)===JSON.stringify(right)?[]:[{id,before:left,after:right}];})};
}
