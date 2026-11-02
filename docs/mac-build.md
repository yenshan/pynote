# macOS アプリの生成

macOS 上で Node.js と npm を用意して実行します。

```sh
./build-mac.sh
```

Apple Silicon では `release/PyNote-darwin-arm64/PyNote.app`、Intel では `release/PyNote-darwin-x64/PyNote.app` を生成します。アプリケーションフォルダーへコピーして起動できます。Python 3 と、AI を使う場合はログイン済みの Codex CLI が別途必要です。

元のアプリの `assets/PyNote.png` をアイコンとして流用しています。アプリ識別子は `com.yenshan.pynote`、アプリ名は `PyNote` です。元の Haskell 版の設定とは分離します。Finder 起動時は `~/.pyenv/shims`、`~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin` も検索します。

設定・初期ワークスペースは `~/Library/Application Support/PyNote/` に保存します。コードや開発時の `.runtime/` は同梱しません。ローカル利用向けのビルドで、Developer ID 署名・公証は行いません。macOS ビルドは macOS 上で検証してください。
