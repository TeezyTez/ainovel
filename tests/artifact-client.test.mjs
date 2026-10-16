import test from 'node:test';
import assert from 'node:assert/strict';
import {ArtifactClient} from '../src/artifact-client.js';

const encoder=new TextEncoder();
const body={sessionId:'novel',branchId:'main',requestId:'request-1'};
const event=(sequence,type,extra={})=>({sequence,type,...extra});
const frame=value=>`id: ${value.sequence}\nevent: artifact\ndata: ${JSON.stringify(value)}\n\n`;
function response(text,{split=0,failAfter=false,cancelled}={}){
  const bytes=encoder.encode(text);
  let position=0;
  return new Response(new ReadableStream({
    pull(controller){
      if(position<bytes.length){const end=split?Math.min(position+split,bytes.length):bytes.length;controller.enqueue(bytes.slice(position,end));position=end;}
      else if(failAfter)controller.error(new Error('Disconnected transport'));
      else controller.close();
    },
    cancel(){cancelled?.();},
  }),{headers:{'content-type':'text/event-stream'}});
}
function fixture(fetcher){
  const requests=[],fetches=[];
  const client=new ArtifactClient({
    owner:()=> 'owner-token',
    async request(path,input,signal){requests.push({path,input,signal});return {jobId:'job-1'};},
    async fetcher(path,options){fetches.push({path,options});return fetcher(path,options,fetches.length);},
  });
  return {client,requests,fetches};
}

test('SSE handles arbitrary UTF-8 byte boundaries and forwards actual progress once',async()=>{
  const progress=[],result={artifact:{head:'版本二'},text:'数量 🧮'};
  const {client,fetches}=fixture(()=>response(frame(event(1,'stage',{stage:'generating',value:'正在生成中文 🧮'}))+frame(event(2,'result',{value:result})),{split:1}));
  assert.deepEqual(await client.prepare(body,undefined,value=>progress.push(value)),result);
  assert.deepEqual(progress,[event(1,'stage',{stage:'generating',value:'正在生成中文 🧮'})]);
  assert.equal(fetches[0].options.headers['x-branch-owner'],'owner-token');
  assert.deepEqual(JSON.parse(fetches[0].options.body),{sessionId:'novel',branchId:'main',jobId:'job-1',afterSequence:0});
});

test('SSE supports CRLF frame delimiters split between carriage return and newline',async()=>{
  const {client}=fixture(()=>response((frame(event(1,'stage',{stage:'checking'}))+frame(event(2,'result',{value:{ok:true}}))).replaceAll('\n','\r\n'),{split:1}));
  assert.deepEqual(await client.prepare(body),{ok:true});
});

test('reconnection resumes after last sequence and duplicate replay events are ignored',async()=>{
  const progress=[];
  const {client,fetches}=fixture((_path,_options,attempt)=>attempt===1
    ?response(frame(event(1,'stage',{stage:'building'})),{split:2,failAfter:true})
    :response(frame(event(1,'stage',{stage:'building'}))+frame(event(2,'stage',{stage:'checking'}))+frame(event(2,'stage',{stage:'checking'}))+frame(event(3,'result',{value:{head:'rev-3'}}))));
  assert.deepEqual(await client.prepare(body,undefined,value=>progress.push(value)),{head:'rev-3'});
  assert.deepEqual(progress.map(value=>value.sequence),[1,2]);
  assert.deepEqual(fetches.map(value=>JSON.parse(value.options.body).afterSequence),[0,1]);
});

test('aborting prepare calls scoped cancel endpoint once without passing the aborted signal',async()=>{
  const controller=new AbortController();
  let opened;
  const ready=new Promise(resolve=>{opened=resolve;});
  const {client,requests,fetches}=fixture((_path,{signal})=>new Response(new ReadableStream({start(stream){signal.addEventListener('abort',()=>stream.error(signal.reason),{once:true});opened();}})));
  const pending=client.prepare(body,controller.signal);
  await ready;controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  const cancel=requests.filter(value=>value.path==='/api/artifacts/cancel');
  assert.equal(cancel.length,1);
  assert.deepEqual(cancel[0].input,{sessionId:'novel',branchId:'main',jobId:'job-1'});
  assert.equal(cancel[0].signal,undefined);
  assert.equal(fetches.length,1);
});

test('a terminal server error closes the stream and never reconnects',async()=>{
  let cancellations=0;
  const {client,fetches}=fixture(()=>response(frame(event(1,'error',{code:'BUILD_FAILED',error:'构建失败'}))+frame(event(2,'result',{value:{bad:true}})),{split:1,cancelled:()=>cancellations++}));
  await assert.rejects(client.prepare(body),{code:'BUILD_FAILED',message:'构建失败'});
  assert.equal(fetches.length,1);
  assert.equal(cancellations,1);
});

test('a committed result resolves immediately and closes a stream that remains open',async()=>{
  let cancellations=0;
  const {client}=fixture(()=>new Response(new ReadableStream({start(controller){controller.enqueue(encoder.encode(frame(event(1,'result',{value:{ok:true}}))));},cancel(){cancellations++;}})));
  const result=await Promise.race([client.prepare(body),new Promise(resolve=>setTimeout(()=>resolve('still waiting'),100))]);
  assert.deepEqual(result,{ok:true});
  assert.equal(cancellations,1);
});

test('streams without a completed result fail after bounded reconnects',async()=>{
  const {client,fetches}=fixture(()=>response(frame(event(1,'stage',{stage:'ready'}))));
  await assert.rejects(client.prepare(body),{code:'ARTIFACT_CONNECTION_LOST'});
  assert.equal(fetches.length,3);
  assert.deepEqual(fetches.map(value=>JSON.parse(value.options.body).afterSequence),[0,1,1]);
});

test('a malformed result event cannot masquerade as a completed result',async()=>{
  const {client}=fixture(()=>response(frame(event(1,'result'))));
  await assert.rejects(client.prepare(body),{code:'ARTIFACT_INVALID_RESULT'});
});
