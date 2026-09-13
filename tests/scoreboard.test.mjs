import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changeScore,cleanTeamName} from '../src/scoreboard.js';
test('Scores increase, decrease and stay within two-digit display bounds',()=>{assert.equal(changeScore(0,1),1);assert.equal(changeScore(21,-1),20);assert.equal(changeScore(0,-1),0);assert.equal(changeScore(99,1),99);});
test('Team names contain at most six letters',()=>{assert.equal(cleanTeamName('Home'), 'Home');assert.equal(cleanTeamName('Guest12!'), 'Guest');assert.equal(cleanTeamName('ABCDEFGH'),'ABCDEF');});
