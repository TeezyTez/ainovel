import test from 'node:test';
import assert from 'node:assert/strict';
import {interactionQuery,selectObjects,resolveSelection,queryObjects} from '../src/interaction-context.js';
import {interactionView,selectionView} from '../src/interaction-ui.js';
import {validateRequest} from '../src/server-model.mjs';
import {createSession,currentState} from '../src/core.js';
import {publicSituation} from '../src/experience-state.js';
const scope={worldKey:'test@1',branchId:'b',baseVersion:3};
const situation={summary:'你在茶馆',clock:{label:'周三傍晚'},objects:[
 {id:'clue:a',kind:'clue',name:'车票',summary:'票面为周二',certainty:'confirmed',sourceVersion:1,fields:[{key:'occurredAt',label:'发生时间',value:'周二'}],secret:'NEVER_RENDER'},
 {id:'clue:b',kind:'clue',name:'证词',summary:'他说周三才出发',certainty:'reported',sourceVersion:3,fields:[]},
 {id:'person:p',kind:'person',name:'小林',summary:'正等你答复',certainty:'confirmed',sourceVersion:2,fields:[]}
]};
test('natural queries are read-only commands, compound world actions remain actions',()=>{
 assert.equal(interactionQuery('我现在怎么样？').kind,'overview');
 assert.equal(interactionQuery('看看有哪些线索').filter,'clue');
 assert.equal(interactionQuery('查看人物资料').filter,'person');
 assert.equal(interactionQuery('比较这两个').kind,'compare');
 assert.equal(interactionQuery('查看小林的资料').query,'小林');
 assert.equal(interactionQuery('我有哪些物品？').filter,'item');
 assert.equal(interactionQuery('现在有哪些约定？').filter,'agreement');
 for(const s of ['我问小林：“我现在怎么样？”','查看小林的资料，然后去找她','去找小林','“比较这两个”'])assert.equal(interactionQuery(s),null);
});

test('presentation is selected from the request without another input or selector',()=>{
 assert.equal(interactionQuery('人物').filter,'person');
 assert.equal(interactionQuery('人物关系').kind,'relationships');
 assert.equal(interactionQuery('时间线').kind,'timeline');
 assert.equal(interactionQuery('用表格显示物品').view,'table');
 assert.equal(interactionQuery('用卡片展示人物').view,'cards');
 assert.equal(interactionQuery('显示我的能力').query,'能力');
 assert.equal(interactionQuery('我说：“用表格显示物品”'),null);
 const people=queryObjects(interactionQuery('人物'),situation,{scope});
 assert.match(interactionView(people,{scope}),/interaction-person-cards/);
 const timeline=queryObjects(interactionQuery('时间线'),situation,{scope});
 assert.match(interactionView(timeline,{scope}),/interaction-timeline/);
 assert.match(interactionView(timeline,{scope}),/按记录顺序/);
});

test('relationship cards distinguish missing relations and never fabricate NPC edges',()=>{
 const result=queryObjects({kind:'relationships',filter:'person'},{objects:[{id:'p',name:'小林',kind:'person',sourceVersion:1,fields:[{key:'relationship',label:'关系',value:'答应帮你送信'}]},{id:'q',name:'阿苇',kind:'person',sourceVersion:2,fields:[]}]},{scope});
 const html=interactionView(result,{scope});
 assert.match(html,/interaction-relationships/);assert.match(html,/答应帮你送信/);assert.match(html,/关系尚未记录/);
 assert.doesNotMatch(html,/友好度|亲密度|<script/);
});
test('selection uses stable public IDs and rejects another branch, outdated version or hidden object',()=>{
 const selected=selectObjects(scope,situation,['clue:b','clue:a']);
 assert.deepEqual(resolveSelection(selected,scope,situation).map(o=>o.id),['clue:b','clue:a']);
 assert.throws(()=>resolveSelection(selected,{...scope,baseVersion:4},situation),/过期/);
 assert.throws(()=>resolveSelection(selected,{...scope,branchId:'else'},situation),/分支/);
 assert.throws(()=>selectObjects(scope,situation,['secret:x']),/可知/);
 assert.equal(JSON.stringify(selected).includes('NEVER_RENDER'),false);
});
test('comparison and sorting read the same projection without mutating world or guessing missing values',()=>{
 const before=structuredClone(situation),selection=selectObjects(scope,situation,['clue:b','clue:a']);
 const result=queryObjects({kind:'compare'},situation,{scope,selection});
 assert.deepEqual(result.objects.map(o=>o.id),['clue:b','clue:a']);
 assert.deepEqual(situation,before);
 assert.match(queryObjects({kind:'compare'},situation,{scope}).message,/先选择/);
 assert.equal(queryObjects({kind:'list',filter:'resource'},situation,{scope}).objects.length,0);
 const html=interactionView(result,{selection,scope});
 assert.match(html,/<table/);assert.match(html,/尚未记录/);assert.doesNotMatch(html,/NEVER_RENDER/);
 assert.match(selectionView(selection,scope,situation),/只对下一次/);
});
test('duplicate names stay distinct and names only resolve unambiguously',()=>{
 const data={objects:[...situation.objects,{...situation.objects[0],id:'clue:c'}]};
 assert.equal(queryObjects({kind:'list',query:'车票'},data,{scope}).objects.length,2);
 assert.equal(queryObjects({kind:'compare',names:['车票','证词']},data,{scope}).objects.length,0);
});
test('server resolves selection from public state and ignores forged attached values',()=>{
 const world={id:'tea',version:1,title:'茶馆',location:'茶馆',opening:'小林坐在桌边。',identity:'客人',rules:[],characters:[{id:'lin',name:'小林',public:'客人',secret:'SECRET'}]};
 const s=createSession(world),b=s.branches[0],state=currentState(s),scope={worldKey:'tea@1',branchId:b.id,baseVersion:0};
 const selection=selectObjects(scope,publicSituation(b,world),['person:lin']);
 const body={world,state,player:s.player,preferences:{},requestId:'select-test',input:'我问这个人是否愿意帮忙',memory:[],recent:[],branchId:b.id,selection,selectedObjects:[{secret:'FORGED'}]};
 const accepted=validateRequest(body);assert.equal(accepted.selectedObjects[0].id,'person:lin');assert.doesNotMatch(JSON.stringify(accepted.selectedObjects),/SECRET|FORGED/);
 assert.throws(()=>validateRequest({...body,selection:{...selection,baseVersion:1}}));
 assert.throws(()=>validateRequest({...body,selection:{...selection,objectIds:['person:secret']}}));
});
