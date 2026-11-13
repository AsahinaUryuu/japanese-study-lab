"""Append independently authored textbook readings without replacing existing lessons.

Source TSV columns: id, module, title, scene, Japanese, Chinese, vocabulary,
focus quotation, focus explanation, comprehension question, reference answer.
Vocabulary: word~reading~meaning[~surface], separated with semicolons.
"""
from pathlib import Path
import argparse, json

ROOT=Path(__file__).resolve().parents[1]
MODULES={
 'n5':[
  ('identity','身份与基本句型'),('pointing','指示与空间位置'),('description','描述、比较与喜好'),
  ('verbs','动词分组与基础活用'),('daily','日常行动与时间安排'),('intent','愿望、建议与邀请'),
  ('requests','请求、许可与禁止'),('connected','把日常表达连成短文')],
 'n4':[
  ('expression','普通形与复合表达'),('time','动作顺序与时间界线'),('plans','打算与决定'),
  ('duties','建议、义务与行为选择'),('states','动作结果、准备与变化'),('giving','授受与互助'),
  ('evidence','信息来源与推测'),('conditions','条件、原因与让步')],
 'n3':[
  ('voice','受身、使役与行动立场'),('respect','尊敬、谦让与郑重表达'),('content','引用、疑问与名词化'),
  ('purpose','目的、变化与行为规则'),('judgment','范围、依据与判断'),('time','状态保持与时间关系'),
  ('relations','话题、身份与关系连接')]
}
CHAPTERS={'n5':'N5 · 日语入门','n4':'N4 · 日常表达','n3':'N3 · 情境与逻辑'}

def load_tsv(path):
 result=[]
 for number,line in enumerate(path.read_text(encoding='utf-8').splitlines(),1):
  if not line.strip():continue
  parts=line.split('¦')
  assert len(parts)==11,(path.name,number,len(parts))
  key,module,title,scene,ja,zh,terms,quote,explanation,question,answer=parts
  vocabulary=[]
  for term in terms.split(';'):
   fields=term.split('~')
   assert len(fields) in [3,4],(key,fields)
   value=dict(zip(['word','reading','meaning','surface'],fields))
   assert value.get('surface',value['word']) in ja,(key,value)
   vocabulary.append(value)
  assert quote in ja,(key,quote)
  assert 4<=len(vocabulary)<=8,(key,len(vocabulary))
  result.append({'id':key,'module':module,'textbook':{'title':title,'scene':scene,
   'paragraphs':[{'ja':ja,'zh':zh}],'vocabulary':vocabulary,
   'focus':[{'quote':quote,'explanation':explanation}],
   'readingQuestions':[{'question':question,'answer':answer}]}})
 return result

def build(level):
 path=ROOT/'public/data'/f'grammar-{level}.json'
 lessons=json.loads(path.read_text(encoding='utf-8'))
 readings=load_tsv(ROOT/'scripts'/f'build-textbook-{level}.tsv')
 assert len(readings)==len(lessons),(level,len(readings),len(lessons))
 indexed={r['id']:r for r in readings}
 assert len(indexed)==len(readings)
 assert set(indexed)=={l['id'] for l in lessons}
 modules=dict(MODULES[level]); ordered={key:i+1 for i,(key,_) in enumerate(MODULES[level])}
 ranks={r['id']:i+1 for i,r in enumerate(readings)}
 for lesson in lessons:
  row=indexed[lesson['id']]; module=row['module']
  assert module in modules,(lesson['id'],module)
  lesson['textbook']=row['textbook']
  lesson['curriculum']={'program':'jlpt','chapterId':level,'chapterTitle':CHAPTERS[level],
   'moduleId':level+'-'+module,'moduleTitle':modules[module],
   'order':ordered[module]*100+ranks[lesson['id']]}
 path.write_text(json.dumps(lessons,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(level.upper(),len(lessons),'readings;',len({r['module'] for r in readings}),'modules')

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--levels',nargs='+',default=['n5','n4','n3'])
 for level in parser.parse_args().levels:build(level)
