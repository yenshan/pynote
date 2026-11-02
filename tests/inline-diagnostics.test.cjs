const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { EditorState } = require('@codemirror/state');

// Exercise the real CodeMirror state field without requiring an Electron window.
const filename = path.resolve(__dirname,'../src/inlineDiagnostics.ts');
const compiled = new Module(filename,module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 }
}).outputText,filename);
const { inlineDiagnostics,setInlineDiagnostics } = compiled.exports;

function decorations(state) {
  const widgets = [], marks = [];
  for (const cursor = state.field(inlineDiagnostics).iter(); cursor.value; cursor.next()) {
    (cursor.value.spec.widget ? widgets : marks).push({ from:cursor.from,to:cursor.to,spec:cursor.value.spec });
  }
  return { widgets,marks };
}
function explain(doc,diagnostics) {
  return EditorState.create({ doc,extensions:[inlineDiagnostics] }).update({
    effects:setInlineDiagnostics.of(diagnostics)
  }).state;
}
const diagnostic = (line,startColumn,targetText,explanation) => ({
  line,column:startColumn,startColumn,endColumn:startColumn+Array.from(targetText).length-1,
  targetText,explanation,message:'type mismatch',severity:'error'
});

test('two errors on the same line share a popup and retain both underlines', () => {
  const first = diagnostic(1,6,'foo','first explanation');
  const second = diagnostic(1,10,'bar','second explanation');
  const state = explain('x = (foo,bar)',[second,first]);
  const { widgets,marks } = decorations(state);
  assert.equal(widgets.length,1);
  assert.equal(widgets[0].from,5,'anchor at the leftmost error regardless of diagnostic order');
  assert.deepEqual(widgets[0].spec.widget.diagnostics,[second,first]);
  assert.deepEqual(marks.map(mark => state.doc.sliceString(mark.from,mark.to)),['foo','bar']);
  const edited = state.update({ changes:{ from:0,insert:'-- heading\n' } }).state;
  assert.equal(decorations(edited).widgets.length,1);
  assert.equal(edited.doc.lineAt(decorations(edited).widgets[0].from).number,2);
  assert.deepEqual(decorations(edited).marks.map(mark => edited.doc.sliceString(mark.from,mark.to)),['foo','bar']);
});

test('grouping uses displayLine and handles errors without a verified range', () => {
  const diagnostics = [
    { ...diagnostic(2,6,'foo','first'),displayLine:1 },
    { ...diagnostic(2,1,'missing','fallback'),displayLine:1 },
    diagnostic(2,5,'bar','other line')
  ];
  const { widgets,marks } = decorations(explain('x = (foo)\ny = bar',diagnostics));
  assert.equal(widgets.length,2);
  assert.equal(widgets[0].from,0);
  assert.equal(widgets[0].spec.widget.diagnostics.length,2);
  assert.equal(widgets[1].spec.widget.diagnostics.length,1);
  assert.equal(marks.length,2);
});

test('same-line Unicode ranges remain distinct and saving can clear the popup', () => {
  const state = explain('x = ("😀",foo)',[
    diagnostic(1,6,'"😀"','first'),diagnostic(1,10,'foo','second')
  ]);
  const { widgets,marks } = decorations(state);
  assert.equal(widgets.length,1);
  assert.deepEqual(marks.map(mark => state.doc.sliceString(mark.from,mark.to)),['"😀"','foo']);
  const cleared = state.update({ effects:setInlineDiagnostics.of([]) }).state;
  assert.deepEqual(decorations(cleared),{ widgets:[],marks:[] });
});
