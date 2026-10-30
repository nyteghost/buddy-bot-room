const {ipcMain,shell,app}=require("electron");
const fs=require("node:fs");
const path=require("node:path");
const https=require("node:https");
const {spawn}=require("node:child_process");
const {randomBytes}=require("node:crypto");
const CHANNELS={main:"main",beta:"feat/showpilot-standalone"};
const API="https://api.github.com/repos/nyteghost/buddy-bot-room";
const MAX_BYTES=220*1024*1024;
function request(url,token,depth=0){
 return new Promise((resolve,reject)=>{
  if(depth>4)return reject(new Error("Too many redirects"));
  const u=new URL(url);
  if(u.protocol!=="https:"||!["api.github.com","github.com","objects.githubusercontent.com","release-assets.githubusercontent.com"].includes(u.hostname))return reject(new Error("Unexpected update host"));
  const req=https.get(u,{headers:{"User-Agent":"ShowPilot-Updater","Accept":url.includes("/artifacts/")?"application/vnd.github+json":"application/vnd.github+json",...(token?{"Authorization":"Bearer "+token}:{})},timeout:25000},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){res.resume();return request(new URL(res.headers.location,u).href,token,depth+1).then(resolve,reject)}
   const chunks=[];let n=0;res.on("data",c=>{n+=c.length;if(n>MAX_BYTES){req.destroy(new Error("Update download exceeds size limit"));return}chunks.push(c)});res.on("end",()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error("GitHub returned "+res.statusCode));resolve({buffer:Buffer.concat(chunks),type:res.headers["content-type"]||""})});
  });req.on("error",reject);req.on("timeout",()=>req.destroy(new Error("Update request timed out")));
 });
}
function stateFile(){return path.join(app.getPath("userData"),"showpilot-updates.json")}
function channel(){try{const v=JSON.parse(fs.readFileSync(stateFile(),"utf8")).channel;return CHANNELS[v]?v:"beta"}catch{return "beta"}}
function setChannel(value){if(!CHANNELS[value])throw new Error("Invalid channel");fs.mkdirSync(path.dirname(stateFile()),{recursive:true});fs.writeFileSync(stateFile(),JSON.stringify({channel:value}));return value}
async function latest(ch){
 const q=new URL(API+"/actions/workflows/showpilot.yml/runs");q.searchParams.set("branch",CHANNELS[ch]);q.searchParams.set("status","success");q.searchParams.set("per_page","5");
 const runs=JSON.parse((await request(q.href)).buffer.toString("utf8")).workflow_runs||[];
 if(!runs.length)return null;
 for(const run of runs){
  const arts=JSON.parse((await request(API+"/actions/runs/"+run.id+"/artifacts")).buffer.toString("utf8")).artifacts||[];
  const art=arts.find(a=>a.name==="showpilot-windows-portable"&&!a.expired);
  if(art)return {runId:run.id,sha:run.head_sha,channel:ch,created:run.created_at,url:run.html_url,artifactUrl:art.archive_download_url,artifactId:art.id};
 }
 return null;
}
function setupUpdates(){
 ipcMain.handle("showpilot-update:status",()=>({channel:channel(),installedVersion:app.getVersion(),portable:!app.isPackaged||process.platform==="win32"}));
 ipcMain.handle("showpilot-update:channel",(_e,value)=>({channel:setChannel(value)}));
 ipcMain.handle("showpilot-update:check",async()=>{
  const ch=channel();const found=await latest(ch);return {channel:ch,latest:found&&{runId:found.runId,sha:found.sha,created:found.created,url:found.url},message:found?"Latest successful "+ch+" build found.":"No published build found for "+ch+"."};
 });
 ipcMain.handle("showpilot-update:open",async()=>{
  const found=await latest(channel());if(!found)throw new Error("No successful build is available");
  // GitHub Actions artifacts require an authenticated GitHub session.
  // Open the verified run in the user's browser rather than embedding a
  // GitHub token in a distributed desktop app or downloading unverified ZIPs.
  await shell.openExternal(found.url);
  return {opened:true,runId:found.runId};
 });
}
module.exports={setupUpdates};
