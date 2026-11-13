import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {addReaderReview,mergeReaderWords,hasReaderParagraph} from '../public/reader-core.js';
import {textbookWords,wordKey} from '../public/curriculum-core.js';
import {newProgress,normalizeProgress,recallQueue,scheduleReview} from '../public/learning-core.js';
import {renderPractice} from '../public/views/practice.js';
import {createProgressStore} from '../lib/progress.mjs';
import {createApp} from '../server.mjs';

const word=(id,word,reading,meaning,level='N3')=>({id,word,reading,meaning,level});
const base=[word('v-original-1','生物','せいぶつ','生物'),word('v-original-2','学校','がっこう','学校','N5')];
const lessons=[{id:'lesson-one',level:'N2',textbook:{vocabulary:[{word:'切り戻す',reading:'きりもどす',meaning:'回滚'}]}}];
const extra=[word('reader-stable-namamono','生物','なまもの','生鲜食物'),word('reader-stable-saikai','再開','さいかい','重新开始')];

async function temporaryRoot(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'kotoba-reader-state-'));
 const intendedParent=await realpath(os.tmpdir());
 t.after(async()=>{
  const resolved=await realpath(root);
  assert.equal(path.dirname(resolved).toLowerCase(),intendedParent.toLowerCase());
  assert.ok(path.basename(resolved).startsWith('kotoba-reader-state-'));
  await rm(resolved,{recursive:true,force:true});
 });
 return root;
}

test('reader merge preserves base and textbook IDs, homographs and previously loaded entries',()=>{
 const original=textbookWords(lessons,base),snapshot=structuredClone(original);
 const collision={...base[0],meaning:'must not overwrite'};
 const merged=mergeReaderWords(original,[collision,...extra,...extra,null,{id:'bad',word:'缺少读音'}]);
 assert.deepEqual(original,snapshot,'loading annotations cannot mutate the existing vocabulary');
 assert.deepEqual(merged.slice(0,original.length),snapshot);
 assert.equal(merged[0],original[0],'the existing record wins even when an extra reuses its ID');
 assert.equal(merged.length,original.length+extra.length);
 assert.deepEqual(merged.filter(w=>w.word==='生物').map(w=>w.reading),['せいぶつ','なまもの']);
 assert.equal(new Set(merged.map(w=>w.id)).size,merged.length);
 assert.equal(merged.find(w=>w.word==='切り戻す').id,'textbook-'+encodeURIComponent(wordKey(lessons[0].textbook.vocabulary[0])));
 assert.deepEqual(mergeReaderWords(merged,extra),merged,'repeat loads must be idempotent');
});

test('malformed optional annotations fail closed without removing the original dictionary or text',()=>{
 for(const invalid of [null,{},'words',123])assert.deepEqual(mergeReaderWords(base,invalid),base);
 for(const invalid of [null,{}, {text:'学校',segments:null},{text:'学校',segments:[null]},{text:'学校',segments:[{text:'学'}]}])assert.equal(hasReaderParagraph(invalid,'学校'),false);
 assert.equal(hasReaderParagraph({text:'学校',segments:[{text:'学'},{text:'校'}]},'学校'),true);
});

test('adding a reader word twice preserves its learned schedule, counters and original identity',()=>{
 const records={},id=extra[0].id;
 assert.equal(addReaderReview(records,id,1000),true);
 assert.deepEqual(records[id],{due:1000,interval:0,reviews:0});
 records[id]={...records[id],...scheduleReview(records[id],'good',2000),introducedAt:1000,customNote:'keep'};
 records[id]={...records[id],...scheduleReview(records[id],'easy',3000)};
 const previous=records[id],snapshot=structuredClone(previous);
 assert.equal(addReaderReview(records,id,999999999),false);
 assert.equal(records[id],previous);
 assert.deepEqual(records[id],snapshot);
 assert.equal(addReaderReview(records,'',9999),false);
});

test('old records default to visible furigana while an explicit hidden preference survives import',()=>{
 const old=newProgress();delete old.settings.showFurigana;
 assert.equal(normalizeProgress(old).settings.showFurigana,true);
 for(const value of [null,'false',0,{},[]]){
  const imported=newProgress();imported.settings.showFurigana=value;
  assert.equal(normalizeProgress(imported).settings.showFurigana,true,'only the boolean false hides annotations');
 }
 const hidden=newProgress();hidden.settings.showFurigana=false;
 assert.equal(normalizeProgress(JSON.parse(JSON.stringify(hidden))).settings.showFurigana,false);
});

