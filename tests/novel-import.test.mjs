import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {parseNovelImport,novelMetadata,extractEpubChapter,decodeNovelText,readEpubZip,MAX_NOVEL_BYTES,MAX_NOVEL_REQUEST_BYTES} from '../lib/novel-import.mjs';

const upload=(text,extra={})=>({filename:'自分の物語.txt',contentBase64:Buffer.from(text).toString('base64'),...extra});
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=data=>{let x=0xffffffff;for(const b of data)x=crcTable[(x^b)&255]^(x>>>8);return (x^0xffffffff)>>>0;};
function zip(entries){let offset=0;const chunks=[],central=[];for(const [filename,value] of Object.entries(entries)){const name=Buffer.from(filename),raw=Buffer.from(value),body=deflateRawSync(raw),local=Buffer.alloc(30),header=Buffer.alloc(46),crc=crc32(raw);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt16LE(8,10);header.writeUInt32LE(crc,16);header.writeUInt32LE(body.length,20);header.writeUInt32LE(raw.length,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(offset,42);chunks.push(local,name,body);central.push(header,name);offset+=local.length+name.length+body.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,directory,end]);}
const epubEntries=()=>({
 'mimetype':'application/epub+zip',
 'META-INF/container.xml':'<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
 'OEBPS/content.opf':'<package><metadata><dc:title>青い傘</dc:title></metadata><manifest><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="first"/><itemref idref="nav"/><itemref idref="second"/></spine></package>',
 'OEBPS/first.xhtml':'<html><head><title>ignore</title><script>bad()</script></head><body><h1>第一話</h1><nav><p>navigation</p></nav><p>朝、<ruby>学校<rt>がっこう</rt><rp>（</rp></ruby>へ行く。</p><script>alert(1)</script><p>青い傘を見つけた。</p></body></html>',
 'OEBPS/second.xhtml':'<html><body><h2>第二話</h2><p>友だちと歩いた。</p></body></html>',
 'OEBPS/nav.xhtml':'<html><body><nav>目次だけ</nav></body></html>'
});
test('TXT detects BOM/UTF-8/Shift-JIS, allows manual encoding and preserves original characters',()=>{
 assert.equal(decodeNovelText(Buffer.from('私は学生です。')).text,'私は学生です。');
 assert.equal(decodeNovelText(Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('雨です。','utf16le')])).encoding,'utf-16le');
 assert.equal(decodeNovelText(Buffer.from([0x93,0xfa,0x96,0x7b,0x8c,0xea])).text,'日本語');
 assert.throws(()=>decodeNovelText(Buffer.from([0xff]),'utf-8'),/编码/);
 assert.throws(()=>decodeNovelText(Buffer.from('text'),'invalid'),/编码/);
 const b=parseNovelImport(upload('第一章 出会い\n今日は晴れです。\n\n第二章 約束\nまた会いましょう。'));
 assert.equal(b.chapters.length,2);assert.equal(b.chapters[0].title,'第一章 出会い');assert.equal(b.chapters[1].paragraphs[0].ja,'また会いましょう。');assert.match(b.id,/^novel-[a-f0-9]{24}$/);
});
test('long TXT is split into bounded chapters and paragraphs without losing supplementary Unicode',()=>{
 const text=('星🌟を見ました。'.repeat(2000)),b=parseNovelImport(upload(text));
 assert.ok(b.chapters.length>1);assert.equal(b.chapters.flatMap(c=>c.paragraphs).map(p=>p.ja).join(''),text);
 for(const c of b.chapters){assert.ok(c.paragraphs.length<=100);assert.ok(c.paragraphs.reduce((n,p)=>n+p.ja.length,0)<=6000);for(const p of c.paragraphs){assert.ok(p.ja.length<=1200);assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p.ja));}}
});
test('EPUB follows spine order, removes executable/navigation content, and retains ruby positions',()=>{
 const b=parseNovelImport({filename:'book.epub',contentBase64:zip(epubEntries()).toString('base64'),linkedId:'bookworm'});
 assert.equal(b.title,'青い傘');assert.equal(b.linkedId,'bookworm');assert.deepEqual(b.chapters.map(c=>c.title),['第一話','第二話']);
 assert.deepEqual(b.chapters[0].paragraphs[0],{ja:'朝、学校へ行く。',sourceReadings:[{start:2,end:4,text:'学校',reading:'がっこう'}]});
 assert.ok(!JSON.stringify(b).includes('alert'));assert.ok(!JSON.stringify(b).includes('navigation'));assert.equal(b.chapters[1].paragraphs[0].ja,'友だちと歩いた。');
});
test('EPUB preserves publisher metadata without changing content identity or chapter IDs',()=>{
 const entries=epubEntries(),before=parseNovelImport({filename:'book.epub',contentBase64:zip(entries).toString('base64')});
 entries['OEBPS/content.opf']=entries['OEBPS/content.opf'].replace('</metadata>','<dc:creator>宮沢賢治</dc:creator><dc:description>森の少年の冒険。</dc:description><dc:rights>公版原著 · 青空文庫</dc:rights><dc:subject>奇幻冒险</dc:subject><dc:source>https://www.aozora.gr.jp/cards/000081/card1924.html</dc:source></metadata>');
 const book=parseNovelImport({filename:'book.epub',contentBase64:zip(entries).toString('base64')}),index=novelMetadata(book);
 assert.equal(book.author,'宮沢賢治');assert.equal(index.author,book.author);assert.equal(index.description,'森の少年の冒険。');assert.equal(index.license,'公版原著 · 青空文庫');assert.equal(index.genre,'奇幻冒险');assert.equal(index.sourceUrl,'https://www.aozora.gr.jp/cards/000081/card1924.html');
 assert.equal(book.id,before.id);assert.equal(book.textHash,before.textHash);assert.deepEqual(book.chapters,before.chapters);
 const txt=novelMetadata(parseNovelImport(upload('朝です。')));assert.equal(txt.author,'本地导入');assert.equal(txt.license,'个人导入文件');assert.equal(txt.sourceUrl,'');
});
test('EPUB metadata strips markup, bounds fields, and rejects unsafe or credential-bearing source URLs',()=>{
 for(const source of ['javascript:alert(1)','data:text/html,bad','file:///secret','https://name:secret@example.test/book','https://example.test/'+ 'x'.repeat(2100)]){
  const entries=epubEntries();entries['OEBPS/content.opf']=entries['OEBPS/content.opf'].replace('</metadata>',`<dc:creator>&lt;img src=x onerror=alert(1)&gt;作者</dc:creator><dc:description><b>読む</b> &lt;script&gt;見出し&lt;/script&gt; ${'あ'.repeat(2100)}</dc:description><dc:subject>${'文'.repeat(120)}</dc:subject><dc:rights>${'許'.repeat(550)}</dc:rights><dc:source>${source}</dc:source></metadata>`);
  const book=parseNovelImport({filename:'book.epub',contentBase64:zip(entries).toString('base64')});
  assert.equal(book.sourceUrl,'');assert.equal(book.author,'作者');assert.ok(!book.description.includes('<'));assert.ok(book.description.startsWith('読む 見出し'));assert.ok(book.description.length<=2000);assert.equal(book.genre.length,100);assert.equal(book.license.length,500);
 }
 assert.equal(novelMetadata({...parseNovelImport(upload('朝です。')),sourceUrl:'javascript:alert(1)'}).sourceUrl,'');
});
test('EPUB XML is inert, handles literal entities, and rejects custom entities or unsafe references',()=>{
 const c=extractEpubChapter('<html><body><p class="x > y">A &amp; B &#x65E5; &#26412; &lt;script&gt;</p><iframe>bad</iframe><style>bad</style><p>後半</p></body></html>');assert.equal(c.paragraphs[0].ja,'A & B 日 本 <script>');assert.equal(c.paragraphs[1].ja,'後半');
 assert.throws(()=>extractEpubChapter('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><body>&x;</body>'),/实体/);
 const e=epubEntries();e['OEBPS/content.opf']=e['OEBPS/content.opf'].replace('first.xhtml','https://example.test/secret');assert.throws(()=>parseNovelImport({filename:'bad.epub',contentBase64:zip(e).toString('base64')}),/路径/);
});
test('EPUB rejects DRM, ZIP traversal, damaged CRC and false uncompressed sizes',()=>{
 const encrypted=epubEntries();encrypted['META-INF/encryption.xml']='<encryption/>';assert.throws(()=>readEpubZip(zip(encrypted)),/DRM/);
 assert.throws(()=>readEpubZip(zip({'../outside.txt':'bad'})),/路径/);
 const wrongCrc=zip({'a.txt':'hello'}),central=wrongCrc.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));wrongCrc.writeUInt32LE(1,central+16);assert.throws(()=>readEpubZip(wrongCrc).get('a.txt').read(),/校验/);
 const bomb=zip({'a.txt':'hello'.repeat(1000)}),at=bomb.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bomb.writeUInt32LE(1,at+24);assert.throws(()=>readEpubZip(bomb).get('a.txt').read(),/解压/);
});
test('stable IDs are based on content and linked shelf entry; invalid inputs remain explicit',()=>{
 const a=parseNovelImport(upload('今日はいい天気です。',{linkedId:'rezero'}));const b=parseNovelImport(upload('今日はいい天気です。',{linkedId:'rezero',title:'別の表示名'}));assert.equal(a.id,b.id);assert.equal(a.chapters[0].id,b.chapters[0].id);
 assert.notEqual(a.id,parseNovelImport(upload('今日はいい天気です。',{linkedId:'slime'})).id);
 assert.throws(()=>parseNovelImport(upload(' ',{filename:'x.txt'})),/正文/);
 assert.throws(()=>parseNovelImport(upload('x',{filename:'x.pdf'})),/TXT/);
 assert.throws(()=>parseNovelImport(upload('x',{linkedId:'../secret'})),/关联/);
 assert.throws(()=>parseNovelImport(upload('x',{contentBase64:'!!!='})),/数据/);
 assert.equal(MAX_NOVEL_BYTES,64*1024*1024);assert.ok(MAX_NOVEL_REQUEST_BYTES>Math.ceil(MAX_NOVEL_BYTES/3)*4);
});
