import http from 'node:http';
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {GradeError} from './lib/config.mjs';
import {createLocalConfigStore} from './lib/local-config.mjs';
import {createRemoteAccess,requireSameOrigin,privateConfig,hydrateModelRequest} from './lib/remote-access.mjs';
import {createProgressStore,MAX_PROGRESS_BYTES} from './lib/progress.mjs';
import {handleProgressHistory} from './lib/progress-http.mjs';
import {listModels} from './lib/models.mjs';
import {coachReply} from './lib/coach.mjs';
import {createNovelStore} from './lib/novel-store.mjs';
import {seedNovels} from './lib/seed-novels.mjs';
import {MAX_NOVEL_REQUEST_BYTES} from './lib/novel-import.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const TYPES={'.gz':'application/gzip','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.pdf':'application/pdf','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg','.mp4':'video/mp4','.webm':'video/webm','.zip':'application/zip','.txt':'text/plain; charset=utf-8'};
const RESOURCE_TYPES=new Set(['.pdf','.mp3','.wav','.m4a','.ogg','.mp4','.webm','.zip']);
const GENERAL_LESSON={id:'general',level:'综合',track:'consultation',title:'日语学习咨询',sections:[],goals:['结合明确的词句与场景，理解日语并练习表达']};
const inside=(root,target)=>target.startsWith(root+path.sep);
function json(res,status,value,extra={}){
  res.writeHead(status,{'content-type':TYPES['.json'],'cache-control':'no-store','x-content-type-options':'nosniff',...extra});res.end(JSON.stringify(value));
}
async function readBody(req,limit=256*1024){
  if(Number(req.headers['content-length'])>limit)throw new GradeError('请求内容超过允许大小。',413);
  const chunks=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>limit)throw new GradeError('请求内容超过允许大小。',413);chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}
  catch{throw new GradeError('请求不是有效的 JSON 对象。');}
}
const sameOrigin=(req,options={})=>requireSameOrigin(req,{requireOrigin:false,...options});
export function parseRange(header,size){
  if(!header)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!match||(!match[1]&&!match[2])||size===0)throw new GradeError('请求的文件范围无效。',416);
  let start,end;
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)throw new GradeError('请求的文件范围无效。',416);start=Math.max(0,size-suffix);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw new GradeError('请求的文件范围无效。',416);
  return {start,end};
}
async function serveFile(req,res,target,mime){
  const info=await stat(target);if(!info.isFile())throw new GradeError('资源不存在。',404);
  let range;try{range=parseRange(req.headers.range,info.size);}catch(error){if(error.status===416)return json(res,416,{error:error.message},{'content-range':`bytes */${info.size}`});throw error;}
  const headers={'content-type':mime,'content-length':range?range.end-range.start+1:info.size,'cache-control':'no-cache','accept-ranges':'bytes','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'SAMEORIGIN'};
  if(range)headers['content-range']=`bytes ${range.start}-${range.end}/${info.size}`;
  res.writeHead(range?206:200,headers);
  if(req.method==='HEAD')return res.end();
  const stream=createReadStream(target,range||undefined);
  res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);
}
export function createApp({publicDir=path.join(directory,'public'),libraryRoot=process.env.LIBRARY_ROOT||path.join(directory,'local-library'),localConfigPath=path.join(directory,'local-config','ai-settings.json'),progressPath=path.join(directory,'local-config','study-progress.json'),novelsDir=path.join(path.dirname(progressPath),'novels'),fetchImpl,timeoutMs,publicOrigin=process.env.PUBLIC_ORIGIN||'',accessToken=process.env.ACCESS_TOKEN||''}={}){
  const configStore=createLocalConfigStore(localConfigPath),progressStore=createProgressStore(progressPath);
  const novelStore=createNovelStore(novelsDir);
  const access=createRemoteAccess({publicOrigin,accessToken,appId:'japanese'});
  const dataDir=path.join(publicDir,'data');let catalogSignature='',catalogValue;
  async function catalog(){
    const names=(await readdir(dataDir)).filter(name=>name.endsWith('.json')&&!/^(vocabulary|kanji|resources|sources|licenses|manifest|catalog|stats|reader|stories|novel)/i.test(name)).sort();
    const infos=await Promise.all(names.map(name=>stat(path.join(dataDir,name))));
    const signature=names.map((name,index)=>`${name}:${infos[index].mtimeMs}:${infos[index].size}`).join('|');
    if(catalogValue&&signature===catalogSignature)return catalogValue;
    const lessons=[],ids=new Set();
    for(const name of names){
      const data=JSON.parse(await readFile(path.join(dataDir,name),'utf8'));
      const items=Array.isArray(data)?data:Array.isArray(data?.lessons)?data.lessons:[];
      for(const lesson of items){
        if(typeof lesson?.id!=='string'||typeof lesson?.title!=='string'||!Array.isArray(lesson.sections))continue;
        if(ids.has(lesson.id))throw new Error('duplicate lesson id');ids.add(lesson.id);lessons.push(lesson);
      }
    }
    const byLevel={};for(const lesson of lessons)byLevel[lesson.level]=(byLevel[lesson.level]||0)+1;
    catalogValue={lessons,stats:{lessons:lessons.length,byLevel}};catalogSignature=signature;return catalogValue;
  }
  async function library(){
    try{const value=JSON.parse(await readFile(path.join(dataDir,'resources.json'),'utf8'));return Array.isArray(value)?value:Array.isArray(value.resources)?value.resources:[];}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
  }
  return http.createServer(async(req,res)=>{
    try{
      if(!access.accept(req,res))return;
      const requested=decodeURIComponent((req.url||'/').split('?')[0]);
      if(requested.includes('\0')||requested.includes('\\')||requested.split('/').some(part=>part==='..'||part.startsWith('.')))throw new GradeError('不可访问此路径。',403);
      if(requested==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,service:'japanese-academy',version:'1.8.0'});
      if(await handleProgressHistory(req,res,{requested,store:progressStore,readBody,json}))return;
      if(requested==='/api/catalog'&&req.method==='GET')return json(res,200,await catalog());
      if(requested==='/api/library'&&req.method==='GET')return json(res,200,{resources:await library()});
      if(requested==='/api/novels'){
        if(req.method!=='GET')throw new GradeError('书架列表请使用 GET。',405);
        sameOrigin(req);return json(res,200,await novelStore.list());
      }
      if(requested==='/api/novels/import'){
        if(req.method!=='POST')throw new GradeError('导入书籍请使用 POST。',405);
        sameOrigin(req,{requireOrigin:true});
        if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new GradeError('请使用 JSON 提交文件。',415);
        return json(res,200,await novelStore.importBook(await readBody(req,MAX_NOVEL_REQUEST_BYTES)));
      }
      if(requested.startsWith('/api/novels/')){
        if(req.method!=='GET')throw new GradeError('读取章节请使用 GET。',405);
        sameOrigin(req);const match=/^\/api\/novels\/([^/]+)\/chapters\/([^/]+)$/.exec(requested);
        if(!match)throw new GradeError('书籍接口地址无效。',404);
        return json(res,200,await novelStore.get(match[1],match[2]));
      }
      if(requested==='/api/progress'){
        if(req.method==='GET'){sameOrigin(req);return json(res,200,await progressStore.read());}
        if(req.method!=='POST')throw new GradeError('学习记录使用 GET 或 POST。',405);
        sameOrigin(req,{requireOrigin:true});
        if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new GradeError('请使用 JSON 提交学习记录。',415);
        return json(res,200,await progressStore.save(await readBody(req,MAX_PROGRESS_BYTES)));
      }
      if(['/api/local-config','/api/models','/api/coach'].includes(requested)){
        if(req.method!=='POST')throw new GradeError('请使用 POST 提交请求。',405);
        sameOrigin(req,{requireOrigin:true});
        if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new GradeError('请使用 JSON 提交请求。',415);
        let input=await readBody(req,requested==='/api/coach'?512*1024:100*1024);
        if(requested==='/api/local-config')return json(res,200,await privateConfig(configStore,input,access.remote));
        input=await hydrateModelRequest(configStore,input,access.remote);
        if(requested==='/api/models')return json(res,200,await listModels(input,{fetchImpl,timeoutMs}));
        const lesson=input.lessonId==='general'?GENERAL_LESSON:(await catalog()).lessons.find(item=>item.id===input.lessonId);
        if(!lesson)throw new GradeError('未找到当前课程，请重新进入课程后提问。',404);
        const requestController=new AbortController();
        const disconnected=()=>requestController.abort();res.once('close',disconnected);
        try{return json(res,200,await coachReply(input,lesson,{fetchImpl,timeoutMs,signal:requestController.signal}));}
        finally{res.removeListener('close',disconnected);}
      }
      if(requested.startsWith('/api/resource/')){
        if(!['GET','HEAD'].includes(req.method))throw new GradeError('资源只支持 GET 或 HEAD。',405);
        const id=requested.slice('/api/resource/'.length);
        if(!id||id.includes('/')||id.length>160)throw new GradeError('资料编号无效。');
        const entry=(await library()).find(item=>item.id===id);
        if(!entry||typeof entry.relativePath!=='string')throw new GradeError('没有找到这份本地资料。',404);
        const root=await realpath(libraryRoot),target=await realpath(path.resolve(root,entry.relativePath));
        if(!inside(root,target))throw new GradeError('不可访问资料目录以外的文件。',403);
        const extension=path.extname(target).toLowerCase();
        if(!RESOURCE_TYPES.has(extension))throw new GradeError('这类资料请使用本地对应应用打开。',415);
        return await serveFile(req,res,target,TYPES[extension]);
      }
      if(requested.startsWith('/api/'))throw new GradeError('接口不存在。',404);
      if(!['GET','HEAD'].includes(req.method))throw new GradeError('不支持的请求方法。',405);
      const relative=requested==='/'?'/index.html':requested,mime=TYPES[path.extname(relative).toLowerCase()];
      if(!mime)throw new GradeError('页面不存在。',404);
      const root=await realpath(publicDir),target=await realpath(path.join(root,relative));
      if(!inside(root,target))throw new GradeError('不可访问此路径。',403);
      return await serveFile(req,res,target,mime);
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      if(error instanceof URIError)return json(res,400,{error:'请求地址编码无效。'});
      if(error.code==='ENOENT')return json(res,404,{error:'文件不存在或资料盘当前不可用。'});
      return json(res,error instanceof GradeError?error.status:500,{error:error instanceof GradeError?error.message:'本地服务处理失败，请检查课程或资料文件。',...(error.current?{current:error.current}:{})});
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const port=Number(process.env.JAPANESE_PORT||4328);
  if(!Number.isInteger(port)||port<1||port>65535){console.error('JAPANESE_PORT 必须为 1 到 65535 的端口号。');process.exit(1);}
  await seedNovels(path.join(directory,'seed','novels'),path.join(directory,'local-config','novels'));
  const server=createApp();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`端口 ${port} 已被占用。请使用启动学习.bat 安全重启本软件，或设置 JAPANESE_PORT。`:'本地日语服务启动失败。');process.exitCode=1;});
  server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`言葉 · 日语学习工作台已启动：http://127.0.0.1:${port}\n本软件与前端学习软件的数据和服务相互独立。`));
}
