import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteAccess,requireSameOrigin,privateConfig,hydrateModelRequest,STORED_KEY} from '../lib/remote-access.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createApp} from '../server.mjs';
import {createLocalConfigStore} from '../lib/local-config.mjs';
const token='test_only_access_token_12345678901234567890',origin='https://study.example.test';
function request({host='study.example.test',url='/',cookie,method='GET',headers={}}={}){return {method,url,headers:{host,...(cookie?{cookie}:{}),...headers},socket:{localPort:4318}};}
function result(){return {status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers;},end(value=''){this.body=value;}};}
test('explicit HTTPS origin rejects insecure, path-bearing and deceptive host configurations',()=>{
 for(const publicOrigin of ['http://study.example.test','https://user:password@study.example.test','https://study.example.test/path','https://study.example.test/?query=1'])assert.throws(()=>createRemoteAccess({publicOrigin,accessToken:token}));
 const access=createRemoteAccess({publicOrigin:origin,accessToken:token});assert.throws(()=>access.accept(request({host:'study.example.test.evil.test'}),result()),/网址/);assert.throws(()=>access.accept(request({host:'other.test'}),result()),/网址/);
 const req=request({cookie:'study_study_access='+token});assert.equal(access.accept(req,result()),true);assert.equal(req.studyOrigin,origin);
});
test('one-time entry URL sets HttpOnly Secure same-site cookie and redirects without token; unauthenticated private API is blocked',()=>{
 const access=createRemoteAccess({publicOrigin:origin,accessToken:token,appId:'frontend'}),res=result();assert.equal(access.accept(request({url:'/?access='+token}),res),false);assert.equal(res.status,303);assert.equal(res.headers.location,'/');assert.match(res.headers['set-cookie'],/HttpOnly; Secure; SameSite=Strict; Path=\//);assert.equal(res.headers['cache-control'],'no-store');assert.equal(res.headers['referrer-policy'],'no-referrer');assert.ok(!res.body.includes(token));
 for(const url of ['/api/local-config','/api/progress','/data/frameworks.json']){const blocked=result();assert.equal(access.accept(request({url}),blocked),false);assert.equal(blocked.status,401);assert.ok(!blocked.body.includes(token));}
 const req=request({cookie:'study_frontend_access='+token});assert.equal(access.accept(req,result()),true);
});
test('cross-origin and cross-site writes remain rejected even with a valid access cookie',()=>{
 const req=request({headers:{origin},cookie:'study_study_access='+token});createRemoteAccess({publicOrigin:origin,accessToken:token}).accept(req,result());assert.doesNotThrow(()=>requireSameOrigin(req));
 assert.throws(()=>requireSameOrigin({...req,headers:{...req.headers,origin:'https://evil.example'}}),/当前学习/);
 assert.throws(()=>requireSameOrigin({...req,headers:{...req.headers,origin:undefined}}),/当前学习/);
 assert.throws(()=>requireSameOrigin({...req,headers:{...req.headers,'sec-fetch-site':'cross-site'}}),/当前学习/);
});
function configStore(){let config={provider:'openai',baseUrl:'https://api.example.test/v1',model:'test-model',apiKey:'test-only-private-key-not-real',proxyUrl:'http://127.0.0.1:7897'};return {get config(){return config;},async execute(input){if(input.action==='save')config={...input.config};if(input.action==='clear-key')config={...config,apiKey:''};return {saved:true,config:{...config}};}};}
test('remote config never returns real key while hydrated requests remain bound to stored endpoint and proxy',async()=>{
 const store=configStore(),secret=store.config.apiKey,visible=await privateConfig(store,{action:'read'},true);assert.equal(visible.config.apiKey,STORED_KEY);assert.equal(visible.serverKey,true);assert.ok(!JSON.stringify(visible).includes(secret));
 const request={config:{...visible.config,proxyUrl:'http://attacker.example:8080'}};const hydrated=await hydrateModelRequest(store,request,true);assert.equal(hydrated.config.apiKey,secret);assert.equal(hydrated.config.proxyUrl,store.config.proxyUrl);assert.equal(request.config.apiKey,STORED_KEY);
 for(const changed of [{baseUrl:'https://attacker.example/v1'},{provider:'gemini'}])await assert.rejects(hydrateModelRequest(store,{config:{...visible.config,...changed}},true),/地址/);
 const cleared=await privateConfig(store,{action:'clear-key'},true);assert.equal(cleared.config.apiKey,'');assert.equal(cleared.serverKey,false);
});
test('saving stored-key marker cannot move an existing secret to another destination',async()=>{
 for(const changed of [{baseUrl:'https://attacker.example/v1'},{provider:'gemini'},{proxyUrl:'http://attacker.example:8080'}]){
  const store=configStore(),before={...store.config};await assert.rejects(privateConfig(store,{action:'save',config:{...before,apiKey:STORED_KEY,...changed}},true));assert.deepEqual(store.config,before);
 }
 const store=configStore(),before={...store.config},saved=await privateConfig(store,{action:'save',config:{...before,apiKey:STORED_KEY,model:'another-model'}},true);assert.equal(store.config.apiKey,before.apiKey);assert.equal(saved.config.apiKey,STORED_KEY);assert.equal(saved.config.model,'another-model');
});
test('actual HTTP middleware authenticates before config/progress handlers and masks credentials after login',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'study-remote-access-')),publicDir=path.join(dir,'public'),localConfigPath=path.join(dir,'config.json');
 await mkdir(publicDir);await writeFile(path.join(publicDir,'index.html'),'study app');
 const store=createLocalConfigStore(localConfigPath),config={provider:'openai',baseUrl:'https://api.example.test/v1',model:'test-model',proxyUrl:'',apiKey:'test-only-http-secret-not-real'};await store.execute({action:'save',config});
 const server=createApp({publicDir,localConfigPath,progressPath:path.join(dir,'progress.json'),publicOrigin:origin,accessToken:token});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const call=(url,options={})=>new Promise((resolve,reject)=>{const req=http.request(url,{method:options.method||'GET',headers:options.headers},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:{get:name=>Array.isArray(res.headers[name])?res.headers[name].join(', '):res.headers[name]},text:async()=>body,json:async()=>JSON.parse(body)}));});req.on('error',reject);req.end(options.body);});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const headers={host:'study.example.test',origin,'content-type':'application/json'};
 const denied=await call(base+'/api/local-config',{method:'POST',headers,body:JSON.stringify({action:'read'})});assert.equal(denied.status,401);assert.ok(!(await denied.text()).includes(config.apiKey));
 const login=await call(base+'/?access='+token,{headers:{host:'study.example.test'},redirect:'manual'});assert.equal(login.status,303);assert.equal(login.headers.get('location'),'/');const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly; Secure/);
 const read=await call(base+'/api/local-config',{method:'POST',headers:{...headers,cookie},body:JSON.stringify({action:'read'})});const value=await read.json();assert.equal(read.status,200,JSON.stringify(value));assert.equal(value.config.apiKey,STORED_KEY);assert.ok(!JSON.stringify(value).includes(config.apiKey));
 const cross=await call(base+'/api/local-config',{method:'POST',headers:{...headers,cookie,origin:'https://evil.example'},body:JSON.stringify({action:'read'})});assert.equal(cross.status,403);
 const progress=await call(base+'/api/progress',{headers:{host:'study.example.test'}});assert.equal(progress.status,401);
});
