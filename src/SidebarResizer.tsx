import { useEffect, useRef } from 'react';

type Props = {
  side:'left'|'right'; width:number; min:number; max:number;
  controls:string; onResize:(width:number)=>void;
  label?:string; className?:string;
};

export function SidebarResizer(props:Props) {
  const current=useRef(props); current.current=props;
  const drag=useRef<{ startX:number; width:number; pointerId:number; element:HTMLDivElement }|null>(null);
  function finish() {
    const active=drag.current; if (!active) return;
    drag.current=null; document.body.classList.remove('resizing-sidebar');
    if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
  }
  useEffect(() => {
    window.addEventListener('blur',finish);
    return () => { window.removeEventListener('blur',finish); finish(); };
  },[]);
  function change(value:number) {
    const { min,max,onResize }=current.current;
    onResize(Math.round(Math.max(min,Math.min(max,value))));
  }
  return <div className={`sidebar-resizer ${props.className || ''}`} role="separator" tabIndex={0}
    aria-label={props.label || `${props.side==='left'?'左':'右'}サイドバーの幅を調整`}
    aria-orientation="vertical" aria-controls={props.controls}
    aria-valuemin={props.min} aria-valuemax={props.max} aria-valuenow={props.width}
    aria-valuetext={`${props.width}px`}
    onPointerDown={event => {
      if (event.button!==0) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current={ startX:event.clientX,width:props.width,pointerId:event.pointerId,element:event.currentTarget };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing-sidebar');
    }}
    onPointerMove={event => {
      const active=drag.current; if (!active || event.pointerId!==active.pointerId) return;
      change(active.width+(event.clientX-active.startX)*(props.side==='left'?1:-1));
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={event => {
      const step=event.shiftKey?40:10;
      if (event.key==='Home') change(props.min);
      else if (event.key==='End') change(props.max);
      else if (event.key==='ArrowLeft' || event.key==='ArrowRight') change(props.width+(event.key==='ArrowRight'?step:-step)*(props.side==='left'?1:-1));
      else return;
      event.preventDefault(); event.stopPropagation();
    }}
  />;
}
