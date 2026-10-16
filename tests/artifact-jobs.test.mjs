import test from 'node:test';
import assert from 'node:assert/strict';
import {JobRegistry} from '../src/artifacts/jobs.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function gate(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

test('same scoped request reuses a job but changed payload conflicts',async()=>{
  const registry=new JobRegistry(),held=gate();let calls=0;
  const run=async()=>{calls++;await held.promise;return {head:'revision-1'};};
  const job=registry.start('owner/session/branch',{requestId:'one',requestHash:'hash'},run);
  assert.equal(registry.start('owner/session/branch',{requestId:'one',requestHash:'hash'},run),job);
  assert.throws(()=>registry.start('owner/session/branch',{requestId:'one',requestHash:'changed'},run),{code:'request_conflict'});
  assert.equal(registry.get(job.id,'another-owner'),null);
  held.resolve();assert.deepEqual(await job.done,{head:'revision-1'});assert.equal(calls,1);
  assert.equal(registry.get(job.id,'owner/session/branch'),job);
  assert.deepEqual(job.events.map(event=>event.sequence),job.events.map((_,index)=>index+1));
});

test('a new edit aborts the actual previous runner and ignores its late events',async()=>{
  const registry=new JobRegistry();let observedAbort=false,lateEmit;
  const previous=registry.start('scope',{requestId:'first',requestHash:'first'},async(signal,emit)=>{lateEmit=emit;await new Promise(resolve=>signal.addEventListener('abort',()=>{observedAbort=true;resolve();},{once:true}));emit({type:'textDelta',value:'stale'});return 'stale';});
  await tick();
  const current=registry.start('scope',{requestId:'second',requestHash:'second'},async(_signal,emit)=>{emit({type:'status',stage:'generating'});return 'current';});
  await assert.rejects(previous.done,error=>error.name==='AbortError');
  assert.equal(await current.done,'current');assert.equal(observedAbort,true);assert.equal(previous.controller.signal.aborted,true);
  lateEmit({type:'textDelta',value:'late'});
  assert.equal(previous.events.some(event=>event.value==='stale'||event.value==='late'),false);
  assert.equal(previous.events.at(-1).stage,'cancelled');
});

test('global concurrency is bounded and aborted queued jobs never start',async()=>{
  const registry=new JobRegistry({maxConcurrent:1}),held=gate();let starts=0;
  const first=registry.start('a',{requestId:'first',requestHash:'first'},async()=>{starts++;await held.promise;return 1;});
  const controller=new AbortController();
  const queued=registry.start('b',{requestId:'queued',requestHash:'queued',signal:controller.signal},async()=>{starts++;return 2;});
  await tick();assert.equal(starts,1);controller.abort();
  await assert.rejects(queued.done,error=>error.name==='AbortError');
  held.resolve();assert.equal(await first.done,1);await tick();assert.equal(starts,1);
});

test('job events are bounded and completed retention evicts old jobs',async()=>{
  const registry=new JobRegistry({maxJobs:2,maxEvents:5});
  const first=registry.start('a',{requestId:'first',requestHash:'first'},async(_signal,emit)=>{for(let i=0;i<20;i++)emit({type:'textDelta',value:String(i)});return 1;});
  await first.done;assert.equal(first.events.length,5);assert.ok(first.events[0].sequence>1);
  const second=registry.start('b',{requestId:'second',requestHash:'second'},async()=>2);await second.done;
  const third=registry.start('c',{requestId:'third',requestHash:'third'},async()=>3);await third.done;
  assert.equal(registry.get(first.id,'a'),null);assert.ok(registry.get(third.id,'c'));
});

test('external cancellation aborts the runner and runner failure stays isolated',async()=>{
  const registry=new JobRegistry(),controller=new AbortController();let signalSeen;
  const cancelled=registry.start('a',{requestId:'cancel',requestHash:'cancel',signal:controller.signal},async signal=>{signalSeen=signal;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return 1;});
  await tick();controller.abort();await assert.rejects(cancelled.done,{name:'AbortError'});assert.equal(signalSeen.aborted,true);
  const failed=registry.start('b',{requestId:'bad',requestHash:'bad'},async()=>{throw new Error('build failed');});
  await assert.rejects(failed.done,/build failed/);assert.equal(failed.events.at(-1).type,'error');assert.equal(failed.events.at(-1).error,'build failed');
});

test('expired job receipts allow a new execution of the same request',async()=>{
  const registry=new JobRegistry({ttlMs:1});let calls=0;
  const first=registry.start('scope',{requestId:'same',requestHash:'same'},async()=>++calls);await first.done;
  await new Promise(resolve=>setTimeout(resolve,5));
  const second=registry.start('scope',{requestId:'same',requestHash:'same'},async()=>++calls);
  assert.notEqual(second,first);assert.equal(await second.done,2);
});

test('integration progress stages remain structured and replayable',async()=>{
  const registry=new JobRegistry();
  const job=registry.start('scope',{requestId:'stages',requestHash:'stages'},async(_signal,emit)=>{
    for(const stage of ['preparing','generating','validating','building','checking','repairing','reviewing','saving'])emit({type:'stage',stage});
    emit({type:'progress',value:{message:'valid candidate'}});return 'ready';
  });
  await job.done;
  assert.deepEqual(job.events.filter(event=>event.type==='stage').map(event=>event.stage),['preparing','generating','validating','building','checking','repairing','reviewing','saving']);
  assert.equal(job.events.some(event=>event.type==='progress'&&event.value.message==='valid candidate'),true);
});

