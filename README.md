# population-terrain — 宮古市の人口変化

宮古市に割り当てられた500m将来推計人口と、PLATEAU **2025年度の建物LOD1**を重ねるPC向けWebアプリです。React + Vite + TypeScript + CesiumJS、人口前処理はPython + pyprojです。

**T01〜T12のローカルPC向けMVPを実装・受入検証済みです。**

- 宮古市の実データ**692セル・2020〜2070の11年（5年刻み）のPTN系列**を3D表示。初期年2050、初期選択は駅を含む `594137654`。
- 年スライダー・キーボード操作・人口推移の再生／一時停止、クリック/全ID選択、人口詳細・対象メッシュ合計、固定高さ/色の凡例。
- 選択メッシュの詳細カードに2020〜2070年・5年刻みの人口推移チャートを表示。現在年の縦線・丸印は年変更／再生／注目地点選択に連動し、「年別の人口を表示」で11時点の数値も確認できます。
- `?year=2070&mesh=594137654` で対象年・選択メッシュを共有。右パネルの「この表示をコピー」で現在URLをコピーできます。
- 操作パネルの「注目地点」3カードから、中心部周辺・市内北側・内陸西部の人口変化を案内。選ぶと再生を停止して2070年の対象メッシュへ移動し、地点別リンクもコピーできます。[選定理由・全11年の値](docs/featured-locations.md)。
- 2025年度LOD1建物・人口・市境の独立切替、opacity 0.1〜0.8、駅/全体/選択セルの視点操作。
- 人口・建物・地形・市境の独立したエラー/再試行。地形・建物が失敗しても人口数値を閲覧可能。0人は選択できる平面、nullは欠損のままです。
- 年変更でViewer・建物・地形基準高を再作成せず、原本を再取得しません。公開デプロイ、年齢階級別、他都市比較、CityGML変換は対象外です。

[計画書](docs/miyako-population-3d-mvp-plan.md) · [T01〜T12実装ログ](docs/implementation-log.md) · [MVP受入検証・画像・制約](docs/verification.md) · [機械可読の実測](docs/mvp-verification.json) · [過去のT06記録](docs/t06-verification.json)

## ローカル起動

Node.js **22.12以上の対応LTS**を使用してください。検証環境はNode 22.22.1 / macOS 15.7.9（Intel）です。

```sh
npm ci
npm run dev
```

表示されたローカルURL（通常 `http://localhost:5173`）を幅1280px以上のPCブラウザーで開きます。上部で年、右パネルでメッシュID・レイヤー・不透明度を操作します。地図上部の「選択メッシュへ」で個別セルへ移動。右パネルは縦スクロールでき、凡例・「データについて」があります。クリックが難しいセルや0人はID欄で選択できます。

幅600px以下では地図と詳細パネルを縦に並べます。チャートと年別の数値表はカード幅に収まり、キーボードでも数値表を開閉できます。チャートには読み上げ用の軸・現在年の説明を付けています。

本番ビルドの確認：

```sh
npm run build
npm run preview
```

通常は `http://127.0.0.1:4173` で表示します。CesiumのWorkers / Assets / ThirdParty / Widgetsも `dist/cesium/` に配置します。ルートパスでのローカル配信が対象で、サブパスへの公開ホスティングは未検証です。

APIキー、Cesium ionトークン、バックエンドは不要です。ただし建物・地形・地図を読むためインターネット接続が必要です。配信元にはブラウザーのIPアドレス・要求タイル範囲等が送られます。原本人口ZIPをブラウザーから取得しません。

共有URLは初期表示で2020〜2070の5年刻みの年を読み、人口データの検証後に存在するメッシュIDを適用します。欠損・不正・重複したクエリは項目ごとに既定値（2050年・宮古駅メッシュ）へ戻します。読込中・人口の取得失敗中はURLを保持してコピーを無効化し、再試行後に復元します。年・メッシュの変更は `history.replaceState` で反映するため操作ごとに履歴は増えません。カメラ・レイヤー・不透明度は共有対象外で、既存の他のクエリとハッシュは保持します。コピーの成功・失敗はボタン直下に通知します。コピーできない環境ではアドレス欄からURLをコピーできます。

