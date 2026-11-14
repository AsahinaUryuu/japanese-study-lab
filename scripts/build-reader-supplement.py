"""Resolve additional teaching/story tokens without changing the v1.2 reader.

Reuses the established dictionary resolver with its output redirected to an
external build directory. Only reader-supplement*.json are published.
"""
from pathlib import Path
import argparse,datetime,hashlib,importlib.util,json,re,sys

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'public'/'data'
BUILD=(ROOT/'../japanese-research/reader-build').resolve()
SOURCE=BUILD/'reader-supplement-tokens.json'
HAN=re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff々〆ヶ]')
def dump(path,value):path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

def main():
    global BUILD,SOURCE
    parser=argparse.ArgumentParser()
    parser.add_argument('--build-dir',type=Path,default=BUILD)
    parser.add_argument('--dictionary',type=Path,default=ROOT/'../japanese-research/vocabulary-sources/tomoshi-dict-open.db')
    args=parser.parse_args()
    BUILD=args.build_dir.resolve();SOURCE=BUILD/'reader-supplement-tokens.json'
    raw=json.loads(SOURCE.read_text(encoding='utf-8'))
    base_before=hashlib.sha256((DATA/'reader.json').read_bytes()).hexdigest()
    if base_before!=raw['supplement']['baseReaderSha256']:raise ValueError('Base reader changed; retokenize supplement')
    target=BUILD/'supplement-resolved';target.mkdir(exist_ok=True)
    spec=importlib.util.spec_from_file_location('established_reader_builder',ROOT/'scripts'/'build-reader.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.DATA=target
    original_args=sys.argv
    try:
        sys.argv=['build-reader.py','--source',str(SOURCE),'--dictionary',str(args.dictionary)]
        module.main()
    finally:sys.argv=original_args
    resolved=json.loads((target/'reader.json').read_text(encoding='utf-8'))
    resolver_meta=json.loads((target/'reader-meta.json').read_text(encoding='utf-8'))
    resolver_uncovered=json.loads((target/'reader-uncovered.json').read_text(encoding='utf-8'))
    manifest=raw['supplement']['manifest']
    snippets=[{'text':info['text'],'segments':resolved['lessons'][rid]['paragraphs'][0]['segments']}
      for rid,info in sorted(manifest['snippets'].items())]
    stories={cid:resolved['lessons'][info['id']] for cid,info in manifest['stories'].items()}
    value={'version':1,'snippets':snippets,'stories':stories,'words':resolved['words']}
    eligible_han=annotated_han=protected_han=0;missing=[];protected_errors=[]
    for rid,record in resolved['lessons'].items():
        for pi,p in enumerate(record['paragraphs']):
            ranges=manifest['snippets'][rid]['ranges'] if rid in manifest['snippets'] else [{'start':0,'end':len(p['text'])}]
            # Current corpus uses BMP Japanese characters, so Python/JS offsets
            # coincide. Assert this instead of silently corrupting future emoji.
            if any(ord(c)>0xffff for c in p['text']):raise ValueError('Non-BMP text requires UTF-16 offset conversion')
            at=0
            for segment in p['segments']:
                end=at+len(segment['text'])
                allowed=any(r['start']<=at and end<=r['end'] for r in ranges)
                n=len(HAN.findall(segment['text']))
                if allowed:
                    eligible_han+=n
                    if segment.get('reading'):annotated_han+=n
                    elif n:missing.append({'recordId':rid,'paragraph':pi,'surface':segment['text'],
                      'context':p['text'][max(0,at-15):end+15]})
                else:
                    protected_han+=n
                    if segment.get('reading') or segment.get('wordId'):
                        protected_errors.append({'recordId':rid,'surface':segment['text']})
                at=end
    if protected_errors:raise ValueError('Chinese text annotated outside verified ranges: '+str(protected_errors[:5]))
    if hashlib.sha256((DATA/'reader.json').read_bytes()).hexdigest()!=base_before:
        raise ValueError('Original reader was modified')
    dump(DATA/'reader-supplement.json',value)
    uncovered={'unannotatedJapanese':missing,'unlinkedContentWords':resolver_uncovered['unlinkedContentWords'],
      'unlinkedWordSummary':resolver_uncovered['unlinkedWordSummary'],
      'mixedBoundaryAudit':raw['supplement']['boundaryAudit'],'unusedOverrides':raw['supplement']['uncertain']}
    dump(DATA/'reader-supplement-uncovered.json',uncovered)
    meta={'version':1,'builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'baseReaderSha256':base_before,'baseWordCount':raw['supplement']['baseWordCount'],
      'counts':{'lessons':raw['supplement']['lessonCount'],'snippets':len(snippets),'storyChapters':len(stories),
        'storyParagraphs':sum(len(s['paragraphs']) for s in stories.values()),
        'additionalWords':len(value['words']),'eligibleJapaneseHan':eligible_han,'annotatedJapaneseHan':annotated_han,
        'protectedChineseHan':protected_han,'missingJapaneseSegments':len(missing),
        'mixedAnnotatedSnippets':len(raw['supplement']['boundaryAudit']),
        'originalRubySpans':len(raw['supplement'].get('sourceRubyAudit',[]))},
      'inputs':raw['inputs'],'analyzer':resolver_meta['analyzer'],'dictionary':resolver_meta['dictionary'],
      'notices':resolver_meta['notices']+sorted('licenses/'+p.name for p in (DATA/'licenses').glob('aozora-*-NOTICE.md')),
      'sha256':hashlib.sha256((DATA/'reader-supplement.json').read_bytes()).hexdigest(),
      'bytes':(DATA/'reader-supplement.json').stat().st_size,
      'method':'例句、语法引用、故事正文整段按日语；中文讲解仅识别已验证引用及假名邻接词，未识别部分原样保护。补充词按原形+读音关联，不覆盖v1.2原词条。',
      'limitations':'混合文本采用保守范围识别；缺乏足够证据的纯汉字词可能不注音。自动形态分析可能有语境歧义，未覆盖清单供校对。',
      'buildCommands':['node scripts/build-reader-supplement-tokenize.mjs','python -X utf8 scripts/build-reader-supplement.py']}
    dump(DATA/'reader-supplement-meta.json',meta)
    print(json.dumps(meta['counts'],ensure_ascii=False,indent=2))

if __name__=='__main__':main()
