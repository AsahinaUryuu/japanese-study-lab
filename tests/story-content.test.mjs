import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const data=async name=>JSON.parse(await readFile(new URL('../public/data/'+name,import.meta.url),'utf8'));
const originals=[...(await data('stories-intro.json')).series,...(await data('stories-advanced.json')).series];
const classic=(await data('stories-classics.json')).series[0];

test('six original serials span N5 to N1, with full Chinese paragraphs and chapter questions',()=>{
 assert.equal(originals.length,6);assert.deepEqual([...new Set(originals.map(b=>b.level))].sort(),['N1','N2','N3','N4','N5']);
 const ids=new Set();let questions=0;
 for(const book of originals){
  assert.equal(book.chapters.length,4);assert.ok(book.description&&book.author);assert.ok(!ids.has(book.id));ids.add(book.id);
  for(const c of book.chapters){
   assert.ok(!ids.has(c.id));ids.add(c.id);assert.ok(c.paragraphs.length>=4);
   const length=c.paragraphs.reduce((n,p)=>n+p.ja.length,0);assert.ok(length>=300,c.id+' too short');
   for(const p of c.paragraphs){assert.equal(typeof p.ja,'string');assert.equal(typeof p.zh,'string');assert.ok(p.ja.trim()&&p.zh.trim());assert.ok(!p.ja.includes('\ufffd'));}
   assert.ok(c.vocabulary.length>=8);assert.ok(c.questions.length>=2);
   for(const q of c.questions){questions++;assert.ok(!ids.has(q.id));ids.add(q.id);assert.ok(q.prompt&&q.explanation);assert.ok(q.options.length>=3);assert.equal(new Set(q.options).size,q.options.length);assert.ok(Number.isInteger(q.answer)&&q.answer>=0&&q.answer<q.options.length);}
  }
 }
 assert.equal(questions,48);
});
test('five additional complete classics preserve source text, chapters, ruby and credits',async()=>{
 const books=(await data('stories-classics.json')).series.slice(1);
 assert.equal(books.length,5);assert.equal(new Set(books.map(b=>b.id)).size,5);
 for(const b of books){
  const text=b.chapters.flatMap(c=>c.paragraphs).map(p=>p.ja).join('');
  assert.equal(text.length,b.characterCount);assert.equal(createHash('sha256').update(text).digest('hex'),b.textSha256);
  assert.ok(b.characterCount>2000);assert.equal(new Set(b.chapters.map(c=>c.sourceChapter)).size,b.originalChapterCount);
  assert.match(b.sourceUrl,/^https:\/\/www\.aozora\.gr\.jp\/cards\//);assert.ok(b.attribution.includes('入力'));
  const notice=await readFile(new URL('../public'+b.noticeUrl,import.meta.url),'utf8');assert.ok(notice.includes(b.sourceSha256)&&notice.includes(b.sourceTextUrl));
  for(const c of b.chapters){assert.ok(c.paragraphs.reduce((n,p)=>n+p.ja.length,0)<=2400);for(const p of c.paragraphs)for(const r of p.sourceReadings){assert.equal(p.ja.slice(r.start,r.end),r.text);assert.ok(r.reading);}}
 }
 assert.equal(books.find(b=>b.id==='s-yume').originalChapterCount,10);
 assert.equal(books.find(b=>b.id==='s-kumo').gaijiConverted,17);
});
test('five modern novels are clearly external author-published Web editions',async()=>{
 const novels=await data('novel-links.json');assert.equal(novels.length,5);
 assert.equal(new Set(novels.map(b=>b.url)).size,5);
 for(const b of novels){assert.match(b.url,/^https:\/\/ncode\.syosetu\.com\/n[a-z0-9]+\/$/);assert.match(b.edition,/Web/);assert.ok(b.title&&b.subtitle&&b.description);assert.equal(b.chapters,undefined);}
});
test('the complete classic preserves all nine source chapters, text and original ruby positions',()=>{
 assert.equal(classic.kind,'classic');assert.equal(classic.author,'宮沢賢治');assert.equal(classic.originalChapterCount,9);assert.equal(classic.chapters.length,21);
 assert.equal(classic.chapters.reduce((n,c)=>n+c.paragraphs.reduce((n,p)=>n+p.ja.length,0),0),38383);
 assert.deepEqual([...new Set(classic.chapters.map(c=>c.sourceChapter))],[1,2,3,4,5,6,7,8,9]);
 let rubies=0;
 for(const c of classic.chapters){assert.ok(c.paragraphs.length);assert.ok(c.paragraphs.reduce((n,p)=>n+p.ja.length,0)<=2400);assert.deepEqual(c.questions,[]);
  for(const p of c.paragraphs)for(const r of p.sourceReadings){rubies++;assert.equal(p.ja.slice(r.start,r.end),r.text);assert.ok(r.reading);}
 }
 assert.equal(rubies,689);assert.match(classic.sourceUrl,/aozora\.gr\.jp\/cards\/000081\/card456\.html$/);assert.ok(classic.attribution.includes('野口英司'));
});