人口推移チャートは読込済みの11時点をSVGで描画し、追加のライブラリやデータ取得を使いません。縦軸は0人から始まり、選択メッシュの全11時点に合わせて決まるため、年変更では変わりません（メッシュ間では異なります）。0人はゼロの位置、欠損は線の切れ目で示し、孤立した有効値も点で残します。傾向把握の補助として使い、現在年の人口・増減の確認には従来の数値欄を使います。

## 元データを再取得・前処理する

加工済みの人口GeoJSON・行政界・メタデータは `public/data/` にあります。通常の起動にはPythonを使いません。再現・再検証するときだけ次を実行します（Python 3.11以上。検証は3.14.7）。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run data:acquire
npm run data:prepare
```

- 原本はGit対象外の `data/raw/` にハッシュ付きファイル名で保存します。`public/`・`dist/`には置かず、Viteのdev配信でもアクセスを拒否します。
- `data/source-manifest.json` にURL・年度・UTC取得日時・SHA-256・HTTP/CORS・利用条件を記録します。
- `data/plateau-2025-lod1-entry.json` に公式カタログの採用エントリを保存しています。
- `data/acquisition-report.json` と `data/population-inspection.json` に検査・差分・判断を保存します。
- 再実行は有効なローカル原本を使います。再ダウンロードを明示する場合は `python3 scripts/acquire_data.py --refresh`。原本や仕様が変われば自動採用せず失敗します。レポートを読み、変更内容をレビューしてから期待値・出典・前処理を整合させてください。
- 約1.1GBの全3D Tiles ZIPは取得していません。通常は公式の年度固定LOD1を直接読みます。

### 原本と計画の差分

人口ZIPのハッシュは計画書と一致しました。ただし県全体には `03402_03209` 等の複数コードの `SHICODE` が**115件**あり、全件単一5桁という仮定とは異なりました。これらは原文字列を検査ログに保持し、分割・再配分しません。宮古市を含む複数コードはなく、厳密な `SHICODE == "03202"` の692セルを採用しています。

JGD2011→WGS84では、現在のPROJが選択した操作は恒等変換（`proj=noop ellps=GRS80`）でした。変換APIは実行し、バージョンと操作定義を記録しています。測量精度や地殻変動補正を保証するものではありません。

## 数値と3Dのルール

- 人口は**全11年を `PTN_YYYY` に統一**し、PT00に代替しません。原精度を保持し、表示だけを丸めます。
- 0人・null・収録なし・通信失敗を区別します。例：メッシュ`594115541`の2030年はPTNの**2.767人**であり、PT00の0ではありません。
- 原典ポリゴンを維持し、市境で切り抜かず、メッシュコードから形状を再生成しません。
- 地形レベル12でセル内3×3の9点を取得し、全点が有限なら **B = max(9点の楕円体高) + 2m**。重複点を除き、タイル別にまとめて最大2並列。成功した点・Bをメモリーにキャッシュします。
- **L = 人口 × 0.5m/人**、押し出し上端は **B + L**。年ごとの再正規化、対数化、最低高、上限カットはありません。
- 低人口セル`594137563`の2050年は1.6294人、柱長は**0.8147m**です。薄く見えることは0人を意味しません。
- 比較するのは柱長Lであり、柱上端の地理的な高さではありません。Bは地形の精密な最大値ではないため、斜面で浮き・突き抜けが残り得ます。
- 地形に接続できなくても数値行は参照可能です。高さ未取得のセルを高度0には描かず、明示的に再試行します。

目視検査セル：`594137654`（宮古駅）、`594137753`（斜面）、`594137563`（低人口）、`594115541`（2070年0人）。本番データの代わりに合成値を配信する機能はありません。100→50人等の合成検査はテスト内だけです。

## テスト

```sh
npm run typecheck
npm test
npm run test:python
npm run data:verify
npm run build
```

実ブラウザー検証は、既存Google Chromeを専用の一時プロファイルで起動します。自分で起動したVite/Chromeは終了時に破棄し、通常のChromeプロファイルには触れません。コマンドは各120秒上限（cleanup最大15秒）です。

```sh
# 通常本番: 公開UIのみ。?acceptance=1 でも検査用オブジェクトを公開しない
npm run build
npm run test:browser -- preview --stage mvp
npm run test:share # 通常本番でURL復元・実クリップボード・初期化再試行を検証
npm run test:guide # 注目地点の選択・再生停止・地点別共有（別の300秒上限）
npm run test:trend # 全11年のチャート追従・数値表・追加取得なし・320/390px幅
SHARE_DEV=1 npm run test:share # devのStrictMode・非同期読込でも同じ検査
npm run test:headers # 有限のローカル Workers Static Assets（Viteではない）

