# T01〜T12 実装・検証記録

T01〜T06の記述は当時の履歴として保持。現在のMVPの判定は末尾のT07〜T12と [verification.md](./verification.md) を参照してください。

計画書: [miyako-population-3d-mvp-plan.md](./miyako-population-3d-mvp-plan.md)

## T01 — 原本取得・出典固定

- `scripts/acquire_data.py`: 公式CKAN/配信カタログの都市・年度・LOD・仕様・URLを検査。人口と関連ZIPをCRC検査し、ハッシュ付き原本を `data/raw/` に保存。
- `data/source-manifest.json`: UTC取得日時、URL/リダイレクト先、年度、SHA-256、HTTP/CORS、ライセンス、ZIPエントリを記録。
- `data/plateau-2025-lod1-entry.json`: 2025年度LOD1の公式カタログエントリを保存。
- `data/acquisition-report.json`: 計画/前回取得とのハッシュ・仕様差分と判断を保存。差分時はmanifest更新を止める。原本を上書きせず、採否判断を人手レビューする。
- 検証: `python3 scripts/acquire_data.py` 成功。人口とtilesetのSHA-256は計画書と一致。関連ZIPの2024ファイル名は公式2025カタログの実名。`py_compile`成功、`git check-ignore`で原本除外を確認。
- 未解決: 全410コンテンツの到達性、地形タイル・実ブラウザー表示はこの時点では未検証。

## T02 — Vite・React・Cesium基盤

- Node 22互換の安定版をレジストリで確認し、React 19.2.8 / Vite 8.2.2 / TypeScript 7.0.2 / Cesium 1.145.0等をpackage.jsonとlockfileへ固定。
- `npm run build` 成功。`vite-plugin-static-copy` v4ではコピー元パスを保持する仕様に変わっていたため、`rename.stripBase`を指定。HTTP 200のHTML fallbackをテストが検出し、修正後は4静的ディレクトリから実ファイルのバイト一致を確認。
- `node scripts/browser_smoke.mjs dev --stage base` / `preview --stage base` とも成功。canvas 1個、WebGL2、外部HTTP要求0件、pageerrorなし。実行約15.5秒/11.6秒（ブラウザー起動・撮影等を含む）。
- ハーネスは120秒上限とfinally cleanupを持つ。localhost待受のsandbox拒否に対し承認を受けて実行。Chromeの通常プロファイルや他のサーバーを操作しない。
- 未解決: Cesiumによる500KB超チャンク警告あり。SwiftShaderによる検証であり、実GPUのFPSは未測定。

## T03 — 地図・地形・建物の接続

- 公式カタログと一致するURLを `src/config/dataSources.ts` に固定。関連ZIPの宮古駅Point `[141.94674615, 39.640204425]` を再確認。
- Viewerは明示した地理院淡色地図ZL9〜18とPLATEAU地形を使う。geocoder/baseLayerPicker/影等はOFF、requestRenderModeを使用。建物の座標・高度・形状は加工しない。
- Cesium 1.145.0の `CesiumTerrainProvider.fromUrl` にlayer.json自体を渡すとURLが二重になり404。公式地形仕様のベースURLへ変更。メタデータ事前検査でCesiumの暗黙のlegacy heightmap fallbackを拒否する。
- ブラウザー初回検証では低解像度タイルの途中状態が撮影されたため、地形のreadyをメタデータ成功から「globe.tilesLoadedが1秒間安定」に変更して再検証。
- `npm run build` 成功。dev/previewの `--stage map` 成功（約37.8秒/32.2秒、起動・撮影等を含む）。宮古駅周辺のLOD1・地形起伏・地図を画像で確認。静的asset不整合・HTTP失敗・pageerror・ion要求なし。
- React StrictModeで二重mount時のViewer破棄とcanvas 1個を確認。非同期の古いtilesetは破棄し、イベント・timerはcleanupする。建物/地形の失敗と再試行を独立管理。
- 未解決: 全410建物タイル、厳密な建物接地、実GPU性能は未検証。

## T04 — 人口・行政界の前処理

