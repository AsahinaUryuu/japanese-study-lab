import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installBackupManager} from '../public/backup-manager.js';

function harness(t,prepare){
 const originals=new Map(['document','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const fields=new Map(),listeners={},requests=[];
 const field=key=>{if(!fields.has(key))fields.set(key,{disabled:false,checked:false,hidden:false,textContent:'',innerHTML:'',classList:{toggle(){}},scrollIntoView(){}});return fields.get(key);};
 const dialog={open:false,setAttribute(){},querySelector:field,querySelectorAll:()=>[],addEventListener:(name,handler)=>listeners[name]=handler,showModal(){this.open=true;},close(){this.open=false;},remove(){}};
 globalThis.document={createElement:()=>dialog,body:{append(){}},querySelector:()=>null,addEventListener(){},removeEventListener(){}};
 globalThis.fetch=async(url,options={})=>{requests.push({url,options});return new Response(JSON.stringify(url.endsWith('/restore')?{revision:4}:/\/point$/.test(url)?{id:'point',createdAt:'2026-01-01T00:00:00Z',reason:'manual',progress:{version:1,lessons:{},notes:{},threads:{},words:{}}}:{revision:3,items:[]}));};
 let restored=0;const manager=installBackupManager({prepare,onRestored:async()=>{restored++;}});t.after(()=>{manager.destroy();for(const [key,value] of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
 const click=attrs=>listeners.click({target:{closest(){return {disabled:false,dataset:attrs.preview?{backupPreview:'point'}:{},hasAttribute:name=>attrs[name]===true};}}});
 return {manager,requests,field,click,get restored(){return restored;}};
}
test('successful prepare with undefined return can create a checkpoint',async t=>{
 const h=harness(t,async()=>{});await h.manager.checkpoint();assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.method,'POST');
});
test('explicit false or a busy-guard error does not create any checkpoint request',async t=>{
 let busy=false;const h=harness(t,async()=>{if(busy)throw new Error('等待AI结束');return false;});await assert.rejects(h.manager.checkpoint(),/同步/);busy=true;await assert.rejects(h.manager.checkpoint(),/等待AI/);assert.equal(h.requests.length,0);
});
test('restoring checks prepare again and blocks a newly busy AI before any restore POST',async t=>{
 let busy=false;const h=harness(t,async()=>{if(busy)throw new Error('等待AI结束');return true;});await h.manager.open();await h.click({preview:true});h.field('[data-backup-ack]').checked=true;busy=true;
 await h.click({'data-backup-confirm':true});assert.equal(h.requests.filter(r=>r.url.endsWith('/restore')).length,0);assert.equal(h.restored,0);assert.match(h.field('.backup-status').textContent,/等待AI/);
});
test('confirmed restore with no pending work refreshes the active client',async t=>{
 const h=harness(t,async()=>true);await h.manager.open();await h.click({preview:true});h.field('[data-backup-ack]').checked=true;await h.click({'data-backup-confirm':true});
 assert.equal(h.requests.filter(r=>r.url.endsWith('/restore')).length,1);assert.equal(h.restored,1);
});
test('Japanese app guards AI and media and checks the full synchronization state',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const prepare=app.slice(app.indexOf('backupManager=installBackupManager('));
 assert.match(prepare,/state\.busy\.size\|\|tutor\?\.isBusy\(\)/);assert.match(prepare,/mediaInputActive\(\)/);
 assert.ok(prepare.indexOf('state.busy.size')<prepare.indexOf('await store.flush()'));
 assert.match(prepare,/current\.ready&&!current\.dirty&&!current\.conflict&&!current\.saving/);
 assert.match(prepare,/onRestored:async\(\)=>\{cleanupMedia\(\);await store\.reloadSaved\(\)/);
});
