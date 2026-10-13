import test from 'node:test';
import assert from 'node:assert/strict';
import {focusPageContent,hasPageContentFocus} from '../src/reader-navigation.js';
test('page navigation announces its heading without disturbing restored reading position',()=>{
 const events=[],heading={setAttribute:(...args)=>events.push(args),focus:options=>events.push(options)},main={querySelector:()=>heading};
 assert.equal(focusPageContent({querySelector:()=>main}),true);
 assert.deepEqual(events,[['tabindex','-1'],{preventScroll:true}]);
});
test('a page without a heading still receives keyboard focus on its content landmark',()=>{
 let focused=false;const main={querySelector:()=>null,setAttribute(){},focus(){focused=true;}};
 assert.equal(focusPageContent({querySelector:()=>main}),true);assert.equal(focused,true);
 assert.equal(focusPageContent({querySelector:()=>null}),false);
});
test('asynchronous page rendering restores a focused destination without stealing draft input focus',()=>{
 let focused=0;const heading={setAttribute(){},focus(){focused++;}},main={querySelector:()=>heading},root={activeElement:heading,querySelector:()=>main};
 assert.equal(hasPageContentFocus(root),true);
 // A server recovery replaces the original heading with a fresh node.
 const restore=hasPageContentFocus(root),newHeading={setAttribute(){},focus(){focused++;}};
 main.querySelector=()=>newHeading;if(restore)focusPageContent(root);assert.equal(focused,1);
 root.activeElement={id:'action-input'};assert.equal(hasPageContentFocus(root),false);
 root.activeElement=main;assert.equal(hasPageContentFocus(root),true);
 assert.equal(hasPageContentFocus({activeElement:null,querySelector:()=>null}),false);
});
