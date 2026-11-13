"""Build attributed, Chinese JLPT study data from openly licensed dictionary data.

Usage: python scripts/build-vocabulary.py --sources ../japanese-research/vocabulary-sources
Refresh: python scripts/build-vocabulary.py --sources ../japanese-research/vocabulary-sources --download
The download step needs `pip install zstandard` (extraction only). Building from an
already decompressed SQLite file uses only the Python standard library.
"""
from pathlib import Path
import argparse,collections,csv,datetime,hashlib,json,sqlite3,urllib.request

ROOT=Path(__file__).resolve().parents[1]
POS={
    'noun (common) (futsuumeishi)':'名词','transitive verb':'他动词','intransitive verb':'自动词',
    'noun or participle which takes the aux. verb suru':'サ变名词','Ichidan verb':'一段动词',
    'adverb (fukushi)':'副词',"nouns which may take the genitive case particle 'no'":'可接の的名词',
    'adjectival nouns or quasi-adjectives (keiyodoshi)':'な形容词','adjective (keiyoushi)':'い形容词',
    'noun, used as a suffix':'名词（后缀）','noun, used as a prefix':'名词（前缀）','suffix':'后缀',
    'expressions (phrases, clauses, etc.)':'惯用表达','interjection (kandoushi)':'感叹词',
    "adverb taking the 'to' particle":'可接と的副词','counter':'量词','pronoun':'代词',
    'conjunction':'接续词','prefix':'前缀','auxiliary verb':'助动词','particle':'助词',
    'suru verb - special class':'サ变动词','suru verb - included':'サ变动词',
    'numeric':'数词','noun or verb acting prenominally':'连体表达','pre-noun adjectival (rentaishi)':'连体词',
    'Kuru verb - special class':'カ变动词',"'taru' adjective":'タリ形容词',
    'unclassified':'其他','auxiliary':'助词性表达','auxiliary adjective':'补助形容词',
}

def pos_zh(label):
    if label in POS:return POS[label]
    if label.startswith('Godan'):return '五段动词'
    if label.startswith('Ichidan'):return '一段动词'
    if label.startswith('adjective'):return 'い形容词'
    if 'archaic' in label:return '古语表达'
    return label

def unique(items):return list(dict.fromkeys(x for x in items if x))
def write_json(path,data):path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

