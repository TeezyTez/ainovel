import {z} from 'zod';
import {cleanArtifactState} from '../interactive-artifact.js';

export const ARTIFACT_PROTOCOL_VERSION=1;
export const ArtifactIdSchema=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(value=>!['__proto__','prototype','constructor'].includes(value),'Reserved artifact identifier.');
export const RequestIdSchema=ArtifactIdSchema;
export const RequestHashSchema=z.string().min(1).max(256);
export const ArtifactScopeSchema=z.object({owner:z.string().min(1).max(256),sessionId:z.string().min(1).max(256),branchId:z.string().min(1).max(256)}).strict();

// Reject accessors and custom serialization before either JSON.stringify or the
// shared iframe state cleaner can invoke application-defined code.
export function cleanArtifactJson(value,{maxDepth=32,maxNodes=20000,maxLength=500000}={}){
  let nodes=0;
  function visit(item,depth){
    if(depth>maxDepth||++nodes>maxNodes)throw new Error('Artifact JSON is too complex.');
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'&&Number.isFinite(item))return;
    if(!item||typeof item!=='object'||(!Array.isArray(item)&&![Object.prototype,null].includes(Object.getPrototypeOf(item))))throw new Error('Artifact value must be safe JSON.');
    if(Object.getOwnPropertySymbols(item).length)throw new Error('Artifact JSON cannot contain symbols.');
    const descriptors=Object.getOwnPropertyDescriptors(item);
    if(Array.isArray(item)&&(item.length>maxNodes||Object.keys(item).length!==item.length||!Array.from({length:item.length},(_,i)=>Object.hasOwn(item,i)).every(Boolean)))throw new Error('Artifact JSON cannot contain sparse or extended arrays.');
    for(const [key,descriptor] of Object.entries(descriptors)){
      if(Array.isArray(item)&&key==='length')continue;
      if(['__proto__','prototype','constructor'].includes(key)||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)throw new Error('Artifact JSON contains an unsafe property.');
      visit(descriptor.value,depth+1);
    }
  }
  visit(value,0);const json=JSON.stringify(value);
  if(json.length>maxLength)throw new Error('Artifact JSON is too large.');
  return JSON.parse(json);
}

function transformedJson(clean){return z.unknown().transform((value,ctx)=>{try{return clean(value);}catch(error){ctx.addIssue({code:'custom',message:error.message});return z.NEVER;}});}
export const ArtifactStateSchema=transformedJson(value=>cleanArtifactState(cleanArtifactJson(value,{maxDepth:8,maxNodes:500,maxLength:6000})));
export const ArtifactDefinitionSchema=transformedJson(value=>{
  if(value!==null&&(!value||Array.isArray(value)||typeof value!=='object'))throw new Error('Artifact definition must be an object or null.');
  return cleanArtifactJson(value);
});
export const ArtifactSourceScopeSchema=transformedJson(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Artifact source scope must be an object.');
  return cleanArtifactJson(value,{maxDepth:4,maxNodes:50,maxLength:2000});
});
export const ArtifactRevisionSchema=z.object({id:ArtifactIdSchema,parentId:ArtifactIdSchema.nullable(),definition:ArtifactDefinitionSchema,contentHash:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.string().datetime(),reason:z.string().max(2000),sourceScope:ArtifactSourceScopeSchema.optional()}).strict();
const expectedStateRevision=z.number().int().nonnegative();
export const ArtifactCommitSchema=z.object({requestId:RequestIdSchema,requestHash:RequestHashSchema,definition:ArtifactDefinitionSchema,expectedHead:ArtifactIdSchema.nullable(),expectedStateRevision,state:ArtifactStateSchema.optional(),reason:z.string().max(2000).optional(),sourceScope:ArtifactSourceScopeSchema.optional()}).strict().refine(value=>!Object.hasOwn(value,'state')||value.state!==undefined,'Explicit artifact state must be JSON.');
export const ArtifactSaveStateSchema=z.object({artifactId:ArtifactIdSchema,revisionId:ArtifactIdSchema,expectedStateRevision,state:ArtifactStateSchema}).strict();
export const ArtifactRestoreSchema=z.object({revisionId:ArtifactIdSchema,expectedHead:ArtifactIdSchema.nullable(),expectedStateRevision,requestId:RequestIdSchema}).strict();
export const ArtifactResultSchema=z.object({artifactId:ArtifactIdSchema,head:ArtifactIdSchema,stateRevision:expectedStateRevision,state:ArtifactStateSchema}).strict();
export const ArtifactRequestSchema=z.object({requestHash:RequestHashSchema,result:ArtifactResultSchema,createdAt:z.string().datetime()}).strict();
export const ArtifactRecordSchema=z.object({artifactId:ArtifactIdSchema,head:ArtifactIdSchema,stateRevision:expectedStateRevision,state:ArtifactStateSchema,revisions:z.array(ArtifactRevisionSchema).max(512),requests:z.record(RequestIdSchema,ArtifactRequestSchema)}).strict();
export const ArtifactImportRecordSchema=ArtifactRecordSchema.omit({requests:true}).extend({revisions:z.array(ArtifactRevisionSchema).min(1).max(64)}).strict();
export const ArtifactImportSchema=z.object({record:ArtifactImportRecordSchema,expectedHead:ArtifactIdSchema.nullable(),expectedStateRevision,requestId:RequestIdSchema,requestHash:RequestHashSchema}).strict();
export const ArtifactStageSchema=z.enum(['queued','preparing','understanding','generating','validating','building','checking','repairing','reviewing','saving','ready','failed','cancelled']);
export const ArtifactJobEventSchema=z.object({sequence:z.number().int().positive(),type:z.enum(['status','stage','progress','textDelta','artifactCandidate','validationResult','artifactCommitted','result','error']),stage:ArtifactStageSchema.optional(),value:transformedJson(value=>cleanArtifactJson(value)).optional(),error:z.string().max(2000).optional()}).strict();

export function canonicalArtifactJson(value,limits){
  const safe=cleanArtifactJson(value,limits);
  function sorted(item){if(Array.isArray(item))return item.map(sorted);if(item&&typeof item==='object')return Object.fromEntries(Object.keys(item).sort().map(key=>[key,sorted(item[key])]));return item;}
  return JSON.stringify(sorted(safe));
}

export class ArtifactError extends Error{
  constructor(code,message,status=400){super(message);this.name='ArtifactError';this.code=code;this.status=status;this.statusCode=status;}
}
export function parseArtifactInput(schema,value){const parsed=schema.safeParse(value);if(!parsed.success)throw new ArtifactError('invalid_artifact',parsed.error.issues.map(issue=>issue.message).join(' ').slice(0,2000));return parsed.data;}
