import React, {useEffect, useRef, useState} from 'react';
import {Pause, Play} from 'lucide-react';

export default function AutoScrollFeatures({children}) {
  const strip = useRef(null);
  const [paused,setPaused] = useState(false);
  useEffect(()=>{
    const el=strip.current;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame, last=0, direction=1, hovering=false, focused=false, touching=false, resumeAt=performance.now()+1000;
    const enter=e=>{if(e.pointerType==='mouse')hovering=true;};
    const leave=()=>{hovering=false;};
    const down=()=>{touching=true;};
    const up=()=>{touching=false;resumeAt=performance.now()+2500;};
    const focus=()=>{focused=true;};
    const blur=e=>{if(!el.contains(e.relatedTarget))focused=false;};
    const wheel=()=>{resumeAt=performance.now()+2500;};
    const tick=now=>{
      const elapsed=last?Math.min(now-last,50):0;last=now;
      const max=el.scrollWidth-el.clientWidth;
      if(!paused&&!reduced.matches&&!document.hidden&&!hovering&&!focused&&!touching&&now>resumeAt&&max>1){
        el.scrollLeft=Math.max(0,Math.min(max,el.scrollLeft+direction*elapsed*.03));
        if((direction>0&&el.scrollLeft>=max-1)||(direction<0&&el.scrollLeft<=1)){direction*=-1;resumeAt=now+1200;}
      }
      frame=requestAnimationFrame(tick);
    };
    el.addEventListener('pointerenter',enter);el.addEventListener('pointerleave',leave);
    el.addEventListener('pointerdown',down);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
    el.addEventListener('focusin',focus);el.addEventListener('focusout',blur);el.addEventListener('wheel',wheel,{passive:true});
    frame=requestAnimationFrame(tick);
    return ()=>{cancelAnimationFrame(frame);el.removeEventListener('pointerenter',enter);el.removeEventListener('pointerleave',leave);el.removeEventListener('pointerdown',down);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);el.removeEventListener('focusin',focus);el.removeEventListener('focusout',blur);el.removeEventListener('wheel',wheel);};
  },[paused]);
  return <div className="feature-autoscroll"><div ref={strip} className="jimmi-feature-strip">{children}</div><button className="feature-scroll-toggle" aria-label={paused?'Resume automatic scrolling':'Pause automatic scrolling'} aria-pressed={paused} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={12}/>:<Pause size={12}/>}</button></div>;
}
