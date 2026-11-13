const abortError=()=>new DOMException('已取消本节注音','AbortError');

// Initialize only when a local book is actually opened. One worker is shared
// across chapters; aborting a route change settles that request immediately.
export function createNovelAnnotator(words=[],{workerFactory=url=>new Worker(url),timeoutMs=75000}={}){
 const dictionary=words.filter(w=>w&&w.id&&w.word&&w.reading&&w.meaning).map(({id,word,reading})=>({id,word,reading}));
 let worker=null,destroyed=false,sequence=0;
 const pending=new Map();
 function settle(id,error,value){
  const request=pending.get(id);if(!request)return;
  pending.delete(id);clearTimeout(request.timer);request.signal?.removeEventListener('abort',request.abort);
  if(error)request.reject(error);else request.resolve(value);
 }
 function failAll(error){
  worker?.terminate();worker=null;
  for(const id of [...pending.keys()])settle(id,error);
 }
 function ensureWorker(){
  if(worker)return worker;
  worker=workerFactory(new URL('./novel-annotator-worker.js',import.meta.url));
  worker.onmessage=event=>{
   const message=event.data||{},request=pending.get(message.id);if(!request)return;
   if(message.type==='progress'){
    clearTimeout(request.timer);request.timer=setTimeout(()=>failAll(new Error('本节注音处理超时，可重新打开后再试')),timeoutMs);
    try{request.onProgress?.({completed:message.completed,total:message.total,stage:message.stage});}catch{}
   }else if(message.type==='result')settle(message.id,null,message.paragraphs);
   else if(message.type==='error')failAll(new Error(message.message||'本节注音处理失败'));
  };
  worker.onerror=()=>failAll(new Error('本地注音组件未能运行，请刷新后再试'));
  worker.onmessageerror=()=>failAll(new Error('本地注音结果无法读取，请重新打开本节'));
  worker.postMessage({type:'init',words:dictionary});return worker;
 }
 function annotate(paragraphs,{signal,onProgress}={}){
  if(destroyed)return Promise.reject(new Error('注音组件已关闭'));
  if(signal?.aborted)return Promise.reject(abortError());
  if(!Array.isArray(paragraphs)||paragraphs.length>5000)return Promise.reject(new Error('阅读段落数量无效'));
  return new Promise((resolve,reject)=>{
   const id=++sequence;
   const abort=()=>{worker?.postMessage({type:'cancel',id});settle(id,abortError());};
   const request={resolve,reject,signal,onProgress,abort,timer:setTimeout(()=>failAll(new Error('本节注音处理超时，可重新打开后再试')),timeoutMs)};
   pending.set(id,request);signal?.addEventListener('abort',abort,{once:true});
   try{ensureWorker().postMessage({type:'annotate',id,paragraphs});}catch(error){failAll(new Error('无法启动本地注音组件：'+error.message));}
  });
 }
 return {annotate,destroy(){if(destroyed)return;destroyed=true;failAll(abortError());}};
}
