import {escapeHTML as e} from './learning-core.js';
import {hasReaderParagraph,readerParagraphHTML} from './reader-core.js';

export function snippetIndex(supplement){
 return new Map((supplement?.snippets||[]).filter(p=>hasReaderParagraph(p,p.text)).map(p=>[p.text,p]));
}
export function annotatedText(text,env){
 const value=String(text??''),annotation=env?.data?.snippets?.get(value);
 return `<span class="annotated-text">${hasReaderParagraph(annotation,value)?readerParagraphHTML(annotation):e(value)}</span>`;
}
export function furiganaButton(show=true){
 return `<button type="button" class="button small" data-action="toggle-furigana" aria-pressed="${show}">${show?'隐藏假名':'显示假名'}</button>`;
}
export function applyFuriganaPreference(root,show){
 document.body.classList.toggle('hide-furigana',!show);
 for(const paragraph of root.querySelectorAll('.passage-text'))paragraph.classList.toggle('furigana-hidden',!show);
 for(const button of root.querySelectorAll('[data-action="toggle-furigana"]')){button.textContent=show?'隐藏假名':'显示假名';button.setAttribute('aria-pressed',String(show));}
}
