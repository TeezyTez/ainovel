// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright entry point.
// Isolated authored fixtures only: no user browser profile, .env or model calls.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createServer} from '../server.mjs';
import {createSession,commitTurn,validateArchive} from '../src/core.js';
import {defaultSettings,STORAGE_KEY} from '../src/storage.js';
import {PRESET_WORLDS} from '../src/worlds.js';
import {ADDITIONAL_WORLDS} from '../src/situations.js';
import {ROUTE_FIXTURES} from './route-fixtures.mjs';
import {DYNAMIC_PROMPT_VERSION} from '../src/dynamic-rules.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const output='test-results/universe-system';
await mkdir(output,{recursive:true});
const world={...structuredClone(ROUTE_FIXTURES[0].world),custom:true};
const session=createSession(world,{},'demo');
session.id='universe-system-reading-fixture';
const prose='唐杏把两张货单放在窗边，让编号朝着广场。两张单子登记的是同一批盐。\n\n许舟从渡船棚走来，把检修回执交给周宁。今晚停航是因为舵链检修，明早是否开船仍要等检查结果。\n\n你留在广场旁，看他们各自处理手边的事情。海风吹过告示，灯光渐渐亮了起来。';
commitTurn(session,world,ROUTE_FIXTURES[0].steps[0].input,{requestId:'universe-system-authored-turn',baseVersion:0,prose,events:[{type:'fact',visibility:'player',value:'两张货单重复登记了同一批盐。'}]});
const editableSession=createSession(PRESET_WORLDS[0],{},'real');
editableSession.id='universe-system-editable-fixture';
editableSession.updatedAt=session.updatedAt-1000;
// A legitimate prepare outcome may decide that the saved opening needs no
// auxiliary interface. Match the authoritativeBranch response contract exactly.
const preparedBranch=structuredClone(editableSession.branches[0]);
preparedBranch.dynamic={
 scope:{worldKey:preparedBranch.worldKey,sessionId:editableSession.id,branchId:preparedBranch.id,sceneId:preparedBranch.initialState.location,sourceTurnId:null,baseVersion:0},
 intent:'',definition:null,digest:null,promptVersion:DYNAMIC_PROMPT_VERSION,
 reason:'',decisionReason:'固定视觉验收开场无需额外交互。',
};
const archive=validateArchive({schemaVersion:1,worlds:[...PRESET_WORLDS,...ADDITIONAL_WORLDS,world],sessions:[session,editableSession],settings:{...defaultSettings},telemetry:[]});
const ledgerDirectory=await mkdtemp(join(tmpdir(),'universe-system-'));
const server=createServer({env:{},ledgerDirectory});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const checks=[],errors=[],blockedRequests=[],fixtureResponses=[];
let browser;
async function check(name,run){
 try{await run();checks.push({name,passed:true});console.log('PASS '+name);}
 catch(error){checks.push({name,passed:false,error:error.message});console.error('FAIL '+name+': '+error.message);}
}
async function settle(page){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(180);}
async function screenshot(page,name){
 await settle(page);
 // Top-layer panels cover the viewport; a full-page capture would append
 // unrelated content below the backdrop and misrepresent their actual layout.
 const topLayer=await page.locator('dialog[open],[popover]:popover-open').count();
 await page.screenshot({path:`${output}/${name}.png`,fullPage:!topLayer,animations:'disabled'});
}
async function overflow(page,label){
 const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,offenders:[...document.querySelectorAll('main *,dialog[open] *')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width&&r.right>innerWidth+2&&s.position!=='absolute'&&s.position!=='fixed';}).slice(0,6).map(el=>({tag:el.tagName,class:el.className}))}));
 assert.ok(result.scroll<=result.width+1&&result.body<=result.width+1,`${label}: horizontal overflow ${JSON.stringify(result)}`);
}
async function keyboardFocus(page,locator){
 await locator.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
 assert.ok(await locator.evaluate(el=>document.activeElement===el&&el.matches(':focus-visible')),'keyboard focus must return to the control and be focus-visible');
 const styles=await locator.evaluate(el=>[null,'::before','::after'].map(pseudo=>{const s=getComputedStyle(el,pseudo);return {outline:s.outlineStyle,width:s.outlineWidth,shadow:s.boxShadow};}));
 assert.ok(styles.some(style=>(style.outline!=='none'&&parseFloat(style.width)>0)||style.shadow!=='none'),'focused control must have a visible focus treatment');
}
async function hoverLens(page,control,name,{reduced=false}={}){
 await page.mouse.move(1,1);
 await control.scrollIntoViewIfNeeded();await page.waitForTimeout(350);
 const before=await control.boundingBox();
 assert.ok(before,`${name}: control is visible`);
 await control.hover({position:{x:Math.min(18,before.width/3),y:before.height/2}});
 if(reduced){
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.control-lens').count(),0,`${name}: reduced motion must not mount a lens`);
 }else{
  const lens=control.locator(':scope > .control-lens');await lens.waitFor();
  assert.equal(await page.locator('.control-lens').count(),1,`${name}: only the active control owns a lens`);
  assert.equal(await lens.locator('.control-orbit').count(),3);
  assert.equal(await lens.locator('.control-lens-core').count(),1);
  const identity=await lens.elementHandle();
  const orbitState=()=>lens.locator('.control-orbit').evaluateAll(orbits=>orbits.map(orbit=>{
   const animation=orbit.getAnimations().find(a=>a.effect?.getComputedTiming().iterations===Infinity);
   return animation?{name:animation.animationName,time:animation.currentTime,state:animation.playState,transform:getComputedStyle(orbit).transform}:null;
  }));
  const first=await orbitState();
  assert.ok(first.every(animation=>animation?.state==='running'),`${name}: all orbit animations run`);
  // No mouse movement: wait on actual animation progress rather than assuming
  // software WebGL and screenshot work leave a fixed 400 ms window unblocked.
  await page.waitForFunction(({node,first})=>[...node.querySelectorAll('.control-orbit')].every((orbit,index)=>{
   const animation=orbit.getAnimations().find(a=>a.effect?.getComputedTiming().iterations===Infinity);
   return animation?.playState==='running'&&animation.currentTime>first[index].time+100;
  }),{node:identity,first},{timeout:3000});
  const second=await orbitState();
  assert.ok(second.every((animation,index)=>animation?.state==='running'&&animation.time>first[index].time+100),`${name}: static-pointer animation advances`);
  assert.ok(second.some((animation,index)=>animation.transform!==first[index].transform),`${name}: orbit transforms visibly change`);
  await page.waitForFunction(node=>getComputedStyle(node).scale==='1',identity,{timeout:3000});
  const after=await control.boundingBox();
  for(const key of ['x','y','width','height'])assert.ok(Math.abs(after[key]-before[key])<=1.1,`${name}: hover must not shift layout (${key})`);
  const point={x:Math.max(2,before.width-18),y:before.height/2};
  await control.hover({position:point});
  await page.waitForTimeout(100);
  assert.ok(await identity.evaluate(node=>node.isConnected&&node.parentElement.querySelector('.control-lens')===node),`${name}: pointer movement reuses its lens`);
  assert.equal(await page.locator('.control-lens').count(),1);
  const finalControl=await control.boundingBox(),finalLens=await lens.boundingBox();
  const pointer={x:finalControl.x+point.x,y:finalControl.y+point.y};
  assert.ok(Math.hypot(finalLens.x+finalLens.width/2-pointer.x,finalLens.y+finalLens.height/2-pointer.y)<3,`${name}: lens center must follow the pointer without a competing transform`);
  assert.equal(await lens.evaluate(node=>getComputedStyle(node).scale),'1',`${name}: arrival scale must settle to 1`);
  // Keep infinite animation enabled: the usual static screenshot helper pauses it.
  await page.screenshot({path:`${output}/${name}.png`,fullPage:false,animations:'allow'});
  await identity.dispose();
 }
 await page.mouse.move(1,1);
 await page.waitForFunction(()=>document.querySelectorAll('.control-lens').length===0);
}
async function navigate(page,hash,selector){
 await page.evaluate(hash=>{location.hash=hash;},hash);
 await page.waitForFunction(hash=>location.hash===hash,hash);
 await page.locator(selector).first().waitFor({state:'visible'});
 await settle(page);
 assert.equal(await page.getByText('这一页暂时无法打开',{exact:true}).count(),0);
}
const scenarios=[
 {name:'desktop-light',theme:'light',width:1440,height:960},
 {name:'desktop-dark',theme:'dark',width:1440,height:960},
 {name:'mobile-light',theme:'light',width:390,height:844,mobile:true},
 {name:'mobile-dark',theme:'dark',width:390,height:844,mobile:true},
 {name:'reduced-motion',theme:'light',width:1440,height:960,reduced:true},
];
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 for(const scenario of scenarios){
  const context=await browser.newContext({viewport:{width:scenario.width,height:scenario.height},deviceScaleFactor:1,isMobile:!!scenario.mobile,hasTouch:!!scenario.mobile,reducedMotion:scenario.reduced?'reduce':'no-preference'});
  await context.addInitScript(({key,archive,theme})=>{if(!localStorage.getItem(key)){archive.settings.theme=theme;localStorage.setItem(key,JSON.stringify(archive));}},{key:STORAGE_KEY,archive,theme:scenario.theme});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   // An editable reader reconciles its branch on entry. Reply from the authored
   // fixture so visual checks never register or edit a server-side story.
   if(url.origin===origin&&request.method()==='POST') {
    const body=request.postDataJSON();
    const read=url.pathname==='/api/branch/read'&&body?.sessionId===editableSession.id&&body?.branchId===editableSession.activeBranch;
    const register=url.pathname==='/api/branch/register'&&body?.session?.id===editableSession.id&&body?.session?.activeBranch===editableSession.activeBranch;
    const prepare=url.pathname==='/api/interaction/prepare'&&body?.sessionId===editableSession.id&&body?.branchId===editableSession.activeBranch&&body?.baseVersion===0&&!body?.retry;
    if(read||register||prepare) {
     fixtureResponses.push({scenario:scenario.name,path:url.pathname});
     await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(prepare?{authoritativeBranch:preparedBranch,world:PRESET_WORLDS[0]}:read?{branch:editableSession.branches[0],world:PRESET_WORLDS[0],receipt:null}:{session:editableSession,worlds:[PRESET_WORLDS[0]]})});
     return;
    }
   }
   if(url.origin!==origin||!['GET','HEAD'].includes(request.method())){blockedRequests.push({scenario:scenario.name,url:request.url(),method:request.method()});await route.abort();return;}
   await route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push({scenario:scenario.name,type:'pageerror',message:error.message}));
  page.on('console',message=>{if(message.type()==='error')errors.push({scenario:scenario.name,type:'console',message:message.text()});});
  await page.goto(origin);
  const prefix=scenario.name;
  const capture=async name=>{await overflow(page,`${prefix}/${name}`);await screenshot(page,`${prefix}-${name}`);};
  await check(`${prefix}: homepage, decorative art and navigation`,async()=>{
   await page.waitForSelector('[data-scene-ready="true"], [data-scene-fallback="true"]',{timeout:20000});
   assert.equal(await page.locator('.universe-art a,.universe-art button,.universe-art img').count(),0);
   assert.equal(await page.locator('body').getAttribute('data-theme'),scenario.theme);
   if(scenario.reduced)assert.equal(await page.locator('[data-universe-stage]').getAttribute('data-motion'),'reduced');
   await capture('home');
   const card=page.locator('.discovery-card h3 a').first(),hash=await card.getAttribute('href');
   await card.scrollIntoViewIfNeeded();
   if(!scenario.mobile){await card.hover();await keyboardFocus(page,card);await screenshot(page,`${prefix}-card-focus`);}
   await card.click();await page.locator('.world-detail-page').waitFor();
   assert.equal(await page.evaluate(()=>location.hash),hash);
   assert.equal(await page.locator('.universe-canvas').count(),0,'homepage canvas must unmount after navigation');
   await capture('detail');
  });
  await check(`${prefix}: personal library and reading navigation`,async()=>{
   await navigate(page,'#/stories','.personal-library');await capture('library');
   const story=page.locator(`#main a[href="#/story/${session.id}"]`).first();
   await story.click();await page.locator('.reading-header').waitFor();
   assert.equal(await page.evaluate(()=>location.hash),`#/story/${session.id}`);
   assert.ok((await page.locator('#main').innerText()).includes('两张单子登记的是同一批盐'));
   await capture('reading');
   const overlap=await page.locator('.reading-readonly').evaluate(panel=>{
    const text=panel.querySelector(':scope > div').getBoundingClientRect(),tool=panel.querySelector('.reader-tools-trigger').getBoundingClientRect();
    return Math.min(text.right,tool.right)>Math.max(text.left,tool.left)+1&&Math.min(text.bottom,tool.bottom)>Math.max(text.top,tool.top)+1;
   });
   assert.equal(overlap,false,'read-only story tool must not overlap its explanatory text');
  });
  await check(`${prefix}: story tools, nested settings and focus`,async()=>{
   await navigate(page,`#/story/${session.id}`,'.reader-tools-trigger');
   const trigger=page.locator('.reader-tools-trigger');
   if(!scenario.mobile)await keyboardFocus(page,trigger);
   await trigger.click();await page.locator('#reader-quick-tools:popover-open').waitFor();
   await capture('tools-popover');
   await page.locator('#reader-quick-tools summary').click();
   await page.locator('#reader-quick-tools [data-action="story-tools"]').click();
   const dialog=page.locator('dialog[open]');await dialog.waitFor();
   assert.equal(await dialog.locator('h2').innerText(),'故事选项');
   assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),'dialog must receive focus');
   await capture('tools-dialog');
   await dialog.locator('[data-action="reader-settings"]').click();await capture('reader-settings');
   await dialog.locator('[data-action="dialog-back"]').click();
   assert.equal(await dialog.locator('h2').innerText(),'故事选项');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
   assert.ok(await trigger.evaluate(el=>document.activeElement===el),'closing tools should restore launcher focus');
   await page.locator('.reading-back').click();await page.locator('.personal-library').waitFor();
   assert.equal(await page.evaluate(()=>location.hash),'#/stories');
  });
  await check(`${prefix}: creator form`,async()=>{
   await navigate(page,'#/create','#world-form');
   const input=page.locator('#world-form input:not([type="hidden"]),#world-form textarea').first();
   await input.fill('月光港口的夜班记录员');assert.equal(await input.inputValue(),'月光港口的夜班记录员');
   await capture('create');
  });
  await check(`${prefix}: editable reader and draft`,async()=>{
   await navigate(page,`#/story/${editableSession.id}`,'.reading-compose-box textarea');
   const draft=page.locator('.reading-compose-box textarea');
   await draft.fill('我走向窗边，听远处的潮声。');
   assert.equal(await draft.inputValue(),'我走向窗边，听远处的潮声。');
   const appearance=await draft.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,border:s.borderTopWidth};});
   assert.equal(appearance.background,'rgba(0, 0, 0, 0)','the composer should have one shared surface');
   assert.equal(appearance.border,'0px','the draft should not have a second inset border');
   await capture('editable-reader');
   await page.locator('.reader-tools-trigger').click();
   await page.locator('#reader-quick-tools:popover-open').waitFor();
   await capture('editable-tools');
   await page.keyboard.press('Escape');
  });
  await check(`${prefix}: settings tabs and theme control`,async()=>{
   await navigate(page,'#/settings','.settings-page');
   await capture('settings');
   const section=page.locator('[data-action="settings-jump"][data-section="narrative-settings"]');
   await section.click();assert.equal(await section.getAttribute('aria-pressed'),'true');
   await page.locator('#narrative-settings').waitFor({state:'visible'});await capture('settings-narrative');
   await page.locator('[data-action="settings-jump"][data-section="reading-settings"]').click();
   const theme=page.locator('#theme');await theme.selectOption(scenario.theme==='dark'?'light':'dark');
   await page.waitForFunction(theme=>document.body.dataset.theme===theme,scenario.theme==='dark'?'light':'dark');
   await theme.selectOption(scenario.theme);
  });
  if(!scenario.mobile)await check(`${prefix}: wormhole hover across controls`,async()=>{
   const options={reduced:!!scenario.reduced};
   await navigate(page,'#/','[data-universe-stage]');
   await hoverLens(page,page.locator('.universe-hero-actions a.btn'),`${prefix}-hover-home-cta`,options);
   await navigate(page,'#/settings','.settings-page');
   await hoverLens(page,page.locator('[data-action="settings-jump"][data-section="narrative-settings"]'),`${prefix}-hover-settings-tab`,options);
   await page.locator('[data-action="settings-jump"][data-section="reading-settings"]').click();
   const summary=page.locator('#reading-settings .settings-extra > summary');
   await summary.click();
   await hoverLens(page,summary,`${prefix}-hover-settings-summary`,options);
   await navigate(page,`#/story/${editableSession.id}`,'.reading-header');
   await hoverLens(page,page.locator('.reading-header [data-action="history"]'),`${prefix}-hover-reading-history`,options);
   await page.locator('.reader-tools-trigger').click();await page.locator('#reader-quick-tools:popover-open').waitFor();
   await hoverLens(page,page.locator('#reader-quick-tools [data-action="branches"]'),`${prefix}-hover-popover-branches`,options);
   await page.keyboard.press('Escape');
  });
  await check(`${prefix}: return home and reduced-motion preference`,async()=>{
   await navigate(page,'#/','[data-universe-stage]');
   await page.waitForSelector('[data-scene-ready="true"], [data-scene-fallback="true"]',{timeout:20000});
   assert.equal(await page.locator('.universe-canvas').count(),1);
   if(!scenario.reduced){
    await navigate(page,'#/settings','.settings-page');
    await page.locator('[data-action="settings-jump"][data-section="reading-settings"]').click();
    await page.locator('#reading-settings .settings-extra > summary').click();
    await page.locator('#reducedMotion').check();
    await navigate(page,'#/','[data-universe-stage]');
    await page.waitForFunction(()=>document.querySelector('[data-universe-stage]')?.dataset.motion==='reduced');
   }
   assert.equal(await page.locator('[data-universe-stage]').getAttribute('data-motion'),'reduced');
   assert.equal(await page.locator('.universe-cursor[data-visible="true"]').count(),0);
   if(!scenario.mobile){await page.locator('.universe-hero-actions a.btn').hover();await page.waitForTimeout(100);}
   assert.equal(await page.locator('.control-lens').count(),0,'reduced motion must not mount a control lens');
   const animated=await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getComputedTiming().iterations===Infinity).map(a=>a.animationName||a.id));
   assert.deepEqual(animated,[],'reduced motion must suppress infinite CSS animation');
   await capture('reduced');
  });
  await context.close();
 }
 await check('no browser errors',async()=>assert.deepEqual(errors,[]));
 await check('no external or unmocked mutating requests',async()=>assert.deepEqual(blockedRequests,[]));
 await check('editable fixture prepare contract exercised',async()=>{
  for(const scenario of scenarios)assert.ok(fixtureResponses.some(response=>response.scenario===scenario.name&&response.path==='/api/interaction/prepare'),`${scenario.name}: fixed prepare response was consumed`);
 });
}catch(error){checks.push({name:'browser harness',passed:false,error:error.stack});console.error(error);}
finally{
 await browser?.close();await new Promise(resolve=>server.close(resolve));
 const passed=checks.length>0&&checks.every(check=>check.passed);
 await writeFile(`${output}/result.json`,JSON.stringify({passed,fixture:'Authored demo turn and editable draft; branch reconciliation and no-interaction prepare use fixed in-memory replies',checks,errors,blockedRequests,fixtureResponses},null,2));
 console.log(`${checks.filter(check=>check.passed).length}/${checks.length} checks passed. Screenshots: ${output}`);
 if(!passed)process.exitCode=1;
}
