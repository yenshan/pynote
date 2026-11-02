import { useEffect, useRef } from 'react';
import { indentUnit } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { pythonLanguage } from './pythonLanguage';
import { editorAppearance } from './editorThemes';
import { vim, Vim, getCM } from '@replit/codemirror-vim';
import { editorTypography, type FontSettings } from './fonts';
import { closeCompletion, fileCompletion } from './fileCompletion';
import { inlineDiagnostics, inlineDiagnosticTheme, setInlineDiagnostics } from './inlineDiagnostics';
import { syncVimYanks } from './vimClipboard';
import { blockCursor } from './blockCursor';
import type { InlineDiagnostic } from './types';

const layout = EditorView.theme({
  '&':{ height:'100%' },'.cm-scroller':{ overflow:'auto' },
  '.cm-content':{ padding:'22px 0' },'.cm-line':{ padding:'0 24px 0 0' },
  '.cm-gutters':{ minWidth:'0' },'.cm-lineNumbers .cm-gutterElement':{ padding:'0 8px' },
  '.cm-foldGutter':{ display:'none' }
});
type Props = { id:string; code:string; vimEnabled:boolean; fontSettings:FontSettings; theme:string; diagnostics:InlineDiagnostic[]; onChange:(code:string)=>void; onSave:()=>void; onRun:()=>void; onError:(error:unknown)=>void; onMode:(mode:string)=>void; onCursor:(line:number, col:number)=>void };
export function Editor(props:Props) {
  const host = useRef<HTMLDivElement>(null); const view = useRef<EditorView|null>(null); const current = useRef(props); current.current = props;
  const applyingExternal = useRef(false);
  const typography = useRef(new Compartment()); const appearance = useRef(new Compartment());
  useEffect(() => {
    if (!host.current) return;
    Vim.defineEx('write', 'w', () => current.current.onSave());
    const editor = new EditorView({ parent:host.current, state:EditorState.create({ doc:current.current.code, extensions:[
      ...(props.vimEnabled ? [vim()] : [blockCursor()]), basicSetup, keymap.of([
        { key:'Mod-s', run:() => { current.current.onSave(); return true; } },
        { key:'Mod-Shift-Enter', run:() => { current.current.onRun(); return true; } },
        { key:'Mod-Enter', run:() => { current.current.onRun(); return true; } }, indentWithTab
      ]), pythonLanguage, fileCompletion(), layout, appearance.current.of(editorAppearance(current.current.theme)), typography.current.of(editorTypography(current.current.fontSettings)),
      EditorState.tabSize.of(4), indentUnit.of('    '), inlineDiagnostics,inlineDiagnosticTheme,
      EditorView.updateListener.of(update => {
        if (update.docChanged && !applyingExternal.current) current.current.onChange(update.state.doc.toString());
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head; const line = update.state.doc.lineAt(pos);
          current.current.onCursor(line.number, pos - line.from + 1);
        }
      })
    ] }) });
    view.current = editor;
    const cm = getCM(editor);
    const modeChange = (event:{ mode:string; subMode?:string }) => {
      current.current.onMode((event.subMode || event.mode).toUpperCase());
      if (event.mode !== 'insert') queueMicrotask(() => { if (view.current === editor) closeCompletion(editor); });
    };
    cm?.on('vim-mode-change', modeChange);
    const stopClipboardSync = props.vimEnabled ? syncVimYanks(text => window.kata.copyText(text),error => current.current.onError(error)) : undefined;
    current.current.onMode(props.vimEnabled ? 'NORMAL' : 'EDIT');
    return () => { stopClipboardSync?.(); editor.destroy(); view.current = null; };
  }, [props.id, props.vimEnabled]);
  useEffect(() => {
    view.current?.dispatch({ effects:appearance.current.reconfigure(editorAppearance(props.theme)) });
  },[props.theme,props.id,props.vimEnabled]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects:typography.current.reconfigure(editorTypography(props.fontSettings)) });
    let disposed = false;
    document.fonts.ready.then(() => { if (!disposed) editor.requestMeasure(); });
    return () => { disposed = true; };
  },[props.fontSettings,props.id,props.vimEnabled]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== props.code) {
      applyingExternal.current = true;
      try { editor.dispatch({ changes:{ from:0, to:editor.state.doc.length, insert:props.code } }); }
      finally { applyingExternal.current = false; }
    }
  }, [props.code]);
  useEffect(() => {
    view.current?.dispatch({ effects:setInlineDiagnostics.of(props.diagnostics) });
  },[props.diagnostics,props.id,props.vimEnabled]);
  return <div ref={host} className="editor-mount" aria-label="Pythonコードエディタ"/>;
}