- `scripts/prepare_population.py` と `requirements.txt`（pyproj 3.7.2 / PROJ 9.5.1）で原本ハッシュを再検査し、県全体のPTN・ID・Polygonを検査した後、SHICODE完全一致で宮古市を抽出。
- **計画と原本の契約差**: ハッシュが同じ原本にも `03402_03209` 等の複数コード表記が県内に存在。公式ページも単一5桁と説明しており、この表記の厳密な意味までは断定しない。全件を `data/population-inspection.json` に原文字列で記録。構成コードの形式を検査し、分割や人口再配分をせず、宮古市を含む複数コードがないことを確認して完全一致692件のみ採用。未知の形式・宮古市の曖昧な割当は失敗させる。データ改訂ではなく計画の全件単一コード仮定の修正。
- CRSは `Transformer.from_crs("EPSG:6668", "EPSG:4326", always_xy=True)`。選択定義は `proj=noop ellps=GRS80`、操作名は `axis order change (2D) + JGD2011 to WGS 84 (1) + axis order change (2D)`。ネットワーク変換OFF。恒等変換は正常であり、座標変更を成功条件にしない。`get_last_used_operation`はnoopでハンドルを返さないためTransformerの具体的な定義を記録。
- 692件・11年・重複/null/不正数/負数なし。2020/2050/2070合計は50369.0000 / 26633.0007 / 15526.9996、2070年0人口225件。駅セル実値、PTN=2.767とPT00=0の実例も照合。
- 人口出力302,351 bytes、境界5,259,720 bytes。境界は1,823 LineStringのまま、丸め・単純化・ポリゴン化なし。属性削減とCRS変換のみを人口へ適用。
- `npm run test:python` 10件成功。T03ライフサイクル41件の回帰検査で旧terrain providerのretry時リスナー残留を検出し、試行開始時の解除に修正。41件・型検査とも成功。
- 未解決: 複数コード表記の公式な意味の確定は対象外（採用692件には影響しない）。行政界表示はまだ組み込んでいない。

## T05 — データ契約・比較計算

- `src/domain/types.ts` に11年・メッシュ・配布契約を定義。`population.ts`はCesium/React非依存で人口差・率・色・表示・固定0.5m/人の高さを計算。基準高Bは有限な負の楕円体高も許容するが、人口は非負のみ。
- `src/data/loadPopulation.ts` はGeoJSONとメタデータを並列取得し、HTTP/JSON、11年、人口値、主キー、矩形リング、原本ハッシュ、件数・null/0件数・合計・bboxを照合。失敗を空データへ変換しない。
- `npm run typecheck` 成功。Vitest全187件成功（domain124、loader22、地図ライフサイクル41）。100→50の検査はテスト内の合成値のみで、公開ファイルを書き換えない。
- 115件の県内複数SHICODE表記はT04レポートに保存済み。採用692件には含まれない。
- 未解決: 実地形基準高と3セルの3D描画はT06。

## T06 — 地形基準高と実データ3セル表示

### 変更ファイル

- `src/map/terrainSampling.ts` / `terrainSampling.test.ts`: レベル12のセル内3×3サンプリング、点の重複除去、タイル別の最大2並列、成功値とBのキャッシュ、失敗点の再試行、破棄後の非同期結果の無効化。初期高をNaNにし、全9点の有限値が揃ったセルだけ `B = max + 2m` を採用。
- `src/map/populationLayer.ts` / `populationLayer.test.ts`: 原典ポリゴンで1セル1Entityを作成。絶対楕円体高Bと上端B+Lを設定。`L = PTN × 0.5m/人` を固定し、0人・null・地形取得失敗を区別する。
- `src/config/sampleCells.ts`: 宮古駅・駅北西の斜面・駅南東の低人口の実メッシュIDを固定。診断年は2050年。
- `src/components/MapViewport.tsx`、`src/App.tsx`、`src/styles.css`: 3セルだけの数値・B/L表示、確認用の視点移動、読込・再試行・注意書き。全セルAPIや年操作UIは追加しない。
- `scripts/browser_smoke.mjs`: dev/previewの3セル実データ照合・WebGL・静的asset検査・撮影。previewではテスト時だけ地形メタデータ503を注入し、数値保持と実サービスへの再試行を確認できる。
- `vite.config.ts`: Vite標準の機密ファイル除外を保持しつつ `data/raw/` のdev配信も拒否（T01の原本非公開要件を補強）。
- `README.md`、本記録、`docs/t06-verification.json`: 起動・再現手順、出典、実測結果と検証範囲を記録。
- 最終エディター診断への対応として `scripts/prepare_population.py` の構造検証を型推論可能な明示的ガードへ変更し、座標変換へ経度・緯度を明示。pyprojの公開network APIの再exportに由来する診断だけを限定抑制し、ネットワークOFF処理を維持。`acquire_data.py` とともにCLIエラーのtracebackをloggerへ出し、実行権限を設定。`test_prepare_population.py` に不正座標・データ構造・propertiesの3テストを追加。