test('cancellation during the commit fence waits and successful committed result wins',async()=>{
  const registry=new JobRegistry(),entered=gate(),release=gate();
  const job=registry.start('scope',{requestId:'commit',requestHash:'commit'},async(signal,_emit,context)=>context.commit(async()=>{entered.resolve();await release.promise;assert.equal(signal.aborted,false);return {head:'durable-revision'};}));
  await Promise.race([entered.promise,job.done]);
  assert.equal(job.cancel(),false);
  assert.equal(job.controller.signal.aborted,false);
  let settled=false;job.done.finally(()=>{settled=true;});await tick();assert.equal(settled,false);
  release.resolve();assert.deepEqual(await job.done,{head:'durable-revision'});
  assert.equal(job.events.some(event=>event.stage==='cancelled'),false);
  assert.equal(job.events.at(-1).stage,'ready');
  assert.equal(job.cancel(),false);
});

test('superseding a committing predecessor preserves its commit and starts the replacement',async()=>{
  const registry=new JobRegistry({maxConcurrent:2}),entered=gate(),release=gate();let replacementStarted=false;
  const first=registry.start('scope',{requestId:'first',requestHash:'first'},async(_signal,_emit,context)=>context.commit(async()=>{entered.resolve();await release.promise;return 'first-committed';}));
  await Promise.race([entered.promise,first.done]);
  const second=registry.start('scope',{requestId:'second',requestHash:'second'},async()=>{replacementStarted=true;return 'second-committed';});
  await tick();assert.equal(replacementStarted,false);assert.equal(first.controller.signal.aborted,false);
  release.resolve();assert.equal(await first.done,'first-committed');assert.equal(await second.done,'second-committed');
});

test('a failed commit fence applies pending cancellation and cannot report ready',async()=>{
  const registry=new JobRegistry(),entered=gate(),release=gate();
  const job=registry.start('scope',{requestId:'failure',requestHash:'failure'},async(_signal,_emit,context)=>context.commit(async()=>{entered.resolve();await release.promise;throw new Error('disk write failed');}));
  await Promise.race([entered.promise,job.done]);assert.equal(job.cancel(),false);release.resolve();
  await assert.rejects(job.done,{name:'AbortError'});assert.equal(job.controller.signal.aborted,true);
  assert.equal(job.events.at(-1).stage,'cancelled');assert.equal(job.events.some(event=>event.stage==='ready'),false);
});

test('cancellation before entering a commit fence prevents the commit callback',async()=>{
  const registry=new JobRegistry(),entered=gate(),release=gate();let wrote=false;
  const job=registry.start('scope',{requestId:'early',requestHash:'early'},async(_signal,_emit,context)=>{entered.resolve();await release.promise;return context.commit(async()=>{wrote=true;return 'bad';});});
  await Promise.race([entered.promise,job.done]);assert.equal(job.cancel(),true);release.resolve();
  await assert.rejects(job.done,{name:'AbortError'});await tick();assert.equal(wrote,false);
});

test('terminal serialization keeps large authoritative results out of events without changing done',async()=>{
  const registry=new JobRegistry(),result={authoritativeBranch:{prose:'x'.repeat(500001)},artifact:{head:'new-head'}};
  const job=registry.start('scope',{requestId:'large',requestHash:'large',serializeResult:value=>({refresh:true,artifact:{head:value.artifact.head}})},async(_signal,_emit,context)=>context.commit(async()=>result));
  assert.equal(await job.done,result);
  assert.deepEqual(job.events.at(-1).value,{refresh:true,artifact:{head:'new-head'}});
  assert.equal(job.events.at(-1).stage,'ready');
});

test('an oversized successful result always settles with a bounded refresh terminal event',async()=>{
  const registry=new JobRegistry(),result={story:'x'.repeat(500001)};
  const job=registry.start('scope',{requestId:'large',requestHash:'large'},async(_signal,_emit,context)=>context.commit(async()=>result));
  assert.equal(await job.done,result);
  assert.deepEqual(job.events.at(-1).value,{refresh:true});assert.equal(job.events.at(-1).stage,'ready');
  assert.ok(job.finishedAt);assert.equal(job.cancel(),false);
});

test('a throwing terminal serializer cannot fail or strand a committed job',async()=>{
  const registry=new JobRegistry(),result={head:'committed'};
  const job=registry.start('scope',{requestId:'serializer',requestHash:'serializer',serializeResult:()=>{throw new Error('serializer failed');}},async(_signal,_emit,context)=>context.commit(async()=>result));
  assert.equal(await job.done,result);assert.deepEqual(job.events.at(-1).value,{refresh:true});
});

test('subscribers receive the bounded terminal result before done settles',async()=>{
  const registry=new JobRegistry(),events=[];
  const job=registry.start('scope',{requestId:'terminal',requestHash:'terminal',serializeResult:()=>({refresh:true})},async()=>({head:'ready'}));
  job.subscribe(event=>events.push(event));await job.done;
  assert.equal(events.at(-1).type,'result');assert.deepEqual(events.at(-1).value,{refresh:true});
});
