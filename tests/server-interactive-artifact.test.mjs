import test from 'node:test';
import assert from 'node:assert/strict';
import {validateArtifactScripts} from '../src/server-interactive-artifact.mjs';

const interactive=()=>({type:'interactive',title:'分配试算',description:'只做试算',html:'<input type="number">',css:'',script:'ui.setState({quantity:1});'});
const react=()=>({type:'react',title:'试算',description:'本地参数',source:'export default function App(){return <button>确定</button>}'});

test('repeated layouts cannot duplicate a runnable artifact with shared local state',()=>{
  const definition={view:[{type:'repeat',items:[1,2],children:[interactive()]}]};
  assert.throws(()=>validateArtifactScripts(definition),/repeat.*单个.*interactive/);
});

test('an artifact remains prohibited inside nested groups and repeats',()=>{
  const definition={view:[{type:'group',children:[{type:'repeat',items:[1],children:[{type:'row',children:[{type:'repeat',items:[1,2],children:[{type:'group',children:[interactive()]}]}]}]}]}]};
  assert.throws(()=>validateArtifactScripts(definition),/repeat.*单个.*interactive/);
});

test('a single artifact in ordinary groups stays valid beside a static repeat',()=>{
  const definition={view:[{type:'repeat',items:[1,2],children:[{type:'text',text:'已知资料'}]},{type:'group',children:[{type:'row',children:[interactive()]}]}]};
  assert.doesNotThrow(()=>validateArtifactScripts(definition));
});

test('multiple non-repeated artifacts are still rejected',()=>{
  const definition={view:[interactive(),{type:'group',children:[interactive()]}]};
  assert.throws(()=>validateArtifactScripts(definition),/最多.*一个/);
});
test('React and legacy artifacts share the same single runnable limit',()=>{
  for(const view of [[react(),interactive()],[interactive(),react()],[react(),{type:'group',children:[react()]}]])assert.throws(()=>validateArtifactScripts({view}),/最多.*一个/);
});
test('React artifacts cannot occur inside a repeat at any nesting depth',()=>{
  assert.throws(()=>validateArtifactScripts({view:[{type:'repeat',children:[{type:'group',children:[react()]}]}]}),/repeat/);
  assert.doesNotThrow(()=>validateArtifactScripts({view:[{type:'group',children:[react()]}]}));
});
