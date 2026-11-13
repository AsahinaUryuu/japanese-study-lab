// Conventional small counters used in the supplied examples and stories.
// Deliberately excludes ambiguous 一日 and unbounded, uncommon compounds.
const digit = {一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,〇:0,零:0};
const readings = ['','いち','に','さん','よん','ご','ろく','なな','はち','きゅう'];
function smallNumber(text) {
  if (/^\d+$/.test(text)) return Number(text);
  if (text.includes('十')) {
    const [a,b]=text.split('十');
    if(a.length>1||b.length>1)return null;
    return (a?digit[a]:1)*10+(b?digit[b]:0);
  }
  return text.length===1?digit[text]:null;
}
function base(n) { return n<10?readings[n]:(n>=20?readings[Math.floor(n/10)]:'')+'じゅう'+readings[n%10]; }
export function countedReading(number,unit) {
  const n=smallNumber(number);if(!n||n>99)return null;
  const last=n%10,head=n<10?'':(n>=20?readings[Math.floor(n/10)]:'')+'じゅう';
  const b=base(n),stem=last?head: b.slice(0,-3);
  const contracted={1:'いっ',6:'ろっ',8:'はっ',0:'じゅっ'};
  if(unit==='時'||unit==='時半') {
    const core=last===4?'よ':last===7?'しち':last===9?'く':readings[last];
    return (last?head+core:b)+'じ'+(unit==='時半'?'はん':'');
  }
  if(unit==='人')return n===1?'ひとり':n===2?'ふたり':(last===4?head+'よ':b)+'にん';
  if(unit==='箱')return n===1?'ひとはこ':n===2?'ふたはこ':b+'はこ';
  if(['本','個','件','回','回目','分','分間'].includes(unit)){
    const suffix={本:'ほん',個:'こ',件:'けん',回:'かい',回目:'かいめ',分:'ふん',分間:'ふんかん'}[unit];
    if(unit==='本'&&last===3)return b+'ぼん';
    if((unit==='分'||unit==='分間')&&[3,4].includes(last))return b+'ぷん'+(unit==='分間'?'かん':'');
    if(contracted[last]){
      const tail=unit==='本'?'ぽん':unit==='分'||unit==='分間'?'ぷん'+(unit==='分間'?'かん':''):suffix;
      return stem+contracted[last]+tail;
    }
    return b+suffix;
  }
  return null;
}
export function countCandidates(text) {
  const results=[];
  for(const m of text.matchAll(/([一二三四五六七八九十〇零0-9]+)(時半|分間|回目|時|分|人|本|個|件|回|箱)/gu)){
    const before=text.slice(0,m.index),after=text.slice(m.index+m[0].length);
    if(/[一二三四五六七八九十百千万〇零0-9]$/.test(before))continue;
    if(m[2]==='人'&&/^[前称]/.test(after))continue;
    if(m[0]==='十分'&&!/(?:約|あと|もう|残り|およそ)$/.test(before)&&! /^(?:間|後|前|ほど|ぐらい|程度|以内|おき|歩|待|で着)/.test(after))continue;
    const reading=countedReading(m[1],m[2]);if(!reading)continue;
    const unitZh={時:'点钟',時半:'点半',分:'分钟',分間:'分钟',人:'人',本:'根、支（细长物量词）',個:'个',件:'件',回:'次',回目:'次（序数）',箱:'箱'}[m[2]];
    results.push({surface:m[0],reading,meaning:String(smallNumber(m[1]))+unitZh,
      exactStart:m.index,exactEnd:m.index+m[0].length,priority:4,positioned:true});
  }
  return results;
}
