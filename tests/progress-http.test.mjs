import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {checkpointExport,summarizeProgress} from '../public/backup-manager.js';

test('还原点 HTTP 全流程：预览、下载兼容、版本冲突、恢复前备份与来源校验',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'study-history-http-'));
 const publicDir=path.join(dir,'public'),localConfigPath=path.join(dir,'ai-settings.json'),progressPath=path.join(dir,'study-progress.json');
 await mkdir(publicDir);await writeFile(localConfigPath,'{"apiKey":"synthetic-secret-never-in-history"}');
 const server=createApp({publicDir,localConfigPath,progressPath,publicOrigin:'',accessToken:''});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});await rm(dir,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const request=async(url,body,extra={})=>{const response=await fetch(origin+url,body===undefined?{}:{method:'POST',headers:{origin,'content-type':'application/json',...extra},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const first={lesson:{notes:'保留原笔记',completed:true,threads:{lesson:{messages:[{role:'user',content:'原来的问题'}]}}}};
 assert.equal((await request('/api/progress',{progress:first,baseRevision:0})).status,200);
 const created=await request('/api/progress/history',{reason:'manual'});assert.equal(created.status,201);
 const id=created.body.item.id;
 const preview=await request('/api/progress/history/'+id);assert.deepEqual(preview.body.progress,first);
 assert.ok(!JSON.stringify(preview.body).includes('synthetic-secret'));
 assert.deepEqual(checkpointExport(preview.body).progress,first);
 assert.equal((await request('/api/progress',{progress:{lesson:{notes:'更新的笔记'}},baseRevision:1})).status,200);
 const stale=await request('/api/progress/history/'+id+'/restore',{baseRevision:1});assert.equal(stale.status,409);assert.equal(stale.body.current.progress.lesson.notes,'更新的笔记');
 assert.equal((await request('/api/progress/history/'+id+'/restore',{})).status,400);
 assert.equal((await request('/api/progress/history',{}, {origin:'https://unrelated.example'})).status,403);
 assert.equal((await request('/api/progress/history',{reason:'auto'})).status,400);
 const restored=await request('/api/progress/history/'+id+'/restore',{baseRevision:2});assert.equal(restored.status,200);assert.equal(restored.body.revision,3);assert.deepEqual(restored.body.progress,first);
 const listing=await request('/api/progress/history');assert.equal(listing.body.revision,3);
 const previous=listing.body.items.find(item=>item.reason==='before-restore');assert.ok(previous);assert.equal((await request('/api/progress/history/'+previous.id)).body.progress.lesson.notes,'更新的笔记');
 assert.equal((await request('/api/progress/history/ai-settings')).status,400);
 assert.equal((await request('/api/progress/history/%2e%2e%2fai-settings.json')).status,403);
 assert.equal(await readFile(localConfigPath,'utf8'),'{"apiKey":"synthetic-secret-never-in-history"}');
});

test('预览和导出兼容两种原有进度结构，不把快照包装误当成课程',()=>{
 const fe={progress:{one:{completed:true,notes:'一',threads:{a:{messages:[{content:'问题'}]}}},two:{notes:''}},createdAt:'2026-11-14T00:00:00Z'};
 const jp={progress:{version:1,lessons:{one:{completed:true}},notes:{one:'笔记'},reviews:{word:{}},threads:{a:{messages:[]}},novels:{book:{position:2}}}};
 assert.equal(summarizeProgress(fe.progress).lessons,2);assert.equal(summarizeProgress(fe.progress).notes,1);
 assert.equal(checkpointExport(fe).version,1);assert.deepEqual(checkpointExport(jp),jp.progress);
 assert.equal(summarizeProgress({}).lessons,0);
});
