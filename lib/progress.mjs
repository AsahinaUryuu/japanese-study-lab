import {mkdir,lstat,readFile,open,rename,unlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {GradeError} from './config.mjs';

export const MAX_PROGRESS_BYTES=12*1024*1024;
export const MAX_HISTORY_FILES=20;
export const MAX_HISTORY_BYTES=80*1024*1024;
export const AUTO_CHECKPOINT_INTERVAL_MS=15*60*1000;
const MAX_CHECKPOINT_BYTES=MAX_PROGRESS_BYTES+4096;
const CHECKPOINT_ID=/^[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REASONS=new Set(['auto','manual','before-restore']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function createProgressStore(filePath,{now=Date.now}={}){
  const target=path.resolve(filePath),directory=path.dirname(target);
  const historyDirectory=path.join(directory,'progress-history');
  let lastAutomaticCheckpoint=null;
  let pending=Promise.resolve();
  const queue=operation=>{const next=pending.then(operation);pending=next.catch(()=>{});return next;};
  async function info(){
    try{
      const parent=await lstat(directory);
      if(!parent.isDirectory()||parent.isSymbolicLink())throw new Error('unsafe parent');
      const file=await lstat(target);
      if(!file.isFile()||file.isSymbolicLink()||file.size>MAX_PROGRESS_BYTES)throw new Error('invalid progress file');
      return file;
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async function read(){
    if(!await info())return {progress:{},revision:0,savedAt:null};
    const stored=JSON.parse(await readFile(target,'utf8'));
    if(stored.version!==1||!object(stored.progress)||!Number.isSafeInteger(stored.revision)||stored.revision<0)throw new Error('invalid progress');
    return {progress:stored.progress,revision:stored.revision,savedAt:stored.savedAt||null};
  }
  async function historyDirectoryExists(create=false){
    try{
      const parent=await lstat(directory);
      if(!parent.isDirectory()||parent.isSymbolicLink())throw new Error('unsafe progress directory');
    }catch(error){if(error.code!=='ENOENT')throw error;if(!create)return false;await mkdir(directory,{recursive:true});}
    try{
      const folder=await lstat(historyDirectory);
      if(!folder.isDirectory()||folder.isSymbolicLink())throw new Error('unsafe history directory');
      return true;
    }catch(error){if(error.code!=='ENOENT')throw error;if(!create)return false;await mkdir(historyDirectory,{mode:0o700});return true;}
  }
  function validateId(id){
    if(typeof id!=='string'||!CHECKPOINT_ID.test(id))throw new GradeError('备份编号无效。',400);
    return id;
  }
  function metadata(value,bytes){return {id:value.id,createdAt:value.createdAt,reason:value.reason,sourceRevision:value.sourceRevision,bytes};}
  async function readCheckpoint(id){
    validateId(id);
    if(!await historyDirectoryExists())throw new GradeError('这份学习记录备份已不存在，可能已被自动轮换。',404);
    const checkpointPath=path.join(historyDirectory,id+'.json');
    let file;
    try{file=await lstat(checkpointPath);}catch(error){if(error.code==='ENOENT')throw new GradeError('这份学习记录备份已不存在，可能已被自动轮换。',404);throw error;}
    if(!file.isFile()||file.isSymbolicLink()||file.size>MAX_CHECKPOINT_BYTES)throw new Error('invalid checkpoint file');
    const value=JSON.parse(await readFile(checkpointPath,'utf8'));
    if(value.version!==1||value.type!=='progress-checkpoint'||value.id!==id||!REASONS.has(value.reason)||!object(value.progress)||!Number.isSafeInteger(value.sourceRevision)||value.sourceRevision<0||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))throw new Error('invalid checkpoint contents');
    return {...value,bytes:file.size};
  }
  async function history(){
    if(!await historyDirectoryExists())return [];
    const names=(await readdir(historyDirectory)).filter(name=>name.endsWith('.json')&&CHECKPOINT_ID.test(name.slice(0,-5)));
    const items=[];
    for(const name of names){const value=await readCheckpoint(name.slice(0,-5));items.push(metadata(value,value.bytes));}
    return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.sourceRevision-a.sourceRevision||b.id.localeCompare(a.id));
  }
  async function writeCheckpoint(current,reason){
    if(!REASONS.has(reason))throw new GradeError('备份原因无效。',400);
    try{
      await historyDirectoryExists(true);
      const timestamp=now(),id=String(timestamp).padStart(13,'0')+'-'+randomUUID();validateId(id);
      const value={version:1,type:'progress-checkpoint',id,createdAt:new Date(timestamp).toISOString(),reason,sourceRevision:current.revision,progress:current.progress};
      const contents=JSON.stringify(value)+'\n',bytes=Buffer.byteLength(contents);
      if(bytes>MAX_CHECKPOINT_BYTES||bytes>MAX_HISTORY_BYTES)throw new Error('checkpoint too large');
      const entries=await history();
      const temporary=path.join(historyDirectory,`.checkpoint-${randomUUID()}.tmp`);let handle;
      try{
        handle=await open(temporary,'wx',0o600);await handle.writeFile(contents,'utf8');await handle.sync();await handle.close();handle=null;
        let count=entries.length,total=entries.reduce((sum,item)=>sum+item.bytes,0);
        // Only files bearing our validated IDs are eligible for retention cleanup.
        for(const old of entries.toReversed()){
          if(count+1<=MAX_HISTORY_FILES&&total+bytes<=MAX_HISTORY_BYTES)break;
          const oldPath=path.join(historyDirectory,validateId(old.id)+'.json'),file=await lstat(oldPath);
          if(!file.isFile()||file.isSymbolicLink())throw new Error('unsafe checkpoint cleanup');
          await unlink(oldPath);count--;total-=old.bytes;
        }
        await rename(temporary,path.join(historyDirectory,id+'.json'));
      }finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
      // Manual and pre-restore snapshots also satisfy the recent-backup window.
      lastAutomaticCheckpoint=timestamp;
      return metadata(value,bytes);
    }catch(error){
      if(error instanceof GradeError)throw error;
      throw new GradeError('学习记录备份失败，本次更改尚未覆盖原记录。请检查 local-config/progress-history 的磁盘空间或目录权限，再重试。',500);
    }
  }
  function verifyRevision(input,current,{required=false}={}){
    if((required&&input.baseRevision===undefined)||(input.baseRevision!==undefined&&(!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0)))throw new GradeError(required?'恢复备份必须提供当前学习记录版本。':'学习记录版本无效。');
    if(input.baseRevision!==undefined&&input.baseRevision!==current.revision){
      const error=new GradeError('另一个页面已更新学习记录，请先合并最新记录再保存。',409);
      error.current=current;throw error;
    }
  }
  function contentsFor(progress,current){
    const result={progress,revision:current.revision+1,savedAt:new Date(now()).toISOString()};
    const contents=JSON.stringify({version:1,...result})+'\n';
    if(Buffer.byteLength(contents)>MAX_PROGRESS_BYTES)throw new GradeError('学习记录超过 12 MB，请先导出并整理过长的对话或笔记。',413);
    return {result,contents};
  }
  async function writeProgress(contents){
    await mkdir(directory,{recursive:true});await info();
    const temporary=path.join(directory,`.progress-${randomUUID()}.tmp`);let handle;
    try{
      handle=await open(temporary,'wx',0o600);await handle.writeFile(contents,'utf8');await handle.sync();await handle.close();handle=null;
      await rename(temporary,target);
    }finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
  }
  async function save(input){
    if(!object(input)||!object(input.progress))throw new GradeError('学习记录必须是 JSON 对象。');
    const current=await read();
    verifyRevision(input,current);
    const {result,contents}=contentsFor(input.progress,current);
    if(current.revision>0||Object.keys(current.progress).length>0){
      try{
        if(lastAutomaticCheckpoint===null){
          const previous=await history();
          lastAutomaticCheckpoint=previous.length?Math.min(now(),Math.max(...previous.map(item=>Date.parse(item.createdAt)))):-Infinity;
        }
        if(now()-lastAutomaticCheckpoint>=AUTO_CHECKPOINT_INTERVAL_MS)await writeCheckpoint(current,'auto');
      }catch(error){
        if(error instanceof GradeError)throw error;
        throw new GradeError('学习记录备份无法读取，本次更改尚未覆盖原记录。请检查 local-config/progress-history 后重试。',500);
      }
    }
    await writeProgress(contents);
    return result;
  }
  async function checkpoint({reason='manual'}={}){return writeCheckpoint(await read(),reason);}
  async function restoreCheckpoint(input){
    if(!object(input))throw new GradeError('恢复备份参数无效。');validateId(input.id);
    const current=await read();verifyRevision(input,current,{required:true});
    // Read the chosen snapshot before retention can remove it while backing up.
    const selected=await readCheckpoint(input.id),{result,contents}=contentsFor(selected.progress,current);
    await writeCheckpoint(current,'before-restore');await writeProgress(contents);
    return result;
  }
  const safe=operation=>queue(async()=>{try{return await operation();}catch(error){if(error instanceof GradeError)throw error;throw new GradeError('本地学习记录读取或写入失败，请检查 local-config/study-progress.json 和目录权限；现有文件未被清空。',500);}});
  return {read:()=>safe(read),save:input=>safe(()=>save(input)),history:()=>safe(history),checkpoint:input=>safe(()=>checkpoint(input)),getCheckpoint:id=>safe(()=>readCheckpoint(id)),restoreCheckpoint:input=>safe(()=>restoreCheckpoint(input))};
}
