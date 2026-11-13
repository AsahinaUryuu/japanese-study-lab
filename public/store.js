import {newProgress,normalizeProgress,sameProgress} from './learning-core.js';
const CACHE='kotoba-study-v1';
const isRecord=value=>value&&typeof value==='object'&&!Array.isArray(value);
export async function createStore(onStatus=()=>{}){
 let data=newProgress(),revision=0,timer=null,saving=null,dirty=false,conflict=false,cached=null,version=0,replacing=false,disposed=false;
 let recoveryKey=CACHE,clientId=crypto.randomUUID(),pendingWrites=[];
 // Each tab keeps its own recovery copy so another tab cannot erase unsaved work.
 try{let id=sessionStorage.getItem(CACHE+'-tab');if(!id){id=clientId;sessionStorage.setItem(CACHE+'-tab',id);}clientId=id;recoveryKey=CACHE+':tab:'+id;}catch{}
 try{cached=JSON.parse(localStorage.getItem(recoveryKey)||localStorage.getItem(CACHE)||'null');}catch{}
 if(cached?.clientId===clientId&&Array.isArray(cached.pendingWrites))pendingWrites=cached.pendingWrites.filter(w=>w?.clientId===clientId&&typeof w.writeId==='string'&&w.writeId.length<=100&&Number.isSafeInteger(w.baseRevision)&&w.baseRevision>=0).slice(-4);
 // The server stores this opaque receipt with the snapshot. Only an exact
 // previously issued write ID permits rebasing a newer, unsent local draft.
 // A matching tab ID alone is insufficient: another write must still conflict.
 function ownsReceipt(saved){const receipt=saved?.progress?._sync;return receipt&&pendingWrites.some(w=>w.clientId===receipt.clientId&&w.writeId===receipt.writeId&&w.baseRevision===receipt.baseRevision&&saved.revision===w.baseRevision+1);}
 function acknowledge(nextRevision){revision=nextRevision;pendingWrites=pendingWrites.filter(w=>w.baseRevision>=nextRevision);}
 function prepareWrite(progress,baseRevision){const write={clientId,writeId:crypto.randomUUID(),baseRevision};return {write,body:JSON.stringify({progress:{...progress,_sync:write},baseRevision})};}
 function remember(write){pendingWrites=[...pendingWrites,write].slice(-4);cache();}
 const validSaved=saved=>{if(!saved||!Number.isSafeInteger(saved.revision)||saved.revision<0||!isRecord(saved.progress))throw new Error('学习记录格式无效');return saved;};
 async function readSaved(){const response=await fetch('/api/progress',{cache:'no-store'});if(!response.ok)throw new Error('无法读取学习记录');return validSaved(await response.json());}
 try{
  const saved=await readSaved();revision=saved.revision;data=saved.progress.version?normalizeProgress(saved.progress):newProgress();
  if(cached?.dirty&&cached.progress){const recovery=normalizeProgress(cached.progress);if(sameProgress(data,recovery)){pendingWrites=[];onStatus('已恢复上次保存');}else if(cached.revision===revision){data=recovery;dirty=true;onStatus('已恢复尚未写入文件的草稿');}else if(ownsReceipt(saved)){acknowledge(saved.revision);data=recovery;dirty=true;onStatus('已确认上次保存，并恢复之后编辑的草稿');}else{data=recovery;dirty=true;conflict=true;onStatus('本页有未同步记录，且其他窗口已更新：请导出记录备份后刷新');}}
 }catch(error){try{if(cached){data=normalizeProgress(cached.progress||cached);revision=Number.isSafeInteger(cached.revision)?cached.revision:0;dirty=!!cached.dirty;}}catch{}onStatus('学习服务暂不可用，使用浏览器恢复副本');}
 function cache(){try{const value=JSON.stringify({progress:data,revision,dirty:dirty||pendingWrites.length>0,clientId,pendingWrites,at:Date.now()});localStorage.setItem(recoveryKey,value);localStorage.setItem(CACHE,value);}catch{onStatus('浏览器备份空间不足，仍尝试保存到学习服务');}}
 async function flush(){
  clearTimeout(timer);if(saving)return saving;if(replacing||disposed)return false;if(!dirty)return true;if(conflict)return false;
  dirty=false;const snapshot=JSON.parse(JSON.stringify(data));
  saving=(async()=>{try{
   for(let attempt=0;attempt<3;attempt++){
    const baseRevision=revision,{write,body}=prepareWrite(snapshot,baseRevision);remember(write);
    const response=await fetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body});const saved=await response.json();
    if(response.status===409){
     if(ownsReceipt(saved.current)){acknowledge(saved.current.revision);continue;}
     conflict=true;throw new Error('另一个窗口更新了记录：请导出本页记录，再刷新同步');
    }
    if(!response.ok)throw new Error(saved.error||'保存失败');if(!Number.isSafeInteger(saved.revision)||saved.revision!==baseRevision+1)throw new Error('保存结果的版本无效，浏览器恢复副本仍保留');
    acknowledge(saved.revision);onStatus(dirty?'正在保存更新后的草稿…':'已保存到学习服务');return true;
   }
   throw new Error('上一笔保存仍在完成，草稿已保留，稍后自动重试');
  }catch(error){dirty=true;onStatus(error.message||'保存失败，浏览器恢复副本仍保留');return false;}finally{saving=null;cache();if(dirty&&!conflict&&!replacing&&!disposed)timer=setTimeout(flush,2000);}})();return saving;
 }
 function save(){version++;dirty=true;cache();clearTimeout(timer);if(!replacing&&!disposed)timer=setTimeout(flush,500);return !conflict;}
 function lesson(id){return data.lessons[id]??=({stage:'learn',answers:{},drafts:{},reviews:[],done:false,updatedAt:Date.now()});}
 function thread(key){return data.threads[key]??=({messages:[],draft:''});}
 function activity(){const date=new Date().toLocaleDateString('en-CA');data.activity[date]=(data.activity[date]||0)+1;}
 async function replaceData(next,reload){
  if(replacing)throw new Error('正在载入记录，请稍后再试');
  const normalized=reload?null:normalizeProgress(next);replacing=true;clearTimeout(timer);
  try{
   if(saving)await saving;
   const expectedVersion=version,saved=await readSaved();
   if(version!==expectedVersion)throw new Error('读取期间产生了新的学习记录，已保留本页内容；请稍后重新操作');
   data=reload?(saved.progress.version?normalizeProgress(saved.progress):newProgress()):normalized;
   revision=saved.revision;pendingWrites=[];conflict=false;dirty=!reload;version++;cache();
  }finally{replacing=false;if(dirty&&!conflict&&!disposed)timer=setTimeout(flush,500);}
  if(reload){onStatus('已重新载入学习记录');return;}
  if(!await flush())throw new Error(conflict?'导入期间记录被另一窗口更新，已保留恢复副本':'导入记录已留在本浏览器，但保存到学习服务失败，请稍后重试');
 }
 function hidden(){if(document.visibilityState==='hidden')void flush();}
 function unloading(){cache();if(dirty&&!conflict&&!saving&&!replacing){const {write,body}=prepareWrite(data,revision);if(new TextEncoder().encode(body).length<55000){remember(write);void fetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});}}}
 document.addEventListener('visibilitychange',hidden);window.addEventListener('beforeunload',unloading);
 if(dirty&&!conflict)timer=setTimeout(flush,1000);
 function dispose(){disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('beforeunload',unloading);cache();}
 return {get data(){return data;},get revision(){return revision;},lesson,thread,save,flush,replace:next=>replaceData(next,false),reloadSaved:()=>replaceData(null,true),activity,get conflict(){return conflict;},dispose};
}

