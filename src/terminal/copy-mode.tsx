import {useLayoutEffect, useRef, useState} from 'react';
import type {Terminal} from '@xterm/xterm';
import {writeSelection} from './clipboard';

export function snapshot(term: Terminal) {
  const buffer = term.buffer.active;
  const grid = term.element!.querySelector<HTMLElement>('.xterm-screen')!;
  const box = grid.getBoundingClientRect();
  const host = grid.closest('.terminal-view')!.getBoundingClientRect();
  const rowStyle = getComputedStyle(grid.querySelector('.xterm-rows > div')!);
  const rows: string[] = [], soft: number[] = [], starts: number[] = [];
  let length = 0;
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i)!;
    if (i && line.isWrapped) soft.push(length - 1);
    starts.push(length);
    const content = line.translateToString(!buffer.getLine(i+1)?.isWrapped);
    rows.push(content);
    length += content.length + 1;
  }
  function offset(pos: {x:number;y:number}){
    if(pos.y >= rows.length)return length - 1;
    return starts[pos.y] + Math.min(rows[pos.y].length, buffer.getLine(pos.y)!.translateToString(false,0,pos.x).length);
  }
  const range=term.getSelectionPosition();
  const rowHeight=box.height / term.rows;
  const canvas=document.createElement('canvas').getContext('2d')!;
  canvas.font=rowStyle.fontSize+' '+rowStyle.fontFamily;
  return {rowCount:rows.length,text:rows.join('\n'),soft,top:buffer.viewportY*rowHeight,
    topInset:box.top-host.top,left:box.left-host.left,
    font:rowStyle.fontFamily,size:rowStyle.fontSize,rowHeight,spacing:box.width/term.cols-canvas.measureText('M').width,
    range:range ? [offset(range.start),offset(range.end)] : [starts[buffer.viewportY],starts[buffer.viewportY]]};
}
type Snapshot=ReturnType<typeof snapshot>;
export function copyText(s:Snapshot,from:number,to:number){
  const parts:string[]=[];
  let start=from;
  for(const pos of s.soft){
    if(pos<from)continue;
    if(pos>=to)break;
    parts.push(s.text.slice(start,pos));
    start=pos+1;
  }
  parts.push(s.text.slice(start,to));
  return parts.join('');
}