test('export/import and dictionary reconstruction retain reader-only review cards without resetting the current round',()=>{
 const progress=newProgress(),now=10000;
 const originalId=textbookWords(lessons,base).at(-1).id;
 progress.words[base[0].id]={...scheduleReview({},'easy',1),introducedAt:1};
 progress.words[originalId]={...scheduleReview({},'good',2),introducedAt:2};
 progress.reviewSession={level:'all',date:'2026-11-14',ids:[base[0].id,originalId],index:1,revealed:true};
 const sessionSnapshot=structuredClone(progress.reviewSession);
 assert.equal(addReaderReview(progress.words,extra[0].id,now),true);
 assert.deepEqual(progress.reviewSession,sessionSnapshot,'adding a word must not replace an active round');
 const restored=normalizeProgress(JSON.parse(JSON.stringify(progress)));
 assert.deepEqual(restored.words,progress.words);
 assert.deepEqual(restored.reviewSession,sessionSnapshot);
 const loadedWords=mergeReaderWords(textbookWords(lessons,base),extra);
 assert.ok(restored.reviewSession.ids.every(id=>loadedWords.some(w=>w.id===id)));
 const due=recallQueue(loadedWords,restored.words,'all',10,now);
 assert.equal(due[0].id,extra[0].id,'a newly added reader word is eligible in the next due queue');
 assert.equal(due[0].reading,'なまもの');
 assert.deepEqual(restored.words[base[0].id],progress.words[base[0].id]);
 assert.deepEqual(restored.words[originalId],progress.words[originalId]);
});

test('missing optional word data is not rendered as a completed round and loading it resumes the same card',()=>{
 const progress=newProgress(),id=extra[0].id;
 progress.words[id]={due:123,interval:3,reviews:2};
 progress.reviewSession={level:'all',date:new Date().toLocaleDateString('en-CA'),ids:[id],index:0,revealed:true};
 const snapshot=structuredClone(progress.reviewSession);
 let saves=0;
 // Exercise the real render function's output contract, without emulating browser events or layout.
 const env={main:{innerHTML:''},state:{route:'review',params:new URLSearchParams(),viewData:{}},data:{words:base},store:{data:progress,save(){saves++;}}};
 renderPractice(env);
 assert.match(env.main.innerHTML,/资料暂未载入/);
 assert.doesNotMatch(env.main.innerHTML,/本轮已完成/);
 assert.match(env.main.innerHTML,/data-action="reload-reader"/);
 assert.deepEqual(progress.reviewSession,snapshot);assert.equal(saves,0);
 env.data.words=mergeReaderWords(base,extra);renderPractice(env);
 assert.match(env.main.innerHTML,/なまもの/);assert.match(env.main.innerHTML,/生鲜食物/);
 assert.equal(env.state.viewData.contextId,id);assert.deepEqual(progress.reviewSession,snapshot);
 progress.reviewSession.index=1;renderPractice(env);
 assert.match(env.main.innerHTML,/本轮已完成/);assert.doesNotMatch(env.main.innerHTML,/资料暂未载入/);
});

test('reader reviews survive a real local JSON round trip and a stale writer cannot erase them',async t=>{
 const root=await temporaryRoot(t),file=path.join(root,'study-progress.json'),local=createProgressStore(file);
 const progress=newProgress();progress.lessons.old={stage:'summary',answers:{q:1},drafts:{t:'古い翻訳'},reviews:[{id:'old-review',reply:'原有反馈'}],done:true};
 progress.settings.showFurigana=false;
 addReaderReview(progress.words,extra[1].id,12345);
 progress.reviewSession={ids:[extra[1].id],index:0,revealed:false,level:'all',date:'2026-11-14'};
 await local.save({progress,baseRevision:0});
 const reopened=createProgressStore(file),loaded=await reopened.read(),normalized=normalizeProgress(loaded.progress);
 assert.deepEqual(normalized.words,progress.words);
 assert.deepEqual(normalized.lessons.old,progress.lessons.old);
 assert.equal(normalized.settings.showFurigana,false);
 assert.deepEqual(normalized.reviewSession,progress.reviewSession);
 await assert.rejects(reopened.save({progress:newProgress(),baseRevision:0}),error=>error.status===409&&error.current.progress.words[extra[1].id].due===12345);
 assert.deepEqual((await local.read()).progress.words,progress.words);
 const persisted=JSON.parse(await readFile(file,'utf8'));
 assert.equal(Object.hasOwn(persisted.progress,'reader'),false,'the corpus is runtime data, not duplicated into progress');
});

