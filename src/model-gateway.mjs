import {streamText,Output,jsonSchema} from 'ai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {ApiError,requestModelJSON} from './server-model.mjs';

export class ModelGateway{
  constructor(config,{requestJSON=requestModelJSON,stream=streamText}={}){this.config=config;this.requestJSON=requestJSON;this.stream=stream;}
  get capabilities(){return {structuredOutput:true,contentDeltas:this.config.kind!=='codex',cancellation:true,tools:false};}
  async request(system,content,signal,{schema,validate=value=>value,emit=()=>{}}={}){
    emit({type:'stage',stage:'generating'});
    if(this.config.kind==='codex'){
      const result=await this.requestJSON(this.config,system,content,signal,{schema});
      emit({type:'stage',stage:'validating'});return validate(result);
    }
    if(!this.config.available)throw new ApiError(503,'MODEL_UNAVAILABLE','尚未连接模型，原输入已保留。');
    const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),this.config.timeoutMs||60000);timer.unref?.();
    try{
      const provider=createOpenAICompatible({name:'story-compatible',baseURL:this.config.endpoint.replace(/\/chat\/completions$/,''),apiKey:this.config.key,fetch:(url,options)=>fetch(url,{...options,redirect:'error'})});
      const result=this.stream({model:provider.chatModel(this.config.model),system:system+'\n只输出 JSON 对象。',prompt:content,...(schema?{output:Output.object({schema:jsonSchema(schema)})}:{}),abortSignal:AbortSignal.any([signal,timeout.signal]),maxOutputTokens:this.config.outputBudget,maxRetries:0});
      let text='',last=0;for await(const delta of result.textStream){text+=delta;if(text.length>524288)throw new Error('Model response too large');if(text.length-last>=256){emit({type:'progress',stage:'generating',value:{outputChars:text.length}});last=text.length;}}
      const finish=await result.finishReason;if(finish==='length'||finish==='tool-calls')throw new Error('Incomplete model response');
      emit({type:'stage',stage:'validating'});return validate(JSON.parse(text));
    }catch(error){
      if(signal.aborted)throw new ApiError(499,'CANCELLED','已停止整理。');
      if(timeout.signal.aborted)throw new ApiError(504,'TIMEOUT','模型响应超时，旧版本与输入已保留。');
      if(error instanceof ApiError)throw error;
      throw new ApiError(502,'INVALID_MODEL_RESULT','模型没有返回有效结果，旧版本与输入已保留。');
    }finally{clearTimeout(timer);}
  }
}
