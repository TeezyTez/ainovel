import test from 'node:test';
import assert from 'node:assert/strict';
import * as library from '../src/personal-library.js';
import {createSession,commitTurn,currentState,getBranch,forkBranch,validateArchive} from '../src/core.js';
import {PRESET_WORLDS} from '../src/worlds.js';
import {selectContext,applyPolish} from '../src/experience.js';

function fixture(){const world=PRESET_WORLDS[0],session=createSession(world);commitTurn(session,world,'看看',{requestId:crypto.randomUUID(),baseVersion:0,prose:'旧门已经打开。\n\n很久以前的稀有蓝色围巾在这里。\n\n你坐下来。',events:[{type:'fact',value:'幕后绝密不进入搜索',visibility:'hidden'}],suggestions:[]});return {session,world,branch:getBranch(session)};}
test('private annotations have exact sources and never modify state or model context',()=>{
 const {session,branch}=fixture(),before=structuredClone(branch),turn=branch.turns[0];
 const noted=library.addAnnotation(branch,{turnId:turn.id,quote:'旧门已经打开。',note:'我的猜测不是角色知识',kind:'note'});
 assert.deepEqual(branch,before);assert.deepEqual(noted.turns,branch.turns);
 assert.equal(noted.personal.notes[0].reference.sourceVersion,1);
 assert.deepEqual(selectContext(noted,'看看'),selectContext(branch,'看看'));
 assert.equal(JSON.stringify(currentState(session)).includes('我的猜测'),false);
 assert.equal(library.removeAnnotation(noted,noted.personal.notes[0].id).personal.notes.length,0);
});
test('source references reject another branch, wrong version and stale quotes',()=>{
 const {session,branch}=fixture(),turn=branch.turns[0],reference=library.createReference(branch,turn.id,'旧门已经打开。');
 const other=forkBranch(session,turn.id,'另一条');
 assert.throws(()=>library.validateReference(other,reference),/分支/);
 assert.throws(()=>library.validateReference(branch,{...reference,sourceVersion:99}),/版本/);
 assert.throws(()=>library.createReference(branch,turn.id,'不存在的引文'),/原文/);
 applyPolish(session,other.turns[0].id,'修改后的新正文',1);
 const originalVersionRef={...reference,branchId:other.id};
 assert.equal(library.resolveReference(other,originalVersionRef).stale,true);
 assert.throws(()=>library.validateReference(other,originalVersionRef),/修订|原文/);
});
test('annotations survive a legitimate prose revision as stale historical sources',()=>{
 const {session,world,branch}=fixture();Object.assign(branch,library.addAnnotation(branch,{turnId:branch.turns[0].id,quote:'旧门已经打开。',note:'旧版笔记'}));
 Object.assign(branch,library.setDraftContext(branch,{references:[library.createReference(branch,branch.turns[0].id,'旧门已经打开。')]}));
 applyPolish(session,branch.turns[0].id,'门已经敞开。',1);
 assert.doesNotThrow(()=>library.validatePersonalMetadata({sessions:[session]}));
 assert.equal(library.resolveReference(branch,branch.personal.notes[0].reference).stale,true);
 assert.equal(library.resolveReference(branch,branch.personal.draftReferences[0]).stale,true);
 assert.doesNotThrow(()=>validateArchive({schemaVersion:1,worlds:[world],sessions:[session]}));
 const tampered=structuredClone(session);tampered.branches[0].personal.notes[0].reference.quote='伪造来源';
 assert.throws(()=>library.validatePersonalMetadata({sessions:[tampered]}),/来源|原文/);
});
test('viewport anchor offsets retain signed fractional coordinates and reject unbounded values',()=>{
 const {branch}=fixture();const anchor=library.captureReadingAnchor(branch,{turnId:branch.turns[0].id,paragraphIndex:1,offset:-137.625});
 assert.equal(anchor.offset,-137.625);assert.equal(library.resolveReadingAnchor(branch,anchor).anchor.offset,-137.625);
 assert.throws(()=>library.captureReadingAnchor(branch,{offset:Infinity}),/偏移/);assert.throws(()=>library.captureReadingAnchor(branch,{offset:1000001}),/偏移/);
});
test('full current-branch search finds old prose but never hidden state or other branches',()=>{
 const {session,world}=fixture();
 for(let i=0;i<8;i++)commitTurn(session,world,'继续',{requestId:crypto.randomUUID(),baseVersion:currentState(session).version,prose:`后续第${i}段。`,events:[]});
 assert.equal(library.filterSessions([session],{query:'稀有蓝色围巾'}).length,1);
 assert.equal(library.filterSessions([session],{query:'幕后绝密'}).length,0);
 forkBranch(session,null,'空白分支');
 assert.equal(library.filterSessions([session],{query:'稀有蓝色围巾'}).length,0);
});
test('story metadata, trash and restore preserve history and separate archive state',()=>{
 const {session}=fixture(),history=structuredClone(session.branches);
 const edited=library.updateStoryMetadata(session,{pinned:true,note:'我的备注',group:'慢读',title:'新标题',archived:true});
 const trashed=library.trashStory(edited,100),restored=library.restoreStory(trashed);
 assert.equal(library.filterSessions([trashed],{category:'trash'}).length,1);
 assert.equal(library.filterSessions([trashed]).length,0);
 assert.equal(restored.archived,true);assert.equal(restored.personal.trashedAt,null);
 assert.deepEqual(restored.branches,history);assert.equal(session.personal,undefined);
 assert.equal(library.filterSessions([restored],{category:'archived',query:'我的备注',group:'慢读'}).length,1);
});
test('reading anchors find their original paragraph after insertion and safely fall back after rewriting',()=>{
 const {branch}=fixture(),turn=branch.turns[0];
 const anchor=library.captureReadingAnchor(branch,{turnId:turn.id,paragraphIndex:1,offset:3});
 const changed=structuredClone(branch);changed.turns[0].prose='新增段落。\n\n'+turn.prose;
 const relocated=library.resolveReadingAnchor(changed,anchor);assert.equal(relocated.anchor.paragraphIndex,2);assert.equal(relocated.stale,false);
 changed.turns[0].prose='所有文字均已替换。';
 const fallback=library.resolveReadingAnchor(changed,anchor);assert.equal(fallback.stale,true);assert.equal(fallback.anchor.paragraphIndex,0);assert.equal(fallback.anchor.offset,0);
 const wrong=library.resolveReadingAnchor({...branch,id:'another-branch'},anchor);assert.equal(wrong.stale,true);assert.equal(wrong.anchor.turnId,null);
});
test('focus, reminder and saved draft are display-only and reject foreign references',()=>{
 const {branch}=fixture(),before=structuredClone(branch);
 const focused=library.toggleObjectFocus(branch,'lin');const muted=library.muteReminder(focused,'lin');
 assert.deepEqual(muted.turns,before.turns);assert.equal(muted.personal.objects.lin.followed,true);assert.equal(muted.personal.objects.lin.muted,true);
 const reference=library.createReference(branch,branch.turns[0].id,'旧门已经打开。');
 const drafted=library.setDraftContext(muted,{references:[reference],intent:'先不执行的打算'});
 assert.equal(drafted.personal.intent,'先不执行的打算');assert.deepEqual(selectContext(drafted,'继续'),selectContext(branch,'继续'));
 assert.throws(()=>library.setDraftContext(branch,{references:[{...reference,branchId:'other'}]}),/分支/);
});
test('object references cannot target an unknown object or silently use newer object state',()=>{
 const {session,world,branch}=fixture();
 assert.throws(()=>library.createReference(branch,branch.turns[0].id,'旧门已经打开。','item:invented'),/对象/);
 const person=world.characters.find(c=>branch.opening.includes(c.name));assert.ok(person);
 const reference=library.createReference(branch,null,person.name,`person:${person.id}`);
 commitTurn(session,world,'继续',{requestId:'changed-person',baseVersion:1,prose:`${person.name}向你告别了。`,events:[{type:'relation',entity:person.id,value:'告别后暂时分开',visibility:'player'}]});
 assert.throws(()=>library.validateReference(branch,reference),/对象|过期/);
 assert.equal(library.resolveReference(branch,reference).stale,true);
});
test('polish may remove a newly introduced name without destroying old object notes and draft quotes',()=>{
 const world=structuredClone(PRESET_WORLDS[0]);world.characters.push({id:'yuan',name:'袁新',public:'来访的人',secret:''});
 const session=createSession(world);commitTurn(session,world,'看看',{requestId:'introduced-person',baseVersion:0,prose:'袁新走到门边。',events:[]});
 const branch=getBranch(session),turnId=branch.turns[0].id,reference=library.createReference(branch,turnId,'袁新走到门边。','person:yuan');
 Object.assign(branch,library.addAnnotation(branch,{turnId,quote:reference.quote,objectId:reference.objectId,note:'旧版的人物备注'}));
 Object.assign(branch,library.setDraftContext(branch,{references:[reference]}));
 applyPolish(session,turnId,'一位访客走到门边。',1);
 assert.doesNotThrow(()=>validateArchive({schemaVersion:1,worlds:[world],sessions:[session]}));
 assert.equal(library.resolveReference(branch,reference).stale,true);assert.throws(()=>library.validateReference(branch,reference),/修订|原文/);
});
