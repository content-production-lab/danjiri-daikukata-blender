# だんじり 大工方（Blender版）

地車（だんじり）の大屋根に立つ大工方（だいくがた）になって、団扇の合図で曳き手と梃子方を動かし、町の角で「やりまわし」を決める3Dブラウザゲームです。地車・人・町並みは Blender の Python スクリプトで作っています。

公開URL: https://content-production-lab.github.io/danjiri-daikukata-blender/

仕様は [docs/SPEC.md](docs/SPEC.md) を参照してください。

## 遊び方

| 操作 | キー | 画面のボタン |
| --- | --- | --- |
| 曳け／止め | W/↑・S/↓ | 左下 |
| 団扇の合図（後梃子で曲げる） | A / D | 左下 |
| 体重移動 | ← / → | 右下 |
| 跳ぶ | Space | 右下 |
| 視点／音／一時停止 | C / M / P | 右上（音・一時停止） |

難易度は「やさしい」「ふつう」「本職」から選べます。角が近づくと「団扇！」「戻せ！」の合図が出て、振る向きのボタンが光ります。

スマホでは画面端のボタンで操作します（両手で同時に押せます）。横持ちがおすすめです。宮入り（クリア）すると、タイム・スコア・総合ランクを X にポストできます。

## 開発

```bash
npm install
npm run dev
npm run check
```

`npm run check` は lint・型チェック・テスト・ビルドをまとめて実行します。

### モデルを作り直す

Blender 5.2 で、プロジェクト直下から実行します。`public/models/*.glb` と `public/og.png` が書き出されます（`-- --no-og` で OGP 画像を省略）。

```bash
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P blender/build_all.py
```

| パス | 内容 |
| --- | --- |
| `blender/build_all.py` | 地車・人・町並みの生成と OGP 画像のレンダリング |
| `src/sim/` | 挙動計算と採点（描画に依存しない。vitest でテスト） |
| `src/render/` | three.js による描画（`.glb` の読み込み、群衆、町並み） |
| `src/audio.ts` | 鳴物と環境音（WebAudio で合成。音声ファイルなし） |
| `src/share.ts` | X の投稿画面の URL（API は使わない） |

外部の画像・3D・音の素材は使っていません。OGP 画像の題字は BIZ UD明朝（SIL Open Font License）でレンダリングしています。

## ライセンス

MIT
