import React,{useEffect,useRef,useState} from 'react';
import {ArrowLeft,Maximize,RotateCcw} from 'lucide-react';
import {cleanTeamName,changeScore} from './scoreboard';
import './scoreboard.css';
const segments=['abcedf','bc','abged','abgcd','fgbc','afgcd','afgecd','abc','abcdefg','abcdfg'];
const shapes={a:'12,3 48,3 54,9 48,15 12,15 6,9',g:'12,45 48,45 54,51 48,57 12,57 6,51',d:'12,87 48,87 54,93 48,99 12,99 6,93',f:'3,12 9,18 9,42 3,48 0,42 0,18',b:'57,12 60,18 60,42 54,48 51,42 51,18',e:'3,54 9,60 9,84 3,90 0,84 0,60',c:'57,54 60,60 60,84 54,90 51,84 51,60'};
function Digits({value,label}){return <svg viewBox="0 0 132 102" role="img" aria-label={`${label}: ${value}`}>{String(value).padStart(2,'0').split('').map((n,i)=><g key={i} transform={`translate(${i*70+1} 0)`}>{Object.entries(shapes).map(([id,points])=><polygon key={id} points={points} fill="currentColor" opacity={segments[Number(n)].includes(id)?1:.09}/>)}</g>)}</svg>;}
export default function Scoreboard({onBack}){
 const root=useRef(null),[names,setNames]=useState(['Home','Guest']),[points,setPoints]=useState([0,0]),[games,setGames]=useState([0,0]),[notice,setNotice]=useState(''),[reset,setReset]=useState(false);
 useEffect(()=>{const old=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=old;try{screen.orientation?.unlock?.();}catch{}};},[]);
 const adjust=(setter,i,delta)=>setter(values=>values.map((v,j)=>i===j?changeScore(v,delta):v));
 async function fullscreen(){try{if(!document.fullscreenElement)await root.current.requestFullscreen();try{await screen.orientation?.lock?.('landscape');}catch{}setNotice('');}catch{setNotice('Fullscreen is unavailable in this browser. The board still fills the page; rotate your phone for landscape.');}}
 async function leave(){try{if(document.fullscreenElement===root.current)await document.exitFullscreen();}catch{}onBack();}
 return <div className="scoreboard-root" ref={root}><main className="scoreboard-landscape" aria-label="Badminton scoreboard"><div className="scoreboard-toolbar"><button onClick={leave} aria-label="Back to discover"><ArrowLeft size={18}/></button><span>Scoreboard</span><button onClick={()=>setReset(true)} aria-label="Reset scoreboard"><RotateCcw size={18}/></button><button onClick={fullscreen} aria-label="Enter landscape fullscreen"><Maximize size={18}/></button></div>
 {[0,1].map(i=><section key={i} className={`scoreboard-half ${i===0?'home':'guest'}`}><label className="scoreboard-name"><span className="sr-only">{i===0?'Home':'Guest'} name, up to six letters</span><input aria-label={i===0?'Home name':'Guest name'} value={names[i]} maxLength={6} spellCheck={false} onChange={e=>setNames(all=>all.map((v,j)=>j===i?cleanTeamName(e.target.value):v))} onBlur={()=>setNames(all=>all.map((v,j)=>j===i&&!v?(i===0?'Home':'Guest'):v))}/></label><div className="scoreboard-points"><Digits value={points[i]} label={`${names[i]} points`}/></div><div className="scoreboard-controls"><button aria-label={`Add ${i===0?'Home':'Guest'} point`} onClick={()=>adjust(setPoints,i,1)}>+</button><button aria-label={`Subtract ${i===0?'Home':'Guest'} point`} disabled={points[i]===0} onClick={()=>adjust(setPoints,i,-1)}>−</button></div></section>)}
 <div className="scoreboard-games" aria-label="Games won"><span className="scoreboard-games-title">Games</span>{[0,1].map(i=><div key={i}><button aria-label={`Add ${i===0?'Home':'Guest'} game`} onClick={()=>adjust(setGames,i,1)}>+</button><Digits value={games[i]} label={`${names[i]} games`}/><button aria-label={`Subtract ${i===0?'Home':'Guest'} game`} disabled={games[i]===0} onClick={()=>adjust(setGames,i,-1)}>−</button></div>)}</div>
 <div className="scoreboard-footer">Tap a name to edit · Points and games are scored manually</div>
 {notice&&<div className="scoreboard-notice" role="status" onClick={()=>setNotice('')}>{notice}</div>}
 {reset&&<div className="scoreboard-confirm" role="dialog" aria-modal="true" aria-label="Reset scoreboard"><p>Reset all points and games?</p><button onClick={()=>setReset(false)}>Cancel</button><button onClick={()=>{setPoints([0,0]);setGames([0,0]);setReset(false);}}>Reset</button></div>}
 </main></div>;
}
