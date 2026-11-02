import { EditorView } from '@codemirror/view';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-400-italic.css';
import '@fontsource/fira-code/latin-400.css';
import '@fontsource/monaspace-neon/latin-400.css';
import '@fontsource/monaspace-neon/latin-400-italic.css';
import '@fontsource/monaspace-argon/latin-400.css';
import '@fontsource/monaspace-argon/latin-400-italic.css';
import './fonts.css';

const fallback = '"SFMono-Regular", Menlo, Consolas, monospace';
export const fonts = [
  { id:'system',name:'システム標準',family:fallback,description:'これまでと同じ標準の等幅フォント。' },
  { id:'jetbrains',name:'JetBrains Mono',family:`"JetBrains Mono", ${fallback}`,description:'すっきりした字形で、文字や記号を見分けやすい。' },
  { id:'fira',name:'Fira Code',family:`"Fira Code", ${fallback}`,description:'豊富な合字で、Pythonの演算子をなめらかに表示。' },
  { id:'hasklig',name:'Hasklig',family:`"Kata Hasklig", ${fallback}`,description:'Pythonの記号を読みやすくするために作られたフォント。' },
  { id:'neon',name:'Monaspace Neon',family:`"Monaspace Neon", ${fallback}`,description:'整った、モダンで端正な字形。' },
  { id:'argon',name:'Monaspace Argon',family:`"Monaspace Argon", ${fallback}`,description:'柔らかさと個性のある、親しみやすい字形。' }
] as const;
export type FontSettings = { font:string; size:number; lineHeight:number; ligatures:boolean };
export const defaultFontSettings:FontSettings = { font:'system',size:13,lineHeight:1.85,ligatures:false };
export const fontSettingsKey = 'kata-editor-font';
export function loadFontSettings():FontSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(fontSettingsKey) || 'null');
    return {
      font:fonts.some(font => font.id === saved?.font) ? saved.font : defaultFontSettings.font,
      size:Number.isFinite(saved?.size) ? Math.round(Math.max(10,Math.min(28,saved.size))) : defaultFontSettings.size,
      lineHeight:Number.isFinite(saved?.lineHeight) ? Math.max(1.2,Math.min(2.2,saved.lineHeight)) : defaultFontSettings.lineHeight,
      ligatures:typeof saved?.ligatures === 'boolean' ? saved.ligatures : defaultFontSettings.ligatures
    };
  } catch { return { ...defaultFontSettings }; }
}
export function editorTypography(settings:FontSettings) {
  const font = fonts.find(font => font.id === settings.font) || fonts[0];
  const ligatureFeatures = settings.font === 'neon' || settings.font === 'argon'
    ? '"liga" 1, "calt" 1, "ss01" 1, "ss02" 1, "ss03" 1, "ss04" 1, "ss05" 1, "ss06" 1, "ss07" 1, "ss08" 1, "ss09" 1'
    : '"liga" 1, "calt" 1';
  return EditorView.theme({
    '&':{ fontSize:`${settings.size}px` },
    '.cm-scroller':{
      fontFamily:font.family,lineHeight:String(settings.lineHeight),
      fontVariantLigatures:settings.ligatures ? 'normal' : 'none',
      fontFeatureSettings:settings.ligatures ? ligatureFeatures : '"liga" 0, "calt" 0'
    }
  });
}