### 実測結果・実装可能性の判定

**T06完了。実地形・2025年度LOD1・実人口3セルの重なりをdevと本番previewで確認できた。** 外部障害中の縮退表示だけを成功とせず、復旧後の描画まで検証した。T07以降へ進める技術的な成立を確認した段階であり、MVP全体の完成ではない。

| 対象 / meshId | 2050年PTN（人） | 地形基準高B（m、表示丸め） | 柱長L（m） |
|---|---:|---:|---:|
| 宮古駅 `594137654` | 377.5496 | 53.71 | 188.7748 |
| 駅北西・斜面 `594137753` | 556.1786 | 95.01 | 278.0893 |
| 駅南東・低人口 `594137563` | 1.6294 | 118.75 | 0.8147 |

- dev/previewの全精度B・L・最小/最大サンプル高は完全一致。値は [t06-verification.json](./t06-verification.json) に保存。Bは9点に基づく近似値で、測量精度を表すものではない。
- 単体テスト内の100→50人は、B=-20 / 0 / 123.5 / 2500mのいずれでもPolygonGraphicsの柱長50→25mになる。合成値を公開データや実ブラウザー表示へ使っていない。
- 初回地形接続失敗時に人口の数値行まで地形待ちになる不具合を最終レビューで検出。人口の読込直後に数値行を作成するよう修正し、地形の利用可否と切り離した。503中も実人口/Lを表示、B属性なし・視点ボタン無効・明示的エラーを確認。再試行では実HTTP 200を観測し、人口/Lを変えずに3セル描画が復旧。

### 最終検証（2026-09-05）

| コマンド / 検査 | 結果 |
|---|---|
| `npm run build` | 型検査・本番ビルド成功。Cesium静的ファイル389点をコピー |
| `npm test` | Vitest 6ファイル・217テスト成功 |
| `npm run test:python` | 最終13テスト成功（入力検証の3テストを追加） |
| `.venv/bin/python -m py_compile scripts/acquire_data.py scripts/prepare_population.py scripts/test_prepare_population.py` | 成功 |
| 実原本のメモリー上での再前処理 | 692件・11年・計画合計の検査成功。人口・行政界の出力が既存publicファイルとバイト単位で一致。公開ファイル・取得日時は書き換えない |
| エディター診断 | Python型エラー29件を解消。最終0エラー・import整形警告1件（Ruff I001） |
| `node scripts/browser_smoke.mjs dev --stage cells` | 成功。観測79.371秒＋cleanup 1.819秒 |
| `CHECK_TERRAIN_FAILURE=1 node scripts/browser_smoke.mjs preview --stage cells` | 503注入→数値保持→実地形へ復旧→3視点撮影まで成功。観測74.829秒＋cleanup 1.626秒 |
| 有限時間のVite原本配信検査 | manifest原本9ファイルについて通常パスと `/@fs/` の計18要求がすべて403。`public/`・`dist/` に原本や `data/raw/` がないことも確認 |

