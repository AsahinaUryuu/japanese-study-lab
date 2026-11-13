// Classic worker: the upstream browser bundle uses importScripts + XHR to load
// gzipped dictionaries from this app's own origin. No remote URLs are involved.
let enginePromise,wordData=[],running=false;
const queue=[],jobs=new Map();
function initialize(){
 if(!enginePromise)enginePromise=(async()=>{
  importScripts('./vendor/kuromoji/kuromoji.js');
  const {createAnnotationEngine}=await import('./novel-annotation-core.js');
  const tokenizer=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('本地日语词典载入超时，请重新打开本节')),45000);
   // Upstream uses POSIX path.join, which would collapse http:// into http:/.
   // An origin-relative path stays valid and always targets this local app.
   self.kuromoji.builder({dicPath:new URL('./vendor/kuromoji/dict/',self.location.href).pathname}).build((error,value)=>{
    clearTimeout(timeout);if(error)reject(new Error('本地日语词典未能载入，请重新启动软件'));else resolve(value);
   });
  });
  const engine=createAnnotationEngine(tokenizer,wordData);wordData=[];return engine;
 })();
 return enginePromise;
}
async function pump(){
 if(running)return;running=true;
 try{
  while(queue.length){
   const job=queue.shift();if(job.cancelled){jobs.delete(job.id);continue;}
   try{
    self.postMessage({type:'progress',id:job.id,completed:0,total:job.paragraphs.length,stage:'loading'});
    const engine=await initialize(),result=[];
    for(let i=0;i<job.paragraphs.length;i++){
     if(job.cancelled)break;
     result.push(engine.annotate(job.paragraphs[i]));
     if(i%5===0||i===job.paragraphs.length-1){
      self.postMessage({type:'progress',id:job.id,completed:i+1,total:job.paragraphs.length,stage:'annotating'});
      await new Promise(resolve=>setTimeout(resolve,0));
     }
    }
    if(!job.cancelled)self.postMessage({type:'result',id:job.id,paragraphs:result});
   }catch(error){if(!job.cancelled)self.postMessage({type:'error',id:job.id,message:error.message||'本节注音处理失败'});}
   finally{jobs.delete(job.id);}
  }
 }finally{running=false;}
}
self.onmessage=event=>{
 const message=event.data||{};
 if(message.type==='init'){wordData=Array.isArray(message.words)?message.words:[];return;}
 if(message.type==='cancel'){const job=jobs.get(message.id);if(job)job.cancelled=true;return;}
 if(message.type==='annotate'){
  if(!Array.isArray(message.paragraphs)||message.paragraphs.length>5000){self.postMessage({type:'error',id:message.id,message:'本节段落数量无效'});return;}
  const job={id:message.id,paragraphs:message.paragraphs,cancelled:false};jobs.set(job.id,job);queue.push(job);pump();
 }
};
