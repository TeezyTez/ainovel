const error=value=>Object.assign(new Error(value.error||'作品服务暂时不可用。'),{code:value.code||'ARTIFACT_ERROR'});
export class ArtifactClient{
  constructor(client){this.client=client;}
  read(body,signal){return this.client.request('/api/artifacts/read',body,signal);}
  state(body,signal){return this.client.request('/api/artifacts/state',body,signal);}
  restore(body,signal){return this.client.request('/api/artifacts/restore',body,signal);}
  export(body,signal){return this.client.request('/api/artifacts/export',body,signal);}
  import(body,signal){return this.client.request('/api/artifacts/import',body,signal);}
  async bundle(body,signal){return (await this.client.request('/api/artifacts/bundle',body,signal)).node;}
  async prepare(body,signal,onProgress=()=>{}){
    const started=await this.client.request('/api/artifacts/prepare',body,signal),request={sessionId:body.sessionId,branchId:body.branchId,jobId:started.jobId};
    const cancel=()=>{this.client.request('/api/artifacts/cancel',request).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
    let sequence=0,result,complete=false;
    try{
      if(signal?.aborted){cancel();throw signal.reason;}
      for(let retry=0;retry<3&&!complete;retry++){
        try{
          const response=await this.client.fetcher('/api/artifacts/events',{method:'POST',headers:{'content-type':'application/json','x-branch-owner':this.client.owner()},body:JSON.stringify({...request,afterSequence:sequence}),signal});
          if(!response.ok)throw error(await response.json());
          const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',ended=false;
          const frame=raw=>{const data=raw.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)return;const event=JSON.parse(data);if(!Number.isSafeInteger(event.sequence)||event.sequence<=sequence)return;sequence=event.sequence;
            if(event.type==='result'){if(!event.value||typeof event.value!=='object'||Array.isArray(event.value))throw error({code:'ARTIFACT_INVALID_RESULT',error:'作品服务返回了无效结果。'});result=event.value;complete=true;}
            else if(event.type==='error')throw error(event);
            else if(event.stage==='cancelled')throw Object.assign(new Error('已停止整理。'),{code:'CANCELLED'});
            else onProgress(event);
          };
          try{while(!complete){const {value,done}=await reader.read();ended=done;buffer+=done?decoder.decode():decoder.decode(value,{stream:true});if(buffer.length>12*1024*1024)throw error({code:'ARTIFACT_RESPONSE_TOO_LARGE',error:'作品响应超过限制。'});let boundary;while(!complete&&(boundary=/\r?\n\r?\n/.exec(buffer))){frame(buffer.slice(0,boundary.index));buffer=buffer.slice(boundary.index+boundary[0].length);}if(done)break;}}
          finally{if(!ended)await reader.cancel().catch(()=>{});reader.releaseLock();}
        }catch(e){if(signal?.aborted||e.code||retry===2)throw e;}
      }
      if(!complete)throw error({code:'ARTIFACT_CONNECTION_LOST',error:'整理连接已中断，旧版本仍可使用。请重试或恢复作品。'});return result;
    }finally{signal?.removeEventListener('abort',cancel);}
  }
}
