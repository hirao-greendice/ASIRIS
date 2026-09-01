# ASIRIS 2D Prototype

12×12マスの見下ろし型2Dゲームを、すぐ移動・編集・テストするための基盤です。HTML、CSS、Vanilla JavaScript、Canvas 2D APIだけで動作し、ビルドや`fetch()`は不要です。

## 起動

`index.html`をブラウザで直接開きます。静的ファイルだけなのでGitHub Pagesにもそのまま配置できます。

- 通常画面：`index.html`
- ステージ指定：`index.html?stage=stage01`
- 素材一覧：`index.html?atlas=1`

## 操作

### PC

- 矢印キー／WASD：1マス移動
- Z／Space：正面1マスを調べる
- X／Escape：キャンセル
- R：ステージリセット
- E：編集／プレイ切替
- G：グリッド表示
- N／P：次／前のステージ

### スマートフォン

- 十字キー：1マス移動
- A：正面1マスを調べる
- B：キャンセル
- RESET／EDIT／GRID／DEBUG：各デバッグ操作

## ステージを作る

1. `EDIT`を押します。
2. パレットから床、壁、キャラクター、アイテムなどを選びます。
3. Canvasをクリックまたはタップして配置します。PCではドラッグ配置もできます。
4. `PLAY TEST`で配置直後の状態からテストします。

編集内容は`localStorage`へ自動保存されます。`COPY JSON`で現在のステージをコピーでき、デバッグパネルの入力欄からJSONを読み込めます。「初期データへ戻す」で`stages.js`の状態へ戻せます。

床タイルとオブジェクトは別データです。床を塗っても同じセルのオブジェクトは削除されません。主人公とソード君はそれぞれ1体だけ配置できます。

## `stages.js`を直接編集する

各ステージは次の形式です。

```js
globalThis.STAGES = [
  {
    id: "stage01",
    name: "テストステージ",
    width: 12,
    height: 12,
    tiles: [
      // 0=床、1=模様付き床、2=壁。12行×12列。
    ],
    objects: [
      { type: "player", x: 1, y: 1, properties: {} },
      { type: "slime", x: 6, y: 4, properties: {} },
    ],
  },
];
```

新しいステージを配列へ追加すると、N／PキーとデバッグパネルのPREV／NEXTで切り替えられます。

## 素材番号を変更する

`game.js`先頭の`TILE_CATALOG`だけを変更します。描画、編集パレット、素材一覧の登録印がすべて同じ定義を参照します。

`colored.png`は49列×22行、各フレーム16×16px、間隔1pxです。フレーム番号からの切り出し位置は次の計算です。

```js
const column = frameNumber % 49;
const row = Math.floor(frameNumber / 49);
const sourceX = column * 17;
const sourceY = row * 17;
```

`index.html?atlas=1`では全1078フレームを確認でき、クリックで番号をコピーできます。

## テスト

```sh
node --check game.js
node --check stages.js
node tests/prototype.smoke.mjs
```

スモークテストはファイル構造、画像寸法、ステージ形式を確認します。ChromeまたはEdgeがある環境では、スマートフォン幅で移動、壁判定、ソード君追従、編集、localStorage、素材一覧、コンソールエラーも確認します。

## 素材

`colored.png`はKenneyの「1-Bit Pack」（CC0）です。

- https://kenney.nl/assets/1-bit-pack
