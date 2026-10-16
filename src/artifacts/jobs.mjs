import {randomUUID} from 'node:crypto';
import {ArtifactError,ArtifactJobEventSchema,RequestHashSchema,RequestIdSchema,parseArtifactInput} from './protocol.mjs';

const abortError=()=>new DOMException('Artifact job was cancelled.','AbortError');
export class JobRegistry{
  constructor({maxConcurrent=4,maxJobs=128,maxEvents=256,ttlMs=60*60*1000}={}){
    for(const [name,value] of Object.entries({maxConcurrent,maxJobs,maxEvents,ttlMs}))if(!Number.isSafeInteger(value)||value<1)throw new ArtifactError('invalid_artifact','Invalid '+name+'.');
    this.maxConcurrent=maxConcurrent;this.maxJobs=maxJobs;this.maxEvents=maxEvents;this.ttlMs=ttlMs;
    this.jobs=new Map();this.active=new Map();this.queue=[];this.running=0;this.committingKeys=new Set();
  }
  prune(){
    for(const [id,job] of this.jobs)if(job.finishedAt&&Date.now()-job.finishedAt>=this.ttlMs)this.jobs.delete(id);
    while(this.jobs.size>=this.maxJobs){const oldest=[...this.jobs.values()].find(job=>job.finishedAt);if(!oldest)break;this.jobs.delete(oldest.id);}
  }
  start(key,{requestId,requestHash,signal,serializeResult}={},run){
    if(typeof key!=='string'||!key||key.length>2048||typeof run!=='function')throw new ArtifactError('invalid_artifact','A bounded job scope and runner are required.');
    if(serializeResult!==undefined&&typeof serializeResult!=='function')throw new ArtifactError('invalid_artifact','Job result serialization must be a function.');
    parseArtifactInput(RequestIdSchema,requestId);parseArtifactInput(RequestHashSchema,requestHash);
    for(const [id,job] of this.jobs)if(job.finishedAt&&Date.now()-job.finishedAt>=this.ttlMs)this.jobs.delete(id);
    for(const job of this.jobs.values())if(job.key===key&&job.requestId===requestId){if(job.requestHash!==requestHash)throw new ArtifactError('request_conflict','This request ID was already used with different input.',409);return job;}
    this.prune();
    const previous=this.active.get(key);
    if(this.jobs.size>=this.maxJobs&&!previous)throw new ArtifactError('artifact_busy','Too many artifact jobs are in flight.',429);
    previous?.cancel();this.prune();
    if(this.jobs.size>=this.maxJobs)throw new ArtifactError('artifact_busy','Too many artifact jobs are in flight.',429);
    const controller=new AbortController(),listeners=new Set();let resolveDone,rejectDone;
    const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});done.catch(()=>{});
    const job={id:'job_'+randomUUID(),key,requestId,requestHash,controller,events:[],done,finishedAt:null,committing:false,committed:false};
    let sequence=0,settled=false,externalAbort,cancelRequested=false,committedValue;
    const append=parsed=>{
      sequence=parsed.sequence;
      job.events.push(structuredClone(parsed));if(job.events.length>this.maxEvents)job.events.shift();
      for(const listener of listeners){try{listener(structuredClone(parsed));}catch{ /* A broken subscriber cannot fail the job. */ }}
    };
    const emit=(event,value)=>{
      if(settled||controller.signal.aborted)return;
      const data=typeof event==='string'?{type:event,...(value===undefined?{}:{value})}:event;
      append(parseArtifactInput(ArtifactJobEventSchema,{...data,sequence:sequence+1}));
    };
    job.subscribe=(listener,{afterSequence=0}={})=>{for(const event of job.events)if(event.sequence>afterSequence)listener(structuredClone(event));if(!settled)listeners.add(listener);return ()=>listeners.delete(listener);};
    const finish=(error,value)=>{
      if(settled)return;
      let terminal;
      try{
        terminal=error?.name==='AbortError'?{sequence:sequence+1,type:'status',stage:'cancelled'}:error?{sequence:sequence+1,type:'error',stage:'failed',error:String(error.message??error).slice(0,2000)}:{sequence:sequence+1,type:'result',stage:'ready',value:serializeResult?serializeResult(value):value};
        terminal=parseArtifactInput(ArtifactJobEventSchema,terminal);
      }catch{
        // Event transport is bounded independently of the authoritative result.
        // A broken serializer must never strand a promise after durable commit.
        terminal=error?{sequence:sequence+1,type:'error',stage:'failed',error:'Artifact job failed.'}:{sequence:sequence+1,type:'result',stage:'ready',value:{refresh:true}};
      }
      settled=true;job.finishedAt=Date.now();signal?.removeEventListener('abort',externalAbort);if(this.active.get(key)===job)this.active.delete(key);
      // Preserve subscribers until the terminal event has been delivered.
      append(terminal);
      listeners.clear();
      if(error)rejectDone(error);else resolveDone(value);
    };
    job.cancel=()=>{
      if(settled||job.committed)return false;
      if(job.committing){cancelRequested=true;return false;}
      controller.abort();return true;
    };
    controller.signal.addEventListener('abort',()=>{
      if(job.committing){cancelRequested=true;return;}
      if(job.committed)return;
      finish(abortError());this.queue=this.queue.filter(queued=>queued!==job);this.pump();
    },{once:true});
    const context={commit:async fn=>{
      if(settled||controller.signal.aborted)throw abortError();
      if(job.committing||job.committed||typeof fn!=='function')throw new ArtifactError('invalid_artifact','A job can cross its commit boundary only once.');
      job.committing=true;this.committingKeys.add(key);
      try{const value=await fn();job.committed=true;committedValue=value;return value;}
      catch(error){if(cancelRequested){controller.abort();throw abortError();}throw error;}
      finally{job.committing=false;this.committingKeys.delete(key);this.pump();}
    }};
    job.execute=async()=>{
      if(settled)return;
      try{const value=await run(controller.signal,emit,context);if(controller.signal.aborted&&!job.committed)finish(abortError());else finish(null,value);}
      catch(error){if(job.committed)finish(null,committedValue);else finish(controller.signal.aborted?abortError():error);}
    };
    this.jobs.set(job.id,job);this.active.set(key,job);emit({type:'status',stage:'queued'});
    externalAbort=()=>job.cancel();
    if(signal?.aborted)externalAbort();else signal?.addEventListener('abort',externalAbort,{once:true});
    if(!settled)this.queue.push(job);this.pump();return job;
  }
  pump(){
    while(this.running<this.maxConcurrent&&this.queue.length){
      const index=this.queue.findIndex(queued=>!this.committingKeys.has(queued.key));if(index<0)break;
      const [job]=this.queue.splice(index,1);if(job.finishedAt)continue;
      this.running++;
      Promise.resolve().then(()=>job.execute()).finally(()=>{this.running--;this.pump();});
    }
  }
  get(id,key){const job=this.jobs.get(id);if(!job||job.key!==key)return null;if(job.finishedAt&&Date.now()-job.finishedAt>=this.ttlMs){this.jobs.delete(id);return null;}return job;}
}
