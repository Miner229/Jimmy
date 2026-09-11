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
