/* Private installed-app Google Calendar integration.
 * Only this trusted Electron process can read encrypted OAuth credentials.
 * Renderer receives summaries/statuses; never credentials, tokens, arbitrary URLs or raw API access.
 */
'use strict';
const { app, ipcMain, safeStorage, shell } = require('electron');
const { createServer } = require('node:http');
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'showpilot-myshifts';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';
const ZONE = 'America/New_York';
const GOOGLE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const FAIL = (reason) => { throw new Error(reason); };
const FILE = () => path.join(app.getPath('userData'), 'showpilot-calendar-credentials.v1.json');
let connecting = false;
let syncing = false;

function secure() {
  if (!safeStorage.isEncryptionAvailable()) FAIL('Windows secure credential storage is unavailable. ShowPilot will not save Google tokens.');
}
function readSettings() {
  const file = FILE();
  try {
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || typeof raw.encrypted !== 'string') FAIL('Calendar credential file is invalid.');
    secure();
    const data = JSON.parse(safeStorage.decryptString(Buffer.from(raw.encrypted,'base64')));
    if (!data || typeof data !== 'object') FAIL('Invalid Calendar credentials.');
    return data;
  } catch (e) { FAIL('Unable to decrypt Google Calendar settings on this Windows user account. Reconnect Google Calendar.'); }
}
function writeSettings(data) {
  secure();
  const file=FILE();
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const encrypted=safeStorage.encryptString(JSON.stringify(data)).toString('base64');
  const temp=file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify({version:1,encrypted}),{encoding:'utf8',mode:0o600});
  fs.renameSync(temp,file);
}
function status() {
  try {
    const data=readSettings();
    return {available:safeStorage.isEncryptionAvailable(),configured:!!data.client_id,connected:!!data.refresh_token,connecting,syncing};
  } catch {return {available:false,configured:false,connected:false,connecting,syncing};}
}
function credentialFromJson(input) {
  if(typeof input!=='string'||input.length>12000)FAIL('Choose the downloaded Google Desktop OAuth JSON file (12 KB maximum).');
  let obj;
  try{obj=JSON.parse(input)}catch{FAIL('Invalid OAuth JSON file.')}
  const settings=obj && obj.installed;
  if(!settings||typeof settings.client_id!=='string'||!settings.client_id.endsWith('.apps.googleusercontent.com')
    ||settings.client_id.length>240)FAIL('Select a Google OAuth client of type Desktop app, not a web or service account key.');
  if(settings.client_secret!==undefined&&(typeof settings.client_secret!=='string'||settings.client_secret.length>512))FAIL('Invalid desktop OAuth client secret.');
  return {client_id:settings.client_id,client_secret:settings.client_secret||''};
}
function setClient(input) {
  if (connecting || syncing) FAIL('Finish the current Google Calendar operation first.');
  const creds=credentialFromJson(input);
  const current=readSettings();
  if(current.client_id===creds.client_id)writeSettings({...current,...creds});
  else writeSettings(creds); // Changing OAuth client must invalidate tokens.
  return status();
}
function disconnect() {
  if(connecting||syncing)FAIL('Finish the current Google Calendar operation first.');
  const current=readSettings();
  if(current.client_id)writeSettings({client_id:current.client_id,client_secret:current.client_secret||''});
  return status();
}
function forget() {
  if(connecting||syncing)FAIL('Finish the current Google Calendar operation first.');
  const f=FILE();
  if(fs.existsSync(f))fs.unlinkSync(f);
  return status();
}
async function tokenRequest(params) {
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams(params),signal:AbortSignal.timeout(18000),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||typeof data.access_token!=='string')FAIL('Google authorization failed (HTTP '+response.status+'). Check the OAuth client and account permissions.');
  return data;
}
async function connect() {
  if(connecting||syncing)FAIL('A Google Calendar operation is already in progress.');
  const settings=readSettings();
  if(!settings.client_id)FAIL('In Settings, first import a Google Desktop OAuth client JSON file.');
  secure();connecting=true;
  let server;
  try {
    const verifier=randomBytes(32).toString('base64url');
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    const state=randomBytes(24).toString('base64url');
    const codePromise=new Promise(async(resolve,reject)=>{
      server=createServer((req,res)=>{
        const url=new URL(req.url||'/', 'http://127.0.0.1');
        res.setHeader('Content-Type','text/html; charset=UTF-8');
        res.setHeader('Cache-Control','no-store');
        if(url.pathname!=='/showpilot-calendar') {res.writeHead(404);res.end('Not found');return}
        if(url.searchParams.get('state')!==state) {res.writeHead(403);res.end('Authorization state mismatch');return}
        const error=url.searchParams.get('error');
        const code=url.searchParams.get('code');
        if(error||!code){res.writeHead(400);res.end('Google Calendar authorization declined. Return to ShowPilot.');reject(new Error('Google sign-in was cancelled or declined.'));return}
        res.end('<!doctype html><html><body style="font:18px system-ui;padding:4rem"><h2>Google Calendar connected</h2><p>You can return to ShowPilot and close this tab.</p></body></html>');
        resolve(code);
      });
      server.once('error',reject);
      server.listen(0,'127.0.0.1',()=>{
        const port=server.address().port;
        const redirect='http://127.0.0.1:'+port+'/showpilot-calendar';
        const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
        for(const [k,v] of Object.entries({
          client_id:settings.client_id,redirect_uri:redirect,response_type:'code',scope:SCOPES,
          code_challenge:challenge,code_challenge_method:'S256',state,access_type:'offline',prompt:'consent',
        }))url.searchParams.set(k,v);
        shell.openExternal(url.toString()).catch(reject);
      });
    });
    const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('Google sign-in timed out. Try again.')),120000));
    const code=await Promise.race([codePromise,timeout]);
    const redirect='http://127.0.0.1:'+server.address().port+'/showpilot-calendar';
    const params={client_id:settings.client_id,code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'};
    if(settings.client_secret)params.client_secret=settings.client_secret;
    const token=await tokenRequest(params);
    const refresh=token.refresh_token||settings.refresh_token;
    if(!refresh)FAIL('Google did not issue an offline refresh token. Remove the previous grant and reconnect.');
    writeSettings({...settings,refresh_token:refresh});
    return status();
  } finally {
    if(server){try{server.close()}catch{}}
    connecting=false;
  }
}
async function accessToken(){
  const s=readSettings();
  if(!s.client_id||!s.refresh_token)FAIL('Connect Google Calendar in Settings before syncing.');
  const params={client_id:s.client_id,refresh_token:s.refresh_token,grant_type:'refresh_token'};
  if(s.client_secret)params.client_secret=s.client_secret;
  const res=await tokenRequest(params);
  return res.access_token;
}
async function callGoogle(method,url,token,data) {
  const response=await fetch(url,{
    method,
    headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},
    ...(data?{body:JSON.stringify(data)}:{}),
    signal:AbortSignal.timeout(20000),
  });
  if(!response.ok) {
    const hint=response.status===401?'Reconnect Google Calendar in Settings.':
      response.status===403?'Make sure Google Calendar API is enabled and the connected account can edit its primary calendar.':
      response.status===429?'Google rate limit hit; retry later.':'Retry or check Google account permissions.';
    FAIL('Google Calendar API returned HTTP '+response.status+'. '+hint);
  }
  return response.status===204?{}:response.json();
}
function isoDay(date) {
  const d=new Date(date+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==date)FAIL('Invalid shift date.');
  return d;
}
function localDateTime(date,minute){
  const d=isoDay(date);
  d.setUTCDate(d.getUTCDate()+Math.floor(minute/1440));
  const n=minute%1440;
  return d.toISOString().slice(0,10)+'T'+String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')+':00';
}
function validateSync(input) {
  if(!input||typeof input!=='object'||!Array.isArray(input.shifts)||input.shifts.length<1||input.shifts.length>200)
    FAIL('Select 1–200 shifts before updating Google Calendar.');
  if(typeof input.title!=='string'||input.title.trim().length<1||input.title.length>120)FAIL('Enter a short calendar title.');
  const seen=new Set();
  const shifts=input.shifts.map(s=>{
    if(!s||typeof s!=='object'||typeof s.id!=='string'||s.id.length>100||!(/^[a-zA-Z0-9_-]+$/).test(s.id)||
      typeof s.date!=='string'||!Number.isInteger(s.start)||!Number.isInteger(s.end)||
      s.start<0||s.start>=1440||s.end<=s.start||s.end>s.start+1440||
      typeof s.raw!=='string'||s.raw.length>160||typeof s.note!=='undefined'&&(typeof s.note!=='string'||s.note.length>300))
      FAIL('Invalid shift details. Check dates and start/end times.');
    isoDay(s.date);
    if(seen.has(s.id))FAIL('Two shifts have the same stable ID. Review duplicates before syncing.');
    seen.add(s.id);
    return {id:s.id,date:s.date,start:s.start,end:s.end,raw:s.raw,note:s.note||''};
  });
  return {title:input.title.trim(),shifts};
}
function calendarBody(s,title) {
  const d='Schedule: '+s.raw+(s.note?'\n'+s.note:'');
  return {
    summary:title,description:d,
    start:{dateTime:localDateTime(s.date,s.start),timeZone:ZONE},
    end:{dateTime:localDateTime(s.date,s.end),timeZone:ZONE},
    extendedProperties:{private:{showpilotSource:SOURCE,showpilotId:s.id,showpilotDate:s.date}},
  };
}
async function listManaged(token) {
  const events=[];let pageToken='';
  for(let i=0;i<20;i++){
    const url=new URL(GOOGLE);
    url.searchParams.set('privateExtendedProperty','showpilotSource='+SOURCE);
    url.searchParams.set('maxResults','250');
    if(pageToken)url.searchParams.set('pageToken',pageToken);
    const response=await callGoogle('GET',url.toString(),token);
    if(!Array.isArray(response.items))FAIL('Google Calendar returned an unexpected event listing.');
    events.push(...response.items.filter(e=>e&&typeof e.id==='string'&&e.extendedProperties?.private?.showpilotSource===SOURCE));
    pageToken=response.nextPageToken||'';
    if(!pageToken)return events;
  }
  FAIL('Too many previous ShowPilot events to safely reconcile. Contact support instead of creating duplicates.');
}
async function updateAll(payload) {
  if(syncing||connecting)FAIL('Another Google Calendar operation is in progress.');
  const {title,shifts}=validateSync(payload);
  syncing=true;
  let created=0,updated=0,failed=0;
  try{
    const token=await accessToken();
    const existing=await listManaged(token);
    const seenIds=new Set(), byId=new Map();
    for(const e of existing){const id=e.extendedProperties?.private?.showpilotId;if(typeof id==='string'&&!byId.has(id))byId.set(id,e)}
    const inputByDate=new Map();
    for(const s of shifts)inputByDate.set(s.date,(inputByDate.get(s.date)||0)+1);
    const savedByDate=new Map();
    for(const e of existing){const d=e.extendedProperties?.private?.showpilotDate;if(typeof d==='string'){if(!savedByDate.has(d))savedByDate.set(d,[]);savedByDate.get(d).push(e)}}
    const errors=[];
    for(const s of shifts) {
      try{
        let prior=byId.get(s.id);
        if(prior&&seenIds.has(prior.id))prior=null;
        // Date fallback only for an unambiguous single shift. Supports a new clock-in time
        // in a freshly re-imported weekly schedule without generating a duplicate.
        if(!prior&&inputByDate.get(s.date)===1){
          const matches=(savedByDate.get(s.date)||[]).filter(e=>!seenIds.has(e.id));
          if(matches.length===1)prior=matches[0];
        }
        const body=calendarBody(s,title);
        if(prior) {
          await callGoogle('PATCH',GOOGLE+'/'+encodeURIComponent(prior.id)+'?sendUpdates=none',token,body);
          updated++;seenIds.add(prior.id);
        }else{
          const made=await callGoogle('POST',GOOGLE+'?sendUpdates=none',token,body);
          created++;if(made.id)seenIds.add(made.id);
        }
      }catch(err){failed++;errors.push(s.date+': '+err.message);if(errors.length>=3)break;}
    }
    return {created,updated,failed,errors,remaining:shifts.length-created-updated-failed,
      message:'Google Calendar: '+created+' added, '+updated+' updated'+(failed?' · '+failed+' failed':'')+'. Existing events imported manually from .ics may still be duplicated. No events were deleted.'};
  } finally {syncing=false}
}
function setupGoogleCalendarIpc(){
  ipcMain.handle('showpilot-calendar:status',()=>status());
  ipcMain.handle('showpilot-calendar:save-client',(_,json)=>setClient(json));
  ipcMain.handle('showpilot-calendar:connect',()=>connect());
  ipcMain.handle('showpilot-calendar:disconnect',()=>disconnect());
  ipcMain.handle('showpilot-calendar:forget',()=>forget());
  ipcMain.handle('showpilot-calendar:update-all',(_,input)=>updateAll(input));
}
module.exports={setupGoogleCalendarIpc,credentialFromJson,validateSync,localDateTime,calendarBody};
