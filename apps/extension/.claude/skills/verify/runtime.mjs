import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extensionPath = resolve('apps/extension/.output/chrome-mv3');
const outputDir = join(tmpdir(), 'wayfinder-runtime-verify');
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

function fixtureHtml(url) {
  const [, owner = 'example', repo = 'wayfinder-fixture'] = new URL(url).pathname.split('/');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
  <main><h1><strong><a itemprop="name">${owner} / ${repo}</a></strong></h1><button data-hotkey="w">main</button>
  <table aria-label="Folders and files"><tbody><tr><td>src</td></tr></tbody></table>
  <article id="readme" class="markdown-body"><h2>Fixture README</h2></article></main></body></html>`;
}
function shaFor(repo) {
  const digit = (([...repo].reduce((total, character) => total + character.charCodeAt(0), 0) % 15) + 1).toString(16);
  return digit.repeat(40);
}
function mapFor(owner, repo, ref = null) {
  const identity = `${owner}/${repo}`;
  return { repo: identity, sha: shaFor(identity), requestedRef: ref, resolvedRef: ref ?? 'main', defaultBranch: 'main',
    description: `A fixture repository for ${identity}.`, homepage: null, language: 'TypeScript', stars: 1, readme: '# Fixture',
    tree: [{path:'src',type:'tree'},{path:'tests',type:'tree'},{path:'README.md',type:'blob'},{path:'package.json',type:'blob'},{path:'src/index.ts',type:'blob'},{path:'tests/index.test.ts',type:'blob'}],
    setupFiles: ['package.json','pnpm-lock.yaml'], truncated:false, generatedAt:'2026-07-15T12:00:00.000Z' };
}
function tourFor(map) { return { repo:map.repo, sha:map.sha, summary:map.description, stack:['TypeScript','Node.js'], entryPoints:[{path:'src/index.ts',why:'Primary entry point.'}], stops:[{order:1,title:'Start here',path:'src/index.ts',lines:[1,40],explanation:'Primary entry point.',lookFor:'Exports.'}] }; }
function guideFor(map) { return { repo:map.repo, sha:map.sha, audience:'develop', packageManager:'pnpm', runtimes:['Node.js >=22'], prerequisites:[{text:'Use Node.js 22.',evidence:{path:'package.json',lines:[1,12]},confidence:'documented'}], steps:[{order:1,title:'Run the tests',command:'pnpm test',evidence:{path:'package.json',lines:[6,10]},confidence:'documented'},{order:2,title:'Install dependencies',command:'pnpm install',evidence:{path:'package.json',lines:[1,12]},confidence:'documented'}], warnings:[], generatedAt:'2026-07-15T12:00:00.000Z' }; }

async function createHarness(name, state = {}) {
  const profile = await mkdtemp(join(tmpdir(), `wayfinder-verify-${name}-`));
  const context = await chromium.launchPersistentContext(profile, { channel:'chromium', headless:true, viewport:{width:1440,height:1000}, args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`] });
  const page = context.pages()[0] ?? await context.newPage();
  const api = { mapDelayByRepo:{}, mapFailures:0, tourFailures:0, agentFailures:0, requests:[], ...state };
  await page.route('https://github.com/**', route => route.fulfill({status:200,contentType:'text/html',body:fixtureHtml(route.request().url())}));
  await page.route(/^(?:http:\/\/localhost:8787|https:\/\/wayfinder-api\.hopit-robert\.workers\.dev)\//, async route => {
    const url = new URL(route.request().url()); const body = route.request().postDataJSON() ?? {};
    if (url.pathname === '/map') {
      const owner=String(body.owner??'example'), repo=String(body.repo??'wayfinder-fixture'), ref=typeof body.ref==='string'?body.ref:null, identity=`${owner}/${repo}`;
      api.requests.push({path:'/map',repo:identity}); const delay=api.mapDelayByRepo[identity]??0; if(delay) await new Promise(r=>setTimeout(r,delay));
      if(api.mapFailures>0){api.mapFailures--; return route.fulfill({status:503,json:{code:'upstream-unavailable',message:'Fixture map unavailable.'}}).catch(()=>{});}
      return route.fulfill({json:mapFor(owner,repo,ref)}).catch(()=>{});
    }
    if(url.pathname==='/tour'){
      const map=body.map; api.requests.push({path:'/tour',repo:map.repo}); if(api.tourFailures>0){api.tourFailures--;return route.fulfill({status:503,json:{code:'upstream-unavailable',message:'Fixture tour unavailable.'}}).catch(()=>{});} return route.fulfill({json:tourFor(map)}).catch(()=>{});
    }
    if(url.pathname==='/agent'){
      const map=body.map, query=String(body.query??''); api.requests.push({path:'/agent',repo:map.repo,query}); if(api.agentFailures>0){api.agentFailures--;return route.fulfill({status:503,json:{code:'upstream-unavailable',message:'Fixture agent unavailable.'}}).catch(()=>{});} const guide=guideFor(map);
      if(/use this project/i.test(query)) return route.fulfill({ json: {
        repo: map.repo, sha: map.sha, query, intent: 'installation', mode: 'free',
        summary: 'I found one consumer installation command.', suggestions: [], evidencePaths: ['package.json'], generatedAt: '2026-07-15T12:00:00.000Z',
        guide: { ...guide, audience: 'use', steps: [{ ...guide.steps[1], title: 'Install the published package', command: 'pnpm add wayfinder-fixture' }] },
      } });
      return route.fulfill({json:{repo:map.repo,sha:map.sha,query,intent:'orientation',mode:'free',summary:`${map.repo} orientation`,explanation:'A detailed fixture explanation used to exercise the expanded answer surface.',suggestions:['Where are the tests?'],evidencePaths:['src/index.ts'],generatedAt:'2026-07-15T12:00:00.000Z',tour:tourFor(map),guide,brief:[{title:'Read the entry point',action:'Inspect the exported surface.',evidencePath:'src/index.ts'},{title:'Pair it with tests',action:'Confirm behavior in the test suite.',evidencePath:'tests/index.test.ts'}]}});
    }
    return route.fulfill({status:404,json:{error:'not_found'}});
  });
  return {context,page,profile,api,close:async()=>{await context.close();await rm(profile,{recursive:true,force:true});}};
}
async function open(page){ const launcher=page.locator('#wayfinder-page-guide').getByRole('button',{name:/Wayfinder helper/}).first(); if(await launcher.getAttribute('aria-expanded')!=='true') await page.getByRole('button',{name:'Open Wayfinder helper'}).click(); await page.getByRole('button',{name:'Close helper'}).waitFor(); }
async function choose(page, mode){ await open(page); const first=page.getByRole('button',{name:mode==='Guided'?'Guide me':'Quick map'}); if(await first.isVisible().catch(()=>false)){ if(mode==='Quick'){await page.getByRole('button',{name:'Guide me'}).click();await page.getByRole('button',{name:'Quick',exact:true}).click();}else await first.click(); } else { const b=page.getByRole('button',{name:mode,exact:true}); if(await b.getAttribute('aria-pressed')!=='true') await b.click(); } }
async function uiState(page){ return page.evaluate(()=>{const host=document.querySelector('#wayfinder-page-guide'),root=host?.shadowRoot,b=root?.querySelector('.wf-bubble'),active=root?.activeElement;const r=b?.getBoundingClientRect();return {hidden:host?.hidden,expanded:root?.querySelector('.wf-helper')?.getAttribute('aria-expanded'),maxHeight:parseFloat(b?.style.maxHeight||'0'),clientHeight:b?.clientHeight,scrollHeight:b?.scrollHeight,scrollTop:b?.scrollTop,rect:r?{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null,active:active?.getAttribute('aria-label')||active?.textContent?.trim()||active?.tagName,status:root?.querySelector('[role=status]')?.textContent,copyLive:root?.querySelector('.wf-copy')?.hasAttribute('aria-live'),highlight:root?.querySelector('.wf-highlight')?.classList.contains('visible'),dockLeft:(root?.querySelector('.wf-dock'))?.style.left,scheme:getComputedStyle(host).colorScheme,panel:getComputedStyle(host).getPropertyValue('--wf-surface-panel').trim(),ink:getComputedStyle(host).getPropertyValue('--wf-ink').trim()};}); }
const report=[];

// Core Quick workflow: expansion, depth, links, clipboard failure/retry, narrow and dark.
{
  const h=await createHarness('core'); const {page,context}=h;
  await page.goto('https://github.com/example/wayfinder-fixture'); await open(page); const onboarding=await uiState(page);
  await page.getByRole('button',{name:'Guide me'}).click(); await page.getByRole('button',{name:'Quick',exact:true}).click();
  await page.getByRole('heading',{name:'Get the answer, then the evidence.'}).waitFor(); const quick=await uiState(page);
  await page.getByRole('button',{name:'Repository snapshot'}).click(); await page.getByText('example/wayfinder-fixture orientation').waitFor();
  const concise=await page.getByRole('button',{name:'Concise',exact:true}).getAttribute('aria-pressed'); await page.getByRole('button',{name:'Expanded',exact:true}).click();
  const expandedPressed=await page.getByRole('button',{name:'Expanded',exact:true}).getAttribute('aria-pressed'); await page.getByText('Recommended reading route').click();
  const link=page.getByRole('link',{name:'Open src/index.ts, lines 1 through 40'}); const href=await link.getAttribute('href');
  await page.screenshot({path:`${outputDir}/core-light.png`});
  await page.getByRole('button',{name:'← New question'}).click(); await page.getByRole('button',{name:'Use or develop this project'}).click(); await page.getByRole('button',{name:'Use this project'}).click();
  const copy=page.getByRole('button',{name:'Copy command: pnpm add wayfinder-fixture'}); const label=await copy.textContent(); const cdp=await context.newCDPSession(page);
  await cdp.send('Browser.setPermission',{permission:{name:'clipboard-write'},setting:'denied',origin:'https://github.com'}); await copy.click(); await page.waitForTimeout(150); const failStatus=(await uiState(page)).status;
  await cdp.send('Browser.setPermission',{permission:{name:'clipboard-write'},setting:'granted',origin:'https://github.com'}); await page.waitForTimeout(800); await copy.click(); await page.waitForTimeout(150); const okStatus=(await uiState(page)).status; const copyLabelStable=(await copy.textContent())===label;
  await page.getByRole('button',{name:'Close helper'}).click(); await page.reload(); await open(page); await page.getByRole('button',{name:'Repository snapshot'}).click(); await page.getByText('example/wayfinder-fixture orientation').waitFor(); const persisted=await page.getByRole('button',{name:'Expanded',exact:true}).getAttribute('aria-pressed');
  await page.setViewportSize({width:360,height:500}); await page.waitForTimeout(200); const narrow=await uiState(page); await page.screenshot({path:`${outputDir}/core-narrow.png`});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'}); await page.waitForTimeout(200); const dark=await uiState(page); await page.screenshot({path:`${outputDir}/core-dark.png`});
  report.push({scenario:'core',onboarding,quick,concise,expandedPressed,href,copyLabelStable,failStatus,okStatus,persisted,narrow,dark}); await h.close();
}

// Guided focus, cancellation while moving, and failure fallback.
{
  const h=await createHarness('guided'); const {page,api}=h; await page.goto('https://github.com/example/wayfinder-fixture'); await choose(page,'Guided');
  const guidedFocus=(await uiState(page)).active; await page.getByRole('button',{name:'Show me around'}).click(); await page.keyboard.press('Escape'); await page.waitForTimeout(2300); const cancelled=await uiState(page);
  await open(page); api.mapFailures=1; await page.getByRole('button',{name:'Show me around'}).click(); await page.getByRole('button',{name:'Continue without project facts'}).waitFor(); const warning=await uiState(page); await page.screenshot({path:`${outputDir}/guided-warning.png`});
  await page.getByRole('button',{name:'Continue without project facts'}).click(); await page.waitForTimeout(2300); const genericVisible=await page.getByText('Repository name',{exact:true}).isVisible(); const projectFactVisible=await page.getByText('In this project').isVisible().catch(()=>false);
  report.push({scenario:'guided',guidedFocus,cancelled,warning,genericVisible,projectFactVisible}); await h.close();
}

// Stale SPA response suppression.
{
  const h=await createHarness('stale',{mapDelayByRepo:{'alpha/one':2000}}); const {page,api}=h; await page.goto('https://github.com/alpha/one'); await choose(page,'Quick'); await page.getByRole('button',{name:'Repository snapshot'}).click();
  await page.evaluate(()=>{history.pushState({},'','/beta/two');document.dispatchEvent(new Event('turbo:load'));}); await page.waitForTimeout(1300); await open(page); await page.getByRole('button',{name:'Repository snapshot'}).click(); await page.getByText('beta/two orientation').waitFor(); await page.waitForTimeout(1200);
  report.push({scenario:'stale-navigation',betaVisible:await page.getByText('beta/two orientation').isVisible(),alphaVisible:await page.getByText('alpha/one orientation').isVisible().catch(()=>false),requests:api.requests}); await h.close();
}

// Hidden route shortcut should remain untouched.
{
  const h=await createHarness('hidden'); const {page}=h; await page.goto('https://github.com/settings/profile');
  const eventResult=await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'w',altKey:true,shiftKey:true,bubbles:true,cancelable:true});const dispatched=document.dispatchEvent(e);return {dispatched,defaultPrevented:e.defaultPrevented};});
  report.push({scenario:'hidden-shortcut',eventResult,state:await uiState(page)}); await h.close();
}

await writeFile(`${outputDir}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({outputDir,report},null,2));
