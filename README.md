# PyNote — Python workspace

Electron 製の Python 用 IDE です。Vim 操作、フォント・配色設定、AI アシスタントを備えています。

- 選択したフォルダーの `.py` ファイルを更新日時順に表示し、作成・編集・手動保存。
- Jupyter 登録環境の一覧と Python 実行ファイルの指定。選択した環境をフォルダーごとに記憶。
- 選択中の環境へ、パッケージ名を入力して pip install。進捗・結果表示と中止操作。
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

左サイドバーの「Python 環境」から、Jupyter に登録した環境の選択、実行ファイルの参照・パス入力ができます。venv 内の Python を指定すれば、その環境のライブラリを使います。切り替え時には全ファイルの Python セッションを終了し、次の実行から選択した環境を使います。

アプリ内で環境を選択していない場合、Python は Linux / macOS では `python3`、Windows では `python` を使用します。仮想環境を使う場合は、実行ファイルを指定して起動してください。

```sh
PYNOTE_PYTHON=/absolute/path/to/.venv/bin/python ./start.sh
```

`KATA_PYTHON` などの旧 `KATA_*` 環境変数も利用できます。両方が設定されている場合は `PYNOTE_*` を優先します。

操作の詳細は [使い方](docs/usage.md)、設定やテストは [開発ドキュメント](docs/development.md)、macOS アプリの生成は [Mac ビルド](docs/mac-build.md) を参照してください。
