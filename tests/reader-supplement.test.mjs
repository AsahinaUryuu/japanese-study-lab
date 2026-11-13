import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {textbookWords} from '../public/curriculum-core.js';
import {toHiragana} from '../scripts/reader-build-core.mjs';
const raw=name=>readFile(new URL('../public/data/'+name,import.meta.url));
const read=async name=>JSON.parse(await raw(name));
const supplement=await read('reader-supplement.json'),meta=await read('reader-supplement-meta.json'),base=await read('reader.json');
const books=(await Promise.all(['stories-intro.json','stories-advanced.json','stories-classics.json'].map(read))).flatMap(v=>v.series);
const chapters=books.flatMap(b=>b.chapters);
const hash=b=>createHash('sha256').update(b).digest('hex');
const lessons=(await Promise.all(Object.keys(meta.inputs).filter(n=>!n.startsWith('stories-')).map(read))).flat();

test('supplement reproduces all teaching snippets and all 70 story sections without modifying text',()=>{
 assert.equal(meta.counts.lessons,351);assert.equal(chapters.length,70);assert.equal(supplement.snippets.length,meta.counts.snippets);
 for(const s of supplement.snippets)assert.equal(s.segments.map(t=>t.text).join(''),s.text);
 for(const c of chapters){const result=supplement.stories[c.id];assert.equal(result.paragraphs.length,c.paragraphs.length,c.id);
  for(let i=0;i<c.paragraphs.length;i++){assert.equal(result.paragraphs[i].text,c.paragraphs[i].ja);assert.equal(result.paragraphs[i].segments.map(t=>t.text).join(''),c.paragraphs[i].ja);}}
});
test('data builds match current sources and preserve the v1.2 reader bytes and stable word IDs',async()=>{
 assert.equal(hash(await raw('reader.json')),'112dd9ec6a1a94ddbc36a8480cc1b54a2277a0f8ef9be730bb32df73e12b6abf');
 assert.equal(meta.baseReaderSha256,hash(await raw('reader.json')));assert.equal(meta.sha256,hash(await raw('reader-supplement.json')));
 for(const [name,expected] of Object.entries(meta.inputs))assert.equal(hash(await raw(name)),expected,name+' stale');
 const existing=[...textbookWords(lessons,await read('vocabulary.json')),...base.words],ids=new Set(existing.map(w=>w.id));
 for(const w of supplement.words){assert.ok(!ids.has(w.id));ids.add(w.id);assert.ok(w.word&&w.reading&&w.meaning);}
 for(const p of [...supplement.snippets,...Object.values(supplement.stories).flatMap(s=>s.paragraphs)])for(const s of p.segments){if(s.wordId)assert.ok(ids.has(s.wordId),'missing word '+s.wordId);if(s.reading)assert.match(s.reading,/^[ぁ-ゖー]+$/u);}
});
test('source ruby suffix fragments are not linked to unrelated dictionary words',()=>{
 const segments=supplement.stories['s-kumo-01-01'].paragraphs[0].segments;
 const good=segments.findIndex(s=>s.text==='好');assert.equal(segments[good+1].text,'い');assert.equal(segments[good+1].wordId,undefined);
 const overflow=segments.findIndex(s=>s.text==='溢');assert.equal(segments[overflow+1].wordId,undefined);
 assert.equal(segments.find(s=>s.text==='玉').reading,'たま');assert.equal(segments.find(s=>s.text==='御歩き').reading,'おあるき');
});
test('all source ruby readings survive supplement annotation at their exact positions',()=>{
 let count=0;
 for(const c of chapters)for(let i=0;i<c.paragraphs.length;i++){
  const segments=supplement.stories[c.id].paragraphs[i].segments;
  for(const r of c.paragraphs[i].sourceReadings||[]){let cursor=0;const segment=segments.find(s=>{const match=cursor===r.start;cursor+=s.text.length;return match;});assert.ok(segment,c.id);assert.equal(segment.text,r.text,c.id);assert.equal(segment.reading,toHiragana(r.reading),c.id);count++;}
 }
 assert.ok(count>1800);
});
test('Japanese coverage, Chinese protection and grammatical form readings are audited',async()=>{
 const audit=await read('reader-supplement-uncovered.json');assert.equal(audit.unannotatedJapanese.length,0);assert.equal(meta.counts.eligibleJapaneseHan,meta.counts.annotatedJapaneseHan);assert.ok(meta.counts.protectedChineseHan>100000);
 const segments=supplement.snippets.flatMap(p=>p.segments);
 for(const [text,reading] of [['て形','てけい'],['た形','たけい'],['ない形','ないけい']]){const xs=segments.filter(s=>s.text===text);assert.ok(xs.length);assert.ok(xs.every(s=>s.reading===reading));}
 for(const s of segments)if(/[这说给让该从仅译应为进联变单选传词现间类问处动实习书关业认确讲时终觉读远结]/u.test(s.text))assert.ok(!s.reading,'Chinese annotated: '+s.text);
});
