import { useEffect, useState } from "react";
import {
  BriefcaseBusiness, CalendarDays, CalendarClock, Layers3, Store, Map,
  LayoutDashboard, Menu, Moon, Sun, ChevronRight, ShieldCheck, PanelLeftClose, PanelLeftOpen
} from "lucide-react";
import { ShowServicesTools, type WorkTabId } from "@/components/work-tools";
import { BackupPanel } from "@/components/showpilot-backup";

type Screen = "dashboard" | WorkTabId;
const sections: { id: WorkTabId; label: string; desc: string; Icon: typeof CalendarDays; note: string }[] = [
  {id:"events",label:"Event Schedule",desc:"Import Ungerboeck reports, plan engineering coverage and export Excel",Icon:CalendarDays,note:"Reports & staffing"},
  {id:"shifts",label:"My Shifts",desc:"Read, edit and export your personal shifts to Google Calendar",Icon:CalendarClock,note:"Calendar tools"},
  {id:"deck",label:"Stage & Deck Planner",desc:"Plan stage sizes, configurations, stairs and inventory",Icon:Layers3,note:"Stage operations"},
  {id:"floor",label:"Floor Maps",desc:"Color booth utility locations and resolve work-order questions",Icon:Map,note:"Exhibitor utilities"},
  {id:"vendors",label:"Vendors",desc:"Manage and compare purchase and rental quotes",Icon:Store,note:"Purchasing & rentals"},
];

function saved(key:string,fallback:string) {
  try { return localStorage.getItem(key)??fallback; } catch { return fallback; }
}

export function App() {
  const [screen,setScreen] = useState<Screen>(()=>{
    const v=saved("showpilot:screen","dashboard");
    return v==="dashboard"||sections.some(s=>s.id===v)?v as Screen:"dashboard";
  });
  const [dark,setDark] = useState(()=>saved("showpilot:theme","light")==="dark");
  const [expanded,setExpanded] = useState(()=>saved("showpilot:sidebar","true")!=="false");
  const [mobileOpen,setMobileOpen] = useState(false);

  useEffect(()=>{
    document.documentElement.classList.toggle("dark",dark);
    try{localStorage.setItem("showpilot:theme",dark?"dark":"light")}catch{}
  },[dark]);
  useEffect(()=>{try{localStorage.setItem("showpilot:screen",screen)}catch{}},[screen]);
  useEffect(()=>{try{localStorage.setItem("showpilot:sidebar",String(expanded))}catch{}},[expanded]);

  const select=(next:Screen)=>{setScreen(next);setMobileOpen(false)};
  const current=sections.find(s=>s.id===screen);
  return <div className="sp-shell">
    {mobileOpen&&<button className="sp-backdrop" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>}
    <aside className={"sp-sidebar "+(expanded?"":"sp-collapsed ")+(mobileOpen?"sp-open":"")}>
      <div className="sp-brand">
        <span className="sp-logo"><BriefcaseBusiness size={23}/></span>
        {expanded&&<div><strong>ShowPilot</strong><small>OPERATIONS SUITE</small></div>}
      </div>
      <div className="sp-nav">
        {expanded&&<span className="sp-nav-label">WORKSPACE</span>}
        <button title="Dashboard" className={"sp-nav-item "+(screen==="dashboard"?"sp-selected":"")} onClick={()=>select("dashboard")}><LayoutDashboard size={19}/>{expanded&&<span>Dashboard</span>}</button>
        {sections.map(({id,label,Icon})=><button title={label} key={id} className={"sp-nav-item "+(screen===id?"sp-selected":"")} onClick={()=>select(id)}><Icon size={19}/>{expanded&&<span>{label}</span>}</button>)}
      </div>
      <div className="sp-sidebar-footer">
        {expanded&&<span>Cobb Convention Center-Atlanta</span>}
        <button className="sp-icon-button" onClick={()=>setExpanded(v=>!v)} title={expanded?"Collapse sidebar":"Expand sidebar"} aria-label={expanded?"Collapse sidebar":"Expand sidebar"}>
          {expanded?<PanelLeftClose size={18}/>:<PanelLeftOpen size={18}/>}
        </button>
      </div>
    </aside>
    <div className="sp-body">
      <header className="sp-header">
        <button className="sp-mobile-menu" onClick={()=>setMobileOpen(true)} aria-label="Open navigation"><Menu size={20}/></button>
        <div className="sp-breadcrumb">SHOWPILOT <ChevronRight size={14}/> {current?.label??"Dashboard"}</div>
        <div className="sp-header-actions">
          <span className="sp-local"><ShieldCheck size={15}/> Local workspace</span>
          <button className="sp-icon-button" onClick={()=>setDark(v=>!v)} aria-label={dark?"Use light theme":"Use dark theme"}>{dark?<Sun size={19}/>:<Moon size={19}/>}</button>
        </div>
      </header>
      <main className="sp-main">
        <div className="sp-page-head">
          <div><p className="sp-eyebrow">COBB CONVENTION CENTER-ATLANTA</p><h1>{current?.label??"Operations Overview"}</h1>
            <p className="sp-subtitle">{current?.desc??"Your venue operations tools, together in one workspace."}</p></div>
        </div>
        {screen==="dashboard"
          ? <div className="space-y-5">
              <div className="sp-banner"><BriefcaseBusiness size={26}/><div><h2>Welcome to ShowPilot</h2><p>Open a tool below to begin. Scheduling and reports run locally, with no uploaded report data sent to a server.</p></div></div>
              <div className="sp-cards">
                {sections.map(({id,label,desc,Icon,note})=><button className="sp-card" key={id} onClick={()=>select(id)}>
                  <div className="sp-card-top"><span className="sp-card-icon"><Icon size={21}/></span><ChevronRight size={17}/></div>
                  <strong>{label}</strong><p>{desc}</p><small>{note}</small>
                </button>)}
              </div>
              <BackupPanel />
              <div className="sp-note">Beta: event imports accept recognized convention-center spaces. Unknown rooms are held for manual review; CEPAC rows are excluded. Direct Google Calendar sync and automated online vendor refresh are not yet connected; .ics export and offline vendor quotes are available.</div>
            </div>
          : <section className="sp-panel"><ShowServicesTools selectedTab={screen} hideTabBar page venueOnly/></section>
        }
      </main>
      <footer className="sp-footer">ShowPilot · Cobb Convention Center-Atlanta · Beta workspace</footer>
    </div>
  </div>;
}
