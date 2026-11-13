"""Download unchanged official originals for this user's personal study library.

python scripts/download-resources.py
Uses only the Python standard library. Already downloaded, valid files are kept.
These JLPT/Irodori originals are personal-study copies, not a redistributable
part of the app's own lessons. Keep them out of public application releases.
"""
from pathlib import Path
import concurrent.futures,datetime,hashlib,json,re,urllib.request
from urllib.parse import quote,urlparse

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public'/'resources'
INDEX=ROOT/'public'/'data'/'online-resources.json'
JLPT_PAGE='https://www.jlpt.jp/e/samples/sampleindex.html'
IRODORI_PAGE='https://www2.jpfbj.cn/irodori/resources/resources.php'
JLPT_POLICY='https://www.jlpt.jp/e/policy.html'
IRODORI_POLICY='https://www.irodori.jpf.go.jp/privacy.html'
BUNKA_POLICY='https://www.mext.go.jp/b_menu/1351168.htm'

def manifest():
    items=[]
    def add(id,title,level,category,kind,source,page,license,license_url,description,redistributable=False):
        items.append({'id':id,'title':title,'level':level,'category':category,'kind':kind,
          'url':'/resources/'+id+('.pdf' if kind=='pdf' else '.mp3'),
          'downloadUrl':source,'sourceUrl':page,'license':license,'licenseUrl':license_url,
          'description':description,'personalStudyOriginal':not redistributable,'redistributable':redistributable})
    sections={'V':'文字词汇','G':'语法','R':'阅读','L':'听力试题','sheet':'答题纸','answer':'参考答案','script':'听力原文'}
    for year in [2012,2018]:
        for level in ['N5','N4','N3','N2','N1']:
            for code,title in sections.items():
                add(f'jlpt-{year}-{level.lower()}-{code.lower()}',f'JLPT {level} 官方练习册 {year} · {title}',level,'官方练习册','pdf',
                  f'https://www.jlpt.jp/samples/sample{year}/pdf/{level}{code}.pdf',JLPT_PAGE,
                  'JLPT 官网条款：个人学习原件；保留第三方版权',JLPT_POLICY,
                  '日本语能力测试官方练习册原始 PDF。按原页完成后对照答案；本软件未改编或转载为自有题库。')
    # The smaller 2012 recordings cover all five levels without duplicating the larger 2018 audio set.
    for level in ['N5','N4','N3','N2','N1']:
        for question in range(1,5 if level in ['N5','N4'] else 6):
            add(f'jlpt-2012-{level.lower()}-audio-q{question}',f'JLPT {level} 官方听力 2012 · 問題 {question}',level,'官方听力','audio',
              f'https://www.jlpt.jp/samples/sample2012/mp3/{level}Q{question}.mp3',JLPT_PAGE,
              'JLPT 官网条款：个人学习原件；音频含第三方版权',JLPT_POLICY,
              '配合相同等级的 2012 听力试题、原文和答案使用。第一遍不看原文，第二遍精听核对。')
    chinese=[
      ('irodori-cn-starter-grammar','入门语法笔记','入门','语法参考','X_Grammar_All.pdf'),
      ('irodori-cn-elementary1-grammar','初级 1 语法笔记','初级','语法参考','Y_Grammar_All_260309a.pdf'),
      ('irodori-cn-elementary2-grammar','初级 2 语法笔记','初级','语法参考','Z_Grammar_All.pdf'),
      ('irodori-cn-worksheet-guide','语法练习册使用方法','入门','语法练习','lxc_yf.pdf'),
      ('irodori-cn-starter-worksheet','入门语法练习册','入门','语法练习','lxc_rm.pdf'),
      ('irodori-cn-elementary1-worksheet','初级 1 语法练习册','初级','语法练习','lxc_cj1.pdf'),
      ('irodori-cn-elementary2-worksheet','初级 2 语法练习册','初级','语法练习','lxc_cj2.pdf'),
      ('irodori-cn-worksheet-answers','语法练习册答案','入门','语法练习','lxc_da.pdf'),
      ('irodori-cn-sentence-patterns','句型汇总表','入门','语法参考','sentence_patterns_listcn.pdf'),
      ('irodori-cn-kana','平假名与片假名','入门','假名','X_Hiragana_All.pdf'),
      ('irodori-cn-starter-kanji','入门汉字词汇','入门','汉字词汇','X_Kanji_All.pdf'),
      ('irodori-cn-elementary1-kanji','初级 1 汉字词汇','初级','汉字词汇','Y_Kanji_All.pdf'),
      ('irodori-cn-elementary2-kanji','初级 2 汉字词汇','初级','汉字词汇','Z_Kanji_All.pdf'),
      ('irodori-cn-starter-vocabulary','入门单词表','入门','词汇参考','wordlist_x_Rumen_2.pdf'),
      ('irodori-cn-elementary1-vocabulary','初级 1 单词表','初级','词汇参考','wordlist_Y_Chuji1_2.pdf'),
      ('irodori-cn-elementary2-vocabulary','初级 2 单词表','初级','词汇参考','wordlist_z_Chuji2_2.pdf'),
    ]
    for id,title,level,category,name in chinese:
        add(id,'IRODORI 中文版 · '+title,level,category,'pdf','https://www2.jpfbj.cn/irodori/resources/pdf/'+quote(name),IRODORI_PAGE,
          '国際交流基金：个人学习原件；非开放再分发许可',IRODORI_POLICY,
          '北京日本文化中心（日本国际交流基金会）官方中文 PDF 原件，独立于本软件的原创课程供个人阅读。')
    add('irodori-jp-grammar-all','IRODORI 日文语法笔记合集（入门至初中级）','不限','语法参考','pdf',
        'https://www.irodori.jpf.go.jp/assets/data/Grammar_all.pdf','https://www.irodori.jpf.go.jp/resources.html',
        '国際交流基金：个人学习原件；非开放再分发许可',IRODORI_POLICY,'官方日文语法笔记合集原件；可与中文版对照学习。')
    add('bunka-keigo-guidelines','文化厅《敬語の指針》官方原文','商务','敬语参考','pdf',
        'https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/hokoku/pdf/keigo_tosin.pdf',
        'https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/hokoku/index.html',
        '文化庁／文部科学省网站使用条款（兼容 CC BY 4.0；第三方内容除外）',BUNKA_POLICY,
        '出典：文化庁。平成19年2月2日文化審議会答申原版；本软件未修改 PDF。涵盖敬语体系、选择原则和具体用法。',True)
    return items

