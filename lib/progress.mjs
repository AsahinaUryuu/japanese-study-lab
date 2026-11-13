import {mkdir,lstat,readFile,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {GradeError} from './config.mjs';

export const MAX_PROGRESS_BYTES=12*1024*1024;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function createProgressStore(filePath){
  const target=path.resolve(filePath),directory=path.dirname(target);
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
  async function save(input){
    if(!object(input)||!object(input.progress))throw new GradeError('学习记录必须是 JSON 对象。');
    if(input.baseRevision!==undefined&&(!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0))throw new GradeError('学习记录版本无效。');
    const current=await read();
    if(input.baseRevision!==undefined&&input.baseRevision!==current.revision){
      const error=new GradeError('另一个页面已更新学习记录，请先合并最新记录再保存。',409);
      error.current=current;throw error;
    }
    const result={progress:input.progress,revision:current.revision+1,savedAt:new Date().toISOString()};
    const contents=JSON.stringify({version:1,...result})+'\n';
    if(Buffer.byteLength(contents)>MAX_PROGRESS_BYTES)throw new GradeError('学习记录超过 12 MB，请先导出并整理过长的对话或笔记。',413);
    await mkdir(directory,{recursive:true});await info();
    const temporary=path.join(directory,`.progress-${randomUUID()}.tmp`);let handle;
    try{
      handle=await open(temporary,'wx',0o600);await handle.writeFile(contents,'utf8');await handle.sync();await handle.close();handle=null;
      await rename(temporary,target);
    }finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
    return result;
  }
  const safe=operation=>queue(async()=>{try{return await operation();}catch(error){if(error instanceof GradeError)throw error;throw new GradeError('本地学习记录读取或写入失败，请检查 local-config/study-progress.json 和目录权限；现有文件未被清空。',500);}});
  return {read:()=>safe(read),save:input=>safe(()=>save(input))};
}
