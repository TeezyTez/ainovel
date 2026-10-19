import {cleanArtifactState} from './interactive-artifact.js';
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const keys=['type','title','description','source','css','height','initialState','when','caption'];
const validCss=(css,max=12000)=>check(typeof css==='string'&&css.length<=max&&!/@import\b|url\s*\(|expression\s*\(/i.test(css),'React交互图样式无效或包含外部资源。');
export function validateReactArtifact(node){
  check(node?.type==='react'&&!Array.isArray(node)&&Object.keys(node).every(k=>keys.includes(k)),'React交互图含不支持的属性。');
  for(const [key,max] of [['title',200],['description',2000],['source',40000]])check(typeof node[key]==='string'&&node[key].length<=max&&!!node[key].trim(),'React交互图的'+key+'无效或过长。');
  validCss(node.css??'');
  check(node.height===undefined||Number.isFinite(node.height)&&node.height>=220&&node.height<=800,'React交互图高度应在220至800之间。');
  if(Object.hasOwn(node,'initialState'))cleanArtifactState(node.initialState);
  return true;
}
// This transport validator is only for the trusted build endpoint's output.
// Model definitions must always pass validateReactArtifact, never this function.
export function validateReactBundle(node){
  check(node?.type==='interactive'&&node.renderer==='react-bundle'&&Object.keys(node).every(k=>['type','renderer','title','description','html','css','script','initialState','height'].includes(k)),'React构建结果格式无效。');
  for(const [key,max] of [['title',200],['description',2000],['html',1000],['script',1200000]])check(typeof node[key]==='string'&&node[key].length<=max&&!!node[key].trim(),'React构建结果的'+key+'无效。');
  validCss(node.css,16000);
  check(node.height===undefined||Number.isFinite(node.height)&&node.height>=220&&node.height<=800,'React构建高度无效。');
  if(Object.hasOwn(node,'initialState'))cleanArtifactState(node.initialState);
  return true;
}
