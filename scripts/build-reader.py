"""Build an offline passage reader from Kuromoji tokens and licensed dictionary data.

Run the companion Node tokenizer first. Both the npm packages and the SQLite
dictionary remain outside the install folder; only compact derived JSON ships.
No credentials, external inference services or runtime npm install are used.
"""
from pathlib import Path
import argparse,collections,datetime,functools,hashlib,json,re,sqlite3,unicodedata

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'public'/'data'
HAN=re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff々〆ヶ]')
KANA=re.compile(r'^[ぁ-ゖー]+$')
CONTENT={'名詞','動詞','形容詞','副詞','連体詞','接続詞','感動詞','接頭詞','教材词','校对词'}
def hira(s):
    s=unicodedata.normalize('NFKC',s or '').strip().lower()
    return ''.join(chr(ord(c)-0x60) if 'ァ'<=c<='ヶ' else c for c in s)
def key(word,reading):return unicodedata.normalize('NFKC',word)+'|'+hira(reading)
def unique(values):return list(dict.fromkeys(v for v in values if v))
def dump(path,value):path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
def identifier(word,reading):return 'reader-'+hashlib.sha256((word+'\0'+reading).encode()).hexdigest()[:16]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--source',type=Path,default=ROOT/'../japanese-research/reader-build/reader-tokens.json')
    ap.add_argument('--dictionary',type=Path,default=ROOT/'../japanese-research/vocabulary-sources/tomoshi-dict-open.db')
    args=ap.parse_args()
    raw=json.loads(args.source.read_text(encoding='utf-8'))
    conn=sqlite3.connect(args.dictionary.resolve().as_uri()+'?mode=ro',uri=True)
    # The distributed SQLite has no forms(text) index. Read one in-memory
    # lookup rather than repeatedly scanning the database or modifying it.
    form_index=collections.defaultdict(set)
    for spelling,entry_id in conn.execute('select text,entry_id from forms'):
        form_index[spelling].add(entry_id)
    existing={key(w['word'],w['reading']):w for w in raw['words']}
    by_id={w['id']:w for w in raw['words']}
    extras={}
    unresolved_readings=[];unresolved_words=[];uses=collections.Counter();linked_sources=collections.Counter()
    paragraph_count=token_count=han_chars=annotated_han_chars=content_count=content_linked=0

    @functools.lru_cache(maxsize=20000)
    def dictionary(word,reading):
        if not reading or not KANA.fullmatch(reading):return None
        ids=sorted(form_index.get(word,[]))
        if not ids:return None
        candidates=conn.execute('''select e.id,e.data,z.data
          from entries e
          left join zh_defs z on z.entry_id=e.id and z.locale='zh-CN'
          where e.id in ('''+','.join('?' for _ in ids)+')',ids).fetchall()
        meanings=[];senses=[];entry_ids=[];levels=[]
        for entry_id,entry_raw,zh_raw in candidates:
            entry=json.loads(entry_raw)
            spellings={form['text'] for form in entry.get('kanji',[])+entry.get('kana',[])}
            if word not in spellings:continue
            # Orthography and reading must belong to this SAME entry, with
            # JMdict's kana-to-kanji restrictions respected.
            kana=[r for r in entry.get('kana',[]) if hira(r['text'])==reading and
              (not r.get('restricted_to') or word in r['restricted_to'] or word==r['text'])]
            if not kana:continue
            zh=json.loads(zh_raw).get('senses',{}) if zh_raw else {}
            entry_senses=[]
            for index,sense in enumerate(entry.get('senses',[])):
                if sense.get('stagk') and word not in sense['stagk']:continue
                if sense.get('stagr') and not any(hira(r)==reading for r in sense['stagr']):continue
                z=zh.get(str(index),{})
                glosses=unique(g.get('text','').strip() for g in z.get('glosses',[]))
                if not glosses:glosses=unique(g.get('text','').strip() for g in sense.get('glosses',[]) if g.get('lang')=='zho')
                if not glosses:continue
                item={'meaning':'；'.join(glosses),'pos':'、'.join(sense.get('pos',[])),'entryId':entry_id,'senseIndex':index}
                if z.get('notes'):item['notes']=z['notes']
                if sense.get('misc'):item['labels']=sense['misc']
                entry_senses.append(item)
            if not entry_senses:continue
            senses.extend(entry_senses);entry_ids.append(entry_id)
            if entry.get('jlpt_level') in ['N5','N4','N3','N2','N1']:levels.append(entry['jlpt_level'])
        if not senses:return None
        for sense in senses:
            if sense['meaning'] not in meanings:meanings.append(sense['meaning'])
        return {'word':word,'reading':reading,'meaning':'；'.join(meanings),'senses':senses,'entryIds':unique(entry_ids),
          'dictionaryLevel':max(levels,key=lambda x:int(x[1])) if levels else None}

    def match(word,reading):
        reading=hira(reading)
        if not word or not KANA.fullmatch(reading):return None
        old=existing.get(key(word,reading))
        if old:return {'existing':old}
        return dictionary(word,reading)

    def register(match_value,level):
        if match_value.get('existing'):return match_value['existing']['id'],'existing'
        word,reading=match_value['word'],match_value['reading']
        id=identifier(word,reading)
        if id not in extras:
            reviewed=match_value.get('reviewed',False)
            extras[id]={'id':id,'word':word,'reading':reading,'meaning':match_value['meaning'],'meaningLang':'zh',
              'level':match_value.get('dictionaryLevel') or level,
              'levelSource':'词典社区等级估计' if match_value.get('dictionaryLevel') else '首次出现课程的教学归类，非官方词汇等级',
              'source':'课文语境校对' if reviewed else 'JMdict / Tomoshi 开放中文释义',
              'sourceId':'reader-reviewed' if reviewed else 'tomoshi-jmdict',
              'senses':match_value.get('senses',[]),'tags':['课文查词']+(['语境校对'] if reviewed else ['词典补充']),
              **({'entryIds':match_value['entryIds']} if match_value.get('entryIds') else {})}
        uses[id]+=1
        return id,'reviewed' if match_value.get('reviewed') else 'dictionary'

    def resolve(t,level):
        if t.get('existingWordId'):
            if t['existingWordId'] not in by_id:raise ValueError('Unknown existing ID')
            return t['existingWordId'],'textbook'
        # Explicit contextual glosses are retained if no exact existing term exists.
        # Homographic 人名 must never resolve to e.g. 林=forest merely because kana match.
        if t.get('source')=='reviewed' and t.get('meaning'):
            word=t.get('lemma') or t['text'];reading=hira(t.get('lemmaReading') or t.get('reading'))
            old=existing.get(key(word,reading))
            if old and t.get('detail2')!='人名':return old['id'],'existing'
            return register({'word':word,'reading':reading,'meaning':t['meaning'],'senses':[],
              'reviewed':True},level)
        if t.get('pos') not in CONTENT or t.get('detail2')=='人名':return None,None
        lemma=t.get('lemma') or t['text']
        reading=t.get('lemmaReading') if lemma!=t['text'] else t.get('reading')
        found=match(lemma,reading)
        if found:return register(found,level)
        # Surface form lookup is still constrained by its exact attested reading.
        if lemma!=t['text']:
            found=match(t['text'],t.get('reading'))
            if found:return register(found,level)
        # IPADIC treats productive potential verbs as dictionary forms. Only
        # revert the e-row ending when the resulting word AND reading exist
        # in a dictionary and are explicitly classified as a godan verb.
        def is_verb(value,godan=False):
            old=value.get('existing',{})
            pos=str(old.get('pos',''))+' '+str([s.get('pos','') for s in value.get('senses',[])])
            if old and not old.get('pos'):
                verified=dictionary(old['word'],hira(old['reading']))
                if verified:pos+=' '+str([s.get('pos','') for s in verified['senses']])
            return ('Godan' in pos or '五段' in pos) if godan else ('verb' in pos or '动词' in pos)
        endings=dict(zip('えけげせてねべめれ','うくぐすつぬぶむる'))
        if lemma.endswith('る') and len(lemma)>2 and lemma[-2] in endings and reading and reading.endswith(lemma[-2:]):
            base=lemma[:-2]+endings[lemma[-2]]
            base_reading=reading[:-2]+endings[lemma[-2]]
            found=match(base,base_reading)
            if found and is_verb(found,True):return register(found,level)
        # Respectful お + masu stem is still the same verb. Do not fabricate
        # a new dictionary headword such as お送り with an invented sense.
        if lemma.startswith('お') and reading and reading.startswith('お'):
            body=lemma[1:];body_reading=reading[1:]
            bases=[(body+'る',body_reading+'る')]
            stems=dict(zip('いきぎしちにびみり','うくぐすつぬぶむる'))
            if body and body[-1] in stems and body_reading.endswith(body[-1]):
                bases.insert(0,(body[:-1]+stems[body[-1]],body_reading[:-1]+stems[body[-1]]))
            for base,base_reading in bases:
                found=match(base,base_reading)
                if found and is_verb(found):return register(found,level)
            found=match(body,body_reading)
            if found:return register(found,level)
        return None,None

    def merge_compounds(tokens):
        result=[];i=0
        while i<len(tokens):
            first=tokens[i];merged=None
            # Only merge bare noun/prefix sequences with attested compound
            # readings. Do not swallow a course word, reviewed anchor or a verb.
            if first.get('pos') in ('名詞','接頭詞') and not first.get('source') and first.get('detail2')!='人名':
                parts=[]
                for j in range(i,min(i+5,len(tokens))):
                    t=tokens[j]
                    if t.get('pos') not in ('名詞','接頭詞') or t.get('source') or not t.get('reading') or t.get('detail2')=='人名':break
                    if parts and parts[-1]['end']!=t['start']:break
                    parts.append(t)
                    if len(parts)<2:continue
                    word=''.join(p['text'] for p in parts);reading=''.join(p['reading'] for p in parts)
                    found=match(word,reading)
                    if found:
                        merged=({**first,'text':word,'reading':reading,'lemma':word,'lemmaReading':reading,
                          'end':t['end'],'compound':True},len(parts))
            if merged:result.append(merged[0]);i+=merged[1]
            else:result.append(first);i+=1
        return result

    result={}
    for lesson_id,lesson in raw['lessons'].items():
        paragraphs=[]
        for pi,paragraph in enumerate(lesson['paragraphs']):
            paragraph_count+=1;segments=[]
            for t in merge_compounds(paragraph['segments']):
                token_count+=1
                item={'text':t['text']}
                reading=hira(t.get('reading'))
                han=len(HAN.findall(t['text']));han_chars+=han
                if KANA.fullmatch(reading):
                    item['reading']=reading
                    annotated_han_chars+=han
                elif han:
                    unresolved_readings.append({'lessonId':lesson_id,'paragraph':pi,'surface':t['text'],
                      'context':paragraph['text'][max(0,t['start']-18):t['end']+18],'reason':'分词词典没有可靠表面读音'})
                word_id,source=resolve(t,lesson['level'])
                if word_id:
                    item['wordId']=word_id;linked_sources[source]+=1
                    target=by_id.get(word_id) or extras[word_id]
                    if target['word']!=t['text']:item['lemma']=target['word']
                elif t.get('lemma') and t['lemma']!=t['text']:
                    item['lemma']=t['lemma']
                is_content=t.get('pos') in CONTENT and t.get('detail') not in ('非自立','数') and t.get('detail2')!='人名'
                if is_content:
                    content_count+=1
                    if word_id:content_linked+=1
                    else:unresolved_words.append({'lessonId':lesson_id,'paragraph':pi,'surface':t['text'],
                      'lemma':t.get('lemma'),'reading':reading or None,'lemmaReading':t.get('lemmaReading'),
                      'pos':t.get('pos'),'context':paragraph['text'][max(0,t['start']-16):t['end']+16],
                      'reason':'无同表记且同读音的可靠中文词义；未强行匹配同形异音词'})
                segments.append(item)
            if ''.join(t['text'] for t in segments)!=paragraph['text']:raise ValueError('Text reconstruction: '+lesson_id)
            paragraphs.append({'text':paragraph['text'],'segments':segments})
        result[lesson_id]={'paragraphs':paragraphs}
    value={'version':1,'lessons':result,'words':sorted(extras.values(),key=lambda w:w['id'])}
    dump(DATA/'reader.json',value)
    unmatched_count=collections.Counter((v['lemma'] or v['surface'],v.get('lemmaReading') or v.get('reading') or '') for v in unresolved_words)
    report={'unannotatedHan':unresolved_readings,'unlinkedContentWords':unresolved_words,
      'unlinkedWordSummary':[{'word':w,'reading':r,'occurrences':n} for (w,r),n in unmatched_count.most_common()],
      'courseReadingConflicts':raw.get('conflicts',[])}
    dump(DATA/'reader-uncovered.json',report)
    metadata={'version':1,'builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'counts':{'lessons':len(result),'paragraphs':paragraph_count,'segments':token_count,'existingWords':len(existing),
        'additionalWords':len(extras),'hanCharacters':han_chars,'annotatedHanCharacters':annotated_han_chars,
        'unannotatedHanSegments':len(unresolved_readings),'contentSegments':content_count,
        'linkedContentSegments':content_linked,'linkedSegmentsBySource':dict(linked_sources),'contextOverrides':raw.get('overrideCount',0)},
      'files':{'readerBytes':(DATA/'reader.json').stat().st_size,'readerSha256':hashlib.sha256((DATA/'reader.json').read_bytes()).hexdigest()},
      'inputs':raw['inputs'],'analyzer':raw['analyzer'],
      'dictionary':{'source':'https://github.com/tomoshi-app/tomoshi-dict-data','license':'CC-BY-SA-4.0',
        'attribution':'JMdict © EDRDG；中文派生释义 © Y1Z','tables':['entries','forms','zh_defs'],
        'sha256':hashlib.sha256(args.dictionary.read_bytes()).hexdigest()},
      'notices':['licenses/kuromoji-LICENSE-2.0.txt','licenses/kuromoji-ipadic-NOTICE.md',
        'licenses/tomoshi-LICENSE.md','licenses/tomoshi-NOTICE.md'],
      'method':'离线 IPADIC 形态分析；课内词汇按完整词边界合并；语境校对覆盖易误读词；按表记+读音关联原词库及有许可中文词典。未通过验证的实词保留原文，不伪造读音或释义。',
      'limitations':'自动分词与读音仍可能有语境歧义；中文释义为开放词典 AI 辅助翻译层，非人工审订权威词典。多义词请结合当前句子判断；假名为词语整体读音，不等于音调标注。',
      'buildCommands':['node scripts/build-reader-tokenize.mjs --deps ../japanese-research/reader-build',
        'python scripts/build-reader.py --source ../japanese-research/reader-build/reader-tokens.json'],
      'uncoveredReport':'reader-uncovered.json'}
    dump(DATA/'reader-meta.json',metadata)
    print(json.dumps(metadata['counts'],ensure_ascii=False,indent=2))
    print('reader.json bytes:',metadata['files']['readerBytes'])

if __name__=='__main__':main()
