# ミリしらソード

PC・スマートフォン対応の見下ろし型マス移動ゲームです。

## 起動

```powershell
npm.cmd install
npm.cmd run dev
```

表示されたURL（通常は `http://localhost:5173/`）をブラウザで開きます。

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
