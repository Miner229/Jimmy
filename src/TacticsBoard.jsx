import React, {useRef,useState} from 'react';
import {ArrowLeft, RotateCcw, Users, User} from 'lucide-react';
import {initialPieces,movePiece} from './tactics';
import './tactics.css';

function PieceArt({team}) {
  return team==='shuttle'?<svg viewBox="0 0 60 70" aria-hidden="true"><path d="M23 26 8 60Q30 70 52 60L37 26Z" fill="#fff9dc" stroke="#bcb796" strokeWidth="2"/><path d="m25 28-8 33m12-33-2 36m6-36 5 35m-2-35 12 32" stroke="#d4cba5" strokeWidth="2"/><rect x="22" y="18" width="16" height="12" rx="3" fill="#facc15"/><path d="M22 20v-5a8 8 0 0 1 16 0v5" fill="white" stroke="#d6d3d1"/></svg>:<svg viewBox="0 0 70 86" aria-hidden="true"><ellipse cx="33" cy="77" rx="23" ry="6" fill="#143e2d" opacity=".4"/><path d="M24 59 22 75m18-16 4 16" stroke="#292524" strokeWidth="9" strokeLinecap="round"/><path d="M20 35 12 51m33-16 9 12" stroke="#e9b894" strokeWidth="7" strokeLinecap="round"/><path d="M21 30h22l5 29H17Z" fill={team==='a'?'#f7a1d3':'#63d9e3'} stroke="white" strokeWidth="2"/><circle cx="32" cy="20" r="11" fill="#e9b894"/><path d="M21 20q-4-19 12-17 14 0 10 19l-4-10q-8 5-17-1Z" fill="#3b2920"/><path d="m52 48 6-14" stroke="#eee" strokeWidth="3"/><ellipse cx="60" cy="25" rx="8" ry="11" transform="rotate(20 60 25)" fill="#b3e8d5" stroke="white" strokeWidth="2"/><path d="m57 17 5 16m-8-9 12 2m-10 4 9 1" stroke="#7d9d87" strokeWidth="1"/></svg>;
}
export default function TacticsBoard({onBack}) {
  const [mode,setMode]=useState('doubles');
  const [pieces,setPieces]=useState(()=>initialPieces('doubles'));
  const board=useRef(null), drag=useRef(null);
  function start(e,p) {
    if(e.pointerType==='mouse'&&e.button!==0)return;
    e.preventDefault();
    e.currentTarget.focus({preventScroll:true});
    e.currentTarget.setPointerCapture(e.pointerId);
    const r=board.current.getBoundingClientRect();
    drag.current={id:p.id,pointer:e.pointerId,dx:(e.clientX-r.left)/r.width*100-p.x,dy:(e.clientY-r.top)/r.height*100-p.y};
  }
  function move(e) {
    const d=drag.current;if(!d||d.pointer!==e.pointerId)return;
    const r=board.current.getBoundingClientRect();
    setPieces(p=>movePiece(p,d.id,(e.clientX-r.left)/r.width*100-d.dx,(e.clientY-r.top)/r.height*100-d.dy));
  }
  function end(e) {if(drag.current?.pointer===e.pointerId)drag.current=null;}
  function changeMode(next) {drag.current=null;setMode(next);setPieces(initialPieces(next));}
  return <main className="tactics-page"><header className="tactics-heading"><button onClick={onBack} aria-label="Back to discover"><ArrowLeft size={20}/></button><h1>Tactics Board</h1><button onClick={()=>setPieces(initialPieces(mode))} aria-label="Reset positions"><RotateCcw size={19}/></button></header><p className="tactics-hint">Drag players and the shuttle to plan your next rally.</p>
    <div className="tactics-court" ref={board}>
      <svg className="tactics-lines" viewBox="0 0 730 1460" preserveAspectRatio="none" aria-hidden="true"><rect width="730" height="1460" rx="20" fill="#164b37"/><rect x="60" y="60" width="610" height="1340" fill="#4e9d65" stroke="#fffef1" strokeWidth="7"/><g stroke="#fffef1" strokeWidth="4" fill="none"><path d="M106 60V1400M624 60V1400M60 136H670M60 1324H670M60 532H670M60 928H670M365 60V532M365 928V1400"/></g><path d="M38 730H692" stroke="#fff" strokeWidth="8"/><path d="M38 741H692M38 751H692" stroke="#153c2a" strokeWidth="2"/>{Array.from({length:48},(_,i)=><path key={i} d={`M${40+i*13.8} 734v24`} stroke="#153c2a" strokeWidth="2"/>)}<circle cx="38" cy="730" r="9" fill="white"/><circle cx="692" cy="730" r="9" fill="white"/></svg>
      {pieces.map(p=><button key={p.id} className={`tactics-piece ${p.team==='shuttle'?'tactics-shuttle':''}`} style={{left:`${p.x}%`,top:`${p.y}%`}} aria-label={`${p.label}; drag or use arrow keys to move`} onPointerDown={e=>start(e,p)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={e=>{const offset={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]}[e.key];if(offset){e.preventDefault();setPieces(all=>movePiece(all,p.id,p.x+offset[0],p.y+offset[1]));}}}><PieceArt team={p.team}/><span>{p.team==='shuttle'?'':p.id.toUpperCase()}</span></button>)}
    </div>
    <div className="tactics-mode" aria-label="Match format"><button aria-pressed={mode==='singles'} onClick={()=>changeMode('singles')}><User size={18}/>Singles · 1 vs 1</button><button aria-pressed={mode==='doubles'} onClick={()=>changeMode('doubles')}><Users size={18}/>Doubles · 2 vs 2</button></div><p className="tactics-footnote">Switching format resets positions. Keyboard: focus a piece and use arrow keys.</p>
  </main>;
}
