import test from 'node:test';
import assert from 'node:assert/strict';
import {hasReaderParagraph,readerParagraphHTML,readerCardHTML,focusRanges} from '../public/reader-core.js';
import {textbookHTML} from '../public/views/textbook.js';
import {newProgress,normalizeProgress} from '../public/learning-core.js';

const paragraph={text:'昨日、申し込んだ。',segments:[{text:'昨日',reading:'きのう',wordId:'yesterday'},{text:'、'},{text:'申し込んだ',reading:'もうしこんだ',wordId:'apply',lemma:'申し込む'},{text:'。'}]};
test('旧注音不能错位套到修改后的课文，原文空白和标点必须完整',()=>{
 assert.equal(hasReaderParagraph(paragraph,paragraph.text),true);
 assert.equal(hasReaderParagraph(paragraph,'今日、申し込んだ。'),false);
 assert.equal(hasReaderParagraph({...paragraph,segments:paragraph.segments.slice(1)},paragraph.text),false);
 assert.equal(hasReaderParagraph(null,paragraph.text),false);
});
test('汉字用 ruby 注音，跨词焦点保留，点词具有可操作的名称',()=>{
 const html=readerParagraphHTML(paragraph,[{quote:'昨日、申し込んだ'}]);
 assert.match(html,/<ruby><mark>昨日<\/mark>/);assert.match(html,/<rt aria-hidden="true">きのう<\/rt>/);
 assert.match(html,/data-word-id="apply"/);assert.match(html,/data-surface="申し込んだ"/);assert.match(html,/aria-haspopup="dialog"/);
 assert.match(html,/昨日（きのう），查看词义/);assert.match(html,/<mark>、<\/mark>/);
 assert.deepEqual(focusRanges('日本語の学校',[{quote:'日本語'},{quote:'語の学校'}]),[[0,6]]);
});
test('课文与词条中的特殊字符不产生可执行标签',()=>{
 const html=readerParagraphHTML({text:'<img>',segments:[{text:'<img>',wordId:'" onclick="bad'}]});
 assert.ok(!html.includes('<img>'));assert.ok(html.includes('&lt;img&gt;'));assert.ok(!html.includes('" onclick="bad'));
 const card=readerCardHTML({word:'<svg>',reading:'&あ',meaning:'<script>bad</script>'});
 assert.ok(!card.includes('<script>'));assert.ok(card.includes('&lt;script&gt;'));
});
test('词卡区分课文活用、词典原形和课内义，已复习词不重复加入',()=>{
 const card=readerCardHTML({word:'申し込む',reading:'もうしこむ',meaning:'申请；报名',pos:'五段动词'},{surface:'申し込んだ',reading:'もうしこんだ',meaning:'报名参加',added:true});
 assert.match(card,/申し込む/);assert.match(card,/申し込んだ（もうしこんだ）/);assert.match(card,/本课含义/);assert.match(card,/报名参加/);assert.match(card,/data-reader="add" disabled/);assert.match(card,/原有复习进度保留/);
});
test('假名偏好可保存与恢复，旧进度默认显示，关闭不删读音或查词按钮',()=>{
 const p=newProgress();assert.equal(p.settings.showFurigana,true);p.settings.showFurigana=false;
 assert.equal(normalizeProgress(JSON.parse(JSON.stringify(p))).settings.showFurigana,false);
 delete p.settings.showFurigana;assert.equal(normalizeProgress(p).settings.showFurigana,true);
 const lesson={textbook:{title:'报名',scene:'测试',paragraphs:[{ja:paragraph.text,zh:'昨天报名了。'}],focus:[],readingQuestions:[]}};
 const html=textbookHTML(lesson,{annotation:{paragraphs:[paragraph]},showFurigana:false});
 assert.match(html,/furigana-hidden/);assert.match(html,/显示假名/);assert.match(html,/reader-word/);assert.match(html,/もうしこんだ/);
});
