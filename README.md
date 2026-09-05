# population-terrain — 宮古市の人口変化

宮古市に割り当てられた500m将来推計人口と、PLATEAU **2025年度の建物LOD1**を重ねるPC向けWebアプリです。React + Vite + TypeScript + CesiumJS、人口前処理はPython + pyprojです。

**現在は計画書のT01〜T06までの技術検証版です。MVP全体の完成ではありません。**

- 692セル・2020〜2070の11年のPTN系列を取得・検査済み。
- 画面は**2050年固定・代表3セルだけ**を描画します。人口は実データで、建物・地形・背景地図は公式配信を使用します。
- 年スライダー、全692セルの描画、任意メッシュ選択、市境の描画はまだありません（T07以降）。行政界の前処理は済んでいます。
- 公開デプロイ、年齢階級別、他都市比較、CityGML変換は実装していません。

[計画書](docs/miyako-population-3d-mvp-plan.md) · [タスク別の変更・検証・未解決事項](docs/implementation-log.md) · [T06の実測・検証結果](docs/t06-verification.json)

## ローカル起動

Node.js **22.12以上の対応LTS**を使用してください。検証環境はNode 22.22.1 / macOS 15.7.9（Intel）です。

```sh
npm ci
npm run dev
```

表示されたローカルURL（通常 `http://127.0.0.1:5173`）をPCブラウザーで開きます。右パネルの「このセルへ移動」で個別の柱を確認できます。右パネルは縦スクロールできます。

本番ビルドの確認：

```sh
npm run build
npm run preview
```

通常は `http://127.0.0.1:4173` で表示します。CesiumのWorkers / Assets / ThirdParty / Widgetsも `dist/cesium/` に配置します。ルートパスでのローカル配信が対象で、サブパスへの公開ホスティングは未検証です。

APIキー、Cesium ionトークン、バックエンドは不要です。ただし建物・地形・地図を読むためインターネット接続が必要です。配信元にはブラウザーのIPアドレス・要求タイル範囲等が送られます。原本人口ZIPをブラウザーから取得しません。

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

3セル：`594137654`（宮古駅）、`594137753`（駅北西の斜面）、`594137563`（駅南東の低人口）。本番データの代わりに合成値を配信する機能はありません。100→50人等の合成検査はテスト内だけです。

## テスト

```sh
npm run typecheck
npm test
npm run test:python
npm run build
```

実ブラウザー検証は、既存Google Chromeを専用の一時プロファイルで起動します。自分で起動したVite/Chromeは終了時に破棄し、通常のChromeプロファイルには触れません。コマンドは各120秒上限（cleanup最大15秒）です。

```sh
npm run test:browser -- dev --stage cells
npm run build
npm run test:browser -- preview --stage cells
# 地形接続失敗でも数値が残り、再試行で復帰することを検査
CHECK_TERRAIN_FAILURE=1 npm run test:browser -- preview --stage cells
```

既定の実行ファイルは `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。必要なら `CHROME_PATH` 環境変数で変更します。ブラウザーの自動ダウンロードは行いません。`artifacts/` にHTTP・WebGL・実測B/L・スクリーンショット・cleanup記録を出力します。`--stage base` / `map` は前工程の検証用で、現在の3セルアプリには `cells` を指定してください。

Zed Agentのsandboxがlocalhost待受を拒否する場合、有限時間のブラウザーテストに対する実行許可が必要です。npmキャッシュが書込不可なら、`npm --cache .npm-cache ci` を使えます。グローバル設定や所有者の変更は不要です。

### 検証の限界

Chrome 152 / Playwright 1.63 / ANGLE SwiftShader（ソフトウェアWebGL2）で検証しています。スクリーンショット時の`GPU stall due to ReadPixels`警告とCesiumの大きなJSチャンク警告が残っています。実GPUのFPSや年切替性能の達成を示すものではありません。全410建物タイルの到達性、厳密な建物接地、公開環境は未検証です。

最終検証はVitest 217件・Python 13件・型検査・ビルド・dev/previewブラウザーが成功。エディター診断は型エラー0件、Pythonのimport整形警告（Ruff I001）が1件残っています。詳細は検証記録を参照してください。

## データの出典・利用条件

取得日：2026-09-05。アプリ内にも帰属表示と出典リンクを表示します。国・市の公式アプリではありません。

| データ | 出典・利用条件 | 加工・注意 |
|---|---|---|
| 500m将来人口 | [国土数値情報 R6国政局推計](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-mesh500r6.html) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [利用規約](https://nlftp.mlit.go.jp/ksj/other/agreement_01.html) | SHICODE抽出・列削減・CRS変換・3D可視化。2020年は調整された基準人口、2025以降は推計、2055以降は2050年仮定の延長。無居住化処理を正確な消滅年と解釈しない |
| 建物・関連データ | [宮古市／Project PLATEAU 2025年度](https://www.geospatial.jp/ckan/dataset/plateau-03202-miyako-shi-2025) · [Site Policy](https://www.mlit.go.jp/plateau/site-policy/) | 形状・高度は無加工、全年共通。公開整備範囲のみで市全域ではない。[索引図](https://assets.cms.plateau.reearth.io/assets/df/6b6322-deea-4594-83a7-cbc713f8ab05/03202_indexmap_op.pdf)。関連ZIPの実ファイル名には2024が残る |
| 地形 | [PLATEAU-Terrain](https://docs.plateauview.mlit.go.jp/datasets/terrain/) | PLATEAU・[Mapterhorn](https://mapterhorn.com/)・[国土地理院](https://www.gsi.go.jp/)の帰属表示。楕円体高。試験配信でSLAなし、一律CC BYのデータとは断定しない |
| 背景地図 | [地理院タイル（淡色地図）](https://maps.gsi.go.jp/development/ichiran.html) · [利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html) | XYZ ZL9〜18をリアルタイム読込 |

ソフトウェアは[MIT License](LICENSE)。データの利用条件とは別です。
