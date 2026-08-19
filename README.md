# スライム・ワープ — 盤面プロトタイプ

ビルドなしのHTML・CSS・JavaScript製プロトタイプです。ステージ、ワープ経路、字幕は [`data/game-content.json`](data/game-content.json) にまとめています。

## 起動方法

JSONを読み込むため、`index.html`を直接開かずローカルHTTPサーバーから起動します。

```powershell
python -m http.server 5500
```

ブラウザで `http://127.0.0.1:5500/` を開いてください。VS CodeのLive Serverでも動作します。

## 現在の画面構成

- 全体は横11マス相当、縦22マス相当のスマホ縦画面
- 上4行相当は灰色のHUD・字幕領域で、ステージではなく歩行不可
- 下18行が11×18の独立したステージ
- ピンクのPurple Panelは中央の見かけ上の盤面外も含めて歩行可能
- 中央の9×9だけSEAとして表示し、LandのないSEAは歩行不可
- 上部に設定、ステージ番号、ヒント、話者画像、話者名、字幕を表示
- 字幕は指定した開始待ち時間の後、一文字ずつ表示
- 下部の方向・A・Uボタンはステージ上に存在し、勇者自身も乗って作動可能
- 各ステージは画面端で接続せず、JSONに定義したワープだけで移動
- Purple PanelとLandは論理上1マス、描画上は下へ張り出す立体タイル
- SEAとワープは一定時間ごとに左右反転
- 方向とUは長押し対応。方向ボタン間を指でスライドすると入力先も切り替わる

## 盤面を編集する

各ステージの `map` が、そのまま上から見た11文字×18行の盤面です。座標配列を手作業で並べる必要はありません。

```json
"map": [
  "...........",
  "...........",
  "..W>#S##W..",
  "..........."
]
```

使用できる記号は次のとおりです。

| 記号 | 内容 |
| --- | --- |
| `.` | 地形なし。中央9×9ではSEA、それ以外では歩けるPurple Panel |
| `#` | Land |
| `O` | 通行できない穴 |
| `^` `>` `v` `<` | 勇者の開始位置と向き。1ステージに必ず1個 |
| `W` | Land上のワープポイント |
| `S` | Land上のスライム |
| `B` | Land上のボス |
| `b` | Purple Panel上のボス |
| `U` `R` `D` `L` | Land上の自動移動パネル |

`W`、`S`、`B`、`b`のIDや表示名は、同じステージの `objects` に上から左へ現れる順で記述します。自動移動パネルのIDは `directionIds` に同じ順で記述します。記号数と設定数が違う場合は起動時に具体的なエラーを表示します。

## ワープを編集する

ステージはすべて独立しています。ワープ接続は各ステージの `warpRoutes` だけで指定します。

```json
"warpRoutes": {
  "warp-01-out": {
    "right": {
      "stageId": "stage-02",
      "warpId": "warp-02-in"
    }
  }
}
```

この例では `warp-01-out` に右向きで入った場合だけStage 2へ移動します。到着先ワープを画面に見せた後、入った方向へさらに1マス進みます。定義していない方向から入ってもワープしません。

## 字幕を編集する

話者の共通設定は `speakers`、ステージごとの字幕は `dialogues` にまとめています。

```json
"stage-01": [
  {
    "id": "stage-01-start",
    "trigger": { "event": "stage-start" },
    "speaker": "guide",
    "delayMs": 320,
    "characterIntervalMs": 38,
    "text": "表示したいセリフ"
  }
]
```

- `speaker`: `speakers`に登録した話者ID
- `trigger.event`: 現在は `stage-start` と `enemy-defeated` に対応
- `trigger.targetId`: `enemy-defeated`で対象の敵を限定するときに指定
- `delayMs`: 発生から文字送りを始めるまでの待ち時間
- `characterIntervalMs`: 1文字ごとの表示間隔
- `text`: 表示する本文

`delayMs`と`characterIntervalMs`を省略すると、`dialogueDefaults`の値を使います。ヒントボタンの文言は各ステージの `hint` です。

## 操作

- 矢印キー／画面の方向ボタン: 移動
- Aキー／Enter／画面のA: 剣を振る
- Uキー／Zキー／画面のU: 一手戻す

## 確認

```powershell
node tests/prototype.smoke.mjs
```

テストは一時HTTPサーバーとヘッドレスブラウザを起動し、JSON読込、11×18盤面、HUDとステージの分離、Purple Panel歩行、画面端の遮断、明示ワープ、文字送りを確認します。