test('reader annotation is optional static data and cannot break or contaminate the lesson catalog',async t=>{
 const root=await temporaryRoot(t),publicDir=path.join(root,'public'),dataDir=path.join(publicDir,'data');
 await mkdir(dataDir,{recursive:true});
 await writeFile(path.join(dataDir,'grammar-test.json'),JSON.stringify([{id:'lesson-one',title:'真正的课程',level:'N5',sections:[]}]));
 await writeFile(path.join(dataDir,'reader.json'),'{unfinished annotation data');
 const server=createApp({publicDir,progressPath:path.join(root,'private','progress.json'),localConfigPath:path.join(root,'private','settings.json')});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const baseUrl=`http://127.0.0.1:${server.address().port}`;
 const catalog=await fetch(baseUrl+'/api/catalog');
 assert.equal(catalog.status,200,'incomplete optional annotations must not take all lessons offline');
 assert.deepEqual((await catalog.json()).lessons.map(l=>l.id),['lesson-one']);
 const raw=JSON.stringify({version:1,lessons:[{id:'not-a-course',title:'注音元数据',sections:[]}],words:extra});
 await writeFile(path.join(dataDir,'reader.json'),raw);
 assert.deepEqual((await (await fetch(baseUrl+'/api/catalog')).json()).lessons.map(l=>l.id),['lesson-one']);
 const annotation=await fetch(baseUrl+'/data/reader.json');
 assert.equal(annotation.status,200);assert.match(annotation.headers.get('content-type'),/^application\/json/);
 assert.equal(annotation.headers.get('cache-control'),'no-cache');assert.equal(await annotation.text(),raw);
 const head=await fetch(baseUrl+'/data/reader.json',{method:'HEAD'});
 assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),Buffer.byteLength(raw));assert.equal(await head.text(),'');
});

test('published annotations resolve every linked word and all legacy vocabulary IDs remain usable after adding the full corpus',async()=>{
 const dataDir=new URL('../public/data/',import.meta.url);
 const read=async name=>JSON.parse(await readFile(new URL(name,dataDir),'utf8'));
 const names=(await readdir(dataDir)).filter(name=>/^(foundation|business|it|reading|listening|grammar-n[1-5])\.json$/.test(name));
 const publishedLessons=(await Promise.all(names.map(read))).flat();
 const [vocabulary,annotation]=await Promise.all([read('vocabulary.json'),read('reader.json')]);
 const legacy=textbookWords(publishedLessons,vocabulary),merged=mergeReaderWords(legacy,annotation.words),index=new Map(merged.map(w=>[w.id,w]));
 assert.ok(publishedLessons.length>=351);assert.ok(annotation.words.length>0);
 assert.equal(index.size,merged.length,'all runtime word IDs are unique');
 assert.equal(new Set(merged.map(wordKey)).size,merged.length,'reader additions reuse existing spelling+reading identities');
 for(const old of legacy)assert.deepEqual(index.get(old.id),old,'existing word remains unchanged: '+old.id);
 for(const added of annotation.words){
  const stable='reader-'+createHash('sha256').update(added.word+'\0'+added.reading).digest('hex').slice(0,16);
  assert.equal(added.id,stable,'reader ID must not depend on lesson order, segment offset or time');
 }
 const linked=new Set();
 for(const lesson of publishedLessons){
  const paragraphs=annotation.lessons[lesson.id]?.paragraphs;
  assert.equal(paragraphs?.length,lesson.textbook.paragraphs.length,'all paragraphs are mapped: '+lesson.id);
  for(let i=0;i<paragraphs.length;i++){
   assert.equal(hasReaderParagraph(paragraphs[i],lesson.textbook.paragraphs[i].ja),true,'annotation must preserve exact course text: '+lesson.id);
   for(const segment of paragraphs[i].segments)if(segment.wordId){
    assert.ok(index.has(segment.wordId),'unresolvable reader word: '+lesson.id+' / '+segment.text+' / '+segment.wordId);
    linked.add(segment.wordId);
   }
  }
 }
 assert.ok(linked.size>1000,'test the real complete corpus, not a small fixture');
 const progress=newProgress();for(const w of annotation.words)addReaderReview(progress.words,w.id,12345);
 const restored=normalizeProgress(JSON.parse(JSON.stringify(progress))),reloaded=mergeReaderWords(textbookWords(publishedLessons,vocabulary),annotation.words);
 const reloadedIds=new Set(reloaded.map(w=>w.id));
 assert.ok(Object.keys(restored.words).every(id=>reloadedIds.has(id)),'every added word survives dictionary reconstruction after a restart');
 assert.equal(Object.keys(restored.words).length,annotation.words.length);
});
