import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { InlineDiagnostic } from './types';

export const setInlineDiagnostics = StateEffect.define<InlineDiagnostic[]>();

class ErrorExplanation extends WidgetType {
  constructor(readonly diagnostics:InlineDiagnostic[]) { super(); }
  eq(other:ErrorExplanation) { return JSON.stringify(this.diagnostics) === JSON.stringify(other.diagnostics); }
  toDOM() {
    const anchor = document.createElement('span');
    anchor.className = 'cm-inline-diagnostic-anchor';
    const note = document.createElement('span');
    note.className = 'cm-inline-diagnostic';
    note.setAttribute('role','note'); note.tabIndex = 0;
    note.textContent = this.diagnostics.map(d => `${this.diagnostics.length > 1 && d.targetText ? `「${d.targetText}」: ` : ''}${d.explanation}`).join('\n\n');
    note.title = this.diagnostics.map(d => `${d.explanation || ''}\nPython (${d.line}:${d.column}): ${d.message}`).join('\n\n');
    note.setAttribute('aria-label',note.title);
    anchor.append(note);
    return anchor;
  }
  ignoreEvent() { return true; }
}

export const inlineDiagnostics = StateField.define<DecorationSet>({
  create:() => Decoration.none,
  update(value,transaction) {
    // Keep explanations attached while editing, including when their text is replaced.
    if (transaction.docChanged) {
      const mapped = [];
      for (let cursor = value.iter(); cursor.value; cursor.next()) {
        const from = transaction.changes.mapPos(cursor.from,1);
        if (cursor.value.spec.widget) mapped.push(cursor.value.range(from));
        else {
          const to = transaction.changes.mapPos(cursor.to,-1);
          if (to > from) mapped.push(cursor.value.range(from,to));
        }
      }
      value = Decoration.set(mapped,true);
    }
    for (const effect of transaction.effects) {
      if (!effect.is(setInlineDiagnostics)) continue;
      const grouped = new Map<number,{ anchor:number; diagnostics:InlineDiagnostic[] }>();
      const ranges = [];
      const underlined = new Set<string>();
      for (const d of effect.value) {
        if (!d.explanation?.trim()) continue;
        const line = d.displayLine ?? d.line;
        if (!Number.isInteger(line) || line < 1 || line > transaction.state.doc.lines) continue;
        const sourceLine = transaction.state.doc.line(line);
        const characters = Array.from(sourceLine.text);
        let anchor = sourceLine.from;
        const start = d.startColumn ?? 0, end = d.endColumn ?? 0;
        if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= characters.length && d.targetText && characters.slice(start-1,end).join('') === d.targetText) {
          const from = sourceLine.from+characters.slice(0,start-1).join('').length;
          const to = sourceLine.from+characters.slice(0,end).join('').length;
          anchor = from;
          if (!underlined.has(`${from}:${to}`)) {
            underlined.add(`${from}:${to}`);
            ranges.push(Decoration.mark({ class:'cm-ai-error-range',attributes:{ title:d.explanation || d.message } }).range(from,to));
          }
        }
        const group = grouped.get(line);
        if (group) {
          group.anchor = Math.min(group.anchor,anchor);
          group.diagnostics.push(d);
        } else grouped.set(line,{ anchor,diagnostics:[d] });
      }
      for (const { anchor,diagnostics } of grouped.values()) ranges.push(Decoration.widget({ widget:new ErrorExplanation(diagnostics),side:-1 }).range(anchor));
      value = Decoration.set(ranges,true);
    }
    return value;
  },
  provide:field => EditorView.decorations.from(field)
});

export const inlineDiagnosticTheme = EditorView.baseTheme({
  '.cm-inline-diagnostic-anchor':{
    position:'relative',display:'inline-block',width:'0',height:'0',verticalAlign:'top'
  },
  '.cm-inline-diagnostic':{
    position:'absolute',top:'calc(1lh + 12px)',left:'0',zIndex:'2',display:'block',width:'min(480px, 45vw)',padding:'3px 8px',
    borderRadius:'4px',backgroundColor:'#fff0eb',color:'#963c2b',fontSize:'inherit',
    fontFamily:'-apple-system, BlinkMacSystemFont, sans-serif',lineHeight:'1.7',
    verticalAlign:'top',whiteSpace:'pre-wrap',overflowWrap:'anywhere',overflow:'visible',
    cursor:'help',userSelect:'text'
  },
  '.cm-ai-error-range':{
    textDecorationLine:'underline',textDecorationStyle:'wavy',textDecorationColor:'#b2382b',textDecorationThickness:'1.5px',textUnderlineOffset:'3px'
  },
  '.cm-inline-diagnostic:focus':{ outline:'1px solid #a04432',outlineOffset:'2px' }
});
