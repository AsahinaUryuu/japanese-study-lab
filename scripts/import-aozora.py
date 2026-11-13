"""Convert the downloaded Aozora No.456 XHTML into offline story reading sections.
Preserves prose and source ruby offsets; does not modernize the author's wording.
Usage: python -X utf8 scripts/import-aozora.py --source ../japanese-research/ginga-456-original.html
"""
from pathlib import Path
from html.parser import HTMLParser
import argparse,hashlib,json

ROOT=Path(__file__).resolve().parents[1]

class Aozora(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active=False;self.depth=0;self.heading=False;self.ruby=None;self.capture=None
        self.buf=[];self.readings=[];self.chapters=[];self.notes=False;self.note=[]
    def flush(self):
        text=''.join(self.buf)
        if text.strip():
            if self.heading:self.chapters.append({'title':text,'titleReadings':self.readings,'paragraphs':[]})
            elif self.chapters:self.chapters[-1]['paragraphs'].append({'ja':text,'sourceReadings':self.readings})
        self.buf=[];self.readings=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='div' and attrs.get('class')=='bibliographical_information':self.notes=True
        if not self.active:
            if tag=='div' and attrs.get('class')=='main_text':self.active=True;self.depth=1
            return
        if tag=='div':self.depth+=1
        if tag=='h4':self.flush();self.heading=True
        if tag=='br':self.flush()
        if tag=='ruby':self.ruby={'start':len(''.join(self.buf)),'reading':''}
        if tag in ('rt','rp'):self.capture=tag
    def handle_endtag(self,tag):
        if self.notes and tag=='div':self.notes=False
        if not self.active:return
        if tag=='div':
            self.depth-=1
            if self.depth==0:self.flush();self.active=False
        if tag=='h4':self.flush();self.heading=False
        if tag in ('rt','rp'):self.capture=None
        if tag=='ruby' and self.ruby:
            end=len(''.join(self.buf));start=self.ruby['start']
            self.readings.append({'start':start,'end':end,'text':''.join(self.buf)[start:end],'reading':self.ruby['reading']})
            self.ruby=None
    def handle_data(self,data):
        if self.notes:self.note.append(data)
        if not self.active:return
        value=data.replace('\n','').replace('\r','')
        if self.capture=='rt':
            if self.ruby:self.ruby['reading']+=value
        elif self.capture!='rp':self.buf.append(value)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,default=ROOT/'../japanese-research/ginga-456-original.html');args=ap.parse_args()
    raw=args.source.read_bytes();source=raw.decode('cp932');parser=Aozora();parser.feed(source)
    assert len(parser.chapters)==9, len(parser.chapters)
    chapters=[]
    for chapter_index,original in enumerate(parser.chapters,1):
        groups=[];group=[];length=0
        for paragraph in original['paragraphs']:
            assert '\ufffd' not in paragraph['ja']
            assert all(ord(c)<=0xffff for c in paragraph['ja']), 'Non-BMP requires UTF16 offset conversion'
            for r in paragraph['sourceReadings']:
                assert paragraph['ja'][r['start']:r['end']]==r['text'] and r['reading']
            if group and length+len(paragraph['ja'])>2400:groups.append(group);group=[];length=0
            group.append(paragraph);length+=len(paragraph['ja'])
        if group:groups.append(group)
        for index,paragraphs in enumerate(groups,1):
            title=original['title']+(f'（{index} / {len(groups)}）' if len(groups)>1 else '')
            chapters.append({'id':f's-ginga-{chapter_index:02d}-{index:02d}','title':title,
             'sourceChapter':chapter_index,'sourceTitle':original['title'],'titleReadings':original['titleReadings'],
             'summary':f'原著第 {chapter_index} 章'+(f' · 阅读分节 {index} / {len(groups)}' if len(groups)>1 else '')+' · 日文原文精读',
             'paragraphs':paragraphs,'vocabulary':[],'questions':[]})
    original_text=''.join(p['ja'] for c in parser.chapters for p in c['paragraphs'])
    rebuilt=''.join(p['ja'] for c in chapters for p in c['paragraphs'])
    assert original_text==rebuilt and len(rebuilt)>30000
    book={'id':'s-ginga','title':'銀河鉄道の夜','subtitle':'银河铁道之夜 · 宫泽贤治完整原著','level':'N1','genre':'文学原著',
      'description':'乔班尼在星祭之夜乘上穿越银河的列车。沿途的景色、相遇与对话，逐渐展开关于友情和幸福的追问。保留文学原文，适合已有基础后进行持续精读。',
      'author':'宮沢賢治','license':'公版原著 · 青空文库 No.456','kind':'classic',
      'sourceUrl':'https://www.aozora.gr.jp/cards/000081/card456.html',
      'sourceTextUrl':'https://www.aozora.gr.jp/cards/000081/files/456_15050.html',
      'sourcePolicyUrl':'https://www.aozora.gr.jp/guide/kijyunn.html',
      'sourceNote':'新潮文库《新編 銀河鉄道の夜》底本。原作含古旧表记、文学表达和未定稿标记；此处保留原文，提供注音、查词、朗读和阅读笔记。长章按阅读长度分节，原版 9 章顺序不变。',
      'translationNote':'原著精读版 · 日文全文与词语中文释义',
      'attribution':'输入：中村隆生、野口英司；校对：野口英司。青空文库志愿者制作。1997年10月28日公开，2010年11月1日修正。',
      'sourceSha256':hashlib.sha256(raw).hexdigest(),'originalChapterCount':9,'chapters':chapters}
    data=ROOT/'public/data';(data/'stories-classics.json').write_text(json.dumps({'version':1,'series':[book]},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    notices=data/'licenses';notices.mkdir(exist_ok=True)
    notice='''# 《銀河鉄道の夜》来源与转换说明

作品：銀河鉄道の夜；作者：宮沢賢治（1896–1933）。
图书卡：https://www.aozora.gr.jp/cards/000081/card456.html
原文件：https://www.aozora.gr.jp/cards/000081/files/456_15050.html
文件使用说明：https://www.aozora.gr.jp/guide/kijyunn.html

本作品为公版原著。青空文库的文件使用说明允许对版权已到期的作品进行下载、复制、格式转换和再利用。
原图书卡书目数据依其说明以 CC BY 4.0 提供。词典派生数据的许可单独见对应词典说明。

转换：从原版 XHTML 提取 9 章日文正文，保留原版 ruby 注音及文本位置；长章分为连续阅读小节。
只将 HTML 换成结构化学习数据，不改写正文、不添加现代商业译本。
课堂之外另有独立原创故事，原创故事与此原著清楚区分。

原文件书目信息和制作署名：

'''+''.join(parser.note).strip()+'\n\n原 XHTML SHA256：'+hashlib.sha256(raw).hexdigest()+'\n'
    (notices/'aozora-ginga-NOTICE.md').write_text(notice,encoding='utf-8')
    print(json.dumps({'sourceChapters':9,'readingSections':len(chapters),'paragraphs':sum(len(c['paragraphs']) for c in chapters),'characters':len(rebuilt),'sourceRuby':sum(len(p['sourceReadings']) for c in chapters for p in c['paragraphs'])},ensure_ascii=False))

if __name__=='__main__':main()
