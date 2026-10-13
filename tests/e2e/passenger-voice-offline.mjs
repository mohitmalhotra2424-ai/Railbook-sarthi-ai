import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
try {
 for (const width of [360,412,1280]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  let passengers=[];let blocked=0;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('railsaarthi.autospeak','off'));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if (url.origin!=='http://localhost:3107') {blocked++;return route.abort();}
   if(url.pathname==='/api/passenger') {
    const body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(body?.action==='add')passengers.push({category:body.category});
    else if(body?.action==='remove')passengers.splice(body.passengerIndex-1,1);
    else if(body?.field){const i=body.passengerIndex-1;passengers[i]??={};passengers[i][body.field]=body.field==='age'?Number(body.value):body.value;}
    return route.fulfill({json:{ok:true,selection:{trainNumber:'12014',trainName:'Offline fixture',classCode:'3A',from:'LDH',to:'NDLS',journeyDate:'2026-11-01'},passengers,readiness:{ready:false,blockers:[],missingFields:[]},review:null}});
   }
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{configured:false}});
   return route.continue();
  });
  await page.goto('http://localhost:3107/passengers?c=offline-browser-session');
  await expect(page.getByRole('heading',{name:'Passenger Details',exact:true})).toBeVisible();
  await page.getByLabel('Full name (required)').fill('सीता शर्मा');
  await page.getByLabel('Age on journey date').click();
  await expect(page.getByRole('status').first()).toContainText('Naam: सीता शर्मा');
  await page.getByLabel('Age on journey date').fill('28');
  await page.getByLabel('Gender (required)').click();
  await expect(page.getByRole('status').first()).toContainText('gender select');
  await page.getByLabel('Gender (required)').selectOption('female');
  await expect(page.getByRole('status').first()).toContainText('Gender: female');
  await expect(page.getByTestId('berth-0')).toHaveAccessibleName(/Berth preference/);
  await page.getByTestId('berth-0').selectOption('No Preference');
  await expect(page.getByRole('status').first()).toContainText('Food preference');
  await page.getByTestId('add-infant-without-berth').click();
  await expect(page.getByTestId('passenger-card-1')).toContainText('Under 5 (no separate berth)');
  await expect(page.getByTestId('berth-1')).toContainText('Not applicable');
  await page.getByRole('button',{name:'Remove passenger 2'}).click();
  await expect(page.getByTestId('passenger-card-1')).toHaveCount(0);
  await expect(page.getByLabel('Full name (required)')).toHaveValue('सीता शर्मा');
  const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,labels:[...document.querySelectorAll('input,select')].every(el=>!!el.closest('label')||!!el.getAttribute('aria-label'))}));
  expect(layout.scroll).toBeLessThanOrEqual(width);expect(layout.labels).toBe(true);expect(errors).toEqual([]);
  await page.getByRole('button',{name:'Stop audio'}).focus();expect(await page.getByRole('button',{name:'Stop audio'}).evaluate(el=>el===document.activeElement)).toBe(true);
  await page.screenshot({path:`../evidence/passenger-form-${width}.png`,fullPage:true});
  results.push({width,status:'PASS',horizontalOverflow:false,accessibleLabels:true,keyboardFocus:true,blockedExternalRequests:blocked,fixtureOnly:true});
  await page.close();
 }
 await fs.writeFile('../evidence/mobile-browser-results.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
} finally {await browser.close();}
