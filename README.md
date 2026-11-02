# PyNote — Python workspace

`haskell_ide/` の Electron アプリを流用した Python 用 IDE です。元の画面配置、Vim 操作、フォント・配色設定、AI アシスタントを引き継いでいます。元の Haskell アプリは変更していません。

- 選択したフォルダーの `.py` ファイルを更新日時順に表示し、作成・編集・手動保存。
- Python の構文ハイライト、4スペースのインデント、ファイル内の単語補完。
- ファイルごとの Python 対話ターミナル。実行後も変数や関数を `>>>` で確認。
- Ctrl+Enter（macOS は ⌘Enter）で保存して実行。再実行時は現在の処理を中断し、ユーザー定義を初期化してファイル全体を実行。
- `input()`、複数行入力、Tab 補完、履歴、Ctrl+C に対応。
- Python の Traceback・構文エラーを取得し、Codex による日本語の説明と該当箇所の下線を表示。
- ターミナルの上下・左右配置、サイドバーのサイズ調整、ウィンドウ位置・表示設定の復元。

## 起動

Node.js 22.12 以降、npm、Python 3 が必要です。AI 機能には Codex CLI とログインが必要です。

```sh
./start.sh
```

初回は依存パッケージをインストールし、ビルドして起動します。AI を利用するときは、事前に `codex login` を実行してください。AI が利用できない場合も編集・保存・Python 実行は使用できます。

Python は Linux / macOS では `python3`、Windows では `python` を使用します。仮想環境を使う場合は、実行ファイルを指定して起動してください。

```sh
KATA_PYTHON=/absolute/path/to/.venv/bin/python ./start.sh
```

操作の詳細は [使い方](docs/usage.md)、設定やテストは [開発ドキュメント](docs/development.md)、macOS アプリの生成は [Mac ビルド](docs/mac-build.md) を参照してください。