def download(out):
    out.mkdir(parents=True,exist_ok=True)
    base='https://huggingface.co/datasets/yuany1z/tomoshi-dict-data/resolve/main/'
    urls={'tomoshi-dict-open.db.zst':base+'tomoshi-dict-open.db.zst',
          'tomoshi-SHA256SUMS':base+'SHA256SUMS',
          'tomoshi-LICENSE.md':base+'LICENSE.md','tomoshi-NOTICE.md':base+'NOTICE.md',
          'tomoshi-README.md':base+'README.md',
          'edrdg-license.html':'https://www.edrdg.org/edrdg/licence.html',
          'waller-license.txt':'https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/main/LICENSE.txt',
          'waller-readme.md':'https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/main/README.md'}
    urls.update({f'waller-n{n}.csv':f'https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/main/original_data/n{n}.csv' for n in range(1,6)})
    report=[]
    for name,url in urls.items():
        with urllib.request.urlopen(url,timeout=180) as response:data=response.read()
        (out/name).write_bytes(data)
        report.append({'file':name,'url':url,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        print('Downloaded',name,len(data))
    import zstandard
    expected=dict((line.split()[1],line.split()[0]) for line in (out/'tomoshi-SHA256SUMS').read_text().splitlines())
    archive=out/'tomoshi-dict-open.db.zst'
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected[archive.name]:raise ValueError('Source checksum mismatch')
    with archive.open('rb') as src,(out/'tomoshi-dict-open.db').open('wb') as dst:
        zstandard.ZstdDecompressor().copy_stream(src,dst)
    write_json(out/'build-downloads.json',report)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--sources',type=Path,default=ROOT/'data-sources');ap.add_argument('--download',action='store_true')
    args=ap.parse_args();src=args.sources.resolve()
    if args.download:download(src)
    conn=sqlite3.connect(f'file:{(src/"tomoshi-dict-open.db").as_posix()}?mode=ro',uri=True)
    if conn.execute('pragma integrity_check').fetchone()[0]!='ok':raise ValueError('Dictionary database integrity check failed')
    expected=dict((line.split()[1],line.split()[0]) for line in (src/'tomoshi-SHA256SUMS').read_text().splitlines())
    database_hash=hashlib.sha256((src/'tomoshi-dict-open.db').read_bytes()).hexdigest()
    if database_hash!=expected['tomoshi-dict-open.db']:raise ValueError('Decompressed database checksum mismatch')
    out=ROOT/'public'/'data';out.mkdir(parents=True,exist_ok=True)
    vocab={};excluded=[];repairs=[]
    # Easiest level wins for duplicated word/reading pairs across source lists.
    for n in range(5,0,-1):
        with (src/f'waller-n{n}.csv').open(encoding='utf-8-sig',newline='') as stream:rows=list(csv.DictReader(stream))
        for row in rows:
            seq=row['jmdict_seq'].strip();word=row['kanji'].strip() or row['kana'].strip();reading=row['kana'].strip()
            key=(word,reading)
            if key in vocab:continue
            if not seq:excluded.append({'reason':'No JMdict entry; isolated character/reading is not a verified word','row':row});continue
            record=conn.execute('select data from entries where id=?',(seq,)).fetchone()
            if not record:excluded.append({'reason':'Missing JMdict entry','row':row});continue
            entry=json.loads(record[0])
            if reading not in {x['text'] for x in entry['kana']}:
                candidates=conn.execute('select e.id,e.data from entries e join forms f on e.id=f.entry_id where f.text=? and f.is_kana=1',(reading,)).fetchall()
                matches=[(i,json.loads(d)) for i,d in candidates if word in {x['text'] for x in json.loads(d)['kanji']+json.loads(d)['kana']}]
                if len(matches)==1:
                    previous=seq;seq,entry=matches[0];repairs.append({'word':word,'reading':reading,'oldEntryId':previous,'entryId':seq})
                else:excluded.append({'reason':'Unverified reading-to-entry alignment','row':row});continue
            # Require that the requested orthography and reading really belong to the same dictionary entry.
            if word not in {x['text'] for x in entry['kanji']+entry['kana']}:
                excluded.append({'reason':'Unverified written form','row':row});continue
            zrow=conn.execute('select data from zh_defs where entry_id=? and locale=?',(seq,'zh-CN')).fetchone()
            zh=json.loads(zrow[0]).get('senses',{}) if zrow else {}
            senses=[]
            for idx,sense in enumerate(entry['senses']):
                z=zh.get(str(idx),{})
                gloss=unique(g.get('text','').strip() for g in z.get('glosses',[]))
                if not gloss:gloss=unique(g.get('text','').strip() for g in sense.get('glosses',[]) if g.get('lang')=='zho')
                if gloss:
                    item={'meaning':'；'.join(gloss),'pos':'、'.join(unique(pos_zh(p) for p in sense.get('pos',[])))}
                    if z.get('notes'):item['notes']=z['notes']
                    senses.append(item)
            is_zh=bool(senses)
            meaning='；'.join(unique(s['meaning'] for s in senses)) if senses else row['waller_definition'].strip()
            tags=[f'N{n}','社区等级估计']
            if entry.get('is_common'):tags.append('常用词')
            result={'id':'v-'+hashlib.sha256((word+'\0'+reading).encode()).hexdigest()[:16],
                'word':word,'reading':reading,'meaning':meaning,'meaningLang':'zh' if is_zh else 'en',
                'level':f'N{n}','pos':'、'.join(unique(pos_zh(p) for s in entry['senses'] for p in s.get('pos',[]))),
                'tags':tags,'sourceId':'tomoshi-jmdict','entryId':seq,'meaningEn':row['waller_definition'].strip(),
                'levelSource':'Jonathan Waller / stephenmk 社区估计，非 JLPT 官方词表',
                'senses':senses,'common':bool(entry.get('is_common'))}
            if entry.get('variant_note'):result['variantNote']=entry['variant_note']
            vocab[key]=result
    values=list(vocab.values())
    values.sort(key=lambda x:(-int(x['level'][1]),not x['common'],x['reading'],x['word']))
    write_json(out/'vocabulary.json',values)
    kanji=[]
    for literal,raw,gloss in conn.execute('select k.literal,k.data,g.zho from kanji k left join kanji_gloss g on g.literal=k.literal'):
        entry=json.loads(raw)
        if entry.get('jlpt') not in {'N1','N2','N3','N4','N5'}:continue
        chinese=json.loads(gloss) if gloss else []
        item={'id':'k-'+format(ord(literal),'x'),'char':literal,'onyomi':entry.get('on',[]),'kunyomi':entry.get('kun',[]),
              'meaning':'；'.join(chinese if chinese else entry.get('meaning',[])),
              'meaningLang':'zh' if chinese else 'en','meaningEn':'; '.join(entry.get('meaning',[])),
              'level':entry['jlpt'],'strokes':entry.get('stroke_count'),'sourceId':'tomoshi-kanjidic',
              'levelSource':'KANJIDIC / Waller 派生社区等级估计，非 JLPT 官方字表'}
        if entry.get('grade'):item['schoolGrade']=entry['grade']
        kanji.append(item)
    kanji.sort(key=lambda x:(-int(x['level'][1]),x.get('strokes') or 99,x['char']))
    write_json(out/'kanji.json',kanji)
    # Notices remain adjacent to the public data for attribution and redistribution.
    notices=out/'licenses';notices.mkdir(exist_ok=True)
    for name in ['tomoshi-LICENSE.md','tomoshi-NOTICE.md','waller-license.txt','waller-readme.md','edrdg-license.html']:
        (notices/name).write_bytes((src/name).read_bytes())
    metadata={'builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'schemaVersion':1,
      'vocabularyCount':len(values),'kanjiCount':len(kanji),'vocabularyByLevel':dict(collections.Counter(x['level'] for x in values)),
      'kanjiByLevel':dict(collections.Counter(x['level'] for x in kanji)),
      'meaningLanguages':dict(collections.Counter(x['meaningLang'] for x in values)),
      'license':'CC-BY-SA-4.0','licenseUrl':'https://creativecommons.org/licenses/by-sa/4.0/',
      'levelNotice':'N5–N1 标签来自社区估计。JLPT 不公布现行完整词汇／汉字表，数量和标签不等于官方考试范围。',
      'translationNotice':'中文词义来自 Y1Z / Tomoshi 开放词典的 AI 辅助翻译与复核层，不是人工审订词典；保留英文词义便于核对，疑义请结合例句与权威词典确认。',
      'modifications':'筛选社区 JLPT 词表；校验日语表记与读音；修复可唯一定位的旧词条 ID；去重；转换词性为中文；关联中文义项；排除无法验证的独立汉字条目；重排为学习用 JSON。未加入来源中缺失的例句。',
      'sources':[
        {'id':'tomoshi-jmdict','title':'JMdict + Tomoshi 开放中文释义','url':'https://github.com/tomoshi-app/tomoshi-dict-data','license':'CC-BY-SA-4.0','attribution':'JMdict © Electronic Dictionary Research and Development Group；中文派生释义 © Y1Z','downloadUrl':'https://huggingface.co/datasets/yuany1z/tomoshi-dict-data','databaseSha256':database_hash},
        {'id':'tomoshi-kanjidic','title':'KANJIDIC2 + Tomoshi 中文汉字释义','url':'https://www.edrdg.org/wiki/index.php/KANJIDIC_Project','license':'CC-BY-SA-4.0','attribution':'KANJIDIC2 © EDRDG；中文释义 © Y1Z'},
        {'id':'waller-jlpt','title':'Waller JLPT community estimates via stephenmk','url':'https://github.com/stephenmk/yomitan-jlpt-vocab','license':'CC-BY-SA-4.0','attribution':'Jonathan Waller（原始 CC BY 数据）；stephenmk 整理'}],
      'databaseMeta':dict(conn.execute('select key,value from meta')),'sourceTableLicenses':[dict(zip(['table','license','source','attribution'],r)) for r in conn.execute('select * from table_licenses') if r[0] in ['entries','zh_defs','kanji','kanji_gloss','vocab_jlpt']],
      'quality':{'excludedCount':len(excluded),'repairedEntryIds':repairs},
      'updateCommand':'python scripts/build-vocabulary.py --sources data-sources --download'}
    write_json(out/'vocabulary-meta.json',metadata)
    write_json(src/'excluded-vocabulary-rows.json',excluded)
    print(json.dumps({k:metadata[k] for k in ['vocabularyCount','kanjiCount','vocabularyByLevel','kanjiByLevel','meaningLanguages','quality']},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
