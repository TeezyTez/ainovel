import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingProgress} from '../src/reading-progress.js';

function fixture(){let time=0,id=0;const timers=new Map(),calls=[];const tracker=createReadingProgress({delay:180,setTimer:(fn,delay)=>{timers.set(++id,{fn,due:time+delay});return id;},clearTimer:id=>timers.delete(id),capture:context=>calls.push(context)});return {tracker,calls,tick(ms){time+=ms;for(const [id,timer] of [...timers])if(timer.due<=time){timers.delete(id);timer.fn();}},timers};}
test('scroll bursts schedule expensive capture once, using the most recent position',()=>{
 const {tracker,calls,tick}=fixture(),branch={id:'branch-a'};
 for(let y=1;y<=100;y++)tracker.schedule({branch,y});
 assert.deepEqual(calls,[]);tick(179);assert.deepEqual(calls,[]);tick(1);
 assert.deepEqual(calls,[{branch,y:100}]);tick(500);assert.equal(calls.length,1);
});
test('exit flush captures the previous branch before the view is replaced and cancels trailing work',()=>{
 const {tracker,calls,tick}=fixture(),branch={id:'previous'};
 tracker.schedule({branch,y:42});tracker.flush();assert.deepEqual(calls,[{branch,y:42}]);
 tick(500);assert.equal(calls.length,1);tracker.flush();assert.equal(calls.length,1);
});
test('scheduled work on a second branch never replaces unflushed first-branch progress',()=>{
 const {tracker,calls,tick}=fixture(),a={id:'a'},b={id:'b'};
 tracker.schedule({branch:a,y:10});tracker.schedule({branch:b,y:20});
 assert.deepEqual(calls,[{branch:a,y:10}]);tick(180);assert.deepEqual(calls,[{branch:a,y:10},{branch:b,y:20}]);
});
