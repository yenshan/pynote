import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

type Palette = {
  background:string; text:string; gutter:string; muted:string; active:string; selection:string; accent:string; border:string;
  keyword:string; comment:string; string:string; number:string; type:string; builtin:string; operator:string; error:string;
};
type EditorTheme = { id:string; name:string; description:string; palette:Palette };
// Adapted from the upstream light palettes. Only the editor and its preview are themed.
export const editorThemes:EditorTheme[] = [
  { id:'classic',name:'PyNote Light（標準）',description:'白とセージグリーンを基調にした、これまでの配色。',palette:{
    background:'#ffffff',text:'#293329',gutter:'#ffffff',muted:'#667165',active:'#f5f8f1',selection:'#dbe9cf',accent:'#4b6e36',border:'#dfe5dc',
    keyword:'#7750a3',comment:'#60705a',string:'#3c6c36',number:'#9a5b1d',type:'#88621b',builtin:'#293329',operator:'#365f9a',error:'#a04432'
  } },
  { id:'latte',name:'Catppuccin Latte',description:'紫・青・オレンジ・緑で色鮮やかに。淡い背景のライトテーマ。',palette:{
    background:'#eff1f5',text:'#4c4f69',gutter:'#e6e9ef',muted:'#6c6f85',active:'#e6e9ef',selection:'#ccd0da',accent:'#8839ef',border:'#bcc0cc',
    keyword:'#8839ef',comment:'#7c7f93',string:'#40a02b',number:'#fe640b',type:'#df8e1d',builtin:'#1e66f5',operator:'#179299',error:'#d20f39'
  } },
  { id:'dawn',name:'Rosé Pine Dawn',description:'クリーム色の背景にローズ・紫・青緑を合わせた、柔らかい配色。',palette:{
    background:'#faf4ed',text:'#464261',gutter:'#fffaf3',muted:'#797593',active:'#f2e9e1',selection:'#dfdad9',accent:'#907aa9',border:'#dfdad9',
    keyword:'#286983',comment:'#797593',string:'#a66b20',number:'#b4637a',type:'#907aa9',builtin:'#b66a58',operator:'#56949f',error:'#b4637a'
  } },
  { id:'solarized',name:'Solarized Light',description:'生成りの背景に青・緑・マゼンタ。少しレトロなライトテーマ。',palette:{
    background:'#fdf6e3',text:'#657b83',gutter:'#eee8d5',muted:'#839496',active:'#eee8d5',selection:'#d8dfd4',accent:'#268bd2',border:'#d8d2c0',
    keyword:'#859900',comment:'#839496',string:'#2aa198',number:'#d33682',type:'#b58900',builtin:'#268bd2',operator:'#6c71c4',error:'#dc322f'
  } }
];
export const editorThemeKey = 'kata-editor-theme';
export const defaultEditorTheme = 'classic';
export function loadEditorTheme():string {
  try {
    const saved = localStorage.getItem(editorThemeKey);
    return editorThemes.some(theme => theme.id === saved) ? saved! : defaultEditorTheme;
  } catch { return defaultEditorTheme; }
}
export function editorAppearance(id:string) {
  const p = (editorThemes.find(theme => theme.id === id) || editorThemes[0]).palette;
  return [EditorView.theme({
    '&':{ backgroundColor:p.background,color:p.text },
    '.cm-content':{ caretColor:p.accent },
    '.cm-gutters':{ backgroundColor:p.gutter,color:p.muted,border:'none' },
    '.cm-activeLine, .cm-activeLineGutter':{ backgroundColor:p.active },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':{ backgroundColor:`${p.selection} !important` },
    '.cm-cursor, .cm-dropCursor':{ borderLeftColor:p.accent },
    '.cm-cursor':{ marginLeft:'0',borderLeftWidth:'2px' },
    '&.cm-focused .cm-fat-cursor':{ backgroundColor:`${p.accent} !important`,color:`${p.background} !important` },
    '&:not(.cm-focused) .cm-fat-cursor':{ backgroundColor:'transparent !important',color:'transparent !important',outline:`1px solid ${p.accent} !important`,outlineOffset:'-1px' },
    '.cm-panels, .cm-tooltip':{ backgroundColor:p.gutter,color:p.text,borderColor:p.border },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]':{ backgroundColor:p.selection,color:p.text },
    '.cm-completionMatchedText':{ color:p.accent,fontWeight:'600',textDecoration:'none' },
    '.cm-search input, .cm-search button':{ color:p.text,background:p.background,border:`1px solid ${p.border}` },
    '&.cm-focused':{ outline:'none' },
    '.cm-matchingBracket':{ backgroundColor:p.selection,outline:`1px solid ${p.accent}` },
    '.cm-selectionMatch':{ backgroundColor:p.active },
    '.cm-searchMatch':{ backgroundColor:p.selection,outline:`1px solid ${p.border}` },
    '.cm-searchMatch.cm-searchMatch-selected':{ backgroundColor:p.selection,outline:`1px solid ${p.accent}` }
  },{ dark:false }),syntaxHighlighting(HighlightStyle.define([
    { tag:tags.keyword,color:p.keyword },{ tag:tags.comment,color:p.comment,fontStyle:'italic' },
    { tag:[tags.string,tags.character],color:p.string },{ tag:[tags.number,tags.bool,tags.atom],color:p.number },
    { tag:[tags.typeName,tags.className],color:p.type },{ tag:tags.variableName,color:p.text },
    { tag:[tags.standard(tags.variableName),tags.function(tags.variableName)],color:p.builtin },
    { tag:tags.operator,color:p.operator },{ tag:tags.modifier,color:p.type },
    { tag:tags.meta,color:p.accent },{ tag:tags.invalid,color:p.error,textDecoration:'underline' }
  ]))];
}
