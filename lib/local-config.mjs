import {mkdir, lstat, readFile, open, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {GradeError} from './config.mjs';

export const DEFAULT_LOCAL_CONFIG=Object.freeze({provider:'openai',baseUrl:'https://api.openai.com/v1',model:'',proxyUrl:'',apiKey:''});
const isLocal=host=>['localhost','127.0.0.1','[::1]'].includes(host);
function field(value,name,max){
  if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new GradeError(`${name} 格式无效或长度超限。`);
  return value.trim();
}
export function validateLocalConfig(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!['openai','gemini'].includes(input.provider))throw new GradeError('接口配置格式无效。');
  const result={provider:input.provider,baseUrl:field(input.baseUrl,'API 地址',2048),model:field(input.model??'','模型名称',200),proxyUrl:field(input.proxyUrl??'','代理地址',2048),apiKey:field(input.apiKey??'','API Key',8192)};
  let base;try{base=new URL(result.baseUrl);}catch{throw new GradeError('请输入完整的 API 地址。');}
  if(base.username||base.password||base.search||base.hash||!(base.protocol==='https:'||(base.protocol==='http:'&&isLocal(base.hostname))))throw new GradeError('API 地址应使用 HTTPS（本机可使用 HTTP），且不能包含密钥或查询参数。');
  if(result.proxyUrl){
    let proxy;try{proxy=new URL(result.proxyUrl);}catch{throw new GradeError('代理地址格式无效。');}
    if(proxy.protocol!=='http:'||!isLocal(proxy.hostname)||proxy.username||proxy.password||proxy.search||proxy.hash||proxy.pathname!=='/')throw new GradeError('代理请填写本机无认证的 HTTP 地址。');
  }
  return result;
}

export function createLocalConfigStore(filePath){
  const target=path.resolve(filePath),directory=path.dirname(target);
  let pending=Promise.resolve();
  const queue=operation=>{const next=pending.then(operation);pending=next.catch(()=>{});return next;};
  async function fileInfo(){
    try{
      const parent=await lstat(directory);
      if(parent.isSymbolicLink()||!parent.isDirectory())throw new Error('unsafe directory');
      const info=await lstat(target);
      if(info.isSymbolicLink()||!info.isFile())throw new Error('unsafe file');
      return info;
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async function read(){
    const info=await fileInfo();
    if(!info)return {config:{...DEFAULT_LOCAL_CONFIG},saved:false};
    if(info.size>64*1024)throw new Error('oversize settings');
    const stored=JSON.parse(await readFile(target,'utf8'));
    if(stored?.version!==1)throw new Error('invalid settings version');
    return {config:validateLocalConfig(stored.config),saved:true};
  }
  async function write(config){
    await mkdir(directory,{recursive:true});
    await fileInfo();
    const temporary=path.join(directory,`.ai-settings-${randomUUID()}.tmp`);
    let handle;
    try{
      handle=await open(temporary,'wx',0o600);
      await handle.writeFile(JSON.stringify({version:1,config},null,2)+'\n','utf8');
      await handle.sync();await handle.close();handle=null;
      await rename(temporary,target);
    }finally{
      await handle?.close().catch(()=>{});
      await unlink(temporary).catch(()=>{});
    }
    return {config,saved:true};
  }
  return {execute(input){
    if(!input||!['read','save','clear-key','reset'].includes(input.action))return Promise.reject(new GradeError('本地配置操作无效。'));
    // Reject bad input before queueing it; never include the supplied value in errors.
    let config;try{if(input.action==='save')config=validateLocalConfig(input.config);}catch(error){return Promise.reject(error);}
    return queue(async()=>{
      try{
        if(input.action==='read')return await read();
        if(input.action==='save')return await write(config);
        if(input.action==='reset')return await write({...DEFAULT_LOCAL_CONFIG});
        const previous=await read();
        return previous.saved?await write({...previous.config,apiKey:''}):previous;
      }catch{
        throw new GradeError('无法读取或保存本地配置。请检查 local-config/ai-settings.json 的格式和文件夹写入权限。',500);
      }
    });
  }};
}
