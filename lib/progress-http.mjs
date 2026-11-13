import {GradeError} from './config.mjs';
import {requireSameOrigin} from './remote-access.mjs';

export async function handleProgressHistory(req,res,{requested,store,readBody,json}){
 const prefix='/api/progress/history';
 if(requested!==prefix&&!requested.startsWith(prefix+'/'))return false;
 const suffix=requested.slice(prefix.length);
 requireSameOrigin(req,{requireOrigin:req.method!=='GET'});
 if(req.method==='GET'&&suffix===''){
  const items=await store.history(),current=await store.read();
  json(res,200,{items,revision:current.revision});return true;
 }
 if(req.method==='GET'&&/^\/[A-Za-z0-9_-]+$/.test(suffix)){
  json(res,200,await store.getCheckpoint(suffix.slice(1)));return true;
 }
 if(req.method!=='POST')throw new GradeError('还原点仅支持读取、创建或恢复操作。',405);
 if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new GradeError('请使用 JSON 提交还原点操作。',415);
 const input=await readBody(req,4096);
 if(suffix===''){
  if(input.reason!==undefined&&input.reason!=='manual')throw new GradeError('只能手动创建还原点。');
  const item=await store.checkpoint({reason:'manual'}),current=await store.read();json(res,201,{item,revision:current.revision});return true;
 }
 const match=/^\/([A-Za-z0-9_-]+)\/restore$/.exec(suffix);
 if(!match)throw new GradeError('还原点地址无效。',404);
 json(res,200,await store.restoreCheckpoint({id:match[1],baseRevision:input.baseRevision}));return true;
}