- 両ブラウザー実行でcanvas 1個、WebGL2・context lossなし。Workers/Assets/ThirdParty/Widgetsの代表ファイルはHTTP 200かつ元ファイルとバイト一致し、HTML fallbackではない。
- 予期しないHTTP/通信失敗、pageerror、ion要求は0件。devの中断3件とpreviewの中断1件はキャンセルとして記録。previewの503 1件はハーネスが注入した期待エラーであり、実配信元の障害と混同しない。
- 各実行で専用Vite/Chromeプロセス終了と一時Chromeプロファイル削除を確認。
- `artifacts/browser-cells-dev.json` / `browser-cells-preview.json` に詳細HTTP・cleanupログ。対応する `.png` が初期表示、`-cell-1.png`〜`-cell-3.png` が個別視点、`browser-cells-preview-terrain-failure.png` が失敗時表示。画像を目視し、駅周辺LOD1との重なり・斜面の柱・低人口の薄い面・失敗時の数値保持を確認。`artifacts/` はGit対象外で再実行時に更新されるため、本記録とJSON要約を残す。

### 未解決事項・対象外

- 3セル・2050年固定。全692セル描画、年更新API、年スライダー、任意セル選択、行政界表示は未実装（T07以降）。0人の平面とnullは単体テスト済みだが、完成版の選択UIや全11年のブラウザー操作検証ではない。
- レベル12の9点最大値は厳密な地形最大高ではない。セル底面の浮き・地形/建物の突き抜けは残り得る。低人口セルのL=0.8147mは見た目に薄く、数値を併記する。可視性のための最低高や年別正規化は入れない。
- Chrome 152.0.7977.76 / Playwright 1.63.0 / ANGLE SwiftShaderでの検証。実GPUのFPS・年更新性能は未測定。スクリーンショット時のReadPixels警告、Cesium遅延読込チャンク約4.16MB（gzip約1.12MB）のビルド警告が残る。
- 全410建物タイルの到達性、厳密な建物接地、モバイル、公開環境、長時間運用は未検証。公開デプロイ・CityGML変換・年齢階級・他都市比較は実装しない。
- `scripts/prepare_population.py` のimport整形にRuff I001警告が1件残る。型エラー・実行テストの失敗ではない。2回の限定修正後も残ったため、追加の無関係な整形や診断全体の無効化は行わない。

## 実行環境と範囲

- macOS 15.7.9 / x86_64、Node 22.22.1、npm 11.16.0、Python 3.14.7。
- 通常の `~/.npm` キャッシュ書込みはAgent sandboxで拒否されたため、検証時は `npm --cache .npm-cache ...` を使用。所有者変更やグローバルインストールはしていない。
- T06完了時点では技術検証のみ。以下でT07〜T12を実装・検証した。公開デプロイ等の対象外項目は実施しない。

## T07 — 全セル表示・年更新API（完了）

- `src/map/populationLayer.ts` を全対象に拡張。`setYear` / `setOpacity` / `setVisible` / `setSelectedMesh` / `destroy` を提供。
- Entity変更をまとめ、固定基準高BとConstantPropertyを再利用。年ごとにViewer・建物・TerrainSampler・基準高を再生成しない。nullは押し出さず欠損のまま、0は平面を保持。
- 選択輪郭は白い5pxの上端輪郭。年の変更時も選択と上端B+Lを更新し、解除時は通常の基準面輪郭に戻す。
- `populationLayer.test.ts` で全692件×11年の原典座標・長さ・色・property同一性、null遷移、opacity・visibility・destroyを検査。

## T08 — 選択と視点（完了）

- `src/map/selection.ts` はdrillPick結果の `mesh:` IDに加えてEntityインスタンスとsource内の同一性を照合。文字列や他レイヤーの同名Entityを拒否。イベントはcleanupで破棄。
- 同期GPU readbackの過負荷を避け、drillPickを最大8ヒットに制限。深く隠れたセルにはID選択欄を用意。
- `src/map/camera.ts` に駅（2800m斜め俯瞰）・全メッシュbbox・選択セル（Bを中心に1800m）を実装。旧flightを取り消し、通常の回転・ズーム・パンに戻す。
- 駅/斜面/低人口/実0人口の実drillPick＋実ポインタークリックを確認。全体視点で全692 Entityの再表示とwheel zoom/globe dragを検査。

