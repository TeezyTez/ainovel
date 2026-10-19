import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {parse} from '@babel/parser';
import {validateReactArtifact,validateReactBundle} from './react-artifact.js';

const directory=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const kit=`import React,{useSyncExternalStore} from 'react';
const listeners=new Set();
const subscribe=listener=>{listeners.add(listener);return ()=>listeners.delete(listener)};
const snapshot=()=>window.ui.state;
const setState=value=>{window.ui.setState(typeof value==='function'?value(window.ui.state):value);for(const listener of listeners)listener()};
export function useArtifactState(){return [useSyncExternalStore(subscribe,snapshot),setState]}
export function useUI(){const [state,setState]=useArtifactState();return {state,setState,draft:text=>window.ui.draft(text)}}
export function draft(text){window.ui.draft(text)}
export function Card({title,children,...props}){return React.createElement('section',{...props,className:'story-card '+(props.className||'')},title&&React.createElement('h2',null,title),children)}
export function Button({children,...props}){return React.createElement('button',{...props,type:'button'},children)}
export function Field({label,children,...props}){return React.createElement('label',props,label&&React.createElement('span',null,label),children)}
export function Stack({children,...props}){return React.createElement('div',{...props,className:'story-stack '+(props.className||'')},children)}
export function Stat({label,value}){return React.createElement('div',{className:'story-stat'},React.createElement('span',null,label),React.createElement('output',null,value))}
`;
const css='.story-card{padding:16px;border:1px solid var(--line);border-radius:12px;min-width:0}.story-stack{display:grid;gap:12px}.story-stat{display:flex;justify-content:space-between;gap:12px}.story-stat output{font-weight:700}button{margin:4px}input,select{max-width:100%}';
// Candidate-only defense in depth. CSP, the opaque frame and host message
// validation remain the authority boundary; this is not a JavaScript sandbox.
const restrictedNames=new Set(`window document globalThis self global parent top opener frames navigator location localStorage sessionStorage indexedDB caches cookieStore fetch XMLHttpRequest WebSocket EventSource Worker SharedWorker ServiceWorker importScripts eval Function AsyncFunction GeneratorFunction Reflect Proxy WebAssembly process Deno Bun module exports require postMessage addEventListener removeEventListener dispatchEvent onmessage onload open close print alert confirm prompt history screen external chrome browser BroadcastChannel MessageChannel MessagePort RTCPeerConnection Notification Image Audio arguments`.split(' '));
const restrictedProperties=new Set(`constructor prototype __proto__ caller callee ownerDocument defaultView contentWindow contentDocument view parentWindow getRootNode composedPath Object getPrototypeOf setPrototypeOf getOwnPropertyDescriptor getOwnPropertyDescriptors getOwnPropertyNames getOwnPropertySymbols defineProperty defineProperties querySelector querySelectorAll getElementById getElementsByTagName getElementsByClassName getElementsByName parentNode parentElement nextSibling previousSibling nextElementSibling previousElementSibling attributes getAttribute getAttributeNode setAttribute innerHTML outerHTML insertAdjacentHTML write writeln createElement createElementNS appendChild replaceChildren nonce scripts ref dangerouslySetInnerHTML srcDoc`.split(' '));
const objectMethods=new Set(['keys','hasOwn','is','freeze','isFrozen','fromEntries','assign']);
const prohibitedProperty=name=>typeof name==='string'&&(restrictedNames.has(name)||restrictedProperties.has(name)||name.startsWith('__'));
function rejectAccess(part,detail){throw new Error('artifact.tsx:'+(part.loc?.start.line??1)+':'+(part.loc?.start.column??0)+' Restricted candidate access: '+detail+'. Use @story/ui for state and drafts.');}
export async function compileReactArtifact(node){
  validateReactArtifact(node);
  // Parse all source imports before tree shaking, including unused TS imports.
  let ast;try{ast=parse(node.source,{sourceType:'module',plugins:['typescript','jsx'],createImportExpressions:true});}catch(error){throw new Error('artifact.tsx:'+error.loc?.line+':'+error.loc?.column+' '+error.message);}
  function inspect(part,parent){
    if(!part||typeof part!=='object')return;
    if(part.type==='ImportDeclaration'||['ExportNamedDeclaration','ExportAllDeclaration'].includes(part.type)&&part.source){
      const name=part.source?.value;
      if(!['react','@story/ui'].includes(name))throw new Error('artifact.tsx: Only react and @story/ui imports are allowed: '+name);
    }
    if(['ImportExpression','TSImportEqualsDeclaration','TSImportType'].includes(part.type)||part.type==='CallExpression'&&['require','import'].includes(part.callee?.name??part.callee?.type?.toLowerCase()))throw new Error('artifact.tsx: Dynamic import and require are not allowed.');
    if(part.type==='Identifier'&&restrictedNames.has(part.name))rejectAccess(part,part.name);
    // Enumerating SyntheticEvent values can reveal its Window reference. Keep
    // Object operations explicit and prevent aliases to introspection methods.
    if(part.type==='Identifier'&&part.name==='Object'){
      const name=parent?.computed?parent.property?.value:parent?.property?.name;
      if(!['MemberExpression','OptionalMemberExpression'].includes(parent?.type)||parent.object!==part||!objectMethods.has(name))rejectAccess(part,'Object introspection or alias');
    }
    if(['ThisExpression','Super','MetaProperty'].includes(part.type))rejectAccess(part,part.type);
    if(['MemberExpression','OptionalMemberExpression'].includes(part.type)){
      const property=part.property;
      // Computed lookup is intentionally limited to literals. Otherwise an
      // obfuscated constructor or DOM capability can evade property checks.
      if(part.computed&&!['StringLiteral','NumericLiteral'].includes(property.type))rejectAccess(part,'dynamic property lookup');
      const name=part.computed?property.value:property.name;
      if(prohibitedProperty(name))rejectAccess(part,String(name));
    }
    if(['ObjectProperty','ObjectMethod','ClassMethod','ClassProperty'].includes(part.type)){
      const name=part.computed?part.key?.value:part.key?.name??part.key?.value;
      if(prohibitedProperty(name))rejectAccess(part,String(name));
      if(part.computed&&parent?.type==='ObjectPattern'&&!['StringLiteral','NumericLiteral'].includes(part.key.type))rejectAccess(part,'dynamic destructuring');
    }
    if(part.type==='JSXAttribute'&&prohibitedProperty(part.name?.name))rejectAccess(part,part.name.name);
    if(part.type==='CallExpression'&&['setTimeout','setInterval'].includes(part.callee?.name)&&['StringLiteral','TemplateLiteral'].includes(part.arguments[0]?.type))rejectAccess(part,'string timer execution');
    for(const value of Object.values(part))if(Array.isArray(value))value.forEach(child=>inspect(child,part));else if(value&&typeof value==='object')inspect(value,part);
  }
  inspect(ast);
  let result;
  try{
    result=await build({absWorkingDir:directory,tsconfigRaw:{},stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import Component from 'artifact:candidate';flushSync(()=>createRoot(document.getElementById('story-react-root')).render(React.createElement(Component)));`,resolveDir:directory,sourcefile:'artifact-entry.js'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',jsx:'automatic',minify:true,legalComments:'none',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',plugins:[{name:'story-artifact-imports',setup(builder){
      builder.onResolve({filter:/^artifact:candidate$/},args=>args.namespace==='file'&&args.importer.endsWith('artifact-entry.js')?{path:'artifact.tsx',namespace:'candidate'}:{errors:[{text:'Only react and @story/ui imports are allowed.'}]});
      builder.onLoad({filter:/.*/,namespace:'candidate'},()=>({contents:node.source,loader:'tsx',resolveDir:directory}));
      builder.onResolve({filter:/.*/,namespace:'candidate'},args=>{
        if(['dynamic-import','require-call','require-resolve'].includes(args.kind))return {errors:[{text:'Dynamic import and require are not allowed.'}]};
        if(args.path==='@story/ui')return {path:'story-ui',namespace:'kit'};
        if(args.path==='react'||args.path==='react/jsx-runtime')return {path:require.resolve(args.path),namespace:'trusted-package'};
        return {errors:[{text:'Only react and @story/ui imports are allowed: '+args.path}]};
      });
      builder.onResolve({filter:/.*/},args=>{
        // Resolve trusted package code in Node; esbuild never reads host paths.
        // Only bootstrap, our kit and already trusted package files reach here.
        const resolver=args.namespace==='trusted-package'?createRequire(args.importer):require;
        return {path:resolver.resolve(args.path),namespace:'trusted-package'};
      });
      builder.onLoad({filter:/.*/,namespace:'trusted-package'},async args=>({contents:await readFile(args.path,'utf8'),loader:'js'}));
      builder.onLoad({filter:/.*/,namespace:'kit'},()=>({contents:kit,loader:'js',resolveDir:directory}));
    }}]});
  }catch(error){
    const diagnostics=error.errors?.map(item=>`${item.location?.file??'artifact.tsx'}:${item.location?.line??1}:${item.location?.column??0} ${item.text}`).join('\n');
    throw new Error(diagnostics||String(error.message));
  }
  const bundle={type:'interactive',renderer:'react-bundle',title:node.title,description:node.description,html:'<div id="story-react-root"></div>',css:css+(node.css??''),script:result.outputFiles[0].text,...(node.height!==undefined?{height:node.height}:{}),...(Object.hasOwn(node,'initialState')?{initialState:node.initialState}:{})};
  validateReactBundle(bundle);return bundle;
}
