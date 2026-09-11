import React, {useEffect, useRef, useState} from 'react';
import {Pause, Play} from 'lucide-react';

export default function AutoScrollFeatures({children}) {
  const strip = useRef(null);
  const [paused,setPaused] = useState(false);
  useEffect(()=>{
    const el=strip.current;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame, last=0, hovering=false, focused=false, touching=false, resumeAt=performance.now()+1000;
    const group=el.querySelector('.feature-loop-group');
    const reset=()=>{el.scrollLeft=group.getBoundingClientRect().width;};
    reset();
    const resize=new ResizeObserver(reset);resize.observe(el);
    const enter=e=>{if(e.pointerType==='mouse')hovering=true;};
    const leave=()=>{hovering=false;};
    const down=()=>{touching=true;};
    const up=()=>{touching=false;resumeAt=performance.now()+2500;};
    const focus=()=>{focused=true;};
    const blur=e=>{if(!el.contains(e.relatedTarget))focused=false;};
    const wheel=()=>{resumeAt=performance.now()+2500;};
    const tick=now=>{
      const elapsed=last?Math.min(now-last,50):0;last=now;
      const width=group.getBoundingClientRect().width;
      if(!paused&&!reduced.matches&&!document.hidden&&!hovering&&!focused&&!touching&&now>resumeAt&&width>0){
        // Decreasing scrollLeft moves the icons visually from left to right.
        const next=el.scrollLeft-elapsed*.03;
        el.scrollLeft=next<=0?next+width:next;
      }
      frame=requestAnimationFrame(tick);
    };
    el.addEventListener('pointerenter',enter);el.addEventListener('pointerleave',leave);
    el.addEventListener('pointerdown',down);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
    el.addEventListener('focusin',focus);el.addEventListener('focusout',blur);el.addEventListener('wheel',wheel,{passive:true});
    frame=requestAnimationFrame(tick);
    return ()=>{resize.disconnect();cancelAnimationFrame(frame);el.removeEventListener('pointerenter',enter);el.removeEventListener('pointerleave',leave);el.removeEventListener('pointerdown',down);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);el.removeEventListener('focusin',focus);el.removeEventListener('focusout',blur);el.removeEventListener('wheel',wheel);};
  },[paused]);
  return <div className="feature-autoscroll"><div ref={strip} className="jimmi-feature-strip feature-loop-strip">{[0,1,2].map(copy=><div key={copy} className="feature-loop-group" aria-hidden={copy!==1?true:undefined}>{React.Children.map(children,child=>React.isValidElement(child)&&copy!==1?React.cloneElement(child,{tabIndex:-1}):child)}</div>)}</div><button className="feature-scroll-toggle" aria-label={paused?'Resume automatic scrolling':'Pause automatic scrolling'} aria-pressed={paused} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={12}/>:<Pause size={12}/>}</button></div>;
}
