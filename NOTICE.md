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
- The six new public-domain novels are distributed only from the reviewed `seed/novels` package, with accompanying provenance notices. User-imported ebooks under `local-config/novels` are excluded.

Automatic annotation and machine-assisted dictionary definitions can be ambiguous. Source license metadata and limitations remain included with the data.
