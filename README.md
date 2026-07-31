# ミリしらソード

PC・スマートフォン対応の見下ろし型マス移動ゲームです。

通常起動では、名前付きオブジェクトを剣で斬り、飛び出した全文字を枠へ運ぶ
4ステージのコアギミック試作をプレイできます。

## 操作

- PC: WASD／矢印キーで移動、Spaceで剣、Rで現在のステージをリセット
- スマートフォン: 画面下の十字キー、剣ボタン、戻ボタン

## 起動

```powershell
npm.cmd install
npm.cmd run dev
```

表示されたURL（通常は `http://localhost:5173/`）をブラウザで開きます。

## ステージエディター

ゲーム画面右上の `EDITOR`、または次のURLから開きます。

```text
http://localhost:5173/?editor=1
```

壁・床・草地、勇者の開始位置、部屋ごとのパズル基準位置を配置できます。
また、勇者の位置によるカメラ切替範囲と、ゲーム画面へ映す範囲を編集できます。

変更はブラウザ内へ下書き保存されます。`プレイテスト` を押すと、その下書きを
ゲームへ反映して確認できます。バックアップや受け渡しには
`JSON書き出し`／`JSON読み込み`を使用します。

## ビルド

```powershell
npm.cmd run build
```

ゲームの決定事項と今後の設計方針は
[`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) に記録します。

## GitHub Pages

`main` ブランチへpushすると、GitHub Actionsがビルドと公開を行います。

公開URL:

```text
https://hirao-greendice.github.io/ASIRIS/
```

GitHubのリポジトリ設定では、`Settings → Pages → Source` を
`GitHub Actions` にします。
