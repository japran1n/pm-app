import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const ROOT = "/Users/sasajapranin/Desktop/pm-app";
const EV = join(ROOT, "missions/20260920-124226/milestones/evidence/M6-pass3");
mkdirSync(EV, { recursive: true });
const BASE = "http://localhost:3000";
const env = readFileSync(join(ROOT, ".env"), "utf8");
for (const line of env.split("\n")) { const t=line.trim(); if(!t||t.startsWith("#"))continue; const eq=t.indexOf("="); if(eq<0)continue; const k=t.slice(0,eq).trim(); if(!(k in process.env)) process.env[k]=t.slice(eq+1).trim(); }
const URL_=process.env.NEXT_PUBLIC_SUPABASE_URL, KEY=process.env.SUPABASE_SECRET_KEY;
const admin=createClient(URL_,KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const ref=new URL(URL_).hostname.split(".")[0];

const suffix="1789930474621";
const slug=`m6ux3-${suffix}`;
const ids={self:"6ad705d3-5636-4c1f-9048-e5f0039ec4ac",b:"d8228448-15c7-49ff-93bb-4b3e93a4b609",c:"a66772b8-2f8f-4797-8c2c-088812db128d",d:"7288bad9-e675-45f2-8114-5704bfdd4a2f",e:"15993c1c-b48a-4d54-b8bb-adcd72c6862a"};
const selfEmail=`m6ux3-self-${suffix}@example.com`;
const log=[]; const L=(...a)=>{const s=a.map(x=>typeof x==="string"?x:JSON.stringify(x)).join(" ");console.log(s);log.push(s);};

const {data:link}=await admin.auth.admin.generateLink({type:"magiclink",email:selfEmail,options:{redirectTo:`${BASE}/auth/callback`}});
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1280,height:900}});
const page=await ctx.newPage();
await page.goto(link.properties.action_link);
await page.waitForURL(/#access_token=/,{timeout:20000});
const p2=new URLSearchParams(new URL(page.url()).hash.slice(1));
const session={access_token:p2.get("access_token"),refresh_token:p2.get("refresh_token"),token_type:"bearer",expires_in:3600,expires_at:Number(p2.get("expires_at")||Math.floor(Date.now()/1000)+3600),user:{id:ids.self,email:selfEmail}};
const cookie={name:`sb-${ref}-auth-token`,value:"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"),url:BASE};
await ctx.addCookies([cookie]);

const CAL=`${BASE}/w/${slug}/calendar`;
const items=(p=page)=>p.locator('[data-slot="people-switcher-content"] [cmdk-item]');
const item=(n,p=page)=>items(p).filter({hasText:n});
const listNames=async(p=page)=>items(p).allTextContents();
const checkedOf=async(n,p=page)=>await item(n,p).getAttribute("data-checked");
async function ready(p=page){await p.waitForSelector('[data-testid="calendar-week-label"]',{timeout:90000});await p.waitForLoadState("networkidle").catch(()=>{});}
async function closeSwitcher(p=page){
  const c=p.locator('[data-slot="people-switcher-content"]');
  for(let i=0;i<5;i++){ if((await c.count())===0) return; await p.keyboard.press("Escape"); await p.waitForTimeout(400); }
}
async function openSwitcher(p=page){
  const c=p.locator('[data-slot="people-switcher-content"]');
  await p.waitForLoadState("networkidle").catch(()=>{});
  for(let i=0;i<8;i++){
    if((await c.count())>0&&await c.isVisible().catch(()=>false)){
      if(await items(p).count()>0){await p.waitForTimeout(300);return;}
      await closeSwitcher(p);
    }
    await p.locator('[data-slot="people-switcher-trigger"]').click({force:true}).catch(()=>{});
    try{await c.waitFor({timeout:3000});}catch{}
    await p.waitForTimeout(400);
  }
  throw new Error("could not open switcher");
}
async function act(fn,p=page){const before=p.url();await openSwitcher(p);await fn();await p.waitForFunction(u=>location.href!==u,before,{timeout:15000});await p.waitForLoadState("networkidle").catch(()=>{});await p.waitForTimeout(700);return decodeURIComponent(p.url());}

// AS-059
L("--- AS-059 ---");
await page.goto(CAL+`?people=${ids.c}`); await ready();
await openSwitcher();
L("AS-059 ?people=<carol>: carol checked:",await checkedOf("Carol Clark"),"alice:",await checkedOf("Alice Anderson"));
await closeSwitcher();
L("AS-059 url after deselecting Carol (the last one):",await act(()=>item("Carol Clark").click()));
await page.reload(); await ready();
await openSwitcher();
L("AS-059 after hard reload -> Alice checked:",await checkedOf("Alice Anderson"),"Carol:",await checkedOf("Carol Clark"));
L("AS-059 week-view renders:",await page.locator('[data-testid="calendar-week-view"]').count());
await page.screenshot({path:join(EV,"P3-11-empty-falls-back-self.png")});
await closeSwitcher();

