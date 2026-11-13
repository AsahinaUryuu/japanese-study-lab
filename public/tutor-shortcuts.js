/** The shared composer always uses Enter to send and Shift+Enter for a newline. */
export function installTutorShortcuts(input,{onSend,onEdit=()=>{}}={}){
  const win=input.ownerDocument.defaultView;
  let composing=false;
  function keydown(event){
    if(event.target!==input||event.key!=='Enter')return;
    if(input.disabled||input.readOnly||input.ownerDocument.activeElement!==input)return;
    // Candidate confirmation belongs to the input method, not the submit action.
    if(composing||event.isComposing||event.keyCode===229)return;
    if(event.ctrlKey||event.altKey||event.metaKey)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.repeat)return;
    if(!event.shiftKey){onSend();return;}
    const start=input.selectionStart,end=input.selectionEnd;
    if(input.maxLength>=0&&input.value.length-(end-start)+1>input.maxLength)return;
    input.setRangeText('\n',start,end,'end');onEdit();
  }
  const startComposition=()=>{composing=true;};
  const endComposition=()=>{composing=false;};
  win.addEventListener('keydown',keydown,true);
  input.addEventListener('compositionstart',startComposition);
  input.addEventListener('compositionend',endComposition);
  input.addEventListener('blur',endComposition);
  return ()=>{
    win.removeEventListener('keydown',keydown,true);
    input.removeEventListener('compositionstart',startComposition);
    input.removeEventListener('compositionend',endComposition);
    input.removeEventListener('blur',endComposition);
  };
}
