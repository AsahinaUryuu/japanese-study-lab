import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createAnnotationEngine,novelHiragana} from '../public/novel-annotation-core.js';
import {createNovelAnnotator} from '../public/novel-annotator.js';

const token=(surface,reading,lemma=surface,pos='名詞',extra={})=>({surface_form:surface,reading,basic_form:lemma,pos,word_type:'KNOWN',...extra});
const map={
 '生物は食べた。':[token('生物','ナマモノ'),token('は','ハ','は','助詞'),token('食べ','タベ','食べる','動詞'),token('た','タ','た','助動詞'),token('。','。','。','記号')],
 '食べる':[token('食べる','タベル','食べる','動詞')],
 '会社員':[token('会社','カイシャ'),token('員','イン','員','名詞',{pos_detail_1:'接尾'})],
 '好い':[token('好い','ヨイ','好い','形容詞')],
 'い':[token('い','イ','いる','動詞')],
 'いる':[token('いる','イル','いる','動詞')],
 '夜空':[token('夜空','ヨゾラ')],
 '東京':[token('東京','トウキョウ')],
 '空い':[token('空い','アイ','空く','動詞')],
 '空く':[token('空く','スク','空く','動詞')],
 '来':[token('来','キ','来る','動詞')],
 '来る':[token('来る','クル','来る','動詞')],
 '山田':[token('山田','ヤマダ','山田','名詞',{pos_detail_2:'人名'})],
 '𠮷の森🌳':[token('𠮷','ヨシ'),token('の','ノ','の','助詞'),token('森','モリ'),token('🌳','*','🌳','記号')],
};
const tokenizer={tokenize(text){return map[text]||[token(text,'*',text,'記号',{word_type:'UNKNOWN'})];}};
const words=[
 {id:'raw-food',word:'生物',reading:'なまもの',meaning:'生鲜食品'},
 {id:'creature',word:'生物',reading:'せいぶつ',meaning:'生物'},
 {id:'eat',word:'食べる',reading:'たべる',meaning:'吃'},
 {id:'employee',word:'会社員',reading:'かいしゃいん',meaning:'公司职员'},
 {id:'company',word:'会社',reading:'かいしゃ',meaning:'公司'},
 {id:'exist',word:'いる',reading:'いる',meaning:'有'},
 {id:'night',word:'夜空',reading:'よぞら',meaning:'夜空'},
 {id:'name',word:'山田',reading:'やまだ',meaning:'山田'},
 {id:'wood',word:'森',reading:'もり',meaning:'森林'},
 {id:'vacant',word:'空く',reading:'あく',meaning:'空出来'},
 {id:'less-crowded',word:'空く',reading:'すく',meaning:'变得稀少'},
 {id:'come',word:'来る',reading:'くる',meaning:'来'},
];
test('runtime dictionary links are constrained by reading and grammatical lemma',()=>{
 const engine=createAnnotationEngine(tokenizer,words),p=engine.annotate({ja:'生物は食べた。'});
 assert.equal(p.segments.map(s=>s.text).join(''),'生物は食べた。');
 assert.equal(p.segments[0].wordId,'raw-food');assert.equal(p.segments[2].wordId,'eat');
 assert.equal(p.segments[2].reading,'たべ');assert.equal(p.segments[2].lemma,'食べる');
 assert.equal(p.segments[1].wordId,undefined);assert.equal(p.segments.at(-1).wordId,undefined);
 assert.deepEqual(engine.annotate({ja:'会社員'}).segments,[{text:'会社員',reading:'かいしゃいん',wordId:'employee'}]);
 assert.equal(engine.annotate({ja:'空い'}).segments[0].wordId,'vacant');
 assert.equal(engine.annotate({ja:'来'}).segments[0].wordId,'come');
});
test('original ruby outranks the analyzer and kana suffixes do not become unrelated words',()=>{
 const engine=createAnnotationEngine(tokenizer,words);
 const p=engine.annotate({ja:'好い',sourceReadings:[{start:0,end:1,text:'好',reading:'ヨ'}]});
 assert.deepEqual(p.segments,[{text:'好',reading:'よ'},{text:'い',reading:'い'}]);
 const creative=engine.annotate({ja:'夜空',sourceReadings:[{start:0,end:2,text:'夜空',reading:'ソラ'}]});
 assert.deepEqual(creative.segments,[{text:'夜空',reading:'そら'}]);
 const ordinary=engine.annotate({ja:'夜空',sourceReadings:[{start:0,end:2,text:'夜空',reading:'ヨゾラ'}]});
 assert.equal(ordinary.segments[0].wordId,'night');
});
test('unknown readings, names, punctuation and malformed source offsets do not fabricate cards',()=>{
 const engine=createAnnotationEngine(tokenizer,words);
 assert.deepEqual(engine.annotate({ja:'未知の固有名'}).segments,[{text:'未知の固有名'}]);
 assert.equal(engine.annotate({ja:'山田'}).segments[0].wordId,undefined);
 const p=engine.annotate({ja:'夜空',sourceReadings:[{start:1,end:99,text:'夜空',reading:'そら'},{start:0,end:2,text:'違う字',reading:'そら'}]});
 assert.equal(p.segments[0].reading,'よぞら');assert.equal(p.segments[0].wordId,'night');
 assert.equal(novelHiragana('ｶﾀｶﾅ'),'かたかな');
});
test('paragraph reconstruction retains emoji, non-BMP kanji, whitespace and punctuation',()=>{
 const engine=createAnnotationEngine(tokenizer,words);
 const p=engine.annotate({ja:'𠮷の森🌳',sourceReadings:[{start:0,end:2,text:'𠮷',reading:'よし'}]});
 assert.equal(p.segments.map(s=>s.text).join(''),'𠮷の森🌳');assert.equal(p.segments[0].text,'𠮷');
 assert.equal(engine.annotate({ja:'\n  東京\t'}).text,'\n  東京\t');
 assert.throws(()=>engine.annotate({ja:'a'.repeat(100001)}),/单段过长/);
});
test('shipped local worker dictionaries are valid gzip assets with license notices',async()=>{
 const root=new URL('../public/vendor/kuromoji/',import.meta.url),names=await readdir(new URL('dict/',root));
 assert.equal(names.filter(x=>x.endsWith('.gz')).length,12);
 for(const name of names.filter(x=>x.endsWith('.gz'))){const bytes=await readFile(new URL('dict/'+name,root));assert.ok(gunzipSync(bytes).length>0);}
 assert.match(await readFile(new URL('LICENSE-2.0.txt',root),'utf8'),/Apache License/);
 assert.match(await readFile(new URL('NOTICE.md',root),'utf8'),/Nara Institute/);
});

