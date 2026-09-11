import React, {useEffect, useState} from 'react';

export default function CityPicker({selection, onSelect}) {
  const [areas,setAreas] = useState(null);
  const [error,setError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [query,setQuery] = useState('');
  const [areaId,setAreaId] = useState(selection?.areaId || '');
  useEffect(()=>{
    const controller=new AbortController();
    setError(false);
    fetch('/data/uk-places.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(!Array.isArray(data.areas))throw Error();setAreas(data.areas);}).catch(e=>{if(e.name!=='AbortError')setError(true);});
    return ()=>controller.abort();
  },[attempt]);
  if(error)return <div role="alert">Unable to load cities. <button onClick={()=>setAttempt(n=>n+1)}>Try again</button></div>;
  if(!areas)return <p role="status">Loading UK counties and cities…</p>;
  const q=query.trim().toLocaleLowerCase('en-GB');
  const score=a=>a.places.some(p=>p.name.toLocaleLowerCase('en-GB')===q)?0:a.name.toLocaleLowerCase('en-GB').includes(q)?1:2;
  const visible=areas.filter(a=>!q||`${a.name} ${a.country}`.toLocaleLowerCase('en-GB').includes(q)||a.places.some(p=>p.name.toLocaleLowerCase('en-GB').includes(q))).sort((a,b)=>a.country.localeCompare(b.country)||(q?score(a)-score(b):0)||a.name.localeCompare(b.name));
  const active=visible.find(a=>a.id===areaId)||visible[0];
  const places=active?.places.filter(p=>!q||`${active.name} ${active.country}`.toLocaleLowerCase('en-GB').includes(q)||p.name.toLocaleLowerCase('en-GB').includes(q))||[];
  return <div className="city-picker">
    <label className="city-search"><span className="sr-only">Search counties or cities</span><input type="search" placeholder="Search counties or cities" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <button className="discover-option" aria-pressed={!selection} onClick={()=>onSelect(null)}>All UK areas</button>
    <div className="city-matrix">
      <div className="county-column"><h3>County / area</h3><div className="county-scroll">{visible.map((a,i)=><React.Fragment key={a.id}>{(i===0||visible[i-1].country!==a.country)&&<p className="country-label">{a.country}</p>}<button aria-pressed={active?.id===a.id} onClick={()=>setAreaId(a.id)}>{a.name}</button></React.Fragment>)}</div></div>
      <div className="cities-column"><h3>City / town</h3><div className="cities-scroll">{active&&<><p className="country-label">{active.name}</p><button className="county-all" aria-pressed={selection?.areaId===active.id&&!selection?.cityId} onClick={()=>onSelect({areaId:active.id,label:active.name})}>All in {active.name}</button><div className="city-grid">{places.map(p=><button key={p.id} aria-pressed={selection?.cityId===p.id} onClick={()=>onSelect({areaId:active.id,cityId:p.id,label:p.name})}>{p.name}</button>)}</div>{!places.length&&<p>No cities or towns listed in this area.</p>}</>}</div></div>
    </div>
    {!visible.length&&<p role="status">No counties or cities match your search.</p>}
    <p className="city-source">Place names: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></p>
  </div>;
}
