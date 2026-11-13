import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNovelStore} from '../lib/novel-store.mjs';
import {createApp} from '../server.mjs';
const upload={filename:'星の約束.txt',contentBase64:Buffer.from('第一章 空を見た日\n夜、窓を開けました。\n第二章 新しい朝\n友だちが来ました。').toString('base64'),linkedId:'rezero'};
test('novel store persists independent files, deduplicates imports and survives process recreation',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'jp-novel-store-'));t.after(()=>rm(root,{recursive:true,force:true}));const dir=path.join(root,'novels'),store=createNovelStore(dir);
 assert.deepEqual(await store.list(),{books:[]});const a=await store.importBook(upload);assert.equal(a.duplicate,false);assert.equal(a.book.chapters.length,2);
 const b=await store.importBook(upload);assert.equal(b.duplicate,true);assert.deepEqual(b.book,a.book);
 const restarted=createNovelStore(dir);assert.deepEqual((await restarted.list()).books,[a.book]);const c=await restarted.get(a.book.id,a.book.chapters[1].id);assert.equal(c.chapter.paragraphs[0].ja,'友だちが来ました。');
 await unlink(path.join(dir,a.book.id+'.meta.json'));assert.equal((await restarted.importBook(upload)).duplicate,true);assert.equal((await restarted.list()).books.length,1);
 await assert.rejects(restarted.get('../outside','bad'),/编号/);
 await writeFile(path.join(dir,a.book.id+'.json'),'{broken');await assert.rejects(restarted.importBook(upload),/未覆盖/);assert.equal(await readFile(path.join(dir,a.book.id+'.json'),'utf8'),'{broken');
});
test('simultaneous imports serialize and do not create duplicate book entries',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'jp-novel-race-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=createNovelStore(root);const results=await Promise.all([store.importBook(upload),store.importBook(upload),store.importBook(upload)]);assert.equal(results.filter(r=>!r.duplicate).length,1);assert.equal((await store.list()).books.length,1);
});
test('novel HTTP APIs protect origins, persist local files and return only one requested chapter',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'jp-novel-http-')),publicDir=path.join(root,'public');await mkdir(path.join(publicDir,'data'),{recursive:true});await writeFile(path.join(publicDir,'index.html'),'ok');const server=createApp({publicDir,progressPath:path.join(root,'private','study-progress.json'),localConfigPath:path.join(root,'private','ai-settings.json')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
 const post=(body,headers={})=>fetch(base+'/api/novels/import',{method:'POST',headers:{origin:base,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post(upload,{origin:'https://outside.test'})).status,403);assert.equal((await post(upload,{'content-type':'text/plain'})).status,415);assert.equal((await fetch(base+'/api/novels/import')).status,405);
 const imported=await post(upload);assert.equal(imported.status,200);const {book}=await imported.json();assert.equal((await (await fetch(base+'/api/novels')).json()).books.length,1);
 const response=await fetch(base+`/api/novels/${book.id}/chapters/${book.chapters[0].id}`);assert.equal(response.status,200);const value=await response.json();assert.equal(value.chapter.paragraphs[0].ja,'夜、窓を開けました。');assert.ok(!JSON.stringify(value).includes('友だちが来ました'));
 assert.equal((await fetch(base+`/api/novels/${book.id}/chapters/${book.chapters[0].id}`,{headers:{origin:'https://outside.test'}})).status,403);
 assert.equal((await fetch(base+'/api/novels',{headers:{origin:'https://outside.test'}})).status,403);
 assert.equal((await fetch(base+'/api/novels/not-a-book/chapters/nope')).status,400);
 assert.equal((await fetch(base+'/local-config/novels/'+book.id+'.json')).status,404);
 assert.equal((await (await fetch(base+'/api/progress')).json()).revision,0);
});
