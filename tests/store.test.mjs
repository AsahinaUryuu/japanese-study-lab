import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../public/store.js';
import {newProgress} from '../public/learning-core.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),map};};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function setup(t){
 const previous=new Map(['localStorage','sessionStorage','document','window','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const local=storage(),session=storage(),stores=[],events={addEventListener(){},removeEventListener(){}};let saved={progress:newProgress(),revision:0,savedAt:null},interceptor=null;
 Object.assign(globalThis,{localStorage:local,sessionStorage:session,document:events,window:events});
 globalThis.fetch=async(url,options={})=>{
  if(interceptor){const result=interceptor(url,options);if(result)return result;}
  if(options.method==='POST'){const value=JSON.parse(options.body);if(value.baseRevision!==saved.revision)return response({error:'conflict',current:saved},409);saved={progress:value.progress,revision:saved.revision+1,savedAt:Date.now()};}
  return response(saved);
 };
 t.after(()=>{stores.forEach(s=>s.dispose());for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 return {local,session,async create(){const s=await createStore();stores.push(s);return s;},get saved(){return saved;},set saved(value){saved=value;},set intercept(value){interceptor=value;}};
}
test('未提交草稿在刷新时恢复，已提交同内容不会再次产生冲突',async t=>{
 const f=setup(t),draft=newProgress();draft.notes.x='尚未写入的笔记';
 f.local.setItem('kotoba-study-v1',JSON.stringify({progress:draft,revision:0,dirty:true}));
 const store=await f.create();assert.equal(store.data.notes.x,draft.notes.x);assert.equal(await store.flush(),true);assert.equal(f.saved.progress.notes.x,draft.notes.x);
 store.dispose();const next=await f.create();assert.equal(next.conflict,false);assert.equal(next.revision,1);
});
test('409 保留本页全部记录且停止自动覆盖服务端',async t=>{
 const f=setup(t),store=await f.create();store.data.notes.mine='本页';store.save();f.saved={progress:{...newProgress(),notes:{theirs:'另一页'}},revision:1};
 assert.equal(await store.flush(),false);assert.equal(store.conflict,true);assert.equal(store.data.notes.mine,'本页');assert.equal(f.saved.progress.notes.theirs,'另一页');
 const copy=JSON.parse(f.local.getItem('kotoba-study-v1'));assert.equal(copy.dirty,true);assert.equal(copy.progress.notes.mine,'本页');
});
test('刷新前 keepalive 已落盘且字段顺序不同，不误判成其他标签冲突',async t=>{
 const f=setup(t),draft=newProgress();draft.activeExam={questions:[{id:'q1',type:'choice',answer:1}],answers:{q1:1,q2:'ください'},endsAt:12345};draft.lessons.a={drafts:{},answers:{b:0,a:'内容'},reviews:[]};
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;
 f.local.setItem('kotoba-study-v1',JSON.stringify({progress:draft,revision:2,dirty:true}));f.saved={progress:reorder(draft),revision:3};
 const s=await f.create();assert.equal(s.conflict,false);assert.equal(s.revision,3);assert.deepEqual(s.data.activeExam.answers,draft.activeExam.answers);assert.equal(await s.flush(),true);assert.equal(f.saved.revision,3);
});
test('不同标签的恢复副本互不覆盖',async t=>{
 const f=setup(t);f.session.setItem('kotoba-study-v1-tab','tab-a');const a=await f.create();a.data.notes.a='A 的未同步内容';a.save();
 f.session.setItem('kotoba-study-v1-tab','tab-b');const b=await f.create();b.data.notes.a='B 的版本';b.save();await b.flush();
 f.session.setItem('kotoba-study-v1-tab','tab-a');const restored=await f.create();assert.equal(restored.data.notes.a,'A 的未同步内容');assert.equal(restored.conflict,true);
});
test('保存中继续编辑仍会用新版本保存后续草稿',async t=>{
 const f=setup(t),s=await f.create(),gate=deferred();let captured;
 f.intercept=(url,o)=>{if(o.method==='POST'){captured=JSON.parse(o.body);return gate.promise;}};
 s.data.notes.a='第一次';s.save();const saving=s.flush();s.data.notes.a='第二次';s.save();
 gate.resolve(response({revision:1}));await saving;assert.equal(captured.progress.notes.a,'第一次');assert.equal(s.data.notes.a,'第二次');
 f.intercept=null;f.saved={progress:captured.progress,revision:1};await s.flush();assert.equal(f.saved.progress.notes.a,'第二次');assert.equal(s.revision,2);
});
test('前一笔已落盘但回执未到，刷新恢复后一笔单选答案并安全续存',async t=>{
 const f=setup(t),s=await f.create(),gate=deferred();let first;
 f.intercept=(url,o)=>{if(o.method==='POST'){first=JSON.parse(o.body);f.saved={progress:first.progress,revision:1};return gate.promise;}};
 s.data.activeExam={questions:[],answers:{fill:'が'},endsAt:12345};s.save();const saving=s.flush();
 s.data.activeExam.answers.choice=3;s.save();const recovery=f.local.getItem('kotoba-study-v1'),slot='kotoba-study-v1:tab:'+f.session.getItem('kotoba-study-v1-tab');
 s.dispose();gate.resolve(response({revision:1}));await saving;
 // Simulate the browser dying before the original POST response was processed.
 f.local.setItem(slot,recovery);f.local.setItem('kotoba-study-v1',recovery);f.intercept=null;
 const restored=await f.create();assert.equal(restored.conflict,false);assert.equal(restored.revision,1);assert.deepEqual(restored.data.activeExam.answers,{fill:'が',choice:3});assert.equal(Object.hasOwn(restored.data,'_sync'),false);
 assert.equal(await restored.flush(),true);assert.equal(f.saved.revision,2);assert.equal(f.saved.progress.activeExam.answers.choice,3);
});
test('旧写入在恢复GET之后才落盘，409 可精确识别回执并重试新草稿',async t=>{
 const f=setup(t),old=newProgress(),latest=newProgress(),receipt={clientId:'a',writeId:'old-write',baseRevision:0};old.notes.x='旧稿';latest.notes.x='新稿';
 f.session.setItem('kotoba-study-v1-tab','a');f.local.setItem('kotoba-study-v1:tab:a',JSON.stringify({progress:latest,revision:0,dirty:true,clientId:'a',pendingWrites:[receipt]}));
 const s=await f.create();f.saved={progress:{...old,_sync:receipt},revision:1};assert.equal(await s.flush(),true);assert.equal(s.conflict,false);assert.equal(f.saved.revision,2);assert.equal(f.saved.progress.notes.x,'新稿');
});
test('只有客户端相同而writeId不同，仍视为真正冲突且不覆盖',async t=>{
 const f=setup(t),draft=newProgress(),receipt={clientId:'a',writeId:'my-write',baseRevision:0};draft.notes.x='待恢复草稿';
 f.session.setItem('kotoba-study-v1-tab','a');f.local.setItem('kotoba-study-v1:tab:a',JSON.stringify({progress:draft,revision:0,dirty:true,clientId:'a',pendingWrites:[receipt]}));
 f.saved={progress:{...newProgress(),notes:{x:'另一次写入'},_sync:{...receipt,writeId:'different-write'}},revision:1};
 const s=await f.create();assert.equal(s.conflict,true);assert.equal(await s.flush(),false);assert.equal(s.data.notes.x,'待恢复草稿');assert.equal(f.saved.progress.notes.x,'另一次写入');
});
test('回执匹配但版本已被继续更新，禁止冒认成自己的一笔保存',async t=>{
 const f=setup(t),draft=newProgress(),receipt={clientId:'a',writeId:'my-write',baseRevision:0};draft.notes.x='本页';
 f.session.setItem('kotoba-study-v1-tab','a');f.local.setItem('kotoba-study-v1:tab:a',JSON.stringify({progress:draft,revision:0,dirty:true,clientId:'a',pendingWrites:[receipt]}));
 f.saved={progress:{...newProgress(),notes:{x:'后续版本'},_sync:receipt},revision:2};const s=await f.create();assert.equal(s.conflict,true);
});
test('导入文件保存失败会报告失败并保留浏览器恢复副本',async t=>{
 const f=setup(t),s=await f.create(),next=newProgress();next.notes.imported='导入内容';f.intercept=(url,o)=>o.method==='POST'?response({error:'磁盘暂不可写'},500):null;
 await assert.rejects(s.replace(next),/写入本地文件失败/);assert.equal(s.data.notes.imported,'导入内容');assert.equal(JSON.parse(f.local.getItem('kotoba-study-v1')).dirty,true);
});
test('导入读取版本期间发生新编辑时不丢弃用户内容',async t=>{
 const f=setup(t),s=await f.create(),gate=deferred();f.intercept=(url,o)=>!o.method?gate.promise:null;
 const replacement=s.replace(newProgress());s.data.notes.live='读取时仍在编辑';s.save();gate.resolve(response(f.saved));
 await assert.rejects(replacement,/新的学习记录/);assert.equal(s.data.notes.live,'读取时仍在编辑');
});
test('载入服务端版本解除冲突，并清除恢复副本脏标记',async t=>{
 const f=setup(t),s=await f.create();s.data.notes.x='本页';s.save();f.saved={progress:{...newProgress(),notes:{x:'已备份后选择远端'}},revision:2};await s.flush();
 await s.reloadSaved();assert.equal(s.conflict,false);assert.equal(s.revision,2);assert.equal(s.data.notes.x,'已备份后选择远端');assert.equal(JSON.parse(f.local.getItem('kotoba-study-v1')).dirty,false);
});
