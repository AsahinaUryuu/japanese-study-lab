# 1.7 原创教学深化记录

本轮在原有 351 课中扩充 20 节，不新增空章节，不替换原教材。每节追加一篇完整第二场景短文、全文中文对照、三步精读、易错对比、两个迁移例句、三道客观题和双向翻译。共 20 篇短文、60 个教学区段、60 道客观题、40 道翻译题、120 条逐题评分点。

选题依据是已有练习较多停留于定义和接续识别，以及部分工作场景只包含一轮简短沟通。本轮增加由证据判断范围、区分事实与推测、澄清承诺和比较近义表达的任务；也增加初学者的问答焦点、状态和条件先后训练。

| 范围 | 已有小节 |
|---|---|
| N5 | `g-n5-002`：话题与主体、问谁与答谁 |
| N4 | `g-n4-027`：动作进行与结果状态；`g-n4-044`：なら与たら的前提及先后 |
| N3 | `g-n3-029`：个人习惯与团队安排 |
| N2 | `g-n2-010`：ものの与预期落差；`g-n2-011`：とはいえ与适用范围；`g-n2-040`：风险可能性与答复限制 |
| N1 | `g-n1-028`：责任与情绪；`g-n1-029`：有条件的可能与正式承诺；`g-n1-034`：最低要求与不必做到 |
| 读解 | `reading-n2-hybrid`：比较条件与归因；`reading-n1-archives`：记录缺席与证据边界 |
| 商务 | `b-uchi-soto`、`b-itadaku-kudasaru`、`b-mail-structure`、`b-meeting-interrupt` |
| IT | `it-scope`、`it-estimation`、`it-reproduction`、`it-incident-timeline` |

## 来源与写作边界

核对日期：2026-11-14。以下链接直接绑定相应课程 `sourceRefs`，不是只保存在构建说明里。

- [JLPT 各级能力描述](https://www.jlpt.jp/e/about/levelsummary.html)：用于 N2/N1 阅读结构、内容、意图等能力目标，不声称是官方逐项语法表。
- [JF 日本语教育标准](https://www.jfstandard.jpf.go.jp/summary/ja/render.do)：用于以任务完成能力设计场景、目标与评价。
- [文化厅《敬语的指针》](https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/hokoku/pdf/keigo_tosin.pdf)：核对いただく／くださる的视角和助词，以及对外介绍己方上司的内外关系；特别参考正文第 32、40、43–44 页。
- [国际交流基金「ものの」](https://www.kyozai.jpf.go.jp/kyozai/material/BMA00058/ja/render.do)：核对承认前项但后项不符合预期的用法。该页面可能要求登录；其中旧分级标签不当作现行官方语法清单。

日文短文、对比例句、中文讲解、题目和参考译文均为本轮原创，没有复制外部教材文章。JLPT 不直接证明口语或岗位胜任能力，以上工作场景也不构成实际项目估算标准或考试通过保证。

## 数据兼容与构建

- 原题、原翻译、原教材全文及 `curriculum` 不动；`tests/fixtures/content-before-v1.7.json` 保存 20 节原始契约哈希与 ID。测试比较完整题目内容，避免只检查 ID 而漏掉选项、答案变化。
- 新客观题 ID 为 `<lesson>-v17-q1..q3`，新翻译为 `<lesson>-v17-t1..t2`，均标记 `introducedIn: "1.7.0"`。题目追加在原数组尾部。
- 翻译评分点按具体句子单独编写，采用 4+3+3 分；不会要求短句必须翻译它未包含的全文事实，参考答案不是唯一译法。
- 原教材 `reader.json` 逐字保持原 SHA256；第二场景进入统一 `sections.examples` 注音与查词链路。重建后用完整文本匹配，原教材不会错用新段落的 tokens。
- 混合中文标题中的独立连接词「与」不再被误识别为日语词。日语动词「与える」及完整日文段落仍可正常注音。

生成内容：`python -X utf8 scripts/deepen-lessons-v1.7.py`。脚本可重复运行，遇到旧契约改变会报错，不会悄悄接受新基线。

构建资源位于应用外时，可以显式传入目录：

```text
node scripts/build-reader-tokenize.mjs --deps <reader-build>
python -X utf8 scripts/build-reader.py --source <reader-build>/reader-tokens.json --dictionary <dictionary.db>
node scripts/build-reader-supplement-tokenize.mjs --build-dir <reader-build>
python -X utf8 scripts/build-reader-supplement.py --build-dir <reader-build> --dictionary <dictionary.db>
```

范围清单、来源角色和量化统计同时保存在 `public/data/content-updates-v1.7.json`。新增 `tests/content-deepening.test.mjs` 验证旧契约、版本标记、题目身份、逐题评分点、正文完整性、来源绑定、注音查词及中文连接词边界。