class FakeWorker{
 messages=[];terminated=false;
 postMessage(message){this.messages.push(message);}
 terminate(){this.terminated=true;}
 emit(data){this.onmessage({data});}
}
test('worker is lazy, reports progress, and cancelled work cannot fulfill a later chapter',async()=>{
 const workers=[];const annotator=createNovelAnnotator(words,{workerFactory:()=>{const w=new FakeWorker();workers.push(w);return w;}});
 assert.equal(workers.length,0);const controller=new AbortController(),progress=[];
 const first=annotator.annotate([{ja:'夜空'}],{signal:controller.signal,onProgress:p=>progress.push(p)});
 const worker=workers[0],firstId=worker.messages.find(m=>m.type==='annotate').id;
 worker.emit({type:'progress',id:firstId,completed:0,total:1,stage:'loading'});assert.equal(progress.length,1);
 controller.abort();await assert.rejects(first,{name:'AbortError'});
 assert.ok(worker.messages.some(m=>m.type==='cancel'&&m.id===firstId));
 const second=annotator.annotate([{ja:'東京'}]);const secondId=worker.messages.at(-1).id;
 worker.emit({type:'result',id:firstId,paragraphs:[{text:'stale'}]});
 worker.emit({type:'result',id:secondId,paragraphs:[{text:'東京',segments:[{text:'東京'}]}]});
 assert.equal((await second)[0].text,'東京');assert.equal(workers.length,1);
 annotator.destroy();assert.equal(worker.terminated,true);
 await assert.rejects(annotator.annotate([{ja:'夜空'}]),/已关闭/);
});
test('worker failures terminate the failed worker, settle requests and permit retry',async()=>{
 const workers=[],annotator=createNovelAnnotator(words,{workerFactory:()=>{const w=new FakeWorker();workers.push(w);return w;}});
 const first=annotator.annotate([{ja:'夜空'}]);workers[0].onerror();await assert.rejects(first,/未能运行/);assert.equal(workers[0].terminated,true);
 const retry=annotator.annotate([{ja:'東京'}]);assert.equal(workers.length,2);const id=workers[1].messages.at(-1).id;
 workers[1].emit({type:'result',id,paragraphs:[]});assert.deepEqual(await retry,[]);annotator.destroy();
});
