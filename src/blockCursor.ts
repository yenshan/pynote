import { EditorSelection } from '@codemirror/state';
import { EditorView, RectangleMarker, layer } from '@codemirror/view';

class BlockCursorMarker extends RectangleMarker {
  constructor(rect:RectangleMarker, readonly letter:string, width:number) {
    super('cm-fat-cursor',rect.left,rect.top,width,rect.height);
  }
  eq(other:BlockCursorMarker) {
    return super.eq(other) && this.letter === other.letter;
  }
  draw() {
    const dom = super.draw();
    dom.textContent = this.letter;
    return dom;
  }
  update(dom:HTMLElement, previous:BlockCursorMarker) {
    super.update(dom,previous);
    dom.textContent = this.letter;
    return true;
  }
}

export function blockCursor() {
  return [EditorView.editorAttributes.of({ class:'cm-standardMode' }),EditorView.theme({
    '&.cm-standardMode .cm-cursorLayer:not(.cm-blockCursorLayer)':{ display:'none' },
    '&.cm-standardMode .cm-fat-cursor':{ position:'absolute',whiteSpace:'pre',lineHeight:'normal',overflow:'hidden',pointerEvents:'none' }
  }),layer({
    above:true,
    class:'cm-blockCursorLayer',
    mount(dom) { dom.classList.add('cm-cursorLayer'); },
    update(update,dom) {
      if (update.selectionSet || update.docChanged) dom.style.animationName = dom.style.animationName === 'cm-blink' ? 'cm-blink2' : 'cm-blink';
      return update.docChanged || update.selectionSet || update.geometryChanged;
    },
    markers(view) {
      return view.state.selection.ranges.filter(range => range.empty).flatMap(range => {
        const cursor = EditorSelection.cursor(range.head,range.assoc);
        const letter = Array.from(view.state.doc.sliceString(range.head,Math.min(view.state.doc.length,range.head+2)))[0] || ' ';
        const start = view.coordsAtPos(range.head);
        const end = range.head+letter.length <= view.state.doc.length && letter !== '\n' && letter !== '\t' ? view.coordsAtPos(range.head+letter.length,-1) : null;
        const width = start && end && end.top === start.top && end.left > start.left ? (end.left-start.left)/view.scaleX : view.defaultCharacterWidth;
        return RectangleMarker.forRange(view,'',cursor).map(rect => new BlockCursorMarker(rect,letter === '\n' || letter === '\t' ? ' ' : letter,width));
      });
    }
  })];
}
