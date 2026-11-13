"""Build original Chinese teaching units from hand-authored, reviewable records.

The JLPT level labels are teaching-path estimates, not an official exam list.
The TSV sources contain original explanations/examples rather than web copies.
"""
from pathlib import Path
import json,re

ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(__file__).parent
OUT=ROOT/'public'/'data'
OUT.mkdir(parents=True,exist_ok=True)
LEVELS=['N5','N4','N3','N2','N1']
official='https://www.jlpt.jp/e/about/levelsummary.html'
reference='https://www.coelang.tufs.ac.jp/mt/ja/gmod/'
enrichment=json.loads((SOURCE/'build-grammar-enrichment.json').read_text(encoding='utf-8'))
n1_spoken=json.loads((SOURCE/'build-grammar-n1-spoken.json').read_text(encoding='utf-8'))
answer_variants=json.loads((SOURCE/'build-grammar-answer-variants.json').read_text(encoding='utf-8'))
speaking_tasks=json.loads((SOURCE/'build-grammar-speaking.json').read_text(encoding='utf-8'))
# Keep lesson IDs stable while presenting morphology before the forms it supports.
n5_order=[1,41,2,45,3,4,5,6,7,8,9,19,20,21,42,36,37,16,17,18,40,38,39,10,11,12,13,14,43,15,44,22,23,24,25,26,27,28,29,30,31,32,33,34,35]

def choices(correct,candidates,seed):
    wrong=[]
    for candidate in candidates:
        if candidate!=correct and candidate not in wrong:
            wrong.append(candidate)
        if len(wrong)==3:break
    assert len(wrong)==3,(correct,wrong)
    answer=seed%4
    result=wrong[:]
    result.insert(answer,correct)
    return result,answer

