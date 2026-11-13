import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp,parseRange} from '../server.mjs';
import {createProgressStore} from '../lib/progress.mjs';

async function fixture(t,{fetchImpl}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'kotoba-server-')),publicDir=path.join(root,'public'),libraryRoot=path.join(root,'library'),privateRoot=path.join(root,'private');
  await mkdir(path.join(publicDir,'data'),{recursive:true});await mkdir(libraryRoot);
  await writeFile(path.join(publicDir,'index.html'),'<h1>言葉</h1>');
  await writeFile(path.join(publicDir,'data','grammar-test.json'),JSON.stringify([{id:'g-n5-test',title:'助词',level:'N5',sections:[{heading:'教学',body:['说明']}],quiz:[],translation:[],speaking:[]}]));
  await writeFile(path.join(publicDir,'data','vocabulary.json'),JSON.stringify([{id:'v1',word:'私',reading:'わたし',meaning:'我'}]));
  await writeFile(path.join(libraryRoot,'sample.pdf'),Buffer.from('0123456789'));
  await writeFile(path.join(root,'outside.pdf'),'do not read');
  await writeFile(path.join(publicDir,'data','resources.json'),JSON.stringify([{id:'pdf-one',title:'资料',relativePath:'sample.pdf'},{id:'bad-file',relativePath:'../outside.pdf'}]));
  const server=createApp({publicDir,libraryRoot,localConfigPath:path.join(privateRoot,'ai-settings.json'),progressPath:path.join(privateRoot,'study-progress.json'),fetchImpl});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  const post=(url,value,headers={})=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json',origin:base,...headers},body:JSON.stringify(value)});
  return {root,publicDir,privateRoot,base,post};
}
test('独立服务标识、课程目录与静态文件不混入词表',async t=>{
  const f=await fixture(t);
  assert.equal((await (await fetch(f.base+'/api/health')).json()).service,'japanese-academy');
  const catalog=await (await fetch(f.base+'/api/catalog')).json();assert.equal(catalog.lessons.length,1);assert.deepEqual(catalog.stats.byLevel,{N5:1});
  await writeFile(path.join(f.publicDir,'data','business.json'),JSON.stringify([{id:'business-test',title:'商务',level:'N2',sections:[]} ]));
  assert.equal((await (await fetch(f.base+'/api/catalog')).json()).lessons.length,2);
  const staticPage=await fetch(f.base);assert.equal(await staticPage.text(),'<h1>言葉</h1>');assert.equal(staticPage.headers.get('cache-control'),'no-cache');
  assert.equal((await fetch(f.base,{method:'HEAD'})).status,200);
});
test('本地资料 Range、后缀与 HEAD 正常，越界和目录逃逸被拒绝',async t=>{
  const f=await fixture(t);
  assert.equal((await (await fetch(f.base+'/api/library')).json()).resources.length,2);
  const range=await fetch(f.base+'/api/resource/pdf-one',{headers:{range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 2-5/10');assert.equal(await range.text(),'2345');
  assert.equal(await (await fetch(f.base+'/api/resource/pdf-one',{headers:{range:'bytes=-3'}})).text(),'789');
  const head=await fetch(f.base+'/api/resource/pdf-one',{method:'HEAD'});assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
  assert.equal((await fetch(f.base+'/api/resource/pdf-one',{headers:{range:'bytes=20-30'}})).status,416);
  assert.equal((await fetch(f.base+'/api/resource/bad-file')).status,403);
  assert.equal((await fetch(f.base+'/api/resource/unknown')).status,404);
});
test('密钥仅独立私有 JSON 持久化，跨站和非 JSON 修改拒绝',async t=>{
  const f=await fixture(t),config={provider:'openai',baseUrl:'http://127.0.0.1:11434/v1',model:'test',proxyUrl:'',apiKey:'test-only-not-real'};
  assert.equal((await f.post('/api/local-config',{action:'read'})).status,200);
  assert.equal((await f.post('/api/local-config',{action:'save',config})).status,200);
  const saved=await (await f.post('/api/local-config',{action:'read'})).json();assert.equal(saved.saved,true);assert.equal(saved.config.model,'test');
  assert.equal(JSON.parse(await readFile(path.join(f.privateRoot,'ai-settings.json'),'utf8')).config.apiKey,'test-only-not-real');
  assert.equal((await fetch(f.base+'/local-config/ai-settings.json')).status,404);
  assert.equal((await f.post('/api/local-config',{action:'read'},{origin:'https://outside.test'})).status,403);
  assert.equal((await f.post('/api/local-config',{action:'read'},{'content-type':'text/plain'})).status,415);
  assert.equal((await fetch(f.base+'/api/local-config')).status,405);
  const cleared=await (await f.post('/api/local-config',{action:'clear-key'})).json();assert.equal(cleared.config.apiKey,'');assert.equal(cleared.config.model,'test');
});
test('学习记录原子保存与多页面版本冲突保留最新内容',async t=>{
  const f=await fixture(t);const empty=await (await fetch(f.base+'/api/progress')).json();assert.equal(empty.revision,0);
  const first=await (await f.post('/api/progress',{progress:{lessons:{one:{done:true}}},baseRevision:0})).json();assert.equal(first.revision,1);
  const stale=await f.post('/api/progress',{progress:{lessons:{}},baseRevision:0});assert.equal(stale.status,409);assert.equal((await stale.json()).current.progress.lessons.one.done,true);
  const actual=await (await fetch(f.base+'/api/progress')).json();assert.deepEqual(actual,first);
  assert.equal((await fetch(f.base+'/api/progress',{headers:{origin:'https://outside.test'}})).status,403);
  assert.equal((await f.post('/api/progress',{progress:[]})).status,400);
});
test('损坏的旧学习记录不被新保存静默覆盖',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kotoba-progress-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'progress.json');await writeFile(file,'{broken');const store=createProgressStore(file);
  await assert.rejects(store.save({progress:{new:true}}),/现有文件未被清空/);assert.equal(await readFile(file,'utf8'),'{broken');
});
test('模型发现与助教使用模拟服务，不泄露接口配置到提示词',async t=>{
  const calls=[];const f=await fixture(t,{fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(options.method==='GET'?{data:[{id:'mock-model'}]}:{choices:[{message:{content:'教学回复'}}]}),{status:200,headers:{'content-type':'application/json'}});}});
  const config={provider:'openai',baseUrl:'http://127.0.0.1:11434/v1',model:'mock-model',apiKey:'test-key',proxyUrl:''};
  assert.equal((await (await f.post('/api/models',{config})).json()).models[0].id,'mock-model');
  const answer=await (await f.post('/api/coach',{config,lessonId:'g-n5-test',mode:'translation',contextId:'g-n5-test:translation:first',question:'请评价',submission:'私は学生です。',context:{lessonId:'g-n5-test',prompt:'我是学生。'}})).json();
  assert.equal(answer.reply,'教学回复');assert.equal(answer.contextId,'g-n5-test:translation:first');
  assert.ok(calls[1].options.body.includes('助词'));assert.ok(!calls[1].options.body.includes('test-key'));
  assert.equal((await f.post('/api/coach',{config,lessonId:'no-such',mode:'chat',question:'你好'})).status,404);
  assert.equal((await f.post('/api/coach',{config,lessonId:'g-n5-test',mode:'chat',question:'你好',context:{lessonId:'other'}})).status,400);
  assert.equal((await (await f.post('/api/coach',{config,lessonId:'general',mode:'chat',question:'解释这个词'})).json()).lessonId,'general');
});
test('绑定主机和静态路径边界拒绝外部来源或非法编码',async t=>{
  const f=await fixture(t);
  const wrongHost=await new Promise((resolve,reject)=>{const request=http.get(f.base+'/api/health',{headers:{host:'outside.test'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
  assert.equal(wrongHost,403);
  assert.equal((await fetch(f.base+'/%ZZ')).status,400);
  assert.equal((await fetch(f.base+'/%2eprivate.json')).status,403);
  assert.equal((await fetch(f.base+'/..%5Cprivate%5Cai-settings.json')).status,403);
});
test('Range 解析拒绝多区间与无效数字',()=>{
  assert.deepEqual(parseRange('bytes=0-',10),{start:0,end:9});assert.deepEqual(parseRange('bytes=-999',10),{start:0,end:9});
  for(const value of ['bytes=0-1,3-4','bytes=-0','bytes=9-2','items=0-2','bytes=-','bytes=99999999999999999999-'])assert.throws(()=>parseRange(value,10));
});
