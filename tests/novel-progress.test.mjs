import test from 'node:test';
import assert from 'node:assert/strict';
import {newProgress,normalizeProgress} from '../public/learning-core.js';
import {rememberNovelChapter,novelResumeChapter} from '../public/novel-progress.js';

test('imported novel resume and manual bookmarks persist independently of existing learning records',()=>{
 const p=newProgress();p.lessons.old={answers:{q:1},drafts:{q:'答案'},reviews:[]};p.words.word1={due:99,reviews:8};
 p.readings['novel:book-1:chapter-1']={paragraph:12,bookmark:3,done:false,note:'雨の表現',answers:{}};
 rememberNovelChapter(p,'book-1','chapter-1');
 const result=normalizeProgress(JSON.parse(JSON.stringify(p)));
 assert.deepEqual(result,p);assert.equal(normalizeProgress({version:1}).novelLast,null);
});

test('switching books and restoring an export keeps each book at its own last section',()=>{
 const a={id:'book-a',chapters:[{id:'a-1'},{id:'a-2'},{id:'a-3'}]},b={id:'book-b',chapters:[{id:'b-1'},{id:'b-2'}]};
 const p=newProgress();
 rememberNovelChapter(p,a.id,'a-3');p.readings['novel:book-a:a-3']={paragraph:18,bookmark:4,done:false,note:'追踪线索',answers:{}};
 rememberNovelChapter(p,b.id,'b-2');p.readings['novel:book-b:b-2']={paragraph:5,done:false,note:'',answers:{}};
 const restored=normalizeProgress(JSON.parse(JSON.stringify(p)));
 assert.equal(restored.novelLast.bookId,b.id);
 assert.equal(novelResumeChapter(a,restored).id,'a-3');
 assert.equal(novelResumeChapter(b,restored).id,'b-2');
 assert.equal(restored.readings['novel:book-a:a-3'].paragraph,18);
 assert.equal(restored.readings['novel:book-a:a-3'].bookmark,4);
 rememberNovelChapter(restored,a.id,'a-3');
 assert.equal(novelResumeChapter(b,normalizeProgress(restored)).id,'b-2');
});

test('legacy global location migrates without overwriting another book or an existing per-book location',()=>{
 const p=normalizeProgress({version:1,novelLast:{bookId:'book-a',chapterId:'a-2'},novelPositions:{'book-b':'b-4'}});
 assert.deepEqual(p.novelPositions,{'book-a':'a-2','book-b':'b-4'});
 const existing=normalizeProgress({...p,novelPositions:{...p.novelPositions,'book-a':'a-3'}});
 assert.equal(existing.novelPositions['book-a'],'a-3');
});

test('resume advances from a completed section and safely handles removed chapter IDs',()=>{
 const book={id:'book-a',chapters:[{id:'a-1'},{id:'a-2'},{id:'a-3'}]},p=newProgress();
 rememberNovelChapter(p,book.id,'a-2');p.readings['novel:book-a:a-2']={done:true};
 assert.equal(novelResumeChapter(book,p).id,'a-3');
 p.novelPositions[book.id]='removed';p.novelLast=null;
 assert.equal(novelResumeChapter(book,p).id,'a-1');
 assert.equal(novelResumeChapter({id:'empty',chapters:[]},p),undefined);
});

test('invalid per-book locations cannot enter saved progress',()=>{
 const p=normalizeProgress({version:1,novelPositions:{'../book':'c-1','book-a':{},'book-b':'../bad','book-c':'c'.repeat(201),'book-d':'d-2'}});
 assert.deepEqual(p.novelPositions,{'book-d':'d-2'});
 assert.deepEqual(normalizeProgress({version:1,novelPositions:[]}).novelPositions,{});
 assert.equal(rememberNovelChapter(p,'__proto__','c-1'),false);
 assert.equal(rememberNovelChapter(p,'book-a','../bad'),false);
 assert.deepEqual(p.novelPositions,{'book-d':'d-2'});
});
test('malformed imported novel locators and bookmarks are ignored or clamped',()=>{
 for(const novelLast of [null,[],{bookId:'../secret',chapterId:'chapter-1'},{bookId:'x',chapterId:{value:'bad'}},{bookId:'x',chapterId:'x'.repeat(201)}]){
  assert.equal(normalizeProgress({version:1,novelLast}).novelLast,null);
 }
 const p=normalizeProgress({version:1,readings:{a:{bookmark:-1},b:{bookmark:'2'},c:{bookmark:20000}}});
 assert.equal(p.readings.a.bookmark,undefined);assert.equal(p.readings.b.bookmark,undefined);assert.equal(p.readings.c.bookmark,10000);
});
