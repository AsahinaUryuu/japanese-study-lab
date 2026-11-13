import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm,symlink,lstat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProgressStore,MAX_HISTORY_FILES,MAX_HISTORY_BYTES,AUTO_CHECKPOINT_INTERVAL_MS} from '../lib/progress.mjs';

async function fixture(t){
  const prefix=path.join(os.tmpdir(),'study-progress-history-'),root=await mkdtemp(prefix);
  assert.ok(path.resolve(root).startsWith(path.resolve(prefix)));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let timestamp=1_780_000_000_000;
  const file=path.join(root,'local-config','study-progress.json'),historyDir=path.join(path.dirname(file),'progress-history');
  const make=()=>createProgressStore(file,{now:()=>timestamp});
  return {root,file,historyDir,store:make(),make,advance:milliseconds=>{timestamp+=milliseconds;}};
}

test('history API stays empty without creating files; manual checkpoints contain progress only',async t=>{
  const f=await fixture(t);
  assert.deepEqual(await f.store.history(),[]);
  assert.deepEqual(await readdir(f.root),[]);
  await f.store.save({progress:{lesson:{notes:'需要保留的笔记'}},baseRevision:0});
  const secretFile=path.join(path.dirname(f.file),'ai-settings.json');
  await writeFile(secretFile,JSON.stringify({apiKey:'PRIVATE_SENTINEL_MUST_NOT_ENTER_HISTORY'}));
  const item=await f.store.checkpoint();
  assert.equal(item.reason,'manual');assert.equal(item.sourceRevision,1);assert.ok(item.bytes>0);
  assert.deepEqual(Object.keys(item).sort(),['bytes','createdAt','id','reason','sourceRevision']);
  const selected=await f.store.getCheckpoint(item.id);
  assert.deepEqual(selected.progress,{lesson:{notes:'需要保留的笔记'}});
  assert.equal(selected.sourceRevision,1);assert.equal(selected.reason,'manual');
  assert.deepEqual(await f.store.history(),[item]);
  const contents=await readFile(path.join(f.historyDir,item.id+'.json'),'utf8');
  assert.equal(contents.includes('PRIVATE_SENTINEL'),false);
  assert.equal((await readFile(secretFile,'utf8')).includes('PRIVATE_SENTINEL'),true);
  const fileInfo=await lstat(path.join(f.historyDir,item.id+'.json'));
  if(process.platform!=='win32')assert.equal(fileInfo.mode&0o777,0o600);
});

test('automatic history preserves old revisions at most once every 15 minutes across store restart',async t=>{
  const f=await fixture(t);let revision=0;
  const save=async value=>{revision=(await f.store.save({progress:{value},baseRevision:revision})).revision;};
  await save('first');assert.equal((await f.store.history()).length,0);
  await save('second');let history=await f.store.history();
  assert.equal(history.length,1);assert.equal(history[0].reason,'auto');
  assert.equal((await f.store.getCheckpoint(history[0].id)).progress.value,'first');
  await save('third');f.advance(AUTO_CHECKPOINT_INTERVAL_MS-1);f.store=f.make();await save('fourth');
  assert.equal((await f.store.history()).length,1);
  f.advance(1);await save('fifth');history=await f.store.history();
  assert.equal(history.length,2);assert.equal(history[0].sourceRevision,4);
  assert.equal((await f.store.getCheckpoint(history[0].id)).progress.value,'fourth');
});

test('existing migrated records with revision zero are backed up before the first new save',async t=>{
  const f=await fixture(t);await mkdir(path.dirname(f.file),{recursive:true});
  await writeFile(f.file,JSON.stringify({version:1,progress:{notes:'迁移过来的旧记录'},revision:0,savedAt:null}));
  await f.store.save({progress:{notes:'新记录'},baseRevision:0});
  const history=await f.store.history();assert.equal(history.length,1);assert.equal(history[0].sourceRevision,0);
  assert.equal((await f.store.getCheckpoint(history[0].id)).progress.notes,'迁移过来的旧记录');
});

test('concurrent CAS saves serialize, and rejected versions never create a checkpoint',async t=>{
  const f=await fixture(t);await f.store.save({progress:{value:'base'},baseRevision:0});
  const results=await Promise.allSettled(['A','B'].map(value=>f.store.save({progress:{value},baseRevision:1})));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const conflict=results.find(result=>result.status==='rejected').reason;
  assert.equal(conflict.status,409);assert.equal(conflict.current.revision,2);
  assert.equal((await f.store.history()).length,1);
  const snapshot=(await f.store.history())[0];
  await assert.rejects(f.store.restoreCheckpoint({id:snapshot.id,baseRevision:1}),error=>error.status===409);
  await assert.rejects(f.store.restoreCheckpoint({id:snapshot.id}),/必须提供/);
  assert.equal((await f.store.history()).length,1);assert.equal((await f.store.read()).revision,2);
});

