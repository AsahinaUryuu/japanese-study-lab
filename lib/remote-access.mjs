import {createHash,timingSafeEqual} from 'node:crypto';
import {GradeError} from './config.mjs';

export const STORED_KEY='__stored_on_server__';
const equal=(a,b)=>timingSafeEqual(createHash('sha256').update(String(a||'')).digest(),createHash('sha256').update(String(b||'')).digest());
export function createRemoteAccess({publicOrigin='',accessToken='',appId='study'}={}){
 let origin='',host='';
 if(publicOrigin){const u=new URL(publicOrigin);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('PUBLIC_ORIGIN must be an HTTPS origin');origin=u.origin;host=u.host;}
 if(accessToken&&(!/^[A-Za-z0-9_-]{32,160}$/.test(accessToken)||!origin))throw new Error('Remote access configuration is invalid');
 const cookie='study_'+appId.replace(/[^a-z0-9_]/gi,'')+'_access';
 function accept(req,res){
  const local=[`127.0.0.1:${req.socket.localPort}`,`localhost:${req.socket.localPort}`,`[::1]:${req.socket.localPort}`];
  if(req.headers.host!==host&&!local.includes(req.headers.host))throw new GradeError('请从已配置的学习网址访问。',403);
  req.studyOrigin=req.headers.host===host?origin:`http://${req.headers.host}`;
  if(!accessToken)return true;
  const u=new URL(req.url||'/',req.studyOrigin);
  if(req.method==='GET'&&u.pathname==='/'&&equal(u.searchParams.get('access'),accessToken)){
   res.writeHead(303,{'location':'/','set-cookie':`${cookie}=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=15552000`,'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();return false;
  }
  const saved=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookie+'='))?.slice(cookie.length+1);
  if(equal(saved,accessToken))return true;
  if(u.pathname==='/api/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end('{"ok":true}');return false;}
  const api=u.pathname.startsWith('/api/');
  res.writeHead(401,{'content-type':api?'application/json':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'});
  res.end(api?'{"error":"请使用你的个人直达链接打开学习软件。"}':'<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>打开学习软件</title><body style="font:18px/1.8 system-ui;background:#f6f8f2;padding:8vw;color:#244937"><h1>使用个人直达链接打开</h1><p>请打开为你生成的完整学习网址，无需输入密码。</p></body></html>');return false;
 }
 return {accept,remote:!!origin,origin};
}
export function requireSameOrigin(req,{requireOrigin=true}={}){
 const expected=req.studyOrigin||`http://${req.headers.host}`;
 if((requireOrigin&&req.headers.origin!==expected)||(req.headers.origin&&req.headers.origin!==expected)||
  (req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])))throw new GradeError('请求必须来自当前学习页面。',403);
}
export async function privateConfig(store,input,remote){
 let request=input;
 if(remote&&input?.action==='save'&&input.config?.apiKey===STORED_KEY){const previous=await store.execute({action:'read'});if(input.config.provider!==previous.config.provider||input.config.baseUrl!==previous.config.baseUrl||input.config.proxyUrl!==previous.config.proxyUrl)throw new GradeError('更换接口或代理地址时，请重新填写对应的 API Key。',409);request={...input,config:{...input.config,apiKey:previous.config.apiKey}};}
 const value=await store.execute(request);
 return remote?{...value,serverKey:!!value.config.apiKey,config:{...value.config,apiKey:value.config.apiKey?STORED_KEY:''}}:value;
}
export async function hydrateModelRequest(store,input,remote){
 if(remote&&input?.config?.apiKey===STORED_KEY){
  const previous=await store.execute({action:'read'});
  // A stored credential is bound to its saved destination; never send it to a caller-selected URL.
  if(input.config.provider!==previous.config.provider||input.config.baseUrl!==previous.config.baseUrl)throw new GradeError('接口地址已改变，请先保存配置再使用。',409);
  return {...input,config:{...input.config,apiKey:previous.config.apiKey,proxyUrl:previous.config.proxyUrl}};
 }
 return input;
}