def fetch(item):
    path=OUT/Path(item['url']).name
    if path.exists():data=path.read_bytes()
    else:
        request=urllib.request.Request(item['downloadUrl'],headers={'User-Agent':'PersonalJapaneseStudyLibrary/1.0'})
        with urllib.request.urlopen(request,timeout=120) as response:data=response.read()
    if item['kind']=='pdf' and not data.startswith(b'%PDF-'):raise ValueError('Not a PDF: '+item['id'])
    if item['kind']=='audio' and not (data.startswith(b'ID3') or (data[0]==255 and data[1]&224==224)):
        raise ValueError('Not an MP3: '+item['id'])
    if not path.exists():path.write_bytes(data)
    return dict(item,bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),downloadedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())

def main():
    OUT.mkdir(parents=True,exist_ok=True);INDEX.parent.mkdir(parents=True,exist_ok=True)
    items=manifest();results=[];failures=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures={pool.submit(fetch,item):item for item in items}
        for future in concurrent.futures.as_completed(futures):
            item=futures[future]
            try:
                result=future.result();results.append(result)
                print('OK',item['id'],result['bytes'],flush=True)
            except Exception as exc:
                failures.append({'id':item['id'],'error':str(exc)})
                results.append(dict(item,kind='external',url=item['downloadUrl'],downloadError='暂未能下载，请打开官网原件'))
                print('LINK ONLY',item['id'],type(exc).__name__,flush=True)
    ordered={x['id']:idx for idx,x in enumerate(items)};results.sort(key=lambda x:ordered[x['id']])
    for id,title,url,description in [
      ('jlpt-official-library','JLPT 官方练习册完整下载页',JLPT_PAGE,'两册官方练习册、答案与听力；可补充下载 2018 听力。'),
      ('irodori-official-chinese','IRODORI 官方中文版教材','https://www2.jpfbj.cn/irodori/','入门与初级生活日语完整教材、配套音频。'),
      ('irodori-official-audio','IRODORI 官方音频播放','https://www.irodori.jpf.go.jp/starter/audio.html','官方原声会话与词汇音频；在线练习跟读和复述。')]:
        results.append({'id':id,'title':title,'level':'不限','category':'官方网站','kind':'external','url':url,
          'sourceUrl':url,'license':'官方网站链接，按来源网站条款使用','description':description})
    INDEX.write_text(json.dumps(results,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    summary={'downloadedFiles':sum(x['kind']!='external' for x in results),'pdfs':sum(x['kind']=='pdf' for x in results),
       'audio':sum(x['kind']=='audio' for x in results),'bytes':sum(x.get('bytes',0) for x in results),'failures':failures}
    (OUT/'download-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    if failures:raise SystemExit(1)

if __name__=='__main__':main()
