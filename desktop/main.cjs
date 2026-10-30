const {app,BrowserWindow,shell} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { setupAiIpc } = require("./ai-vault.cjs");
const { setupGoogleCalendarIpc } = require("./google-calendar.cjs");
const { setupUpdates } = require("./app-updates.cjs");
let win;
function openApp(){
 win=new BrowserWindow({
  title:"ShowPilot - Cobb Convention Center-Atlanta",
  width:1360,height:860,minWidth:820,minHeight:580,
  backgroundColor:"#142338",
  icon:path.join(__dirname,"showpilot.png"),
  show:false,
  webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,preload:path.join(__dirname,"preload.cjs")}
 });
 win.once("ready-to-show",()=>win.show());
 const file=path.join(__dirname,"..","dist","index.html");
 if(!fs.existsSync(file))throw new Error("Missing bundled ShowPilot app files");
 win.loadFile(file);
 // External calendar/vendor links open in the default browser, never inside the privileged app.
 win.webContents.setWindowOpenHandler(({url})=>{
  try{const u=new URL(url);if(u.protocol==="https:"||u.protocol==="http:")void shell.openExternal(url)}
  catch{}
  return {action:"deny"};
 });
 win.webContents.on("will-navigate",(event,url)=>{
  if(!url.startsWith("file://")){event.preventDefault();try{const u=new URL(url);if(u.protocol==="https:"||u.protocol==="http:")void shell.openExternal(url)}catch{}}
 });
 win.on("closed",()=>{win=null});
}
app.whenReady().then(()=>{setupAiIpc();setupGoogleCalendarIpc();openApp();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)openApp()})});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});
