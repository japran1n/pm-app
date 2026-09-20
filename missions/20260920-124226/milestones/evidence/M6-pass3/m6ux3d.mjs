import { readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
const ROOT="/Users/sasajapranin/Desktop/pm-app";
const EV=join(ROOT,"missions/20260920-124226/milestones/evidence/M6-pass3");
const BASE="http://localhost:3000";
const env=readFileSync(join(ROOT,".env"),"utf8");
for(const line of env.split("\n")){const t=line.trim();if(!t||t.startsWith("#"))continue;const eq=t.indexOf("=");if(eq<0)continue;const k=t.slice(0,eq).trim();if(!(k in process.env))process.env[k]=t.slice(eq+1).trim();}
const URL_=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.SUPABASE_SECRET_KEY;
const admin=createClient(URL_,KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const ref=new URL(URL_).hostname.split(".")[0];
const suffix="1789930474621",slug=`m6ux3-${suffix}`;
const ids={self:"6ad705d3-5636-4c1f-9048-e5f0039ec4ac",b:"d8228448-15c7-49ff-93bb-4b3e93a4b609",c:"a66772b8-2f8f-4797-8c2c-088812db128d",d:"7288bad9-e675-45f2-8114-5704bfdd4a2f"};
const selfEmail=`m6ux3-self-${suffix}@example.com`;
const log=[];const L=(...a)=>{const s=a.map(x=>typeof x==="string"?x:JSON.stringify(x)).join(" ");console.log(s);log.push(s);};
const {data:link}=await admin.auth.admin.generateLink({type:"magiclink",email:selfEmail,options:{redirectTo:`${BASE}/auth/callback`}});
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1280,height:900}});
const page=await ctx.newPage();
await page.goto(link.properties.action_link);await page.waitForURL(/#access_token=/,{timeout:20000});
const p2=new URLSearchParams(new URL(page.url()).hash.slice(1));
const session={access_token:p2.get("access_token"),refresh_token:p2.get("refresh_token"),token_type:"bearer",expires_in:3600,expires_at:Number(p2.get("expires_at")),user:{id:ids.self,email:selfEmail}};
await ctx.addCookies([{name:`sb-${ref}-auth-token`,value:"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"),url:BASE}]);
const CAL=`${BASE}/w/${slug}/calendar`;
const label=()=>page.locator('[data-testid="calendar-week-label"]').first().textContent();
async function ready(){await page.waitForSelector('[data-testid="calendar-week-label"]',{timeout:90000});await page.waitForLoadState("networkidle").catch(()=>{});}


const items=()=>page.locator('[data-slot="people-switcher-content"] [cmdk-item]');
const item=(n)=>items().filter({hasText:n});
async function openSwitcher(){
  const c=page.locator('[data-slot="people-switcher-content"]');
  await page.waitForLoadState("networkidle").catch(()=>{});
  for(let i=0;i<8;i++){
    if((await c.count())>0&&await c.isVisible().catch(()=>false)&&await items().count()>0){await page.waitForTimeout(300);return;}
    await page.locator('[data-slot="people-switcher-trigger"]').click({force:true}).catch(()=>{});
    try{await c.waitFor({timeout:3000});}catch{}
    await page.waitForTimeout(500);
  }
  throw new Error("no switcher");
}
L("=== AS-012 (week preserved when the selection changes) ===");
await page.goto(CAL+`?people=${ids.self},${ids.b},${ids.c}`);await ready();
await page.getByLabel("Next week").click();await page.waitForTimeout(2500);await ready();
const weekVal=new URL(page.url()).searchParams.get("week");
L("before: week=",weekVal,"people=",new URL(page.url()).searchParams.get("people"),"label=",(await label()).trim());
const b4=page.url();
await openSwitcher();
await item("Dave Davis").click();
await page.waitForFunction(u=>location.href!==u,b4,{timeout:15000});
await page.waitForTimeout(2500);await ready();
const u2=new URL(page.url());
L("after toggling Dave: week=",u2.searchParams.get("week"),"people=",u2.searchParams.get("people"),"label=",(await label()).trim());
L("AS-012 week preserved:",u2.searchParams.get("week")===weekVal);
await page.screenshot({path:join(EV,"P3-13-people-change-preserves-week.png")});
// and the reverse: just-me from a non-default week
const b5=page.url();
await openSwitcher();
await page.locator('[data-slot="people-switcher-just-me"]').click();
await page.waitForFunction(u=>location.href!==u,b5,{timeout:15000});
await page.waitForTimeout(2500);await ready();
const u3=new URL(page.url());
L("after 'Just me': week=",u3.searchParams.get("week"),"people=",u3.searchParams.get("people"),"label=",(await label()).trim());
L("AS-012 week preserved through shortcut:",u3.searchParams.get("week")===weekVal);
appendFileSync(join(EV,"P3-trace.txt"),"\n\n=== part D (AS-012 focused) ===\n"+log.join("\n")+"\n");
await browser.close();console.log("DONE");
