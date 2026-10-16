import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelGateway} from '../src/model-gateway.mjs';
import http from 'node:http';
test('Codex gateway reports stages and capabilities without fabricated tokens or raw output',async()=>{
 const events=[];const gateway=new ModelGateway({kind:'codex',available:true},{requestJSON:async()=>({payload:'{"decision":"keep"}'})});
 assert.equal(gateway.capabilities.contentDeltas,false);
 const result=await gateway.request('system','context',new AbortController().signal,{emit:e=>events.push(e),validate:x=>JSON.parse(x.payload)});
 assert.equal(result.decision,'keep');assert.deepEqual(events.map(e=>e.stage),['generating','validating']);
});
test('compatible API gateway uses real SSE and requests JSON output through the SDK',async t=>{
 let request;const server=http.createServer(async(req,res)=>{const chunks=[];for await(const part of req)chunks.push(part);request=JSON.parse(Buffer.concat(chunks));
   res.writeHead(200,{'content-type':'text/event-stream'});for(const content of ['{"payload":"','x'.repeat(270),'"}'])res.write('data: '+JSON.stringify({id:'response',created:1,model:'fixture',choices:[{index:0,delta:{content},finish_reason:null}]})+'\n\n');
   res.end('data: '+JSON.stringify({id:'response',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const config={available:true,endpoint:`http://127.0.0.1:${server.address().port}/v1/chat/completions`,model:'fixture',key:'test',timeoutMs:5000,outputBudget:1000};
 const events=[],gateway=new ModelGateway(config),result=await gateway.request('JSON','data',new AbortController().signal,{schema:{type:'object',properties:{payload:{type:'string'}},required:['payload'],additionalProperties:false},emit:e=>events.push(e)});
 assert.equal(result.payload.length,270);assert.equal(request.stream,true);assert.equal(request.response_format.type,'json_object');assert.ok(events.some(e=>e.type==='progress'&&e.value.outputChars>=256));assert.equal(request.tools,undefined);
});
