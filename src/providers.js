import {demoGenerate} from './demo.js';
export class DemoProvider {
  async generate(context,signal){
    if(signal?.aborted)throw new DOMException('已取消','AbortError');
    // A short cancellable transition, not simulated model streaming.
    await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1200);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('已取消','AbortError'));},{once:true});});
    return demoGenerate(context);
  }
}
export class RealProvider {
  async generate(context,signal){
    const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(context),signal});
    const data=await response.json();
    if(!response.ok)throw new Error(typeof data.error==='string'?data.error:(data.error?.message||'模型暂时无法响应，输入和旧故事已保留。'));
    return data;
  }
}
