const {ipcMain, safeStorage, app} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const PROVIDERS = new Set(["openai","anthropic","google","openrouter","groq","xai","deepseek","mistral","perplexity"]);
const ENABLED = new Set(["openai","anthropic","google"]);
const KEY_FILE = () => path.join(app.getPath("userData"),"showpilot-ai-keys.v1.json");
const failure = (message) => { throw new Error(message); };
function vault() {
  try {
    const file=KEY_FILE();
    if(!fs.existsSync(file))return {};
    const data=JSON.parse(fs.readFileSync(file,"utf8"));
    if(!data || typeof data!=="object" || Array.isArray(data))return {};
    return Object.fromEntries(Object.entries(data).filter(([id,encoded])=>PROVIDERS.has(id)&&typeof encoded==="string"));
  } catch { return failure("Could not read encrypted AI credentials."); }
}
function store(items) {
  const loc=KEY_FILE();const dir=path.dirname(loc);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const tmp=loc+".tmp";
  fs.writeFileSync(tmp,JSON.stringify(items),{encoding:"utf8",mode:0o600});
  fs.renameSync(tmp,loc);
}
function requireStorage() {
  if(!safeStorage.isEncryptionAvailable())failure("Secure OS credential encryption is unavailable. API key was NOT saved.");
}
function status() {
  return {available:safeStorage.isEncryptionAvailable(),providers:Object.keys(vault())};
}
function readKey(provider) {
  if(!PROVIDERS.has(provider))failure("Unknown AI provider.");
  requireStorage();
  const val=vault()[provider];
  if(!val)failure("Connect the provider in Settings first.");
  return safeStorage.decryptString(Buffer.from(val,"base64"));
}
function textFromResponse(json,provider) {
  if(provider==="openai") {
    if(typeof json.output_text==="string")return json.output_text;
    return (json.output||[]).flatMap(x=>(x.content||[]).filter(y=>y.type==="output_text").map(y=>y.text||"")).join("\n");
  }
  if(provider==="anthropic")return (json.content||[]).filter(x=>x.type==="text").map(x=>x.text).join("\n");
  if(provider==="google")return (json.candidates||[]).flatMap(x=>x.content?.parts||[]).map(x=>x.text||"").join("\n");
  return "";
}
const removeFence = (s) => {const fence=String.fromCharCode(96).repeat(3);let out=s.trim();if(out.startsWith(fence)){out=out.slice(3).replace(/^json/i,"").trim();if(out.endsWith(fence))out=out.slice(0,-3).trim();}return out;};
async function suggest(provider,context) {
  if(!ENABLED.has(provider))failure("This provider's online task integration is not available yet.");
  if(!context || typeof context!=="object" || typeof context.date!=="string" ||
     !/^\d{4}-\d{2}-\d{2}$/.test(context.date) || !Array.isArray(context.events) || context.events.length>35 ||
     !Array.isArray(context.rooms) || context.rooms.length>20)failure("Invalid AI task context.");
  const events=context.events.map(e => {
    if(!e||typeof e!=="object"||typeof e.room!=="string"||typeof e.title!=="string"||
       typeof e.phase!=="string"||typeof e.time!=="string"||e.room.length>80||e.title.length>180||e.time.length>30)
       failure("Invalid AI event entry.");
    if(/cepac|cobb energy|performing arts/i.test(e.room))failure("Another venue may not be sent to AI.");
    return {room:e.room,title:e.title,phase:e.phase,time:e.time};
  });
  const rooms=context.rooms.filter(r=>typeof r==="string"&&r.length<=80&& !/cepac|cobb energy|performing arts/i.test(r)).slice(0,20);
  if(!rooms.length||!events.length)failure("Select a date containing convention center events.");
  const prompt=JSON.stringify({date:context.date,rooms,events},null,2);
  const system="You are an engineering TASK SUGGESTION assistant for Cobb Convention Center-Atlanta, NOT Cobb Energy Performing Arts Centre. Use ONLY supplied event facts. Never fabricate air-wall positions, stage sizes, room-release times, staff assignments or required work. Propose up to five actionable stage/room-turn/air-wall preparation checks, not staffing assignments. All uncertain work must explicitly say VERIFY or CONFIRM. Reply ONLY strict JSON with a suggestions array of {date,room,section,task,reason,evidence}; each room must exactly match the input; section must be HALLS or BALLROOM; evidence must quote input facts. Exclude meeting rooms and other venues.";
  let url,headers,body;const key=readKey(provider);
  if(provider==="openai"){
    url="https://api.openai.com/v1/responses";
    headers={"content-type":"application/json","authorization":"Bearer "+key};
    body={model:"gpt-4.1-mini",instructions:system,input:prompt,max_output_tokens:1100};
  }else if(provider==="anthropic"){
    url="https://api.anthropic.com/v1/messages";
    headers={"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"};
    body={model:"claude-sonnet-4-5",max_tokens:1100,system,messages:[{role:"user",content:prompt}]};
  }else {
    url="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
    headers={"content-type":"application/json","x-goog-api-key":key};
    body={systemInstruction:{parts:[{text:system}]},contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:1400,responseMimeType:"application/json"}};
  }
  const resp=await fetch(url,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  if(!resp.ok)failure("AI provider request failed (HTTP "+resp.status+"). Check API key, account permissions and model access.");
  const raw=await resp.text();
  if(raw.length>120_000)failure("AI response was too large.");
  const s=textFromResponse(JSON.parse(raw),provider);
  let val;
  try{val=JSON.parse(removeFence(s));}catch{failure("AI returned unexpected output. No tasks were applied.");}
  if(!val||!Array.isArray(val.suggestions))failure("AI returned an invalid task list.");
  return {suggestions:val.suggestions};
}
function setupAiIpc() {
  ipcMain.handle("showpilot-ai:status",()=>status());
  ipcMain.handle("showpilot-ai:save",(_,provider,key)=>{
    if(!PROVIDERS.has(provider)||typeof key!=="string"||key.length<12||key.length>500||/\s/.test(key))failure("Select a provider and enter a valid-looking key.");
    requireStorage();const v=vault();v[provider]=safeStorage.encryptString(key).toString("base64");store(v);
    return status();
  });
  ipcMain.handle("showpilot-ai:remove",(_,provider)=>{
    if(!PROVIDERS.has(provider))failure("Unknown AI provider.");
    const v=vault();delete v[provider];store(v);return status();
  });
  ipcMain.handle("showpilot-ai:suggest",(_,provider,context)=>suggest(provider,context));
}
module.exports={setupAiIpc};