// AS-011
L("--- AS-011 ---");
const multi=`?people=${ids.self},${ids.b},${ids.c}`;
await page.goto(CAL+multi); await ready();
L("AS-011 start url:",decodeURIComponent(page.url()));
for(const nav of ["Next week","Previous week"]){
  await page.getByLabel(nav).click(); await ready(); await page.waitForTimeout(600);
  L(`AS-011 after '${nav}':`,decodeURIComponent(page.url()));
}
await page.getByText("Today",{exact:true}).click(); await ready(); await page.waitForTimeout(600);
L("AS-011 after 'Today':",decodeURIComponent(page.url()));
await page.screenshot({path:join(EV,"P3-12-week-nav-preserves-people.png")});

// AS-012
L("--- AS-012 ---");
await page.getByLabel("Next week").click(); await ready(); await page.waitForTimeout(600);
const weekVal=new URL(page.url()).searchParams.get("week");
L("AS-012 url with a week param:",decodeURIComponent(page.url()),"| week=",weekVal);
L("AS-012 url after toggling Dave:",await act(()=>item("Dave Davis").click()));
const after=new URL(page.url()).searchParams.get("week");
L("AS-012 week preserved:",after,"===",weekVal,"->",after===weekVal);
await page.screenshot({path:join(EV,"P3-13-people-change-preserves-week.png")});
await closeSwitcher();

// AS-013
L("--- AS-013 ---");
const st=await page.evaluate(()=>({local:Object.fromEntries(Object.entries(localStorage)),sessionKeys:Object.keys(sessionStorage)}));
L("AS-013 localStorage keys:",Object.keys(st.local));
L("AS-013 sessionStorage keys:",st.sessionKeys);
L("AS-013 keys/values mentioning people|week|planner|calendar:",JSON.stringify(Object.entries(st.local).filter(([k,v])=>/people|week|planner|calendar/i.test(k+" "+v)).map(([k])=>k).concat(st.sessionKeys.filter(k=>/people|week|planner|calendar/i.test(k)))));

// AS-060
L("--- AS-060 ---");
await page.goto(CAL); await ready();
await page.evaluate(()=>document.body.focus());
let tabs=0,reached=false;
for(;tabs<60;tabs++){await page.keyboard.press("Tab");if(await page.evaluate(()=>document.activeElement?.getAttribute("data-slot")==="people-switcher-trigger")){reached=true;break;}}
L("AS-060 trigger reached by Tab:",reached,"after",tabs+1,"presses");
if(reached){
  await page.keyboard.press("Enter");
  await page.locator('[data-slot="people-switcher-content"]').waitFor({timeout:5000});await page.waitForTimeout(500);
  L("AS-060 popover open:",await page.locator('[data-slot="people-switcher-content"]').isVisible());
  L("AS-060 focus:",await page.evaluate(()=>(document.activeElement?.tagName||"")+" placeholder="+(document.activeElement?.getAttribute("placeholder")||"")));
  await page.keyboard.type("Dave");await page.waitForTimeout(500);
  L("AS-060 list after typing 'Dave':",await listNames());
  await page.keyboard.press("ArrowDown");await page.waitForTimeout(400);
  L("AS-060 highlighted after ArrowDown:",await page.evaluate(()=>document.querySelector('[cmdk-item][data-selected="true"]')?.textContent??null));
  await page.screenshot({path:join(EV,"P3-14-keyboard-open.png")});
  const b4=page.url();
  await page.keyboard.press("Enter");
  await page.waitForFunction(u=>location.href!==u,b4,{timeout:10000}).catch(()=>{});
  await page.waitForTimeout(900);
  L("AS-060 url after keyboard Enter:",decodeURIComponent(page.url()),"| Dave id:",ids.d);
  await page.screenshot({path:join(EV,"P3-15-keyboard-selected.png")});
}

// AS-061
L("--- AS-061 ---");
const mctx=await browser.newContext({viewport:{width:375,height:812}});
await mctx.addCookies([cookie]);
const mp=await mctx.newPage();
await mp.goto(CAL); await ready(mp);
const mt=mp.locator('[data-slot="people-switcher-trigger"]');
L("AS-061 mobile (single) trigger visible:",await mt.isVisible(),"box:",JSON.stringify(await mt.boundingBox()));
await mp.screenshot({path:join(EV,"P3-16-mobile-header.png")});
await openSwitcher(mp);
L("AS-061 mobile popover visible:",await mp.locator('[data-slot="people-switcher-content"]').isVisible(),"items:",await listNames(mp));
await mp.screenshot({path:join(EV,"P3-17-mobile-open.png")});
const mB=mp.url();
await item("Erin Evans",mp).click();
await mp.waitForFunction(u=>location.href!==u,mB,{timeout:10000}).catch(()=>{});
await mp.waitForTimeout(900);
L("AS-061 mobile url after toggling Erin:",decodeURIComponent(mp.url()),"| Erin id:",ids.e);
await ready(mp);
L("AS-061 mobile (stacked) trigger count:",await mt.count(),"visible:",await mt.count()?await mt.isVisible():false,"stacked:",await mp.locator('[data-testid="stacked-planner"]').count());
L("AS-061 mobile horizontal overflow:",await mp.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth));
await mp.screenshot({path:join(EV,"P3-18-mobile-stacked-header.png")});

appendFileSync(join(EV,"P3-trace.txt"),"\n\n=== part B ===\n"+log.join("\n")+"\n");
await browser.close();
console.log("DONE");