total=0
for level in LEVELS:
    src=SOURCE/f'build-grammar-{level.lower()}.tsv'
    if not src.exists():continue
    records=[]
    for line_number,line in enumerate(src.read_text(encoding='utf-8').splitlines(),1):
        if not line.strip():continue
        row=line.split('¦')
        assert len(row)==9,(src.name,line_number,len(row))
        title,form,meaning,use,marked,zh1,ja2,zh2,pitfall=row
        match=re.search(r'\{([^{}]+)\}',marked)
        assert match and len(re.findall(r'\{',marked))==1,(src.name,line_number)
        records.append(dict(title=title,form=form,meaning=meaning,use=use,marked=marked,ja1=marked.replace('{','').replace('}',''),zh1=zh1,ja2=ja2,zh2=zh2,pitfall=pitfall,gap=match.group(1)))
    lessons=[]
    for index,row in enumerate(records):
        key=f'g-{level.lower()}-{index+1:03d}'
        def pool(field):
            ordered=records[index+1:]+records[:index]
            return [r[field].split('。')[0] if field=='meaning' else r[field] for r in ordered]
        meaning=row['meaning'].split('。')[0]
        meaning_options,meaning_answer=choices(meaning,pool('meaning'),index)
        form_options,form_answer=choices(row['form'],pool('form'),index+1)
        reading_options,reading_answer=choices(row['zh2'],pool('zh2'),index+2)
        lesson={
          'id':key,'level':level,'track':'grammar','title':row['title'],
          'subtitle':meaning,'minutes':18 if level in ['N5','N4'] else 24,
          'goals':[f"理解「{row['title'].split('：')[0]}」的意义和接续",'区分本课表达与易混用法','能在完整语境中造句、翻译并说出来'],
          'prerequisites':[],
          'sections':[
            {'heading':'先理解：这句话在表达什么','body':[row['meaning'],row['use']]},
            {'heading':'接续与造句','body':[row['form']+'。','先找到句中的主体、时间和说话立场，再把前项变成所需形式。动词有辞书形、ます词干、て形、た形、ない形等变化；不要直接把汉语词序套入日语。']},
            {'heading':'例句精读：把形式放回语境','body':['先读日文并判断关系，再展开或对照中文。朗读时把助词和前面的词连起来，不要按汉字逐字停顿。'],
             'examples':[{'ja':row['ja1'],'zh':row['zh1'],'note':f"本句练习形式：{row['gap']}"},{'ja':row['ja2'],'zh':row['zh2']}]},
            {'heading':'易混点与使用边界','body':[row['pitfall']]}
          ],
          'quiz':[
            {'id':key+'-q1','type':'choice','prompt':f"本课「{row['title'].split('：')[0]}」主要表达什么？",'options':meaning_options,'answer':meaning_answer,'explanation':row['meaning']},
            {'id':key+'-q2','type':'choice','prompt':f"按本课用法，哪一项接续说明正确？（{row['title']}）",'options':form_options,'answer':form_answer,'explanation':row['form']+'。'+row['pitfall']},
            {'id':key+'-q3','type':'fill','prompt':f"按本课例句所用的形式补全，不改变句子其他部分（允许正确的假名写法）：\n{re.sub(r'\{[^{}]+\}','（　）',row['marked'])}\n句意：{row['zh1']}",'answer':row['gap'],'accepted':list(dict.fromkeys([row['gap']]+answer_variants.get(row['gap'],[]))),'explanation':row['ja1']+'\n'+row['form']+'。'},
            {'id':key+'-q4','type':'choice','prompt':'选择最贴切的中文意思：\n'+row['ja2'],'options':reading_options,'answer':reading_answer,'explanation':row['zh2']+'\n'+row['pitfall']}
          ],
          'translation':[
            {'id':key+'-tr1','direction':'zh-ja','prompt':row['zh1'],'reference':row['ja1'],'notes':['尝试使用本课表达；自然译法不止一种，不应只按逐字相等判断。',row['form']+'。',row['pitfall']]},
            {'id':key+'-tr2','direction':'ja-zh','prompt':row['ja2'],'reference':row['zh2'],'notes':['先还原主体、时态、否定范围与语气，再整理成自然中文。',row['meaning']]}
          ],
          'speaking':[{'id':key+'-sp1','scene':row['use'],'role':'你是正在解释自己想法或经历的说话人','task':f"先朗读「{row['ja2']}」，再替换人物、地点或时间，围绕自己的生活说出两句。使用「{row['title'].split('：')[0]}」，并补一句理由或具体情境。",'modelAnswer':row['ja2'],'checks':['接续形式是否正确','否定、时间和说话立场是否与原意一致','是否说出了完整句子而非只报语法名称','能否脱离参考句说一个真实例子']}],
          'summary':{'professional':row['form']+'。'+row['meaning'],'plain':row['use']+' 记住：'+row['pitfall']},
          'sourceRefs':[official]+([reference] if level in ['N5','N4'] else []),
          'sourceNote':'课文、例句和题目为本软件原创编写。链接用于说明分级能力和基础语法参考；并非官方语法清单或逐课原文来源。',
          'levelNote':'等级为本软件的学习顺序参考；现行JLPT未公布固定语法清单。',
          'tags':[level,'语法','原创教材','翻译','口语迁移']
        }
        extra=enrichment.get(key,{})
        if key=='g-n5-001':
            lesson['translation'][0]['notes'].insert(0,'本题先练「私＝我、留学生＝留学生」与「名词＋です」；不需要加入尚未学习的动词小句修饰。')
        if extra.get('body'):
            lesson['sections'].insert(2,{'heading':'一步步理解：从词语到完整句子','body':extra['body']})
        if extra.get('quiz'):
            lesson['quiz'].append({'id':key+'-q5','type':'choice',**extra['quiz']})
        if key in speaking_tasks:
            lesson['speaking'][0].update(speaking_tasks[key])
        if key in ['g-n1-016','g-n1-017']:
            lesson['sourceRefs'].append('https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/shoiinkai/iinkai_07/pdf/shiryo_2.pdf')
        if level=='N1':
            assert key in n1_spoken,key
            assert n1_spoken[key]['sourceSentence']==row['ja2'],f'{key}: spoken exercise source changed; review the paraphrase before rebuilding'
            lesson['speaking'][0].update({
              'role':'你正在向同事解释一段正式文章或公告',
              'task':f"先朗读「{row['ja2']}」，再用自然、易懂的日语向同事说明它的意思。尝试不用「{row['title'].split('：')[0]}」这个书面构式，同时保留原句的范围、否定、时间关系与评价强度。最后补一句自己的解释或应对。",
              'sourceSentence':n1_spoken[key]['sourceSentence'],
              'modelAnswer':n1_spoken[key]['modelAnswer'],
              'checks':['能否用自然会话解释书面表达','有没有把否定、范围、先后或因果关系翻反','是否保留推测、批评、赞赏等说话立场','能否根据同事关系选择适当礼貌程度，而不生硬堆砌高级语法']
            })
        lessons.append(lesson)
    if level=='N5':
        assert sorted(n5_order)==list(range(1,len(lessons)+1))
        lessons=[lessons[number-1] for number in n5_order]
    (OUT/f'grammar-{level.lower()}.json').write_text(json.dumps(lessons,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    total+=len(lessons)
    print(level,len(lessons),f'{sum(len(x["quiz"]) for x in lessons)} questions')
print('Total',total)
