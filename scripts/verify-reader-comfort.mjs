// Isolated authored story; no user profile, .env, or model requests.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from '../server.mjs';
import {createSession} from '../src/core.js';
import {PRESET_WORLDS} from '../src/worlds.js';
import {defaultSettings,STORAGE_KEY} from '../src/storage.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const output='test-results/reader-comfort';await mkdir(output,{recursive:true});
const session=createSession(PRESET_WORLDS[0],{},'demo');
session.branches[0].opening=Array.from({length:18},(_,i)=>`第${i+1}段。窗外的雨渐渐停了，街角传来卖花人的声音。你把书翻到上一页，记住刚才读到的那句话。阳光落在桌面，远处的钟声慢慢散去。`).join('\n\n');
const archive={schemaVersion:1,worlds:PRESET_WORLDS,sessions:[session],settings:defaultSettings,telemetry:[]};
const server=createServer({env:{},ledgerDirectory:await mkdtemp(join(tmpdir(),'reader-comfort-'))});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
const contrast=(a,b)=>{const l=rgb=>rgb.match(/\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);const x=l(a),y=l(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
try{
  for(const width of [1440,768,390,320]){
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.addInitScript(({key,archive})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(archive));},{key:STORAGE_KEY,archive});
    await context.route('**/api/**',route=>route.request().method()==='POST'?route.abort():route.continue());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${origin}/#/story/${session.id}`);
    await page.locator('.reading-prose').first().waitFor();await page.evaluate(()=>document.fonts.ready);
    const dock=page.locator('.reading-composer-wrap'),toggle=page.locator('[data-action=toggle-composer]'),input=page.locator('#action-input');
    assert.equal(await page.locator('body').getAttribute('data-page'),'story');
    for(const selector of ['.reading-paper']){
      const style=await page.locator(selector).evaluate(el=>{const s=getComputedStyle(el);return {image:s.backgroundImage,shadow:s.boxShadow,blur:s.backdropFilter};});
      assert.deepEqual(style,{image:'none',shadow:'none',blur:'none'},selector+' is a plain surface');
    }
    await page.locator('.reading-appearance').hover();
    assert.equal(await page.locator('.control-lens,.control-ripple').count(),0,'reading has no pointer decoration');
    assert.equal(await input.isVisible(),false);
    assert.ok((await dock.boundingBox()).height<115,'compact dock height');
    assert.ok(await page.locator('[data-action=continue]').isVisible());
    assert.ok(await page.locator('.reader-tools-trigger').isVisible());
    await toggle.click();await input.fill('暂存的行动与对话。');await toggle.click();
    assert.equal(await input.inputValue(),'暂存的行动与对话。');
    await toggle.click();assert.equal(await input.isVisible(),true);await toggle.click();
    const anchor=page.locator('.opening p').nth(7);
    await anchor.evaluate(el=>window.scrollBy({top:el.getBoundingClientRect().top-150,behavior:'instant'}));
    await page.locator('.reading-appearance').click();
    const form=page.locator('#reader-settings-form');
    const dialogStyle=await page.locator('#dialog').evaluate(el=>{const s=getComputedStyle(el);return {image:s.backgroundImage,shadow:s.boxShadow,animation:s.animationName,blur:getComputedStyle(el,'::backdrop').backdropFilter};});
    assert.equal(dialogStyle.animation,'none');assert.equal(dialogStyle.blur,'none');
    const chrome=await page.locator('.reading-header,.reading-composer,#dialog').evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.backgroundImage,s.borderRadius];}));
    assert.equal(await page.locator('.control-lens,.control-ripple').count(),0);

    const initial=await page.evaluate(async()=>{const {captureReadingViewport}=await import('/src/reader-comfort.js');window.comfortAnchor=captureReadingViewport();return window.comfortAnchor.top;});
    await form.getByRole('button',{name:'增大字号',exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.reading-prose')).fontSize==='19px');
    await page.waitForTimeout(100);
    const restored=await page.evaluate(()=>{const a=window.comfortAnchor,r=document.createRange();r.setStart(a.node,a.index);r.setEnd(a.node,a.index+1);return r.getBoundingClientRect().top;});
    assert.ok(Math.abs(restored-initial)<3,`font change preserves visible text: ${initial} -> ${restored}`);
    for(const theme of ['paper','white','sage','night']){
      await form.locator(`label[data-theme-swatch=${theme}]`).click();
      await page.waitForFunction(theme=>document.querySelector('.reading-experience').dataset.readingTheme===theme,theme);
      const palette=await page.locator('.reading-paper').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,ink:getComputedStyle(el).color}));
      assert.ok(contrast(palette.bg,palette.ink)>=7,theme+' readable contrast');
      if(theme!=='night')assert.deepEqual(await page.locator('.reading-header,.reading-composer,#dialog').evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.backgroundImage,s.borderRadius];})),chrome,theme+' preserves shared interface appearance');

    }
    await form.locator('label[data-theme-swatch=sage]').click();
    await form.getByRole('button',{name:'宽松',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(parseFloat(getComputedStyle(document.querySelector('.reading-prose')).lineHeight)-43.7)<.1);
    await page.screenshot({path:`${output}/settings-${width}.png`,animations:'disabled'});
    const footer=await form.locator('[type=submit]').boundingBox(),dialogBox=await page.locator('#dialog').boundingBox();
    assert.ok(footer.y+footer.height<=dialogBox.y+dialogBox.height,'settings footer is fully visible');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE_KEY);
    assert.equal(saved.settings.readingTheme,'sage');assert.equal(saved.settings.fontSize,19);assert.equal(saved.settings.lineHeight,2.3);
    // Generate a local demo continuation while reading earlier paragraphs.
    // Live replacement must retain the collapsed drawer, draft and viewport.
    const before=await page.evaluate(()=>scrollY);
    await page.locator('[data-action=continue]').click();
    await page.locator('[data-reader-turns]>.turn').first().waitFor();
    await page.waitForTimeout(150);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<3,'new prose must not pull a historical reader to the bottom');
    assert.equal(await input.isVisible(),false);
    assert.equal(await input.inputValue(),'暂存的行动与对话。');
    assert.ok(await page.locator('#new-content').isVisible());
    await page.reload();await page.locator('.reading-prose').first().waitFor();
    assert.equal(await page.locator('.reading-experience').getAttribute('data-reading-theme'),'sage');
    await toggle.click();assert.equal(await input.inputValue(),'暂存的行动与对话。');
    await toggle.click();
    await page.evaluate(()=>scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`${output}/reading-${width}.png`,animations:'disabled'});
    await page.locator('.reading-appearance').click();
    if(width===1440){
      await form.getByText('字体与精细排版',{exact:true}).click();
      await form.locator('[name=fontFamily]').selectOption('sans');
      await page.evaluate(()=>document.fonts.ready);
      assert.ok((await page.locator('.reading-prose').first().evaluate(el=>getComputedStyle(el).fontFamily)).includes('Noto Sans'));
      await form.locator('[name=readingMode]').selectOption('paged');
      assert.equal(await page.locator('.reading-pagination').count(),1);
      await form.locator('[name=readingMode]').selectOption('continuous');
      assert.equal(await page.locator('.reading-pagination').count(),0);
    }
    await form.locator('[data-action=reset-reading]').click();
    assert.equal(await page.locator('.reading-experience').getAttribute('data-reading-theme'),'paper');
    await page.keyboard.press('Escape');
    await page.emulateMedia({forcedColors:'active'});
    const forced=await page.locator('.reading-paper').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,ink:getComputedStyle(el).color}));
    assert.ok(contrast(forced.bg,forced.ink)>=7);
    if(width===1440){
      await page.emulateMedia({forcedColors:'none'});
      await page.evaluate(()=>location.hash='#/');
      await page.locator('body[data-page=home]').waitFor();
      const homeControl=page.locator('.workspace-create').first();await homeControl.hover();
      await page.waitForFunction(()=>document.querySelector('.control-lens'));
      const homePrimary=await page.locator('.btn.primary').first().evaluate(el=>{const s=getComputedStyle(el);return {image:s.backgroundImage,ink:s.color};});
      await page.screenshot({path:output+'/home-effects.png',animations:'disabled'});
      await page.evaluate(id=>location.hash='#/story/'+id,session.id);
      await page.locator('body[data-page=story]').waitFor();
      await page.locator('.reading-appearance').hover();
      assert.equal(await page.locator('.control-lens,.control-ripple,.portal-transfer').count(),0,'home effects cleaned on entering reader');
      assert.equal(await page.locator('.reading-paper').evaluate(el=>el.getAnimations().length),0,'no reading entrance animation');
      await toggle.click();await input.fill('测试简洁输入框');
      const send=page.locator('.reading-send');await page.mouse.move(0,0);
      const sendStyle=await send.evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,ink:s.color,image:s.backgroundImage,shadow:s.boxShadow};});
      assert.deepEqual({image:sendStyle.image,ink:sendStyle.ink},homePrimary,'reader send uses the same primary material as home');
      await page.screenshot({path:output+'/reading-input.png',animations:'disabled'});
    }
    await page.emulateMedia({forcedColors:'none'});
    await page.locator('.reader-tools-trigger').click();
    const menu=page.locator('.reader-quick-tools');assert.ok(await menu.isVisible());
    assert.equal(await menu.evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.keyboard.press('Escape');
    assert.equal(errors.length,0,errors.join('\n'));
    results.push({width,passed:true});console.log('PASS reader comfort '+width+'px');await context.close();
  }
  await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
