import { readFileSync } from "node:fs";
for (const l of readFileSync("/Users/sasajapranin/Desktop/pm-app/.env","utf8").split("\n")) {
  const i=l.indexOf("="); if(i>0 && !l.trim().startsWith("#")) process.env[l.slice(0,i).trim()]=l.slice(i+1).trim();
}
const { createClient } = await import("@supabase/supabase-js");
const URL_=process.env.NEXT_PUBLIC_SUPABASE_URL, SECRET=process.env.SUPABASE_SECRET_KEY;
const ANON=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin=createClient(URL_,SECRET,{auth:{persistSession:false}});
const s=`probe-${Date.now()}`;
const {data:ws}=await admin.from("workspaces").insert({name:"probe",slug:s}).select("id").single();
const {data:u}=await admin.auth.admin.createUser({email:`p-${s}@example.com`,password:"Probe12345!",email_confirm:true});
await admin.from("workspace_members").insert({workspace_id:ws.id,user_id:u.user.id,role:"admin",status:"active"});
const {data:pr}=await admin.from("projects").insert({workspace_id:ws.id,name:"probe p",created_by:u.user.id,visibility:"workspace"}).select("id").single();
const {data:t}=await admin.from("tasks").insert({project_id:pr.id,title:"probe task",author_id:u.user.id,status:"todo",position:1}).select("id").single();

const cli=createClient(URL_,ANON,{auth:{persistSession:false}});
const {error:se}=await cli.auth.signInWithPassword({email:`p-${s}@example.com`,password:"Probe12345!"});
if(se) throw se;
const got=[];
const ch=cli.channel(`probe:${s}`)
 .on("postgres_changes",{event:"*",schema:"public",table:"task_assignees"},p=>got.push(["task_assignees",p.eventType]))
 .on("postgres_changes",{event:"*",schema:"public",table:"tasks"},p=>got.push(["tasks",p.eventType]));
const status=await new Promise(r=>{ch.subscribe((st,err)=>{console.log("SUBSCRIBE STATUS:",st,err?.message??"");if(st!=="SUBSCRIBED")r(st);else r(st);});});
await new Promise(r=>setTimeout(r,2000));
await admin.from("task_assignees").insert({task_id:t.id,user_id:u.user.id,assigned_by:u.user.id});
await admin.from("tasks").update({status:"in_progress"}).eq("id",t.id);
await new Promise(r=>setTimeout(r,6000));
console.log("EVENTS RECEIVED:", JSON.stringify(got));

// second channel: tasks only
const got2=[];
const ch2=cli.channel(`probe2:${s}`).on("postgres_changes",{event:"*",schema:"public",table:"tasks"},p=>got2.push(p.eventType));
await new Promise(r=>{ch2.subscribe(st=>{console.log("CH2 STATUS:",st); if(st!=="SUBSCRIBED")r();else r();});});
await new Promise(r=>setTimeout(r,1500));
await admin.from("tasks").update({status:"done"}).eq("id",t.id);
await new Promise(r=>setTimeout(r,5000));
console.log("CH2 (tasks-only) EVENTS:", JSON.stringify(got2));

await admin.from("tasks").delete().eq("project_id",pr.id);
await admin.from("projects").delete().eq("id",pr.id);
await admin.from("workspace_members").delete().eq("workspace_id",ws.id);
await admin.from("workspaces").delete().eq("id",ws.id);
await admin.auth.admin.deleteUser(u.user.id);
process.exit(0);
