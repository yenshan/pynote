import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { AppEvent } from './types';

export type TerminalHandle = { focus:()=>void; dimensions:()=>{ cols:number; rows:number } };
type Props = { id:string; generation:number; onError:(error:unknown)=>void; onState:(alive:boolean)=>void };
export const PythonTerminal = forwardRef<TerminalHandle,Props>(function PythonTerminal(props,ref) {
  const host = useRef<HTMLDivElement>(null); const terminal = useRef<Terminal|null>(null);
  const [showStartHint,setShowStartHint] = useState(false);
  const current = useRef(props); current.current=props;
  useImperativeHandle(ref,() => ({
    focus:() => terminal.current?.focus(),
    dimensions:() => ({ cols:terminal.current?.cols || 80,rows:terminal.current?.rows || 24 })
  }),[]);
  useEffect(() => {
    if (!host.current) return;
    setShowStartHint(false);
    const { id }=props; let disposed=false, initialized=false, exited=true, sequence=0, placeholder=false;
    const pending:Extract<AppEvent,{type:'python-data'}>[]=[];
    const term=new Terminal({
      cursorBlink:true,cursorStyle:'block',scrollback:5000,fontSize:12,lineHeight:1.35,
      fontFamily:'"SFMono-Regular", Menlo, Consolas, monospace',
      theme:{ background:'#ffffff',foreground:'#293329',cursor:'#4b6e36',cursorAccent:'#ffffff',selectionBackground:'#dbe9cf',
        black:'#293329',red:'#a04432',green:'#3c6c36',yellow:'#88621b',blue:'#365f9a',magenta:'#7750a3',cyan:'#267578',white:'#657267',
        brightBlack:'#667165',brightRed:'#b2382b',brightGreen:'#477c36',brightYellow:'#9a6516',brightBlue:'#416fb0',brightMagenta:'#8b50b3',brightCyan:'#267578',brightWhite:'#293329' }
    });
    const fit=new FitAddon(); term.loadAddon(fit); term.open(host.current); terminal.current=term;
    term.attachCustomKeyEventHandler(event => {
      if (event.defaultPrevented) return false;
      if (event.type==='keydown' && ((event.metaKey && event.key==='c') || (event.ctrlKey && event.shiftKey && event.key.toLowerCase()==='c')) && term.hasSelection()) {
        event.preventDefault(); navigator.clipboard.writeText(term.getSelection()).catch(current.current.onError); return false;
      }
      // Let application shortcuts bubble; ordinary terminal keys go to Python.
      if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && ['s','n','j','/','enter'].includes(event.key.toLowerCase())) return false;
      return true;
    });
    const onData=term.onData(data => { if (initialized && !exited) window.kata.pythonWrite(id,data).catch(current.current.onError); });
    const onResize=term.onResize(({ cols,rows }) => { if (initialized && !exited) window.kata.pythonResize(id,cols,rows).catch(current.current.onError); });
    const write = (event:Extract<AppEvent,{type:'python-data'}>) => {
      if (event.seq <= sequence) return;
      if (placeholder) { term.reset(); placeholder=false; setShowStartHint(false); }
      if (exited) { exited=false; current.current.onState(true); window.kata.pythonResize(id,term.cols,term.rows).catch(current.current.onError); }
      sequence=event.seq; term.write(event.data);
    };
    const unsubscribe=window.kata.onEvent(event => {
      if (event.type==='python-data' && event.id===id) {
        if (!initialized) pending.push(event);
        else write(event);
      }
      if (event.type==='python-exit' && event.id===id) {
        exited=true; sequence=0; placeholder=true;
        term.writeln(`\r\n[Python終了。右上の ↻ で再起動できます]`); current.current.onState(false);
      }
    });
    const size=() => { if (!disposed && host.current?.clientWidth && host.current.clientHeight) fit.fit(); };
    size(); const observer=new ResizeObserver(size); observer.observe(host.current);
    document.fonts.ready.then(size);
    window.kata.pythonSnapshot(id).then(snapshot => {
      if (disposed) return;
      sequence=snapshot?.seq || 0; exited=!snapshot?.alive;
      if (snapshot) term.write(snapshot.data);
      else { setShowStartHint(true); placeholder=true; }
      initialized=true;
      for (const event of pending) write(event);
      pending.length=0; size();
      if (!exited) window.kata.pythonResize(id,term.cols,term.rows).catch(current.current.onError);
      current.current.onState(!exited);
    }).catch(error => { if (!disposed) { term.writeln(String(error)); current.current.onState(false); current.current.onError(error); } });
    return () => { disposed=true; observer.disconnect(); unsubscribe(); onData.dispose(); onResize.dispose(); term.dispose(); terminal.current=null; };
  },[props.id,props.generation]);
  return <div className="python-terminal-container"><div className="python-terminal" ref={host} aria-label="Pythonターミナル"/>{showStartHint && <div className="python-start-hint"><span><span className="python-command-key">⌘</span>Enter / Ctrl+Enter または「実行」でPythonを起動します。</span></div>}</div>;
});
