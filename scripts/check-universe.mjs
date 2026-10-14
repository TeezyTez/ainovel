// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright entry point.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const server=createServer({env:{}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});
const page=await context.newPage(),errors=[];
// Browser compositing can differ by one channel value on an otherwise static edge.
// Compare decoded pixels with a two-level tolerance instead of PNG byte identity.
const changedPixels=async(a,b)=>page.evaluate(async urls=>{
 const images=await Promise.all(urls.map(encoded=>createImageBitmap(new Blob([Uint8Array.from(atob(encoded),character=>character.charCodeAt(0))],{type:'image/png'}))));
 const pixels=images.map(image=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;});
 let count=0;for(let i=0;i<pixels[0].length;i+=4)if(Math.max(Math.abs(pixels[0][i]-pixels[1][i]),Math.abs(pixels[0][i+1]-pixels[1][i+1]),Math.abs(pixels[0][i+2]-pixels[1][i+2]))>2)count++;
 return count;
},[a,b].map(buffer=>buffer.toString('base64')));
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error'&&/THREE|shader|WebGLProgram/i.test(message.text()))errors.push(message.text());});
await mkdir('test-results/universe',{recursive:true});
try{
 await page.goto(url);await page.waitForSelector('[data-universe-stage][data-scene-ready="true"]',{timeout:20000});
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(600);
 assert.equal(await page.locator('.universe-art a, .universe-art button').count(),0);
 await page.screenshot({path:'test-results/universe/desktop.png'});
 const first=await page.screenshot();
 await page.waitForTimeout(300);const second=await page.screenshot();
 assert.ok(await changedPixels(first,second)>50,'environment should continue moving without pointer input');
 await page.locator('[data-universe-pause]').click();
 assert.equal(await page.locator('[data-universe-stage]').getAttribute('data-motion'),'paused');
 await page.waitForTimeout(450);const paused=await page.screenshot();
 await page.waitForTimeout(200);assert.equal(await changedPixels(paused,await page.screenshot()),0,'pause must stop environmental motion');
 await page.locator('[data-universe-pause]').click();
 await page.mouse.move(1100,420);await page.waitForTimeout(250);
 assert.equal(await page.locator('.universe-cursor').getAttribute('data-visible'),'true');
 await page.screenshot({path:'test-results/universe/pointer.png'});
 await page.locator('select[data-setting="theme"]').first().selectOption('dark');
 await page.waitForFunction(()=>document.body.dataset.theme==='dark');
 await page.mouse.move(10,10);await page.waitForTimeout(400);
 await page.screenshot({path:'test-results/universe/dark-live.png'});
 await page.locator('select[data-setting="theme"]').first().selectOption('light');
 await page.waitForFunction(()=>document.body.dataset.theme==='light');
 await page.evaluate(()=>window.scrollTo({top:380,behavior:'instant'}));
 await page.waitForFunction(()=>Number(document.querySelector('[data-universe-stage]')?.dataset.progress)>.1);
 assert.ok(Number(await page.locator('[data-universe-stage]').getAttribute('data-progress'))>.1);
 await page.screenshot({path:'test-results/universe/scroll.png'});
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(250);
 const destination=await page.locator('.discovery-card h3 a').first().getAttribute('href');
 await page.locator('.discovery-card h3 a').first().click();

 await page.screenshot({path:'test-results/universe/transition.png'});await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>location.hash),destination);
 assert.equal(await page.locator('.universe-canvas').count(),0);
 await page.screenshot({path:'test-results/universe/detail.png'});
 for(let i=0;i<3;i++){
  await page.goto(url+'/#/');await page.waitForSelector('[data-scene-ready="true"]');
  assert.equal(await page.locator('.universe-canvas').count(),1);
  await page.locator('.universe-hero-actions a[href="#/create"]').click();await page.waitForTimeout(80);
 }
 await page.goto(url+'/#/');await page.waitForSelector('[data-scene-ready="true"]');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 await page.waitForSelector('[data-universe-stage][data-motion="reduced"]');
 assert.equal(await page.locator('[data-universe-stage]').getAttribute('data-motion'),'reduced');
 const still=await page.screenshot();await page.waitForTimeout(200);
 assert.equal(await changedPixels(still,await page.screenshot()),0,'reduced motion must hold a static image');
 await page.screenshot({path:'test-results/universe/reduced.png'});
 await page.emulateMedia({reducedMotion:'no-preference'});
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const phone=await mobile.newPage();await phone.goto(url);await phone.waitForSelector('[data-scene-ready="true"]');
 assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
 await phone.screenshot({path:'test-results/universe/mobile.png'});
 await phone.locator('.discovery-card h3 a').first().click();assert.match(await phone.evaluate(()=>location.hash),/^#\/world\//);
 const fallback=await context.newPage();await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:original.call(this,type,...args);};});
 await fallback.goto(url);await fallback.waitForSelector('[data-scene-fallback="true"]');
 await fallback.screenshot({path:'test-results/universe/fallback.png'});
 await fallback.locator('.discovery-card h3 a').first().click();assert.match(await fallback.evaluate(()=>location.hash),/^#\/world\//);
 assert.deepEqual(errors,[]);
 await writeFile('test-results/universe/result.json',JSON.stringify({passed:true,errors,checks:['continuous motion','pause','pointer','theme switch','scroll','navigation','remount','reduced motion','mobile','WebGL fallback']},null,2));
 console.log('Universe browser checks passed; screenshots: test-results/universe');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
