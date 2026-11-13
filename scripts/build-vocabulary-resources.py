"""Index user-owned local media without copying or redistributing it.

python scripts/build-vocabulary-resources.py --local "local-library"
Optional dependency: pypdf (page counts only). No full book text is extracted.
"""
from pathlib import Path
import argparse,collections,concurrent.futures,hashlib,json,logging,re

ROOT=Path(__file__).resolve().parents[1]
KINDS={'.pdf':'pdf','.mp4':'video','.webm':'video','.mkv':'video','.mp3':'audio','.wav':'audio','.m4a':'audio','.ogg':'audio'}
logging.getLogger('pypdf').setLevel(logging.ERROR)
try:
    from pypdf import PdfReader
except ImportError:
    PdfReader=None

def index_file(file,root):
    relative=file.relative_to(root).as_posix();parts=Path(relative).parts
    name=file.stem
    if relative=='textbook_lesson_all.pdf':title='NHK WORLD-JAPAN 简明日语 · 48 课中文教材'
    elif relative=='textbook_appendix.pdf':title='NHK WORLD-JAPAN 简明日语 · 动词与实用词汇附录'
    else:
        # Keep original reading titles rather than inventing translations.
        title=name.split(' -- ')[0].replace('_',' ').strip()
    item={'id':'local-'+hashlib.sha256(relative.encode('utf-8')).hexdigest()[:16],
          'title':title,'relativePath':relative,'kind':KINDS[file.suffix.lower()],
          'level':'不限','category':'综合教材','bytes':file.stat().st_size,
          'sourceId':'user-local','storage':'local','searchText':title+' '+relative}
    if parts[0] in {'0','1','2','3','4','5'}:
        item.update(level='分级阅读',readingLevel='L'+parts[0],category='分级阅读',
                    levelNote='原资料的多读阅读分级 L0–L5，与 JLPT N5–N1 不直接对应。')
    elif '敬語' in relative:
        item.update(level='商务',category='敬语',tags=['敬语','视频讲解'])
    elif 'IT業務' in relative:
        item.update(level='商务',category='IT 职场',tags=['商务日语','IT','职场会话'])
    elif 'ビジネス' in relative:
        item.update(level='商务',category='商务日语',tags=['商务日语','职场'])
    elif relative.startswith('textbook_'):
        item.update(level='入门',category='基础教材',tags=['中文教材','NHK','日常会话'])
    elif '初级' in relative:item.update(level='初级',tags=['综合教材','扫描资料'])
    elif '中级' in relative:item.update(level='中级',tags=['综合教材','扫描资料'])
    if item['kind']=='pdf' and PdfReader:
        try:
            reader=PdfReader(file,strict=False)
            item['pageCount']=len(reader.pages)
        except Exception as exc:item['indexNote']='页数暂不可读取：'+type(exc).__name__
    return item

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--local',type=Path,default=Path('local-library'));args=ap.parse_args()
    local=args.local.resolve()
    if not local.is_dir():raise SystemExit('Local resource folder does not exist: '+str(local))
    # hsqsl is an unrelated game archive directory, not Japanese learning material.
    files=[p for p in local.rglob('*') if p.is_file() and p.suffix.lower() in KINDS and p.relative_to(local).parts[0]!='hsqsl']
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        resources=list(pool.map(lambda path:index_file(path,local),files))
    def natural(item):return [int(s) if s.isdigit() else s.lower() for s in re.split(r'(\d+)',item['relativePath'])]
    resources.sort(key=natural)
    output=ROOT/'public'/'data'/'resources.json';output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(resources,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'resources':len(resources),'kinds':dict(collections.Counter(x['kind'] for x in resources)),
      'categories':dict(collections.Counter(x['category'] for x in resources)),
      'pages':sum(x.get('pageCount',0) for x in resources),'withPageCount':sum('pageCount' in x for x in resources)},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
