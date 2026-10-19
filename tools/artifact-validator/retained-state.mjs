// Adapted from src/interaction-intent.mjs: same bounded patch/migration semantics,
// without the demo HTTP layer or zod dependency. It never writes story state.
import {createHash} from 'node:crypto';
import {canonical,inspect} from './dynamic-rules.js';import {cleanArtifactState} from './interactive-artifact.js';
const check=ok=>{if(!ok)throw Error('invalid_artifact');};
export function applyPatch(base,patch,current){
 check(base&&current&&patch.baseRevision===current.head&&patch.baseHash===current.contentHash);inspect(patch);check(Array.isArray(patch.changes)&&patch.changes.length>0&&patch.changes.length<=32);
 const next=structuredClone(base),seen=new Set();for(const change of patch.changes){check(change&&Object.keys(change).every(k=>['path','value'].includes(k)));const {path,value}=change;check(Array.isArray(path)&&path.length>0&&path.length<=12&&['view','title','summary'].includes(path[0])&&path.every(k=>['string','number'].includes(typeof k)&&!['__proto__','prototype','constructor'].includes(k)));const key=JSON.stringify(path);check(!seen.has(key));seen.add(key);let parent=next;for(const part of path.slice(0,-1)){check(parent&&Object.hasOwn(parent,part));parent=parent[part];}const last=path.at(-1);check(parent&&typeof parent==='object'&&Object.hasOwn(parent,last));parent[last]=structuredClone(value);}return next;
}
export function migrateState(previous,defaults={},migration){
 const safe=cleanArtifactState(previous),initial=cleanArtifactState(defaults);
 if(migration===undefined){if(safe&&initial&&!Array.isArray(safe)&&!Array.isArray(initial)&&typeof safe==='object'&&typeof initial==='object')return cleanArtifactState({...initial,...safe});return safe;}
 const key=k=>typeof k==='string'&&k.length>0&&k.length<=100&&!['__proto__','prototype','constructor'].includes(k);
 check(migration&&typeof migration==='object'&&!Array.isArray(migration)&&Object.keys(migration).every(k=>['map','drop'].includes(k)));const mapping=migration.map??{},drop=migration.drop??[];check(mapping&&typeof mapping==='object'&&!Array.isArray(mapping)&&Object.entries(mapping).every(([a,b])=>key(a)&&key(b))&&Array.isArray(drop)&&drop.length<=100&&drop.every(key));check(safe&&initial&&typeof safe==='object'&&typeof initial==='object'&&!Array.isArray(safe)&&!Array.isArray(initial));
 const next={...initial,...safe};for(const old of drop)delete next[old];const entries=Object.entries(mapping),destinations=new Set();for(const [from,to]of entries){check(!destinations.has(to));destinations.add(to);if(Object.hasOwn(safe,from))delete next[from];}for(const [from,to]of entries)if(Object.hasOwn(safe,from))next[to]=safe[from];return cleanArtifactState(next);
}
export function prepareState(previous,previousDefinition,definition,{patch=false,migration}={}){
 const find=source=>{let selected=null;const visit=node=>{if(['interactive','react'].includes(node.type))selected=node;for(const child of node.children??[])visit(child);};source?.view.forEach(visit);return selected;};
 const safe=cleanArtifactState(previous),record=value=>value&&typeof value==='object'&&!Array.isArray(value),root=record(safe)?safe:{};
 const hostKeys=['dynamic','travel','inspectedId'],host=Object.fromEntries(hostKeys.filter(key=>Object.hasOwn(root,key)).map(key=>[key,root[key]]));
 const hosted=Object.hasOwn(root,'artifacts')||hostKeys.some(key=>Object.hasOwn(root,key));
 if(!definition){if(!hosted)return migrateState(safe,{},migration);if(migration!==undefined)migrateState({}, {}, migration);return safe;}
 const sameDefinition=previousDefinition?.scope&&definition.scope&&previousDefinition.id===definition.id&&canonical(previousDefinition.scope)===canonical(definition.scope);
 if(!sameDefinition)delete host.dynamic;
 const nextNode=find(definition);
 if(!nextNode){
  if(!hosted)return migrateState(safe,{},migration);
  if(migration!==undefined){if(sameDefinition&&record(host.dynamic))host.dynamic={...host.dynamic,params:migrateState(record(host.dynamic.params)?host.dynamic.params:{},{},migration)};else migrateState({}, {}, migration);}
  return cleanArtifactState(host);
 }
 const previousNode=find(previousDefinition),digest=node=>createHash('sha256').update(canonical(node)).digest('hex');
 const current=previousNode&&sameDefinition&&previousNode.type===nextNode.type;
 const defaults=Object.hasOwn(nextNode,'initialState')?nextNode.initialState:{};
 let local=cleanArtifactState(defaults);
 if(current&&(patch||migration!==undefined&&previousNode.title===nextNode.title)){
  const oldKey=digest(previousNode),artifacts=record(root.artifacts)?root.artifacts:{};
  const initial=Object.hasOwn(previousNode,'initialState')?previousNode.initialState:{};
  const saved=Object.hasOwn(artifacts,oldKey)?artifacts[oldKey]:hosted||record(safe)&&Object.keys(safe).length===0?initial:safe;
  local=migrateState(saved,defaults,migration);
 }else if(migration!==undefined)migrateState({}, {}, migration);
 return cleanArtifactState({...host,artifacts:{[digest(nextNode)]:local}});
}
