import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialPieces,movePiece} from '../src/tactics.js';
test('Singles and doubles provide two or four players and one shuttle',()=>{for(const [mode,count] of [['singles',3],['doubles',5]]){const p=initialPieces(mode);assert.equal(p.length,count);assert.equal(p.filter(x=>x.id==='shuttle').length,1);assert.equal(new Set(p.map(x=>x.id)).size,count);}});
test('Dragging moves only selected piece and clamps it inside the board',()=>{const p=initialPieces('doubles');const next=movePiece(p,'a1',-100,150);assert.equal(next[0].x,5);assert.equal(next[0].y,96);assert.deepEqual(next.slice(1),p.slice(1));assert.equal(p[0].x,30);assert.equal(movePiece(p,'shuttle',72,62).find(x=>x.id==='shuttle').x,72);});
