# T07–T12 MVP受入検証

最終確認日：**2026-09-06（実行ログのUTC時刻）**。原本取得日は2026-09-05のまま変更していません。

**判定：ローカルPC向けMVPの9項目を確認。未解決の必須機能ブロッカーなし。** 実GPU性能・全建物タイル・公開ホスティングを検証したという意味ではありません。ソフトウェア描画には下記の画質・反映待ち時間の制約があります。

- 機械可読の数値・12実行の要約・画像SHA-256：[mvp-verification.json](./mvp-verification.json)
- 原本固定と実装履歴：[implementation-log.md](./implementation-log.md)
- T06の過去記録：[t06-verification.json](./t06-verification.json)（変更していない）
- 詳細HTTPログとPNGはGit対象外の `artifacts/`。下のコマンドで再生成できます。

## 環境と方法

macOS / Darwin 24.6.0、Intel x64、Node 22.22.1、npm 11、Chrome **152.0.7977.76**、Playwright 1.63.0。Chrome実行ファイルは `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。一時プロファイル、headless、1440×1000、DPR=1、ANGLE **SwiftShaderソフトウェアWebGL2のみ**。実GPUのベンチマークではありません。

各ブラウザー実行は **120秒上限＋cleanup最大15秒**。GPU測定を同時実行せず、年・操作・各視点・各障害を分離しました。所有するVite/Chromeプロセスの終了と一時プロファイル削除を12実行すべてで確認。commit/push/deployなし。

`?acceptance=1` のときだけ実Cesiumオブジェクトへの検証用参照を公開します。偽の値、代替原本、模擬地形は配信しません。通常URLには検証用参照を公開しません。

年検査はReact UIから変更し、全692 Entityの人口・年・色・B・押し出し長と原本を照合。Entity/height property/Viewer/provider/bases/building/modelMatrix/cameraの同一性を検査し、年操作期間の要求を記録します。描画検査は新しい状態を一度renderに渡した後、`dataSourceDisplay.ready` と `globe.tilesLoaded` が1秒安定するまで待機。旧視点のreadyフラグや未更新の輪郭で撮影を成功扱いにしません。

## 9項目の受入条件

| # | 条件 | 結果・根拠 |
|---|---|---|
| 1 | dev / build+previewで2025 LOD1建物表示 | 両方成功。実配信タイルのtileVisible、PNGの建物形状、WebGL2を確認 |
| 2 | 692人口セル | 全692件の9点高が取得済み、692 Entity生成。全体視点で692 Entityのshow=trueを検査。近景で画面外Entityだけを非表示にし、元レコード・合計・基準高を削らない |
| 3 | 全11年の数値・色・長さ | dev/previewそれぞれ2020〜2070を全検査。各年692件、固定0.5m/人、固定2020年比色、詳細・合計の同年一致 |
| 4 | ID/クリックによる詳細 | 駅・斜面・低人口・実0人口をID選択後、実drillPickと実マウスクリックでも選択。別Entity/建物/文字列IDの誤選択は単体テストでも排除 |
| 5 | 0/nullを区別し0でも選択 | 実 `594115541` の2070年0人を選択。基準5.03人・増減率-100%。薄い平面と白枠を目視。実データはnull=0件、null/基準0/0.1人未満は別途単体テスト |
| 6 | 建物とカメラを年で変えない | 同一tilesetオブジェクト、modelMatrix、camera.viewMatrixを全11年で比較。建物の形・座標・高さ未加工 |
| 7 | 年で再取得/再生成しない | 両モードの年操作期間はネットワーク要求 **0件**。Viewer/terrain provider/bases/layer/Entity/height propertyの同一性検査成功 |
| 8 | 出典・利用条件・推計・整備範囲 | 画面のDataNotes、凡例、帰属表示を確認。2020調整基準、2025建物固定、2055以降仮定継続、1km無居住化、対象692合計と市全人口の違いを明記 |
| 9 | 明示した地形・背景、ion要求なし | PLATEAU-Terrainと地理院淡色地図を使用。認証キー不要。両年検査でion要求0、予期しないHTTP/CORS失敗0、pageerror0。Cesiumロゴはネットワーク使用を意味しない |

追加：人口・地形・建物・市境を1種類ずつ503にし、他レイヤーready、対象名付きエラー、対象だけのretry、実HTTP 200復帰、同一Viewer、復旧後692セルを確認。人口そのものの取得失敗以外では、障害中も駅と実0セルの数値を閲覧できました。境界は原本の**1,823 LineString・171,626頂点**のままで、クリップ・単純化・Polygon化していません。

## 数値・単体検証

| コマンド | 結果 |
|---|---|
| `npm test` | **241 tests / 10 files passed** |
| `npm run test:python` | **16 tests passed** |
| `npm run data:verify` | 読取専用・オフラインで原本ハッシュ、全7,612人口値、692セル全形状、境界、メタデータを再照合 |
| `npm run build` | TypeScript検査と本番build成功。静的Cesium資産389点をコピー |
| dev/previewの静的配信検査 | Workers/Assets/ThirdParty/Widgetsから実ファイルをHTTP取得しバイト・SHA-256一致、HTML fallback/404なし |

人口ZIP SHA-256：`2ca30e11eaf5328098c93af59a11ec2f55e73a727c3359f297a4667c628c0d59`。
建物tileset SHA-256：`dc2b322e126757e1bae9d38061b0fbc6c016a786b48fa610f9e7441452a82a91`。
ローカル原本を利用し、再ダウンロード・manifestやpublicデータの書換えはしていません。

| 実値 | 2020 | 2050 | 2070 |
|---|---:|---:|---:|
| 対象メッシュ合計（人） | 50369.0000 | 26633.0007 | 15526.9996 |
| 駅セル594137654（人） | 653.5813 | 377.5496 | 220.6021 |

2070年の0人口は225件。`594115541` の2030年はPTN **2.767**（PT00の0を採用しない）。駅2070年の2020年比は約-66.2%。テストの100→50人だけは合成値で、公開データ・ブラウザーには使いません。

## 実ブラウザー実行結果

| レポート（`artifacts/`） | 観測 / cleanup 秒 | 結果 |
|---|---:|---|
| `browser-mvp-dev.json` | 100.254 / 3.345 | 全11年・全692セル・静的配信 |
| `browser-mvp-preview.json` | 83.410 / 2.947 | 本番buildの全11年・全692セル・静的配信 |
| `browser-mvp-preview-2050-controls.json` | 43.809 / 2.499 | キーボード5年step、0のID選択、opacity、3レイヤー |
| `browser-mvp-preview-2050-all.json` | 86.107 / 1.276 | 全体視点の692 show=true、wheel zoom・globe drag |
| `browser-mvp-dev-2050-station-coast.json` | 93.391 / 3.672 | 駅・沿岸、実pick/クリック |
| `browser-mvp-preview-2050-slope.json` | 113.292 / 3.603 | 斜面、実pick/クリック |
| `browser-mvp-preview-2050-low-population.json` | 102.123 / 3.582 | 低人口、実pick/クリック |
| `browser-mvp-dev-2050-zero.json` | 57.732 / 1.544 | 2070年の実0人口平面、実pick/クリック |
| `browser-mvp-preview-fault-population.json` | 53.947 / 3.848 | 人口503と独立retry |
| `browser-mvp-preview-fault-terrain.json` | 68.331 / 3.758 | 地形503中の数値保持と独立retry |
| `browser-mvp-preview-fault-buildings.json` | 64.366 / 4.960 | 建物503中の数値保持と独立retry |
| `browser-mvp-preview-fault-border.json` | 23.536 / 0.951 | 市境503中の数値保持と独立retry |

すべてpassed。通常年検査の要求総数はdev592 / preview560、devの3中断はStrictMode等のキャンセルとして記録し、予期しない失敗ではありません。障害検査の意図した503は通常配信障害と区別しています。

### 目視した画像

- [駅・沿岸](../artifacts/browser-mvp-dev-station-coast.png)：建物背景と人口柱、選択柱の上端白枠。
- [斜面](../artifacts/browser-mvp-preview-slope.png)：斜面上の水平基準面と柱。白枠と右のIDが一致。
- [低人口](../artifacts/browser-mvp-preview-low-population.png)：1.6294人、L=0.8147mの薄い面。見やすさのための最低高は足さない。
- [0人口](../artifacts/browser-mvp-dev-zero.png)：山地の実0人口セルを薄い面として表示・選択。建物未整備範囲を無人口と推定していない。
- [全体](../artifacts/browser-mvp-preview-all.png)：市内に割り当てられた全対象セルとLineString市境。

駅/斜面/低人口のBはそれぞれ **53.7126902791 / 95.0112370144 / 118.7540491867 m**。0セルのBは691.5698001733m。地形内の厳密な接地検証ではなく、9点最大値に基づく近似の確認です。半透明の建物判読性は不透明度・人口表示で調整できます。

## 性能と残る制約

| 全11年操作期間 | dev | preview |
|---|---:|---:|
| 20ms UIタイマーの最大間隔 | **456.9ms** | **280.1ms** |
| PerformanceObserverの最長long task | **445ms** | **269ms** |
| 入力→geometry/tile安定確認 | 3.55〜6.63秒 | 3.17〜4.61秒 |

暫定目標「継続的な1秒以上のUI停止なし」はこの条件で満たしました。**入力→安定確認は別指標**であり、1秒未満の描画反映や10FPSの達成を意味しません。安定確認には意図した1秒待機・ブラウザー自動操作・レンダー同期が含まれます。大規模な年変更の途中に旧geometryが短時間残る可能性があり、静止比較は描画が落ち着いてから行ってください。

初期の全セル実験では120秒timeoutやReadPixels待ちが発生。画面外Entityのshow制御（データは全件保持）、MSAA/antialias無効、浮動小数点OIT無効、通常描画0.75解像度/30fps上限、検出したSwiftShader等では**0.5解像度/10fps上限**でGPUキュー負荷を抑えました。今回の内部描画バッファは560×367、CSS mapは1120×735で、画像は粗くなります。GPUの実際の達成FPSは未測定です。

- 地形9点はセル内の厳密な最大値ではなく、浮き・潜り・建物とのずれが残り得ます。固定+30m等で補正していません。
- 透明描画は通常のブレンド。重なり順の見え方、エッジの粗さ・細かな描画ノイズが残ります。
- クリックはdrillPick最大8ヒットに制限し、同期GPU readbackの過剰な停止を抑えます。深く隠れたセルはID欄でも選択できます。
- 全410建物コンテンツの到達性・厳密な建物接地・実GPU/端末別FPS・長時間利用・公開/サブパスホスティングは未検証。
- Cesium約4.15MB（gzip約1.12MB）の遅延読込チャンク警告とSwiftShader ReadPixels警告。最終エディター診断は0エラー。Python import整形Ruff I001が既存 `prepare_population.py` と新規 `verify_data.py` に各1件残る。後者は2回の限定修正後も残り、一括抑制していない。
- モバイル、ログイン、バックエンド、年補間、自動再生、CityGML変換、公開デプロイは対象外。

## 再実行

```sh
npm test
npm run test:python
npm run data:verify
npm run build
node scripts/browser_smoke.mjs dev --stage mvp
node scripts/browser_smoke.mjs preview --stage mvp
MVP_SUITE=controls MVP_YEARS=2050 node scripts/browser_smoke.mjs preview --stage mvp
MVP_FOCUS=all MVP_YEARS=2050 node scripts/browser_smoke.mjs preview --stage mvp
MVP_FOCUS=station-coast MVP_YEARS=2050 node scripts/browser_smoke.mjs dev --stage mvp
MVP_FOCUS=slope MVP_YEARS=2050 node scripts/browser_smoke.mjs preview --stage mvp
MVP_FOCUS=low-population MVP_YEARS=2050 node scripts/browser_smoke.mjs preview --stage mvp
MVP_FOCUS=zero MVP_YEARS=2050 node scripts/browser_smoke.mjs dev --stage mvp
MVP_FAULT=population node scripts/browser_smoke.mjs preview --stage mvp
MVP_FAULT=terrain node scripts/browser_smoke.mjs preview --stage mvp
MVP_FAULT=buildings node scripts/browser_smoke.mjs preview --stage mvp
MVP_FAULT=border node scripts/browser_smoke.mjs preview --stage mvp
```

`preview` は既存buildを使います。外部配信への実アクセスが必要です。`MVP_YEARS` で分割も可能ですが、全年検査の代用にしないでください。`base/map/cells` はT02〜T06の過去版用で、現在のMVPには `mvp` を指定します。
