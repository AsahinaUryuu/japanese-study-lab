"""Import five complete public-domain stories from downloaded Aozora XHTML.
Run after import-aozora.py. Idempotently replaces only these five books.
Gaiji images with JIS X 0213 coordinates are decoded losslessly to Unicode.
"""
from pathlib import Path
import importlib.util,json,hashlib,re

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('aozora',ROOT/'scripts/import-aozora.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Parser(module.Aozora):
    def __init__(self,title):
        super().__init__();self.default_title=title;self.gaiji=0
    def flush(self):
        if not self.heading and not self.chapters and ''.join(self.buf).strip():
            self.chapters.append({'title':self.default_title,'titleReadings':[],'paragraphs':[]})
        super().flush()
    def handle_starttag(self,tag,attrs):
        super().handle_starttag(tag,attrs)
        if self.active and tag=='img':
            attrs=dict(attrs);match=re.search(r'gaiji/([12])-\d+/[12]-(\d+)-(\d+)\.png',attrs.get('src',''))
            if not match:raise ValueError('Unmapped source image: '+str(attrs))
            plane,ku,ten=map(int,match.groups())
            char=(b'\x1b$('+(b'Q' if plane==1 else b'P')+bytes([ku+32,ten+32])+b'\x1b(B').decode('iso2022_jp_2004')
            assert all(ord(c)<=0xffff for c in char),'UTF16 conversion required'
            self.buf.append(char);self.gaiji+=1
    def handle_endtag(self,tag):
        if self.notes and tag=='br':self.note.append('\n')
        super().handle_endtag(tag)

BOOKS=[
 dict(key='chumon',title='注文の多い料理店',subtitle='要求特别多的餐厅',author='宮沢賢治',level='N2',genre='奇幻童话',card='000081/card1927',file='1927_17906',
      description='两个猎人在山里发现一家西餐厅。每扇门上的要求都很周到，却也越来越不对劲。带反转的奇幻童话，适合练习对话和指示表达。'),
 dict(key='donguri',title='どんぐりと山猫',subtitle='橡子与山猫',author='宮沢賢治',level='N2',genre='奇幻童话',card='000081/card43752',file='43752_17657',
      description='一郎收到山猫寄来的古怪明信片，进入森林参加一场谁也不肯服输的审判。动物、橡子和荒诞的争论，组成一篇有趣的森林故事。'),
 dict(key='kumo',title='蜘蛛の糸',subtitle='蜘蛛之丝',author='芥川龍之介',level='N2',genre='寓言短篇',card='000879/card92',file='92_14545',
      description='地狱深处垂下一根细细的蜘蛛丝，成为一个人逃离苦海的机会。篇幅短、转折集中，适合一次读完再思考人物的选择。'),
 dict(key='toshishun',title='杜子春',subtitle='杜子春',author='芥川龍之介',level='N1',genre='奇幻冒险',card='000879/card43015',file='43015_17432',
      description='穷困的青年遇见神秘老人，经历财富、修行与严酷考验。他想获得的究竟是什么？六章完整的奇幻故事，适合持续精读。'),
 dict(key='yume',title='夢十夜',subtitle='梦十夜',author='夏目漱石',level='N1',genre='梦境幻想',card='000148/card799',file='799_14972',
      description='十场彼此独立的梦，将等待、恐惧、孤独与奇异的相遇化为画面。可以每晚读一夜，练习从描写中理解气氛与隐含意义。')
]
def main():
    data=ROOT/'public/data';path=data/'stories-classics.json';value=json.loads(path.read_text(encoding='utf-8'))
    value['series']=[b for b in value['series'] if b['id'] not in {'s-'+b['key'] for b in BOOKS}]
    for info in BOOKS:
        key=info['key'];raw=(ROOT/f'../japanese-research/aozora-{key}-original.html').read_bytes()
        parser=Parser(info['title']);parser.feed(raw.decode('cp932'));parser.close()
        chapters=[]
        for ci,original in enumerate(parser.chapters,1):
            assert original['paragraphs']
            groups=[];group=[];length=0
            for p in original['paragraphs']:
                assert '\ufffd' not in p['ja'] and all(ord(c)<=0xffff for c in p['ja'])
                for r in p['sourceReadings']:assert p['ja'][r['start']:r['end']]==r['text'] and r['reading']
                if group and length+len(p['ja'])>2400:groups.append(group);group=[];length=0
                group.append(p);length+=len(p['ja'])
            if group:groups.append(group)
            for i,paragraphs in enumerate(groups,1):
                chapters.append(dict(id=f's-{key}-{ci:02d}-{i:02d}',title=original['title']+(f'（{i} / {len(groups)}）' if len(groups)>1 else ''),
                  sourceChapter=ci,sourceTitle=original['title'],titleReadings=original['titleReadings'],
                  summary=f'日文完整原著 · 第 {ci} 章'+(f' · 阅读分节 {i} / {len(groups)}' if len(groups)>1 else ''),paragraphs=paragraphs,vocabulary=[],questions=[]))
        original=''.join(p['ja'] for c in parser.chapters for p in c['paragraphs'])
        rebuilt=''.join(p['ja'] for c in chapters for p in c['paragraphs'])
        assert original==rebuilt and len(rebuilt)>1000
        prefix='https://www.aozora.gr.jp/cards/'+info['card'].split('/')[0]
        notes=''.join(parser.note).strip();credits='；'.join(re.findall(r'(?:入力|校正)：[^\r\n]+',notes))
        book={k:v for k,v in info.items() if k not in ('key','card','file')}
        book.update(id='s-'+key,kind='classic',license='公版原著 · 青空文库',chapters=chapters,
          sourceUrl='https://www.aozora.gr.jp/cards/'+info['card']+'.html',sourceTextUrl=prefix+'/files/'+info['file']+'.html',
          sourcePolicyUrl='https://www.aozora.gr.jp/guide/kijyunn.html',noticeUrl=f'/data/licenses/aozora-{key}-NOTICE.md',
          sourceNote=f'保留青空文库日文完整正文、原版注音和原章顺序。长章按阅读长度分节；原版外字图片转换为同一 Unicode 字符。文中有文学用语和古旧表记。',
          translationNote='原著精读版 · 日文全文与词语中文释义',attribution=credits+'。青空文库志愿者制作。',
          sourceSha256=hashlib.sha256(raw).hexdigest(),textSha256=hashlib.sha256(rebuilt.encode()).hexdigest(),
          originalChapterCount=len(parser.chapters),characterCount=len(rebuilt),gaijiConverted=parser.gaiji)
        value['series'].append(book)
        notice=f"# 《{book['title']}》来源与转换说明\n\n作者：{book['author']}\n图书卡：{book['sourceUrl']}\n原版：{book['sourceTextUrl']}\n文件使用说明：{book['sourcePolicyUrl']}\n\n公版作品。根据青空文库文件使用说明复制与转换；书目数据依原站 CC BY 4.0。\n转换保留完整日文正文、原章顺序与原版 ruby；长章分节。{parser.gaiji} 处 JIS X 0213 外字图片无损转为 Unicode。\n未引入商业中译本。补充注音和查词来自独立词典数据，其许可另见词典说明。\n\n## 原文件书目信息与署名\n\n{notes}\n\n原 XHTML SHA256：{book['sourceSha256']}\n正文 SHA256：{book['textSha256']}\n"
        (data/'licenses'/f'aozora-{key}-NOTICE.md').write_text(notice,encoding='utf-8')
        print(key,json.dumps({k:book[k] for k in ['originalChapterCount','characterCount','gaijiConverted']},ensure_ascii=False),'sections',len(chapters))
    path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
if __name__=='__main__':main()
