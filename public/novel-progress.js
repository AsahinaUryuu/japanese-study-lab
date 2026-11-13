const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);

export function rememberNovelChapter(progress,bookId,chapterId){
 if(!validId(bookId)||!validId(chapterId))return false;
 progress.novelPositions||={};
 progress.novelPositions[bookId]=chapterId;
 // Keep the global location for the latest-book entry point and older exports.
 progress.novelLast={bookId,chapterId};
 return true;
}

export function novelResumeChapter(book,progress){
 const chapters=book.chapters||[],last=progress.novelLast;
 const saved=chapters.find(c=>c.id===progress.novelPositions?.[book.id])||chapters.find(c=>last?.bookId===book.id&&c.id===last.chapterId);
 const done=chapter=>progress.readings?.['novel:'+book.id+':'+chapter.id]?.done;
 if(saved&&!done(saved))return saved;
 // A finished section advances within this book, without resetting other books.
 if(saved){const next=chapters.slice(chapters.indexOf(saved)+1).find(c=>!done(c));if(next)return next;}
 return chapters.find(c=>!done(c))||saved||chapters[0];
}
