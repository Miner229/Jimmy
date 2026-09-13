import React from 'react';
import {ClipboardList,Shuffle,Layers,ChevronRight} from 'lucide-react';
import './tools.css';
export default function ToolsPage({go}) {
 const tools=[{id:'scoreboard',title:'Scoreboard',detail:'Keep every point in play',icon:ClipboardList},{id:'tactics',title:'Tactics Board',detail:'Plan your next winning rally',icon:Shuffle},{id:'levels',title:'Levels',detail:'Find your level. Build your game.',icon:Layers}];
 return <main className="tools-page" aria-label="Tools"><h1 className="sr-only">Tools</h1>{tools.map(({id,title,detail,icon:Icon})=><button key={id} className={`tool-tile tool-${id}`} onClick={()=>go(id)}><img src={`/tools/${id}.svg`} alt="" aria-hidden="true"/><span className="tool-shade"/><span className="tool-tile-content"><Icon size={32} strokeWidth={1.5}/><span><strong>{title}</strong><span className="tool-description">{detail}</span>{id!=='levels'&&<small>Sign-in required</small>}</span><ChevronRight className="tool-chevron" size={26}/></span></button>)}</main>;
}
