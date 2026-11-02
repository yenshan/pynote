# 開発と検証

```sh
npm run dev             # 開発用に起動
npm run build           # TypeScript チェックと本番ビルド
npm test                # ファイル管理・実 Python PTY・診断・AI 通信の検証
npm run test:electron   # GUI 操作テスト（デスクトップ環境が必要）
```

Node.js 22.12 以降、Python 3 が必要です。AI 通信のテストには偽 app-server を使用し、実アカウントには接続しません。POSIX 環境ではテスト用サーバーを Python のブリッジ経由で接続し、Node の標準入出力がソケットを扱えない実行環境でも OS パイプで検証します。

## 環境変数

| 変数 | 用途 |
| --- | --- |
| `PYNOTE_WORKSPACE` | 起動時に開くフォルダー。保存済みの選択より優先 |
| `PYNOTE_PYTHON` | Python 実行ファイル。既定は Linux/macOS で `python3`、Windows で `python` |
| `PYNOTE_CODEX` | Codex CLI 実行ファイル。既定は `codex` |
| `PYNOTE_RUNTIME` | 開発時の設定・キャッシュ保存先。既定は `.runtime/` |

旧名の `KATA_WORKSPACE`・`KATA_PYTHON`・`KATA_CODEX`・`KATA_RUNTIME`・`KATA_DEV_URL` も互換用に利用できます。対応する `PYNOTE_*` が空でなければそちらを優先します。開発サーバーの URL は `PYNOTE_DEV_URL` で指定します。

## 構成

- `src/App.tsx` と `useWorkspace.ts`: 画面、編集、保存、フォルダーの切替。
- `src/pythonLanguage.ts` と `Editor.tsx`: CodeMirror の Python モード、Vim、4スペースのインデント。
- `src/usePython.ts` と `PythonTerminal.tsx`: 実行状態、エラー解析、xterm.js の表示。
- `electron/python-environments.cjs`: Jupyter の kernelspec と既定の登録先の探索、Python 3 の起動確認、フォルダーごとの選択と最大20件の履歴を `python-environments.json` に保存。
- `electron/pip-installer.cjs` と `src/PipInstallDialog.tsx`: 選択中の Python へのパッケージインストール、出力配信、中止・終了時のプロセス管理。
- `src/PythonEnvironmentPicker.tsx`: 環境一覧、実行ファイルの選択・パス入力。
- `electron/python.cjs`: node-pty で Python を起動し、初回実行・再実行・対話入力・終了を管理。
- `electron/python-diagnostics.cjs`: Traceback の最後の対応フレームと構文エラーから現在のファイルの行番号を取得。
- `electron/codex.cjs`: 日本語の Python 相談と、チャットから独立した構造化エラー説明。
- `electron/workspace-services.cjs`: フォルダー監視と子プロセスの寿命を管理。フォルダー変更時は古い通知を止め、保存と終了を待機。

Python の起動時に一時スクリプトでプロンプトへ不可視の OSC マーカーを設定します。PTY の出力が分割されてもプロンプト到達を検出し、その操作の出力だけを診断します。初回実行と再実行ではユーザー定義を初期化し、ファイルを `__main__` として実行します。一時スクリプトは Python 終了時に削除します。

Python の実行完了待ちは60秒、AI の応答待ちは120秒です。時間超過は実行プロセスの強制終了を意味しません。Traceback の文字位置は端末表示に依存するため、AI が返した対象文字列をソースと照合してから下線を表示します。

設定は開発版ではこのプロジェクトの `.runtime/`、macOS アプリ版では `PyNote` のユーザーデータに保存します。元の Haskell アプリとは別のアプリ識別子を使用します。


環境選択は IPC の切り替え処理で直列化します。実行ファイルの検証に失敗した場合は既存の選択とセッションを保持し、切り替えに成功した場合だけ Python と診断を交換します。古いプロセスの通知と遅延した AI 解析結果は新しい環境へ反映しません。AI 接続とフォルダー監視は維持します。

Jupyter が利用できれば `jupyter kernelspec list --json` を参照し、標準のユーザー・システム・既定 Python の登録先、`JUPYTER_PATH`・`JUPYTER_DATA_DIR` も探索します。探索先の仕様は [Jupyter のディレクトリ説明](https://docs.jupyter.org/en/latest/use/jupyter-directories.html)、起動情報は [kernelspec の仕様](https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs) に準拠します。Python の確認には5秒の制限を設け、同時に確認する候補を最大4件に制限します。


pip のインストールは選択中の実行ファイルで `-u -m pip install --disable-pip-version-check --no-input -- <package>` を起動します。入力は [PyPA のパッケージ名形式](https://packaging.python.org/en/latest/specifications/name-normalization/) に制限し、シェルを介さず引数として渡します。プロジェクト内の `pip.py` に影響されないよう作業ディレクトリには専用の空の一時フォルダーを使い、完了時に削除します。標準出力・標準エラーは直近200,000文字まで保持して UI へ配信し、アプリ内の同時実行は1件に制限します。実行中の環境変更・フォルダー変更は拒否します。

インストール検証では、テスト用 venv にローカルの wheel をネットワークなしで実際にインストールし、その Python から import できることを確認します。GUI テストはローカルの pip 代替モジュールで入力と対象環境・進捗表示を確認し、外部のパッケージをダウンロードしません。