# 詳細受入: 専用モードのみ。dist-acceptance は絶対にデプロイしない
npm run build:acceptance
TREND_ACCEPTANCE=1 npm run test:trend # 年変更中の実カメラ維持・選択メッシュへの移動・ズームも検証
GUIDE_ACCEPTANCE=1 npm run test:guide # 注目地点の実カメラ・選択Entity・描画完了も検証
BROWSER_ACCEPTANCE=1 npm run test:browser -- preview --stage mvp
# 各操作は別の120秒上限実行に分割
BROWSER_ACCEPTANCE=1 MVP_SUITE=controls MVP_YEARS=2050 npm run test:browser -- preview --stage mvp
BROWSER_ACCEPTANCE=1 MVP_FOCUS=zero MVP_YEARS=2050 npm run test:browser -- dev --stage mvp
BROWSER_ACCEPTANCE=1 MVP_FAULT=terrain npm run test:browser -- preview --stage mvp
# 最後は常に通常本番成果物を生成・検査
npm run build
```

既定の実行ファイルは `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。必要なら `CHROME_PATH` 環境変数で変更します。ブラウザーの自動ダウンロードは行いません。`artifacts/` にHTTP・WebGL・実測B/L・スクリーンショット・cleanup記録を出力します。現在は `--stage mvp` を指定してください（通常モードは公開UI、`BROWSER_ACCEPTANCE=1` の既定suiteは全11年）。`MVP_FOCUS` は `all` / `station-coast` / `slope` / `low-population` / `zero`、`MVP_FAULT` は `population` / `terrain` / `buildings` / `border`。全12実行のコマンドは [検証手順](docs/verification.md#再実行) に記載。`base/map/cells` は過去版の検証用です。

Zed Agentのsandboxがlocalhost待受を拒否する場合、有限時間のブラウザーテストに対する実行許可が必要です。npmキャッシュが書込不可なら、`npm --cache .npm-cache ci` を使えます。グローバル設定や所有者の変更は不要です。

共有リンクのPlaywrightテストは1 worker・全体300秒上限で、専用のローカルポート（preview: 4174 / dev: 5174）と一時Chromeプロファイルを使います。人口データは実ファイル、地形・建物・地図は実配信を使い、遅延・人口503・Clipboard API拒否/非対応・Canvas初期化失敗だけをテスト内で注入します。`artifacts/browser-share-links-{preview,dev}.json` と `artifacts/share-links-{preview,dev}/` に結果・スクリーンショットを出力します。

チャートのブラウザーテストも1 worker・全体300秒上限で実ファイルを使います。結果と画像は `artifacts/browser-population-trend-{preview,acceptance}.json`、`artifacts/population-trend-{preview,acceptance}/` に出力します。実データにない全時点欠損・全時点0人・途中の欠損・孤立値はコンポーネントテストの合成値で確認します。

`npm run data:verify` は既存の `data/raw/` の固定原本と公開出力を読むだけです。再取得や出力更新をせず、全7,612値・692形状・市境・metadataを照合します。通常起動には原本もPythonも不要です。

### 最終結果・性能・限界

2026-09-06：**Vitest 241件/10ファイル、Python 16件、読取専用データ検査、型検査、buildが成功**。有限ブラウザー12実行で9項目の受入、全692セル、全11年、4種類の独立retry、実0セルのクリック、camera・toggle・静的配信を確認。年操作中のネットワーク要求はdev/previewとも0件、Viewer・建物・B・カメラは同一です。

Chrome 152 / Playwright 1.63 / ANGLE SwiftShader（ソフトウェアWebGL2）で、20ms UIタイマーの最大間隔は **dev456.9ms / preview280.1ms**、最長long taskは445ms /269ms。暫定「1秒以上の継続UI停止なし」をこの条件で確認しました。一方、入力から描画安定確認は **3.17〜6.63秒**（ハーネスの1秒安定待ち等を含む）。即時反映・実GPUのFPSを保証しません。

画面外Entityは非表示にするだけで全692件を保持。MSAA/浮動小数点OITを無効化し、通常0.75解像度・30fps上限、検出したSwiftShader等は0.5解像度・10fps上限に制限します。画像の粗さ・透明な重なり順・ReadPixels警告、Cesium約4.15MBの遅延読込チャンク警告が残ります。全410建物タイルの到達性、厳密な建物接地、実GPU、公開環境、長時間利用は未検証です。エディター診断は0エラー。Ruff I001のimport整形警告が既存 `prepare_population.py` と新規 `verify_data.py` に各1件残ります（計2件）。後者は2回の限定的な整理後も残ったため、診断の一括無効化はしていません。

詳細な計測条件・各実行秒数・目視したPNG・未検証範囲は [verification.md](docs/verification.md) に記録しています。

## データの出典・利用条件

取得日：2026-09-05。アプリ内にも帰属表示と出典リンクを表示します。国・市の公式アプリではありません。

| データ | 出典・利用条件 | 加工・注意 |
|---|---|---|
| 500m将来人口 | [国土数値情報 R6国政局推計](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-mesh500r6.html) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [利用規約](https://nlftp.mlit.go.jp/ksj/other/agreement_01.html) | SHICODE抽出・列削減・CRS変換・3D可視化。2020年は調整された基準人口、2025以降は推計、2055以降は2050年仮定の延長。無居住化処理を正確な消滅年と解釈しない |
| 建物・関連データ | [宮古市／Project PLATEAU 2025年度](https://www.geospatial.jp/ckan/dataset/plateau-03202-miyako-shi-2025) · [Site Policy](https://www.mlit.go.jp/plateau/site-policy/) | 形状・高度は無加工、全年共通。公開整備範囲のみで市全域ではない。[索引図](https://assets.cms.plateau.reearth.io/assets/df/6b6322-deea-4594-83a7-cbc713f8ab05/03202_indexmap_op.pdf)。関連ZIPの実ファイル名には2024が残る |
| 地形 | [PLATEAU-Terrain](https://docs.plateauview.mlit.go.jp/datasets/terrain/) | PLATEAU・[Mapterhorn](https://mapterhorn.com/)・[国土地理院](https://www.gsi.go.jp/)の帰属表示。楕円体高。試験配信でSLAなし、一律CC BYのデータとは断定しない |
| 背景地図 | [地理院タイル（淡色地図）](https://maps.gsi.go.jp/development/ichiran.html) · [利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html) | XYZ ZL9〜18をリアルタイム読込 |

ソフトウェアは[MIT License](LICENSE)。データの利用条件とは別です。

### 第三者ソフトウェア・セキュリティ検証

`npm run build` / `npm run build:acceptance` は、実際にバンドルされたモジュールとCesium配布物を検査し、`public/THIRD_PARTY_LICENSES.txt`・`public/THIRD_PARTY_PROVENANCE.json` を再生成して成果物に同梱します。`public/NOTICE.txt` も配布対象です。依存更新後は生成差分と未解決の利用条件を再レビューしてください。ネットワーク取得はビルド時に行いません。

**[今回のセキュリティ修正・新しいローカル検証・ライセンス監査の限界](docs/security-verification.md)**。上記MVP記録と `docs/verification.md` / `docs/mvp-verification.json` は従来の履歴です。公開環境のヘッダーや全バイナリーの利用条件を確認済みという意味ではありません。