## T09 — 年・レイヤー・凡例UI（完了）

- `YearControl.tsx` / `LayerControls.tsx` / `Legend.tsx` はCesium非依存のprops/callback UI。
- 2020〜2070をstep=5で操作、キーボード左右で5年移動。opacity 0.1〜0.8、建物/人口/市境切替、固定0.5m/人と色区分・0/nullの凡例。
- UIの単体テストとproduction-previewの操作テストが成功。全年の補間・正規化・自動再生は追加しない。

## T10 — 詳細・出典UI（完了）

- `MeshDetails.tsx` / `DataNotes.tsx` / `Attribution.tsx` を実装。全692 ID欄、基準/選択人口、差分/率、状態ラベルを表示。
- 0/null/基準0/0.1人未満を区別。2020調整基準・2025年度建物固定・公開整備範囲・2055以降仮定継続・1km無居住化処理・SHICODE抽出・非等面積・加工・利用条件を説明。
- 出典リンクは既存の検証済み設定を再利用。秘密情報・新しいAPIキー・推測URLなし。

## T11 — 統合・独立した読込とretry（完了）

- `App.tsx` が年2050・選択594137654・opacity 0.25・全レイヤーONを初期値として一元管理。人口取得は地図初期化と独立し、地形失敗でも数値が使える。
- `MapViewport.tsx` が全692セルのサンプリング/描画、市境1,823 LineString、camera/selectionの接続・cleanupを担当。人口、建物、地形、市境のエラーと再試行を分離。
- 4種類の503注入で対象名・他レイヤーready・数値保持・同一Viewer・対象のみ実HTTP 200再取得・復旧後692セルを確認。年では再取得しない。
- `visibility.ts` は近景の画面外Entityだけを非表示にし、全体視点で復元。元データや全件計算を削らない。地形サンプラーの9点/レベル12/max+2m/最大2並列/cacheを維持。
- SwiftShaderでGPUキューが詰まる問題を実測。MSAA/OITを無効化し、通常0.75解像度・30fps上限、software判定時0.5解像度・10fps上限へ調整。画質と描画反映には制約を明記。建物LOD1/SSE24/全年共通は変更しない。

## T12 — 受入・手順書（完了、2026-09-06）

- `scripts/verify_data.py` と `test_verify_data.py`：原本再取得・公開ファイル書換えなしのオフライン検査。SHA-256、全7,612値、692形状、1,823境界線、metadataを照合。改変原本/出力を拒否。
- `browser_smoke.mjs` のmvpモードと `browser_mvp_checks.mjs`：120秒＋cleanup15秒、Google Chrome/SwiftShaderのみ。全年・controls・単独focus・単独faultを分けて12実行成功。静的資産4ディレクトリもHTTP/バイト/hash検査。
- 初期のtimeout、過剰GPU負荷、カメラ変更前のreadyを使った不十分な撮影を診断し修正。最終は新状態のrender後にgeometry/terrainの1秒安定を待ち、駅/沿岸・斜面・低人口・実0人口・全体の画像を目視した。
- 最終：Vitest **241件/10ファイル**、Python **16件**、read-only data検査、型検査・build成功。dev/preview各11年で692セルの数値・色・長さ・リソース同一性を照合し、年操作中の要求0件。
- UIタイマー最大停止間隔：dev456.9ms / preview280.1ms。long task最大445ms /269ms。暫定1秒停止未満の目標を達成。安定描画待ちは3.17〜6.63秒（1秒安定待ち等を含む）であり、即時描画やFPSの保証ではない。
- 9項目のローカル受入を確認。必須機能の未解決ブロッカーなし。実GPU、全410建物タイル、厳密な接地、公開ホスティング、長時間運用は未検証。最終エディター診断は0エラー。Ruff I001は既存prepare_population.pyと新規verify_data.pyに各1件残る（後者は2回の限定整理後も残り、抑制していない）。
- [verification.md](./verification.md)、[mvp-verification.json](./mvp-verification.json)、READMEに起動方法・実測・画像・制約を記録。`t06-verification.json` と原本/manifest/publicデータは不変。commit/push/deployなし。
