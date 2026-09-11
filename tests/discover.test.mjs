import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultFilters,filterSessions,distanceKm} from '../src/discoverFilters.js';
const origin={latitude:51,longitude:0};
const sessions=[{id:1,name:'Morning',club:'Club',location:'London',coordinates:origin,dateISO:'2026-09-11',timeStart:'06:00',price:0,type:'Social',levelMin:1,levelMax:3,reliability:80},{id:2,name:'Evening',club:'Club',location:'London',coordinates:{latitude:52,longitude:0},dateISO:'2026-09-12',timeStart:'18:00',price:9,type:'Doubles',levelMin:6,levelMax:8,reliability:90}];
const ids=(patch,pos=origin)=>filterSessions(sessions,{...defaultFilters,...patch},pos).map(s=>s.id);
test('Date, time, free, type, level and search filters apply',()=>{
 for(const patch of [{date:'2026-09-11'},{start:'06:00',end:'12:00'},{free:true},{type:'Social'},{level:'1-3'},{query:'morning'}])assert.deepEqual(ids(patch),[1]);
 assert.deepEqual(ids({start:'00:00',end:'06:00'}),[]);
 assert.deepEqual(ids({date:'2026-09-13'}),[]);
});
test('Distance uses coordinates and never a fabricated fallback',()=>{
 assert.equal(distanceKm(origin,origin),0);assert.ok(Math.abs(distanceKm(origin,{latitude:52,longitude:0})-111.195)<.01);
 assert.deepEqual(ids({radius:10}),[1]);assert.deepEqual(ids({radius:10},null),[]);
 assert.equal(filterSessions(sessions,defaultFilters,null)[0].distanceKm,null);
});
test('Sort orders are deterministic and do not mutate data',()=>{
 assert.deepEqual(ids({sort:'smart'}),[2,1]);assert.deepEqual(ids({sort:'time'}),[1,2]);assert.deepEqual(ids({sort:'distance'}),[1,2]);assert.equal(sessions[0].distanceKm,undefined);
});
test('County and city selection uses IDs and excludes untagged sessions',()=>{
 const local=[{...sessions[0],areaId:'GB.ENG.GLA',cityIds:['london','crystal-palace']},{...sessions[1],areaId:'GB.SCT.U8',cityIds:['edinburgh']}, {...sessions[0],id:3}];
 const select=area=>filterSessions(local,{...defaultFilters,area},null).map(s=>s.id);
 assert.deepEqual(select({areaId:'GB.ENG.GLA'}),[1]);
 assert.deepEqual(select({areaId:'GB.ENG.GLA',cityId:'london'}),[1]);
 assert.deepEqual(select({areaId:'GB.ENG.GLA',cityId:'crystal-palace'}),[1]);
 assert.deepEqual(select({areaId:'GB.ENG.GLA',cityId:'edinburgh'}),[]);
 assert.equal(select(null).length,3);
});
test('UK dataset covers four nations and has stable unique place IDs',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {areas}=JSON.parse(await readFile(new URL('../public/data/uk-places.json',import.meta.url),'utf8'));
 for(const nation of ['England','Scotland','Wales','Northern Ireland'])assert.ok(areas.some(a=>a.country===nation&&a.places.length));
 const places=areas.flatMap(a=>a.places);
 for(const name of ['London','Belfast','Cardiff','Edinburgh','Wrexham','Milton Keynes','Dunfermline','Bangor'])assert.ok(places.some(p=>p.name===name),name);
 assert.equal(new Set(places.map(p=>p.id)).size,places.length);
 assert.ok(areas.some(a=>a.id==='GB.ENG.GLA'&&a.places.some(p=>p.id==='2643743')));
});
