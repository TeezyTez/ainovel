import test from 'node:test';
import assert from 'node:assert/strict';
import {readerInputCommand} from '../src/reader-input.js';

test('single input handles continuation and local tools without choosing a mode',()=>{
  for(const input of ['继续','继续读。','请往下读'])assert.equal(readerInputCommand(input).action,'continue');
  assert.equal(readerInputCommand('重试').action,'retry');
  assert.equal(readerInputCommand('恢复进度').action,'recover');
  assert.equal(readerInputCommand('故事选项').action,'tools');
  assert.equal(readerInputCommand('查看存档').action,'saves');
  assert.equal(readerInputCommand('保存为雨停之前').name,'雨停之前');
});

test('waiting keeps the full request and uses a bounded stop without inventing a calendar',()=>{
  const input='等到明天上午，有人敲门就停，不花钱';
  const result=readerInputCommand(input);
  assert.equal(result.control.kind,'wait');
  assert.equal(result.control.goal,input);
  assert.equal(result.control.limit,'明天上午');
  assert.match(result.control.reserved,/承诺/);
  assert.match(readerInputCommand('等到雨停').control.limit,/当前场景/);
  assert.equal(readerInputCommand('等待半小时').control.limit,'半小时');
});

test('quoted dialogue, hypothetical questions and compound actions are not UI commands',()=>{
  for(const input of ['我说：“继续。”','继续修理这把伞','不要等到明天','如果等到明天会怎样？','等到明天可以吗？','等待别人报价，然后回答“继续”','保存这封信，交给阿苇','我有哪些物品？'])assert.equal(readerInputCommand(input),null,input);
});