export function CopyMode({view,onClose}:{view:Snapshot;onClose:()=>void}){
  const panel=useRef<HTMLDivElement>(null), field=useRef<HTMLTextAreaElement>(null);
  const [selected,setSelected]=useState(view.range[0]!==view.range[1]);
  const [problem,setProblem]=useState('');
  const afterClose=useRef(onClose); afterClose.current=onClose;
  const writing=useRef(false);
  const closing=useRef(false);
  const motion=useRef<Animation | null>(null);
  function dismiss(){
    const scope=panel.current;
    if(!scope || closing.current)return;
    closing.current=true;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){afterClose.current();return;}
    const style=getComputedStyle(scope);
    const from={transform:style.transform,opacity:style.opacity};
    motion.current?.cancel();
    const exit=scope.animate([from,{transform:'scale(.96)',opacity:0}],{duration:95,easing:'ease-in',fill:'forwards'});
    motion.current=exit;
    exit.onfinish=()=>{if(scope.isConnected)afterClose.current();};
  }
  useLayoutEffect(()=>{
    const el=field.current!, scope=panel.current!;
    el.focus({preventScroll:true});
    el.setSelectionRange(view.range[0],view.range[1]);
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      motion.current=scope.animate([{transform:'scale(.90)',opacity:0},{transform:'scale(1)',opacity:1}],
        {duration:145,easing:'ease-out'});
    }
    // Keep the opening row reachable even if Android dismisses the keyboard
    // and the textarea becomes taller than the previous terminal viewport.
    function padBottom(){
      const missing=Math.max(0,Math.ceil(el.clientHeight+view.top-view.rowCount*view.rowHeight));
      el.style.paddingBottom=missing+'px';
    }
    padBottom();
    el.scrollTop=view.top;
    const observer=new ResizeObserver(padBottom);
    observer.observe(el,{box:'border-box'});
    const bindings=new AbortController(), {signal}=bindings;
    function selection(){setSelected(el.selectionStart!==el.selectionEnd);}
    document.addEventListener('selectionchange',selection,{signal});
    el.addEventListener('select',selection,{signal});
    let shiftDown=0,lastShift=0;
    function reset(){shiftDown=lastShift=0;}
    // Keep selection shortcuts native. Handle the closing key while this layer still owns focus.
    scope.addEventListener('keydown',e=>{
      if(e.key==='Escape'){
        e.preventDefault(); e.stopPropagation();

      }else if(e.key==='Shift'&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
        shiftDown=performance.now();
        e.stopPropagation();
      }else reset();
    },{signal});
    scope.addEventListener('keyup',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismiss();return;}
      if(e.key!=='Shift')return;
      e.stopPropagation();
      const now=performance.now();
      if(shiftDown && now-shiftDown<350){
        if(lastShift && now-lastShift<400){e.preventDefault();dismiss();return;}
        lastShift=now;
      }else reset();
      shiftDown=0;
    },{signal});
    let pair:Map<number,[number,number]>|undefined, since=0, moved=false;
    scope.addEventListener('touchstart',e=>{
      reset();
      if(e.touches.length===2 && !pair){
        pair=new Map(Array.from(e.touches,t=>[t.identifier,[t.clientX,t.clientY]]));
        since=performance.now(); moved=false;
      }else if(e.touches.length>2)moved=true;
      if(pair){e.preventDefault();e.stopPropagation();}
    },{passive:false,signal});
    scope.addEventListener('touchmove',e=>{
      if(!pair)return;
      for(const t of Array.from(e.changedTouches)){
        const p=pair.get(t.identifier);
        if(!p || Math.hypot(t.clientX-p[0],t.clientY-p[1])>12)moved=true;
      }
      e.preventDefault();e.stopPropagation();
    },{passive:false,signal});
    scope.addEventListener('touchend',e=>{
      if(!pair)return;
      e.preventDefault();e.stopPropagation();
      if(e.touches.length===0){pair=undefined;if(!moved && performance.now()-since<400)dismiss();}
    },{passive:false,signal});
    scope.addEventListener('touchcancel',()=>{pair=undefined;},{signal});
    return ()=>{motion.current?.cancel();observer.disconnect();bindings.abort();};
  },[view]);
  async function copy(all:boolean){
    const el=field.current!;
    const value=all?copyText(view,0,view.text.length).replace(/\n+$/,''):copyText(view,el.selectionStart,el.selectionEnd);
    if(writing.current || closing.current)return;
    writing.current=true;
    try{
      if(await writeSelection(value)){if(el.isConnected)dismiss();}
      else if(el.isConnected){setProblem('Use Copy in the system menu.');if(all)el.select();el.focus({preventScroll:true});}
    }finally{writing.current=false;}
  }
  return <div className="terminal-copy-mode" ref={panel}>
    <textarea aria-label="Terminal text" ref={field} readOnly wrap="off" spellCheck={false}
      style={{marginTop:view.topInset,marginLeft:view.left,fontFamily:view.font,fontSize:view.size,lineHeight:view.rowHeight+'px',letterSpacing:view.spacing}}
      defaultValue={view.text}
      onCopy={e=>{
        if(writing.current || !e.nativeEvent.isTrusted)return;
        if(closing.current){e.preventDefault();return;}
        const el=field.current!;
        if(el.selectionEnd===el.selectionStart)return;
        e.preventDefault();
        e.clipboardData.setData('text/plain',copyText(view,el.selectionStart,el.selectionEnd));
        queueMicrotask(()=>{if(el.isConnected)dismiss();});
      }}/>
    {problem && <span role="status">{problem}</span>}
    <div className="copy-row" role="group" aria-label="Copy controls"
      onMouseDown={e=>e.preventDefault()}>
      <button onClick={()=>void copy(true)}>Copy all</button>
      <button disabled={!selected} onClick={()=>void copy(false)}>{selected ? 'Copy selected' : 'Select text to copy'}</button>
      <button aria-label="Close copy mode" onClick={dismiss}>×</button>
    </div>
  </div>;
}
