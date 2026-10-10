import test from 'node:test';
import assert from 'node:assert/strict';
import * as transfer from '../src/data-transfer.js';
import {PRESET_WORLDS} from '../src/worlds.js';
import {createSession,getBranch,commitTurn} from '../src/core.js';
import {addAnnotation,validatePersonalMetadata} from '../src/personal-library.js';
test('full import restores preferences and draft while adding independent stories',()=>{const current={schemaVersion:1,worlds:structuredClone(PRESET_WORLDS),sessions:[createSession(PRESET_WORLDS[0])],settings:{theme:'light'},telemetry:[]};const incoming={...structuredClone(current),settings:{theme:'dark'},worldDraft:{...structuredClone(PRESET_WORLDS[1]),editId:'mountain',originalVersion:1}};const merged=transfer.mergeArchive(current,incoming);assert.equal(merged.sessions.length,2);assert.notEqual(merged.sessions[0].id,merged.sessions[1].id);assert.equal(merged.settings.theme,'dark');assert.equal(merged.worldDraft.title,'山门之外');assert.equal(current.sessions.length,1);});
test('conflicting world version rejects whole merge with current data intact',()=>{const current={schemaVersion:1,worlds:structuredClone(PRESET_WORLDS),sessions:[]};const other=structuredClone(current);other.worlds[0].opening='不同开场';assert.throws(()=>transfer.mergeArchive(current,other),/冲突/);assert.equal(current.worlds[0].opening,PRESET_WORLDS[0].opening);});
test('import regenerates session identity without orphaning branch-bound personal sources',()=>{
 const world=PRESET_WORLDS[0],session=createSession(world);commitTurn(session,world,'继续',{requestId:'transfer-personal',baseVersion:0,prose:'公开的一句话。',events:[]});
 const branch=getBranch(session);Object.assign(branch,addAnnotation(branch,{turnId:branch.turns[0].id,quote:'公开的一句话。',note:'私人导入笔记'}));
 const incoming={schemaVersion:1,worlds:[world],sessions:[session]},before=structuredClone(incoming),current={schemaVersion:1,worlds:[world],sessions:[]};
 const merged=transfer.mergeArchive(current,incoming);assert.notEqual(merged.sessions[0].id,session.id);assert.deepEqual(incoming,before);
 assert.doesNotThrow(()=>validatePersonalMetadata(merged));const imported=getBranch(merged.sessions[0]);assert.equal(imported.personal.notes[0].reference.branchId,imported.id);assert.equal(imported.personal.notes[0].text,'私人导入笔记');
});
