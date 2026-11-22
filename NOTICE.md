# Third-party materials and publication scope

The top-level MIT license covers original application code and original instructional additions only.
It does not relicense third-party libraries, dictionary data, source literary works, or external teaching materials.
Keep all notices together with redistributed files.

Frontend dependency bundles retain their license files under `public/vendor/`.
These include CodeMirror where present, Acorn, and the Markdown/highlighting bundles.
No API keys, model configurations, conversation history, learner progress, recordings, private PDFs, or videos are included.
Test fixtures named as progress records are synthetic regression fixtures, not a user's learning history.

## Japanese dictionaries and reading material

- The vocabulary/kanji data and derived dictionary definitions retain their source-specific licensing, including CC BY-SA 4.0. See `public/data/vocabulary-meta.json` and `public/data/licenses/`.
- JMdict/EDRDG, Tomoshi Chinese definitions and the source maintainers remain attributed in the supplied notices. Reuse of share-alike data must keep its applicable license.
- Kuromoji retains Apache-2.0; IPADIC retains its separate NAIST/ICOT and other supplied notices.
- Aozora literary texts are public-domain source works under the source site's stated reuse rules; preserve the source URLs, original production credits and conversion notices shipped with each work. Original prose is not claimed as MIT-authored content.
- The public repository excludes downloaded JLPT/IRODORI and other personal-use-only official PDFs/audio. Their catalog entries open the official source site.
- The six public-domain Aozora novels and six Creative Commons Attribution 4.0 (CC BY 4.0) modern light novels from Hoshizora Bunko (星空文庫, https://slib.net/) are distributed only from the reviewed `seed/novels` package, with accompanying attribution and provenance notices under `seed/licenses/`. User-imported ebooks under `local-config/novels` are excluded.
- The six CC BY 4.0 Hoshizora Bunko light novels (`留年ガールの恋事情` by 蒼生, `魔法の科学的根拠` by アルケニア, `死神さんのお仕事` by ヤカ, `MANA & DREAM 白狐の願い` by 広瀬ナオキ, `重なり合うプシュケーの塔` by 南天, `#梓にだって,華が咲く。` by 紅羽) remain governed by CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/deed.ja), not the top-level MIT license. Retain author attribution, source URLs, and license notices when redistributing.
- The unchanged 82-page Agency for Cultural Affairs report `public/resources/bunka-keigo-guidelines.pdf` is included under the MEXT website terms, compatible with CC BY 4.0. Attribution, source, terms, review date and SHA-256 are in `public/data/licenses/bunka-keigo-guidelines.md`. It is not MIT-licensed application content.
- Locally indexed commercial textbooks, graded readers and NHK PDFs are excluded because a public redistribution license was not established. Free personal downloads and classroom-use permissions are not treated as permission to mirror entire books on GitHub. All videos remain excluded.

Automatic annotation and machine-assisted dictionary definitions can be ambiguous. Source license metadata and limitations remain included with the data.
