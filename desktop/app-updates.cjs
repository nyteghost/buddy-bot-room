"use strict";
// ShowPilot update channel discovery. GitHub Actions artifacts require a signed-in
// GitHub session; the application never stores a GitHub token or silently runs downloads.
const {ipcMain,shell,app}=require("electron");
const fs=require("node:fs");
const path=require("node:path");
const https=require("node:https");
const SOURCES=[
  {repository:"nyteghost/showpilot",branches:{main:"main",beta:"beta"}},
  // Temporary compatibility path until standalone ShowPilot launches.
  {repository:"nyteghost/buddy-bot-room",branches:{beta:"feat/showpilot-standalone"}},
];
const MAX_JSON=1_500_000;
function readJson(url,depth=0){
 return new Promise((resolve,reject)=>{
  if(depth>3)return reject(new Error("Too many GitHub redirects"));
  const u=new URL(url);
  if(u.protocol!=="https:"||u.hostname!=="api.github.com")return reject(new Error("Unexpected update endpoint"));
  const req=https.get(u,{headers:{"User-Agent":"ShowPilot-Updater","Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},timeout:12000},res=>{
   if([301,302,307,308].includes(res.statusCode)){
     const loc=res.headers.location;res.resume();if(!loc){reject(new Error("Invalid GitHub redirect"));return}
     readJson(new URL(loc,u).href,depth+1).then(resolve,reject);return;
   }
   if(res.statusCode===404){res.resume();resolve(null);return}
   const chunks=[];let n=0;
   res.on("data",c=>{n+=c.length;if(n>MAX_JSON)req.destroy(new Error("GitHub response too large"));else chunks.push(c)});
   res.on("end",()=>{
     if(res.statusCode<200||res.statusCode>=300)return reject(new Error("GitHub HTTP "+res.statusCode+"; check your internet connection or GitHub API access."));
     try{resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))}catch{reject(new Error("Invalid GitHub response"))}
   });
  });
  req.on("error",reject);
  req.on("timeout",()=>req.destroy(new Error("GitHub request timed out")));
 });
}
function stateFile(){return path.join(app.getPath("userData"),"showpilot-updates.json")}
function channel(){try{const v=JSON.parse(fs.readFileSync(stateFile(),"utf8")).channel;return v==="main"||v==="beta"?v:"beta"}catch{return "beta"}}
function setChannel(value){
 if(value!=="main"&&value!=="beta")throw new Error("Invalid channel");
 fs.mkdirSync(path.dirname(stateFile()),{recursive:true,mode:0o700});
 fs.writeFileSync(stateFile(),JSON.stringify({channel:value}),{mode:0o600});
 return value;
}
async function latest(ch){
 for(const source of SOURCES){
  const ref=source.branches[ch];if(!ref)continue;
  const base="https://api.github.com/repos/"+source.repository;
  const q=new URL(base+"/actions/workflows/showpilot.yml/runs");
  q.searchParams.set("branch",ref);q.searchParams.set("status","success");q.searchParams.set("per_page","5");
  const response=await readJson(q.href);
  if(!response)continue;
  for(const run of (response.workflow_runs||[])){
   if(run.head_branch!==ref||run.conclusion!=="success")continue;
   const arts=await readJson(base+"/actions/runs/"+run.id+"/artifacts");
   const art=(arts?.artifacts||[]).find(a=>a.name==="showpilot-windows-portable"&&!a.expired);
   if(art)return {runId:run.id,sha:run.head_sha,channel:ch,created:run.created_at,url:run.html_url,repository:source.repository,temporary:source.repository!=="nyteghost/showpilot"};
  }
 }
 return null;
}
function setupUpdates(){
 ipcMain.handle("showpilot-update:status",()=>({channel:channel(),installedVersion:app.getVersion(),repository:"nyteghost/showpilot"}));
 ipcMain.handle("showpilot-update:channel",(_,value)=>({channel:setChannel(value)}));
 ipcMain.handle("showpilot-update:check",async()=>{
   const ch=channel(),found=await latest(ch);
   return {channel:ch,latest:found,message:found
    ? "Latest successful "+ch+" build found"+(found.temporary?" in the temporary legacy repository.":".")
    : ch==="main"?"No stable ShowPilot release is published yet. Try Beta.":"No accessible ShowPilot beta build found."};
 });
 ipcMain.handle("showpilot-update:open",async()=>{
   const found=await latest(channel());
   if(!found)throw new Error("No accessible build is available in this channel.");
   await shell.openExternal(found.url);
   return {opened:true,runId:found.runId,repository:found.repository};
 });
}
module.exports={setupUpdates};
