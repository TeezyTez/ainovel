import {validateArchive} from './core.js';
export const STORAGE_KEY='cijian:archive:v1';
export const defaultSettings={theme:'light',fontSize:18,lineHeight:1.95,width:720,reducedMotion:false,sendEnter:false,showSuggestions:true,perspective:'第二人称',length:'适中',pace:'从容',style:'细腻克制'};
export class LocalRepository {
  constructor(storage){this.storage=storage;this.lastLoadedRaw=null;this.hasLoaded=false;this.readFailed=false;this.presets=[];}
  decode(raw,presets){
    if(raw===null)return {schemaVersion:1,worlds:structuredClone(presets),sessions:[],settings:{...defaultSettings},worldDraft:null,telemetry:[]};
    let data;try{data=validateArchive(JSON.parse(raw));}catch(e){throw new Error('本机存档读取失败，原始数据未被覆盖。请先导出备份再处理。'+e.message);}
    data.settings={...defaultSettings,...data.settings};data.telemetry??=[];
    // Early prototype backups did not freeze the opening on each branch.
    for(const session of data.sessions)for(const branch of session.branches)branch.opening??=data.worlds.find(w=>`${w.id}@${w.version}`===branch.worldKey)?.opening||'';
    return data;
  }
  load(presets=this.presets){
    this.presets=presets;const raw=this.storage.getItem(STORAGE_KEY);
    try{const data=this.decode(raw,presets);this.lastLoadedRaw=raw;this.hasLoaded=true;this.readFailed=false;return data;}
    catch(error){this.readFailed=true;throw error;}
  }
  hasExternalChange(){return this.hasLoaded&&this.storage.getItem(STORAGE_KEY)!==this.lastLoadedRaw;}
  // Preview never advances the optimistic baseline or mutates the caller's database.
  readExternal(presets=this.presets){return this.decode(this.storage.getItem(STORAGE_KEY),presets);}
  // Explicit user-chosen reload. The UI must preserve/export unsaved drafts first.
  acceptExternal(presets=this.presets){return this.load(presets);}
  mergeExternal(merge){
    const raw=this.storage.getItem(STORAGE_KEY),external=this.decode(raw,this.presets),next=merge(external);
    validateArchive(next);
    if(this.storage.getItem(STORAGE_KEY)!==raw){const error=new Error('合并期间另一标签页再次更新，请重新比较后再合并。');error.code='STORAGE_CONFLICT';throw error;}
    const serialized=JSON.stringify(next);this.storage.setItem(STORAGE_KEY,serialized);
    this.lastLoadedRaw=serialized;this.hasLoaded=true;this.readFailed=false;return next;
  }
  recover(data){
    const valid=validateArchive(data),raw=this.storage.getItem(STORAGE_KEY);
    // Preserve the damaged bytes before the explicitly chosen recovery import.
    // A failure writing either key leaves the original archive in place.
    if(raw!==null)this.storage.setItem(STORAGE_KEY+':recovery:'+Date.now(),raw);
    const serialized=JSON.stringify(valid);this.storage.setItem(STORAGE_KEY,serialized);
    this.lastLoadedRaw=serialized;this.hasLoaded=true;this.readFailed=false;return true;
  }
  save(data){
    if(this.readFailed){const error=new Error('本机存档读取失败，原始数据未被覆盖。请先导出备份并处理读取问题。');error.code='STORAGE_READ_FAILED';throw error;}
    try{
      const raw=JSON.stringify(data),current=this.storage.getItem(STORAGE_KEY);
      if(typeof raw!=='string')throw new Error('not serializable');
      if(this.hasLoaded&&current!==this.lastLoadedRaw){const error=new Error('另一标签页已更新本机存档。当前页面的内容与草稿已保留，请先查看新进展并决定如何接续。');error.code='STORAGE_CONFLICT';throw error;}
      this.storage.setItem(STORAGE_KEY,raw);this.lastLoadedRaw=raw;this.hasLoaded=true;return true;
    }catch(error){if(error.code==='STORAGE_CONFLICT')throw error;throw new Error('保存失败：此设备的存储空间不足或不可写。当前内容仍在页面内，请导出完整存档备份后重试。');}
  }
}
