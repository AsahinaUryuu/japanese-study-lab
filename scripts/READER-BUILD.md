# 离线课文注音与查词构建

软件运行时只读取 public/data/reader.json 和 reader-supplement.json，不运行分词器，不联网，不需要 npm install。
以下步骤只供维护者在修改课文或语境校对后重新生成数据。

1. 在软件目录之外建立构建依赖目录：

   npm install --prefix ../japanese-research/reader-build --cache ../japanese-research/reader-build/npm-cache --registry https://registry.npmjs.org --ignore-scripts --no-audit --no-fund kuromoji@0.1.2

2. 保留已下载的开放词典原件：

   ../japanese-research/vocabulary-sources/tomoshi-dict-open.db

3. 从本软件目录运行：

   node scripts/build-reader-tokenize.mjs --deps ../japanese-research/reader-build

   python -X utf8 scripts/build-reader.py

4. 验证：

   node --test tests/reader-data.test.mjs tests/reader-state.test.mjs

原始分词中间文件保存在外部研究目录 reader-build/reader-tokens.json。依赖、缓存、
原始 SQLite 均不进入正式安装；脚本不会改教材 JSON、用户进度或接口配置。

## 关联原则

- 段词逐字拼接须还原原文，包括空格、换行、标点。
- reading 是该段表面形的平假名，wordId 指向原形词条；两者不得混为一谈。
- 原有词库和 curriculum-core.js 的 textbookWords 生成器是 ID 的唯一来源。
- 正文教材词汇只在分词完整边界合并；不会把「方向」中的「方」单独套用另一读音。
- reader-overrides.json 按课、段、出现次数、前后文校对同形异音和数字连读。
- 词典关联必须同时符合表记、读音、读音限制；不能只凭一个汉字猜词义。
- 能产出的五段可能形可还原为经词典词性验证的原动词。来る等不规则词不能仅替换假名尾部。
- 无可靠词义的片段保留原文和可靠读音，不创建猜测性词卡；清单见 reader-uncovered.json。
- 新词 ID = reader- + SHA256(原形 + NUL + 平假名) 的前 16 位，不依赖时间或段落顺序。

## 来源与许可

Kuromoji 0.1.2 的构建 API 和 token 字段依据官方项目文档：
https://github.com/takuyaa/kuromoji.js

软件许可证为 Apache-2.0，所带 IPADIC 数据保留 NAIST/ICOT 声明：
https://github.com/takuyaa/kuromoji.js/blob/master/LICENSE-2.0.txt
https://github.com/takuyaa/kuromoji.js/blob/master/NOTICE.md

词义来自既有教材词汇，以及 JMdict / Tomoshi 开放中文释义：
https://github.com/tomoshi-app/tomoshi-dict-data
https://www.edrdg.org/edrdg/licence.html

本构建仅使用 entries、forms、zh_defs 三表（CC BY-SA 4.0），不使用其他专有数据；
保留 EDRDG 与 Y1Z 署名、完整许可和修改说明。源数据库中文释义为 AI 辅助翻译层，
不是权威人工审订词典；多义词展示词典义项，不假装全部义项都适合当前句子。

语境校对者撰写的短释义标记为 reader-reviewed。加工后的词典子集仍遵守 CC BY-SA 4.0。
public/data/reader-meta.json 记录构建来源、输入文件哈希、统计与未覆盖清单。


## v1.3 教学与课外阅读补充构建

基础 reader.json 和原有词条 ID 保持 v1.2 不变。新数据单独写入 reader-supplement.json。

1. 原著导入：将相应 Aozora 原版 XHTML 保存在 ../japanese-research（名称见导入脚本）。
   先运行 `python -X utf8 scripts/import-aozora.py`，再运行 `python -X utf8 scripts/import-aozora-more.py`。
   后者只替换指定五部原著，可重复运行；前者会重建 classics 文件，须按此顺序执行。
2. 运行 `node scripts/build-reader-supplement-tokenize.mjs`。
3. 运行 `python -X utf8 scripts/build-reader-supplement.py`。
4. 运行 `node --test tests/reader-supplement.test.mjs tests/story-content.test.mjs tests/stories.test.mjs`。

数据涵盖 351 节课的标题、讲解、例句、重点和总结中的日语，以及 12 部故事的 70 个阅读小节。
混合中文讲解只对有日语证据的片段分词；中文范围保留原文。完整日语例句与故事逐段处理。
源 ruby 位置和读音优先于分词器与补充规则。原版外字按 JIS X 0213 坐标转为等价 Unicode。
源 ruby 切开动词时，剩余假名不作为独立词关联（例如好い的い不能关联居る）。
未可靠关联词义的片段有读音但不显示猜测词卡；维护报告在 reader-supplement-uncovered.json。

语境修订放在 scripts/reader-supplement-overrides.json，使用作品前缀、段号和前后文限定。
生成元数据记录输入文件 SHA256、原版注音数、日语覆盖、受保护中文和各项许可。
故事和例句新词沿用原形+读音的稳定 ID，可与原来复习记录合并。
原著原文、译文对照与外部作者链接清楚分离：外部链接不被下载、分词或混入课程目录。


## v1.4 用户导入内容的动态注音

内置教材/故事继续读取预生成注音。用户导入的 TXT / EPUB 通过 public/novel-annotator-worker.js 在浏览器后台按阅读小节动态处理；Kuromoji 及词典位于 public/vendor/kuromoji，无 CDN / 远端分词请求。

runtime 索引只关联现有词库表记+读音或经分词器识别的词典原形，未知词不猜测释义；源 ruby 优先。
更新本地分词资源时保留 vendor/kuromoji 下全部许可文件。服务器必须原样发送 .gz 字典，不添加 Content-Encoding。
运行 `node --test tests/novel-annotation.test.mjs tests/novel-import.test.mjs tests/novel-store.test.mjs tests/novel-progress.test.mjs` 验证功能。
