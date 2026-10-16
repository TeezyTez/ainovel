import {z} from 'zod';
import {ApiError} from './server-model.mjs';
import {inspect} from './dynamic-rules.js';
import {cleanArtifactState} from './interactive-artifact.js';

const decision=z.object({kind:z.enum(['create','edit','story','mixed','clarify']),target:z.string().max(200).nullable().optional(),message:z.string().max(1000).optional()}).strict();
export function parseIntentDecision(value,current){
  const parsed=decision.safeParse(value);
  if(!parsed.success)throw new ApiError(422,'INVALID_INTENT','无法确认这次输入的用途，请补充说明。');
  const result=parsed.data;
  if(result.kind==='edit'&&(!current||result.target!==current.artifactId))throw new ApiError(409,'ARTIFACT_TARGET_CONFLICT','修改目标不是当前作品，原输入已保留。');
  return result;
}

// Patches address exact presentation fields, never rules or host files.
export function applyArtifactPatch(base,patch,current){
  if(!base||!current||patch?.baseRevision!==current.head||patch?.baseHash!==current.contentHash)throw new ApiError(409,'ARTIFACT_PATCH_CONFLICT','作品版本已改变，局部修改未应用。');
  inspect(patch);
  if(!Array.isArray(patch.changes)||!patch.changes.length||patch.changes.length>32)throw new Error('局部修改数量无效。');
  const next=structuredClone(base),seen=new Set();
  for(const {path,value} of patch.changes){
    if(!Array.isArray(path)||!path.length||path.length>12||!['view','title','summary'].includes(path[0])||path.some(k=>!['string','number'].includes(typeof k)||['__proto__','prototype','constructor'].includes(k)))throw new Error('局部修改路径无效。');
    const key=JSON.stringify(path);if(seen.has(key))throw new Error('局部修改路径重复。');seen.add(key);
    let parent=next;for(const part of path.slice(0,-1)){if(!parent||!Object.hasOwn(parent,part))throw new Error('局部修改路径不存在。');parent=parent[part];}
    const last=path.at(-1);if(!parent||typeof parent!=='object'||!Object.hasOwn(parent,last))throw new Error('局部修改路径不存在。');
    parent[last]=structuredClone(value);
  }
  return next;
}

export function migrateArtifactState(previous,defaults={},migration){
  const safe=cleanArtifactState(previous),initial=cleanArtifactState(defaults);
  if(migration===undefined){if(safe&&initial&&!Array.isArray(safe)&&!Array.isArray(initial)&&typeof safe==='object'&&typeof initial==='object')return cleanArtifactState({...initial,...safe});return safe;}
  const key=z.string().min(1).max(100).refine(k=>!['__proto__','prototype','constructor'].includes(k));
  const parsed=z.object({map:z.record(key,key).default({}),drop:z.array(key).max(100).default([])}).strict().parse(migration);
  if(!safe||typeof safe!=='object'||Array.isArray(safe)||!initial||typeof initial!=='object'||Array.isArray(initial))throw new Error('字段迁移需要对象形式的界面状态。');
  const next={...initial,...safe};for(const old of parsed.drop)delete next[old];
  const entries=Object.entries(parsed.map),destinations=new Set();
  for(const [from,to] of entries){if(destinations.has(to))throw new Error('参数迁移目标重复。');destinations.add(to);if(Object.hasOwn(safe,from))delete next[from];}
  for(const [from,to] of entries)if(Object.hasOwn(safe,from))next[to]=safe[from];
  return cleanArtifactState(next);
}

export const INTENT_INSTRUCTIONS=`若上下文 inputRouting=true，先结合 intent、recent、pending 和 artifact 判断输入用途，返回 {intentDecision:{kind:'create'|'edit'|'story'|'mixed'|'clarify',target:artifact.artifactId或null,message?:澄清问题},output:完整定义或keep/none/patch决定}。修改配色、字号、布局、筛选、列、当前图表参数属于edit；要求新图表/工具属于create；对人物说话、购买、出发属于story；同时修改界面和行动且不能分清授权的输入属于mixed，提出一句澄清且不执行任何行动。story/mixed/clarify时output=null。不能仅因提到“这个”“颜色”“图”就认定修改界面，要判断指代；明确编辑当前作品时target必须精确回传artifact.artifactId。create/edit与作品生成在这同一次调用完成，不能返回空的output。`;
