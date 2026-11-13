import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {GradeError} from './config.mjs';

export const MAX_NOVEL_BYTES=64*1024*1024;
export const MAX_NOVEL_REQUEST_BYTES=90*1024*1024;
const MAX_EXPANDED=128*1024*1024,MAX_TEXT=16_000_000,MAX_CHAPTERS=4000;
const LINKED_IDS=new Set(['rezero','slime','mushoku','bookworm','spider']);
const fail=(message,status=400)=>{throw new GradeError(message,status);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const localName=name=>name.toLowerCase().split(':').at(-1);
const metadataLimits={creator:200,description:2000,rights:500,subject:100,source:2000};
const plainMetadata=(value,limit)=>typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit).replace(/[\uD800-\uDBFF]$/,''):'';
function sourceLink(value){
 const clean=plainMetadata(value,2001);if(!clean||clean.length>2000)return '';
 try{const url=new URL(clean);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
function preservedMetadata(value={}){return {author:plainMetadata(value.author,200)||'本地导入',description:plainMetadata(value.description,2000),license:plainMetadata(value.license,500)||'个人导入文件',genre:plainMetadata(value.genre,100),sourceUrl:sourceLink(value.sourceUrl)};}

export function decodeNovelText(bytes,encoding='auto'){
 if(!['auto','utf-8','shift_jis','utf-16le','gb18030'].includes(encoding))fail('不支持这种文字编码，请选择 UTF-8、Shift-JIS、UTF-16LE 或 GB18030。');
 const candidates=encoding==='auto'?(bytes[0]===0xff&&bytes[1]===0xfe?['utf-16le']:bytes[0]===0xfe&&bytes[1]===0xff?['utf-16be']:['utf-8','shift_jis']):[encoding];
 for(const name of candidates){try{const text=new TextDecoder(name,{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');if(text.includes('\0'))continue;return {text:text.replace(/\r\n?/g,'\n'),encoding:name};}catch{}}
 fail('无法识别文件的文字编码。请在导入时指定编码，或将文件另存为 UTF-8。');
}

const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function zipPath(value){
 if(!value||value.includes('\\')||value.startsWith('/')||/^[a-z]:/i.test(value)||value.includes('\0')||value.split('/').some(p=>p==='..'))fail('EPUB 包含不安全的文件路径。');
 return value.replace(/^\.\//,'');
}
export function readEpubZip(buffer){
 if(buffer.length>MAX_NOVEL_BYTES)fail('文件超过 64 MB，请拆分后再导入。',413);
 if(buffer.length<22)fail('这不是有效的 EPUB 文件。');
 let end=-1;
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
 if(end<0)fail('EPUB 压缩目录损坏。');
 if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))fail('不支持分卷 EPUB。');
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),offset=buffer.readUInt32LE(end+16);
 if(!count||count>5000||count===65535||offset===0xffffffff||size===0xffffffff||offset+size>end||buffer.readUInt16LE(end+8)!==count)fail('EPUB 压缩目录超出支持范围。');
 const files=new Map();let at=offset,total=0;
 for(let i=0;i<count;i++){
  if(at+46>offset+size||buffer.readUInt32LE(at)!==0x02014b50)fail('EPUB 压缩目录损坏。');
  const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),crc=buffer.readUInt32LE(at+16),compressed=buffer.readUInt32LE(at+20),expanded=buffer.readUInt32LE(at+24),nameSize=buffer.readUInt16LE(at+28),extraSize=buffer.readUInt16LE(at+30),commentSize=buffer.readUInt16LE(at+32),local=buffer.readUInt32LE(at+42);
  const next=at+46+nameSize+extraSize+commentSize;
  if(next>offset+size||local+30>offset||compressed===0xffffffff||expanded===0xffffffff)fail('EPUB 文件结构损坏或使用了不支持的 ZIP64。');
  if(flags&1)fail('该 EPUB 已加密，无法导入。请使用无 DRM 的文件。');
  if(![0,8].includes(method))fail('EPUB 使用了不支持的压缩方式。');
  let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(at+46,at+46+nameSize));}catch{fail('EPUB 内部文件名不是 UTF-8。');}
  name=zipPath(name);if(files.has(name))fail('EPUB 包含重复的内部文件名。');
  total+=expanded;if(expanded>20*1024*1024||total>MAX_EXPANDED)fail('EPUB 解压后过大，请拆分或移除大图片。',413);
  if(buffer.readUInt32LE(local)!==0x04034b50)fail('EPUB 内部文件头损坏。');
  const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
  if(start+compressed>offset||buffer.readUInt16LE(local+8)!==method||(buffer.readUInt16LE(local+6)&1))fail('EPUB 内部文件范围无效。');
  const encoded=buffer.subarray(start,start+compressed);
  files.set(name,{read(){let bytes;try{bytes=method===0?encoded:inflateRawSync(encoded,{maxOutputLength:expanded+1});}catch{fail('EPUB 解压失败或文件大小不符。');}if(bytes.length!==expanded||crc32(bytes)!==crc)fail('EPUB 内容校验失败。');return bytes;}});
  at=next;
 }
 if(at!==offset+size)fail('EPUB 压缩目录长度不符。');
 if(files.has('META-INF/encryption.xml')||files.has('META-INF/rights.xml'))fail('该 EPUB 含加密或 DRM 信息，暂不支持导入。请使用无 DRM 的文件。');
 return files;
}

function entityText(value){return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(match,code)=>{if(code[0]==='#'){const point=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1));return point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):'\uFFFD';}return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'})[code.toLowerCase()];});}
function attributes(value){const result={};for(const m of value.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)){const key=m[1].toLowerCase();if(['__proto__','constructor','prototype'].includes(key))continue;result[key]=entityText(m[2]??m[3]);}return result;}
// Inert tokenization only. No DOM, entities, scripts, remote resources or XML
// declarations are evaluated. DTDs with entity definitions are rejected.
function* xmlTokens(text){
 if(/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(text))fail('EPUB 含不支持的 XML 实体定义。');
 const token=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z_](?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</g;
 let count=0;
 for(const m of text.matchAll(token)){
  if(++count>1_000_000)fail('EPUB 文档结构过大。',413);
  const value=m[0];if(value.startsWith('<![CDATA[')){yield {type:'text',text:value.slice(9,-3)};continue;}if(value.startsWith('<!')||value.startsWith('<?'))continue;
  if(value.startsWith('<')){const name=/^<\/?([\w:.-]+)/.exec(value)?.[1];if(!name)continue;yield {type:value[1]==='/'?'end':'start',name:localName(name),attrs:attributes(value),self:/\/\s*>$/.test(value)||['br','img','hr','meta','link','input'].includes(localName(name))};}
  else yield {type:'text',text:entityText(value)};
 }
}
function xmlDocument(bytes){return decodeNovelText(bytes,'auto').text;}
function resolveResource(from,href){
 let value;try{value=decodeURIComponent(href.split('#')[0]);}catch{fail('EPUB 资源路径编码无效。');}
 if(!value||/^[a-z][a-z\d+.-]*:/i.test(value)||value.startsWith('/')||value.includes('\\')||value.includes('\0'))fail('EPUB 资源路径无效。');
 const target=path.posix.normalize(path.posix.join(path.posix.dirname(from),value));return zipPath(target);
}
function splitParagraph(paragraph,limit=1200){
 const output=[];let start=0;const text=paragraph.ja,readings=paragraph.sourceReadings||[];
 while(start<text.length){let end=Math.min(text.length,start+limit);
  if(end<text.length){const candidate=text.lastIndexOf('。',end);if(candidate>start+limit/2)end=candidate+1;const crossing=readings.find(r=>r.start<end&&r.end>end);if(crossing)end=crossing.start>start?crossing.start:crossing.end;if(/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;}
  output.push({ja:text.slice(start,end),sourceReadings:readings.filter(r=>r.start>=start&&r.end<=end).map(r=>({...r,start:r.start-start,end:r.end-start}))});start=end;
 }return output;
}
export function extractEpubChapter(xml,fallbackTitle='正文'){
 const paragraphs=[];let title='',buf='',readings=[],body=false,bodySeen=false,skip=0,heading=false,headBuf='',ruby=null,capture='',depth=0;
 const ignored=new Set(['script','style','nav','noscript','svg','math','iframe','object','audio','video','head']);
 const blocks=new Set(['p','div','li','blockquote','section','article','pre']);
 const flush=()=>{if(buf.trim()){const leading=buf.length-buf.trimStart().length;const ja=buf.trim();paragraphs.push(...splitParagraph({ja,sourceReadings:readings.filter(r=>r.start>=leading&&r.end<=leading+ja.length).map(r=>({...r,start:r.start-leading,end:r.end-leading}))}));}buf='';readings=[];};
 for(const token of xmlTokens(xml)){
  const {type,name,attrs,self}=token;
  if(type==='start'&&name==='body'){body=true;bodySeen=true;continue;}
  if(type==='end'&&name==='body'){flush();body=false;continue;}
  if(!body)continue;
  if(type==='start'){
   if(skip){if(!self)skip++;continue;}
   if(ignored.has(name)||Object.hasOwn(attrs,'hidden')||attrs['aria-hidden']==='true'){if(!self)skip=1;continue;}
   if(/^h[1-6]$/.test(name)){flush();heading=true;headBuf='';continue;}
   if(name==='ruby'){ruby={start:buf.length,reading:''};depth++;continue;}
   if(name==='rt'||name==='rp'){capture=name;continue;}
   if(name==='br'){if(heading)headBuf+=' ';else if(!ruby)flush();else buf+='\n';continue;}
   if(blocks.has(name)&&!heading&&!ruby)flush();
  }else if(type==='end'){
   if(skip){skip--;continue;}
   if(/^h[1-6]$/.test(name)){if(!title)title=headBuf.trim();else if(headBuf.trim())paragraphs.push({ja:headBuf.trim(),sourceReadings:[]});heading=false;continue;}
   if(name==='rt'||name==='rp'){capture='';continue;}
   if(name==='ruby'&&ruby){if(ruby.reading.trim()&&buf.length>ruby.start)readings.push({start:ruby.start,end:buf.length,text:buf.slice(ruby.start),reading:ruby.reading.replace(/\s+/g,'')});ruby=null;depth--;continue;}
   if(blocks.has(name)&&!heading&&!ruby)flush();
  }else if(!skip){
   if(/^\s+$/.test(token.text)&&/[\r\n\t]/.test(token.text))continue;
   const value=token.text.replace(/[\r\n\t]+/g,' ');
   if(capture==='rp')continue;
   if(capture==='rt'){if(ruby)ruby.reading+=value;continue;}
   if(heading)headBuf+=value;else buf+=value;
  }
 }
 flush();if(!bodySeen)fail('EPUB 正文章节缺少 body。');return {title:(title||fallbackTitle).slice(0,200),paragraphs};
}

function txtChapters(text){
 const chapters=[];let current={title:'正文',paragraphs:[]};
 const flush=()=>{if(current.paragraphs.length)chapters.push(current);};
 for(const raw of text.split('\n')){const line=raw.trim();if(!line)continue;
  if(line.length<100&&/^(?:第[\d０-９一二三四五六七八九十百千万零〇]+[章話節部巻]|(?:プロローグ|エピローグ|序章|終章|序幕|後書き|あとがき)(?:\s|$|[：:「『])|Chapter\s+\d+)/i.test(line)){flush();current={title:line,paragraphs:[]};}
  else current.paragraphs.push(...splitParagraph({ja:line,sourceReadings:[]}));
 }
 flush();return chapters;
}
function epubChapters(bytes){
 const files=readEpubZip(bytes),get=name=>{const item=files.get(name);if(!item)fail('EPUB 缺少必要文件：'+name.slice(0,160));return xmlDocument(item.read());};
 if(files.has('mimetype')&&files.get('mimetype').read().toString().trim()!=='application/epub+zip')fail('文件不是 EPUB 格式。');
 const container=get('META-INF/container.xml');let packageFile='';for(const t of xmlTokens(container))if(t.type==='start'&&t.name==='rootfile'&&t.attrs['full-path']){packageFile=zipPath(t.attrs['full-path']);break;}
 if(!packageFile)fail('EPUB 未声明正文包。');
 const manifest=new Map(),spine=[],fields={};let inTitle=false,title='',inMetadata=false,capture='';
 for(const t of xmlTokens(get(packageFile))){
  if(t.type==='start'&&t.name==='item')manifest.set(t.attrs.id,t.attrs);
  if(t.type==='start'&&t.name==='itemref'&&t.attrs.linear!=='no')spine.push(t.attrs.idref);
  if(t.type==='start'&&t.name==='title')inTitle=true;else if(t.type==='end'&&t.name==='title')inTitle=false;else if(t.type==='text'&&inTitle)title+=t.text;
  if(t.type==='start'&&t.name==='metadata')inMetadata=true;
  else if(t.type==='end'&&t.name==='metadata'){inMetadata=false;capture='';}
  else if(inMetadata&&t.type==='start'&&Object.hasOwn(metadataLimits,t.name)&&!Object.hasOwn(fields,t.name)){capture=t.self?'':t.name;fields[t.name]='';}
  else if(t.type==='end'&&t.name===capture)capture='';
  else if(t.type==='text'&&capture)fields[capture]=(fields[capture]+t.text).slice(0,metadataLimits[capture]+1);
 }
 if(!spine.length||spine.length>MAX_CHAPTERS)fail('EPUB 阅读顺序为空或章节过多。');
 const chapters=[];for(const id of spine){const item=manifest.get(id);if(!item)fail('EPUB 章节目录引用了不存在的文件。');if((item.properties||'').split(/\s+/).includes('nav'))continue;if(!['application/xhtml+xml','text/html'].includes(item['media-type']))continue;const filename=resolveResource(packageFile,item.href||'');const chapter=extractEpubChapter(get(filename),'第 '+(chapters.length+1)+' 章');if(chapter.paragraphs.length)chapters.push(chapter);}
 return {chapters,title:title.trim(),metadata:preservedMetadata({author:fields.creator,description:fields.description,license:fields.rights,genre:fields.subject,sourceUrl:fields.source})};
}

export function parseNovelImport(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('导入参数无效。');
 if(typeof input.filename!=='string'||input.filename.length>240||/[\0\r\n]/.test(input.filename))fail('文件名无效。');
 const filename=path.win32.basename(input.filename),extension=path.extname(filename).toLowerCase();if(!['.txt','.epub'].includes(extension))fail('目前支持 TXT 和无 DRM 的 EPUB 文件。',415);
 if(typeof input.contentBase64!=='string'||!input.contentBase64||input.contentBase64.length>Math.ceil(MAX_NOVEL_BYTES/3)*4||input.contentBase64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64))fail('文件数据无效或超过 64 MB。',413);
 const bytes=Buffer.from(input.contentBase64,'base64');if(bytes.length>MAX_NOVEL_BYTES)fail('文件超过 64 MB。',413);
 const linkedId=input.linkedId||'';if(typeof linkedId!=='string'||linkedId&&!LINKED_IDS.has(linkedId))fail('关联的书架作品无效。');
 if(input.title!==undefined&&(typeof input.title!=='string'||input.title.length>200))fail('书名最多 200 个字符。');
 let chapters,title='',encoding='epub',metadata=preservedMetadata();
 if(extension==='.txt'){const decoded=decodeNovelText(bytes,input.encoding||'auto');encoding=decoded.encoding;if(decoded.text.length>MAX_TEXT)fail('正文超过 1600 万字符。',413);chapters=txtChapters(decoded.text);}
 else({chapters,title,metadata}=epubChapters(bytes));
 const sections=[];let total=0;
 for(const original of chapters){let parts=[],current=[],length=0;
  for(const p of original.paragraphs){total+=p.ja.length;if(total>MAX_TEXT)fail('正文超过 1600 万字符。',413);if(current.length&&(length+p.ja.length>6000||current.length>=100)){parts.push(current);current=[];length=0;}current.push(p);length+=p.ja.length;}
  if(current.length)parts.push(current);
  parts.forEach((paragraphs,index)=>sections.push({title:original.title+(parts.length>1?`（${index+1} / ${parts.length}）`:''),paragraphs,vocabulary:[],questions:[]}));
 }
 if(!sections.length||!total)fail('文件里没有可阅读的正文。');if(sections.length>MAX_CHAPTERS)fail('导入后超过 4000 个阅读小节，请拆成几本。',413);
 const textHash=digest(JSON.stringify(sections.map(c=>[c.title,c.paragraphs]))),id='novel-'+digest(linkedId+'\0'+textHash).slice(0,24);
 sections.forEach((chapter,index)=>chapter.id=id+'-'+String(index+1).padStart(4,'0'));
 return {id,title:(input.title?.trim()||title||filename.slice(0,-extension.length)).slice(0,200),linkedId,filename,format:extension.slice(1),encoding,textHash,characters:total,chapters:sections,kind:'imported',level:'自由阅读',...metadata};
}

export function novelMetadata(book){return {id:book.id,title:book.title,linkedId:book.linkedId,filename:book.filename,sourceFilename:book.filename,format:book.format,encoding:book.encoding,textHash:book.textHash,characters:book.characters,totalCharacters:book.characters,totalChapters:book.chapters.length,importedAt:book.importedAt,kind:'imported',level:book.level,...preservedMetadata(book),chapters:book.chapters.map(c=>({id:c.id,title:c.title,characters:c.paragraphs.reduce((n,p)=>n+p.ja.length,0),paragraphCount:c.paragraphs.length}))};}