test('restore keeps revisions increasing and makes a mandatory undo checkpoint of the current state',async t=>{
  const f=await fixture(t);
  await f.store.save({progress:{draft:'原来的完整草稿'},baseRevision:0});const original=await f.store.checkpoint();
  await f.store.save({progress:{draft:'后来改写的草稿'},baseRevision:1});
  const restored=await f.store.restoreCheckpoint({id:original.id,baseRevision:2});
  assert.deepEqual(Object.keys(restored).sort(),['progress','revision','savedAt']);
  assert.equal(restored.revision,3);assert.equal(restored.progress.draft,'原来的完整草稿');
  const undo=(await f.store.history()).find(item=>item.reason==='before-restore');
  assert.equal(undo.sourceRevision,2);assert.equal((await f.store.getCheckpoint(undo.id)).progress.draft,'后来改写的草稿');
  const recovered=await f.store.restoreCheckpoint({id:undo.id,baseRevision:3});
  assert.equal(recovered.revision,4);assert.equal(recovered.progress.draft,'后来改写的草稿');
  assert.equal((await f.store.history()).filter(item=>item.reason==='before-restore').length,2);
});

test('retention keeps 20 newest checkpoints and ignores unrelated files',async t=>{
  const f=await fixture(t);await f.store.save({progress:{draft:'keep'},baseRevision:0});
  const created=[];
  for(let i=0;i<24;i++){f.advance(1);created.push(await f.store.checkpoint());}
  const unrelated=path.join(f.historyDir,'user-note.txt');await writeFile(unrelated,'untouched');
  let items=await f.store.history();assert.equal(items.length,MAX_HISTORY_FILES);
  assert.deepEqual(items.map(item=>item.id),created.slice(-20).reverse().map(item=>item.id));
  await assert.rejects(f.store.getCheckpoint(created[0].id),error=>error.status===404);
  await f.store.checkpoint();assert.equal(await readFile(unrelated,'utf8'),'untouched');
  assert.equal((await f.store.history()).length,20);
  assert.equal((await readdir(f.historyDir)).some(name=>name.endsWith('.tmp')),false);
});

test('80 MiB retention prunes large snapshots even before the count limit',async t=>{
  const f=await fixture(t);await f.store.save({progress:{notes:'x'.repeat(10*1024*1024)},baseRevision:0});
  for(let i=0;i<8;i++){f.advance(1);await f.store.checkpoint();}
  const items=await f.store.history(),bytes=items.reduce((sum,item)=>sum+item.bytes,0);
  assert.ok(bytes<=MAX_HISTORY_BYTES);assert.equal(items.length,7);assert.ok(items.every(item=>item.bytes>10*1024*1024));
});

test('backup failure leaves the original progress and revision intact and reports the actual problem',async t=>{
  const f=await fixture(t);await f.store.save({progress:{notes:'原始记录'},baseRevision:0});
  await writeFile(f.historyDir,'This is a file, not a backup directory.');
  await assert.rejects(f.store.save({progress:{notes:'不能覆盖'},baseRevision:1}),error=>error.status===500&&/备份/.test(error.message));
  assert.deepEqual((await f.store.read()).progress,{notes:'原始记录'});assert.equal((await f.store.read()).revision,1);
  await assert.rejects(f.store.checkpoint(),error=>error.status===500&&/备份/.test(error.message));
});

test('checkpoint IDs and reason allowlist reject traversal; failed restore never mutates progress',async t=>{
  const f=await fixture(t);await f.store.save({progress:{value:'retained'},baseRevision:0});
  for(const id of ['../ai-settings','../study-progress.json','C:\\outside','%2e%2e','not-an-id']){
    await assert.rejects(f.store.getCheckpoint(id),error=>error.status===400);
    await assert.rejects(f.store.restoreCheckpoint({id,baseRevision:1}),error=>error.status===400);
  }
  await assert.rejects(f.store.checkpoint({reason:'reset-everything'}),error=>error.status===400);
  assert.equal((await f.store.read()).revision,1);assert.deepEqual(await f.store.history(),[]);
});

test('history junction/symlink cannot redirect backups to another directory',async t=>{
  const f=await fixture(t);await f.store.save({progress:{value:'retained'},baseRevision:0});
  const other=path.join(f.root,'other');await mkdir(other);
  try{await symlink(other,f.historyDir,process.platform==='win32'?'junction':'dir');}
  catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('host does not allow creating test symlinks');return;}throw error;}
  await assert.rejects(f.store.checkpoint(),error=>error.status===500);
  await assert.rejects(f.store.save({progress:{value:'changed'},baseRevision:1}),error=>error.status===500);
  assert.deepEqual(await readdir(other),[]);assert.equal((await f.store.read()).progress.value,'retained');
});

test('corrupt history is never treated as an empty valid backup and does not erase current progress',async t=>{
  const f=await fixture(t);await f.store.save({progress:{value:'retained'},baseRevision:0});const checkpoint=await f.store.checkpoint();
  await writeFile(path.join(f.historyDir,checkpoint.id+'.json'),'{broken');
  await assert.rejects(f.store.getCheckpoint(checkpoint.id),error=>error.status===500);
  await assert.rejects(f.store.restoreCheckpoint({id:checkpoint.id,baseRevision:1}),error=>error.status===500);
  assert.equal((await f.store.read()).progress.value,'retained');assert.equal((await f.store.read()).revision,1);
});
