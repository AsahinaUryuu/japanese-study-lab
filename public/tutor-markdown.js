import {MarkdownIt,createDOMPurify,hljs} from './vendor/tutor-markdown.js';

const purifiers=new WeakMap();
const aliases={js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',javascript:'javascript',ts:'typescript',tsx:'typescript',typescript:'typescript',html:'xml',htm:'xml',xml:'xml',svg:'xml',vue:'xml',markup:'xml',css:'css',scss:'css',json:'json',jsonc:'json',sh:'bash',shell:'bash',shellscript:'bash',bash:'bash',zsh:'bash',diff:'diff',patch:'diff',sql:'sql',py:'python',python:'python',txt:'plaintext',text:'plaintext',plain:'plaintext',plaintext:'plaintext',console:'plaintext',none:'plaintext'};
const labels={javascript:'JavaScript',typescript:'TypeScript',xml:'HTML / XML',css:'CSS',json:'JSON',bash:'Bash / Shell',diff:'Diff',sql:'SQL',python:'Python',plaintext:'纯文本'};
const allowedTags=['h1','h2','h3','h4','h5','h6','p','strong','em','s','del','code','pre','blockquote','ul','ol','li','table','thead','tbody','tr','th','td','hr','br','div','span','a'];

export function safeTutorLink(value){
  if(typeof value!=='string'||/[\u0000-\u0020\u007f]/.test(value))return '';
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
function purifierFor(doc){const win=doc.defaultView;if(!win)throw new Error('Markdown 需要浏览器文档。');if(!purifiers.has(win))purifiers.set(win,createDOMPurify(win));return purifiers.get(win);}
function selectionSnapshot(doc){
  const active=doc.activeElement,selection=doc.defaultView?.getSelection?.();
  const ranges=[];if(selection)for(let i=0;i<selection.rangeCount;i++)ranges.push(selection.getRangeAt(i).cloneRange());
  let inputSelection;
  try{if(typeof active?.selectionStart==='number')inputSelection=[active.selectionStart,active.selectionEnd,active.selectionDirection];}catch{}
  return ()=>{
    try{if(active?.isConnected)active.focus({preventScroll:true});if(inputSelection)active.setSelectionRange(...inputSelection);}catch{}
    try{if(selection&&ranges.every(range=>range.commonAncestorContainer.isConnected)){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}}catch{}
  };
}

/** Copy the original source, never highlighted DOM text or toolbar labels. */
export async function copyTutorCode(source,{doc=globalThis.document,toast=()=>{},fallbackRoot}={}){
  const value=String(source??'');
  try{if(doc.defaultView?.navigator.clipboard?.writeText){await doc.defaultView.navigator.clipboard.writeText(value);toast('代码已复制。');return true;}}catch{}
  const restore=selectionSnapshot(doc),textarea=doc.createElement('textarea');
  textarea.value=value;textarea.readOnly=true;textarea.tabIndex=-1;textarea.setAttribute('aria-label','临时复制代码');
  Object.assign(textarea.style,{position:'fixed',left:'-10000px',top:'0',opacity:'0',pointerEvents:'none'});
  const target=fallbackRoot||doc.activeElement?.closest?.('dialog[open]')||doc.body;
  let copied=false;
  try{target.append(textarea);textarea.focus({preventScroll:true});textarea.select();copied=doc.execCommand?.('copy')===true;}catch{}
  finally{textarea.remove();restore();}
  toast(copied?'代码已复制。':'自动复制失败，请选中代码后手动复制。');return copied;
}

export function renderTutorMarkdown(container,text,{toast=()=>{}}={}){
  if(!container?.ownerDocument)throw new TypeError('Markdown 需要一个内容容器。');
  const doc=container.ownerDocument,purifier=purifierFor(doc),source=String(text??''),blocks=[];
  const md=new MarkdownIt({html:false,linkify:false,typographer:false,breaks:false,maxNesting:50});
  const esc=md.utils.escapeHtml;
  md.validateLink=value=>!!safeTutorLink(value);
  md.renderer.rules.link_open=(tokens,index,options,env,self)=>{
    const token=tokens[index],url=safeTutorLink(token.attrGet('href'));
    if(url){token.attrSet('href',url);token.attrSet('target','_blank');token.attrSet('rel','noopener noreferrer');token.attrSet('referrerpolicy','no-referrer');}
    else token.attrs=(token.attrs||[]).filter(([key])=>key!=='href');
    return self.renderToken(tokens,index,options);
  };
  md.renderer.rules.image=(tokens,index)=>{
    const token=tokens[index],url=safeTutorLink(token.attrGet('src')),alt=token.content||'图片';
    return url?`<a class="tutor-image-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">图片：${esc(alt)}（打开链接）</a>`:`<span class="tutor-image-link">图片：${esc(alt)}</span>`;
  };
  const codeBlock=(tokens,index)=>{const token=tokens[index];blocks.push({source:token.content,info:token.info||''});return `<pre data-tutor-code="${blocks.length-1}"></pre>\n`;};
  md.renderer.rules.fence=codeBlock;md.renderer.rules.code_block=codeBlock;
  const rendered=md.render(source);
  const fragment=purifier.sanitize(rendered,{RETURN_DOM_FRAGMENT:true,ALLOWED_TAGS:allowedTags,ALLOWED_ATTR:['href','title','target','rel','referrerpolicy','class','start','data-tutor-code'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
  // Recheck every link after sanitizing, with no resource-loading elements left.
  for(const anchor of fragment.querySelectorAll('a')){const url=safeTutorLink(anchor.getAttribute('href'));if(url){anchor.href=url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.referrerPolicy='no-referrer';}else anchor.removeAttribute('href');}
  for(const placeholder of fragment.querySelectorAll('[data-tutor-code]')){
    const block=blocks[Number(placeholder.getAttribute('data-tutor-code'))];if(!block){placeholder.remove();continue;}
    const declared=block.info.trim().split(/\s+/)[0].toLowerCase().slice(0,40),language=aliases[declared]||'plaintext';
    const wrap=doc.createElement('div');wrap.className='tutor-code';
    const toolbar=doc.createElement('div');toolbar.className='tutor-code-toolbar';
    const label=doc.createElement('span');label.className='tutor-code-label';label.textContent=aliases[declared]?labels[language]:declared?declared+' · 纯文本':'纯文本';
    const copy=doc.createElement('button');copy.type='button';copy.className='tutor-copy';copy.textContent='复制代码';copy.setAttribute('aria-label','复制 '+label.textContent+' 代码');
    const status=doc.createElement('span');status.className='tutor-copy-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const pre=doc.createElement('pre'),code=doc.createElement('code');code.className='hljs language-'+language;
    if(language!=='plaintext'&&hljs.getLanguage(language)&&block.source.length<=50000){
      try{code.append(purifier.sanitize(hljs.highlight(block.source,{language,ignoreIllegals:true}).value,{RETURN_DOM_FRAGMENT:true,ALLOWED_TAGS:['span'],ALLOWED_ATTR:['class'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false}));}catch{code.textContent=block.source;}
    }else code.textContent=block.source;
    let copying=false;
    copy.addEventListener('click',async()=>{
      if(copying)return;copying=true;copy.setAttribute('aria-busy','true');
      try{const copied=await copyTutorCode(block.source,{doc,toast,fallbackRoot:container.closest('dialog[open]')||doc.body});status.textContent=copied?'已复制':'复制失败，请手动选择';}
      finally{copying=false;copy.removeAttribute('aria-busy');}
    });
    toolbar.append(label,status,copy);pre.append(code);wrap.append(toolbar,pre);placeholder.replaceWith(wrap);
  }
  for(const table of [...fragment.querySelectorAll('table')]){const wrapper=doc.createElement('div');wrapper.className='tutor-table-wrap';table.replaceWith(wrapper);wrapper.append(table);}
  container.classList.add('tutor-markdown');container.replaceChildren(fragment);
  return {codeBlocks:blocks.length};
}
