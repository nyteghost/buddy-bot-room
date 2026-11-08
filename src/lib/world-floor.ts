import type { CharacterMode } from "./hellraiser";
import type { Heading } from "./office-motion";

/**
 * Living World floor plans, calibrated against each theme backdrop (1536×864 art shown at the
 * Pal Room's 1.72 aspect ratio). Every coordinate is a FOOT position in percent of the scene:
 * characters are drawn with their feet on this point, so collision matches the art at any width.
 * Obstacles are the floor footprint of furniture, not its silhouette.
 */
export type WorldPoint = Readonly<{x:number;y:number}>;
export type WorldObstacle = Readonly<{x1:number;y1:number;x2:number;y2:number;label:string}>;
export type WorldBounds = Readonly<{x1:number;y1:number;x2:number;y2:number}>;
export const WORLD_FIXTURE_KINDS = ["screen","lamp","flame","crystal","portal","loot","potion","holo","puzzle","candle","board","steam","rack","sky","phone","tv","table"] as const;
export type WorldFixtureKind = typeof WORLD_FIXTURE_KINDS[number];
/** A piece of furniture a character can walk up to and use. `glow` is the art position that lights up. */
export type WorldFixture = Readonly<{id:string;label:string;kind:WorldFixtureKind;glow:WorldPoint;stand:WorldPoint;facing:Heading}>;
export type WorldRoomPlan = Readonly<{bounds:WorldBounds;obstacles:readonly WorldObstacle[];homes:readonly WorldPoint[];visits:readonly WorldPoint[];fixtures:readonly WorldFixture[];
 /** Optional start spots for imported visitors (also wander stops), to spread a full room. */
 entries?:readonly WorldPoint[]}>;

/** Scene height divided by width (.window-room .room-scene uses aspect-ratio 1.72). */
export const WORLD_SCENE_ASPECT = 1 / 1.72;
export const WORLD_GRID_STEP = 3;
/** Collision margin around furniture, in percent. */
export const WORLD_OBSTACLE_MARGIN = 1;

const p=(x:number,y:number):WorldPoint=>({x,y});
const r=(x1:number,y1:number,x2:number,y2:number,label:string):WorldObstacle=>({x1,y1,x2,y2,label});
const f=(id:string,label:string,kind:WorldFixtureKind,glow:WorldPoint,stand:WorldPoint,facing:Heading):WorldFixture=>({id,label,kind,glow,stand,facing});

/** Common room (pixel-room.jpg) and the Cenobite chamber share one layout. */
const commonRoom=(fixtures:readonly WorldFixture[],extra:readonly WorldObstacle[]=[]):WorldRoomPlan=>({
 bounds:{x1:12,y1:35,x2:87,y2:86},
 obstacles:[r(34,38,66,59,"discussion table"),r(37,58,44,70,"front left stool"),r(56,58,63,70,"front right stool"),r(85,35,100,64,"window bench"),...extra],
 homes:[p(21,41),p(30,35),p(69,35),p(78,41),p(21,77),p(36,80),p(63,80),p(78,77),p(51,83)],
 visits:[p(27,62),p(27,47),p(75,47),p(72,62),p(18,56),p(51,74),p(42,77),p(60,74),p(81,71)],
 fixtures,
});
const plans:Record<CharacterMode,WorldRoomPlan>={
 normal:commonRoom([
  f("terminals","wall terminals","screen",p(50,11),p(51,35),"n"),
  f("left-shelf","left bookshelf","lamp",p(23,20),p(24,38),"n"),
  f("right-shelf","right bookshelf","lamp",p(80,25),p(78,38),"n"),
  f("table","discussion table","table",p(50,49),p(51,71),"n"),
  f("table-west","table end","table",p(37,50),p(30,50),"e"),
 ]),
 hellraiser:commonRoom([
  f("puzzle-box","puzzle box","puzzle",p(50,47),p(51,71),"n"),
  f("candles","candle bench","candle",p(93,50),p(81,59),"e"),
  f("left-shelf","bone shelf","candle",p(24,20),p(24,38),"n"),
  f("pillars","rune pillars","flame",p(50,20),p(51,35),"n"),
 ],[r(0,50,10,70,"left cabinet")]),
 horror:{
  // x2 reaches the visible floor right of the front armchair (beside the TV): a third pocket for crowds.
  bounds:{x1:20,y1:49,x2:96,y2:95},
  obstacles:[r(0,30,24,72,"fireplace"),r(25,44,37,70,"back left armchair"),r(59,44,71,68,"back right armchair"),
   r(9,56,37,100,"front left armchair"),r(62,56,89,100,"front right armchair"),r(30,56,66,86,"seance table"),r(86,48,100,72,"television")],
  homes:[p(41,52),p(53,52),p(77,52),p(83,52),p(44,89),p(56,89),p(50,92),p(47,52),p(74,52)],
  // Each visit stays in its Pal home's pocket; back-row visits sit at y 49 so they are not on top of a Pal home.
  visits:[p(56,49),p(41,49),p(83,49),p(74,49),p(53,92),p(41,89),p(59,92),p(50,49),p(80,49)],
  // Imported visitors start spread over all four separate floor pockets (incl. right of the front armchair),
  // so a full room does not pile up behind the armchairs.
  entries:[p(41,89),p(92,79),p(59,92),p(95,88),p(74,49),p(50,49),p(92,94)],
  fixtures:[
   f("ouija","ouija board","candle",p(48,60),p(47,52),"s"),
   f("tv","static television","tv",p(92,45),p(83,52),"e"),
   f("window","moonlit window","sky",p(56,20),p(53,52),"n"),
   f("pedestal","seance table","flame",p(50,58),p(50,89),"n"),
  ],
 },
 matrix:{
  bounds:{x1:12,y1:39,x2:89,y2:92},
  obstacles:[r(44,41,56,48,"back armchair"),r(23,44,36,58,"left armchair"),r(64,44,76,58,"right armchair"),r(40,50,60,64,"console table"),
   r(26,62,39,81,"front left armchair"),r(61,62,74,81,"front right armchair"),r(0,25,11,50,"phone booth"),r(86,25,100,48,"service counter")],
  homes:[p(18,42),p(36,39),p(63,39),p(81,51),p(18,66),p(42,84),p(57,84),p(81,69),p(51,90)],
  visits:[p(30,63),p(18,54),p(81,60),p(78,66),p(21,78),p(51,69),p(45,75),p(57,72),p(84,84)],
  fixtures:[
   f("left-console","code console","screen",p(33,28),p(33,39),"n"),
   f("right-console","code console","screen",p(67,28),p(66,39),"n"),
   f("phone","phone booth","phone",p(6,28),p(15,48),"w"),
   f("table","console table","screen",p(50,56),p(51,66),"n"),
   f("counter","service counter","steam",p(93,24),p(84,51),"n"),
  ],
 },
 finalfantasy:{
  bounds:{x1:12,y1:41,x2:88,y2:81},
  obstacles:[r(35,46,64,72,"compass dais"),r(0,40,12,58,"left couch"),r(15,33,22,47,"left planter"),r(78,33,85,47,"right planter"),
   r(86,40,100,60,"right lounge"),r(16,77,22,100,"left lantern"),r(78,77,84,100,"right lantern")],
  homes:[p(27,44),p(42,41),p(57,41),p(72,44),p(24,74),p(39,77),p(60,77),p(75,74),p(51,80)],
  visits:[p(27,59),p(18,62),p(75,56),p(72,65),p(30,71),p(48,77),p(66,71),p(81,68),p(84,62)],
  fixtures:[
   f("crystal","great crystal","crystal",p(50,16),p(51,44),"n"),
   f("left-armor","armor stand","lamp",p(30,24),p(30,44),"n"),
   f("right-armor","armor stand","lamp",p(70,24),p(69,44),"n"),
   f("dais","compass dais","crystal",p(50,58),p(51,77),"n"),
   f("left-window","sky window","sky",p(8,20),p(15,62),"w"),
  ],
 },
 cyberpunk:{
  bounds:{x1:12,y1:53,x2:87,y2:90},
  obstacles:[r(36,52,63,70,"holo table"),r(0,44,19,67,"lounge"),r(10,35,35,54,"left workstations"),r(66,35,90,57,"right workstations"),
   r(88,25,100,64,"server wall"),r(0,72,9,100,"left console"),r(85,72,100,100,"crate stack")],
  homes:[p(24,56),p(27,62),p(69,59),p(78,62),p(21,78),p(36,84),p(63,84),p(78,78),p(51,87)],
  visits:[p(30,69),p(21,66),p(66,74),p(72,66),p(15,84),p(51,75),p(42,78),p(60,78),p(81,84)],
  fixtures:[
   f("holo","holo city","holo",p(50,50),p(51,75),"n"),
   f("left-terminals","netrunner terminals","screen",p(20,38),p(24,56),"n"),
   f("right-terminals","netrunner terminals","screen",p(77,38),p(78,59),"n"),
   f("server-wall","server wall","rack",p(95,42),p(84,66),"e"),
  ],
 },
 dcc:{
  bounds:{x1:14,y1:50,x2:88,y2:90},
  obstacles:[r(0,46,21,67,"loot chests"),r(64,46,90,62,"stairwell pool"),r(31,55,58,71,"round table"),r(27,62,35,79,"left stools"),
   r(48,72,55,81,"front stool"),r(56,64,62,74,"right stool"),r(0,69,16,100,"map crate"),r(83,73,100,100,"supply crate"),
   r(90,36,100,72,"potion rack"),r(86,58,93,67,"barrel")],
  homes:[p(26,50),p(41,50),p(56,50),p(23,65),p(20,86),p(38,86),p(62,86),p(77,80),p(71,65)],
  visits:[p(23,77),p(44,77),p(62,62),p(80,65),p(32,86),p(59,83),p(68,74),p(50,86),p(26,53)],
  fixtures:[
   f("potions","potion shelf","potion",p(29,32),p(29,50),"n"),
   f("chests","loot chests","loot",p(12,53),p(23,59),"w"),
   f("stairwell","stairwell portal","portal",p(76,48),p(77,65),"n"),
   f("lantern","table lantern","flame",p(44,52),p(62,59),"w"),
   f("torch","wall torch","flame",p(37,29),p(41,50),"n"),
  ],
 },
 devteam:{
  bounds:{x1:10,y1:46,x2:91,y2:52},
  obstacles:[r(15,52,37,100,"left desk"),r(40,52,62,100,"center desk"),r(64,52,87,100,"right desk")],
  homes:[p(13,46),p(22,49),p(31,46),p(43,49),p(52,46),p(61,49),p(70,46),p(79,49),p(88,46)],
  visits:[p(28,52),p(40,46),p(55,49),p(64,46),p(73,52),p(85,52),p(19,46),p(46,52),p(10,52)],
  fixtures:[
   f("kanban","sprint board","board",p(50,12),p(52,46),"n"),
   f("server-rack","server rack","rack",p(81,12),p(82,46),"n"),
   f("coffee","coffee machine","steam",p(6,27),p(13,46),"n"),
   f("window","harbour window","sky",p(95,20),p(91,49),"e"),
  ],
 },
 linux:{
  bounds:{x1:9,y1:43,x2:86,y2:57},
  obstacles:[r(84,30,100,57,"lounge couch")],
  homes:[p(12,46),p(21,49),p(33,46),p(45,52),p(54,46),p(63,52),p(72,46),p(81,49),p(39,55)],
  visits:[p(27,55),p(42,46),p(57,55),p(66,49),p(75,55),p(15,55),p(48,49),p(30,49),p(81,55)],
  fixtures:[
   f("whiteboard","whiteboard","board",p(34,8),p(33,43),"n"),
   f("coffee","coffee machine","steam",p(7,17),p(12,43),"n"),
   f("server-rack","server rack","rack",p(72,10),p(72,43),"n"),
   f("lounge","lounge lamp","lamp",p(98,32),p(81,52),"e"),
  ],
 },
 assistant:{bounds:{x1:0,y1:0,x2:0,y2:0},obstacles:[],homes:[],visits:[],fixtures:[]},
};
plans.assistant=plans.linux;

type Grid=Readonly<{plan:WorldRoomPlan;width:number;height:number;blocked:Uint8Array}>;
const grids=new Map<CharacterMode,Grid>();
const inObstacle=(point:WorldPoint,plan:WorldRoomPlan)=>plan.obstacles.some(o=>
 point.x>=o.x1-WORLD_OBSTACLE_MARGIN&&point.x<=o.x2+WORLD_OBSTACLE_MARGIN&&point.y>=o.y1-WORLD_OBSTACLE_MARGIN&&point.y<=o.y2+WORLD_OBSTACLE_MARGIN);
const outside=(point:WorldPoint,b:WorldBounds)=>point.x<b.x1||point.y<b.y1||point.x>b.x2||point.y>b.y2;
function gridOf(theme:CharacterMode):Grid{
 const found=grids.get(theme);if(found)return found;
 const plan=plans[theme]??plans.normal;
 const width=Math.floor((plan.bounds.x2-plan.bounds.x1)/WORLD_GRID_STEP)+1,height=Math.floor((plan.bounds.y2-plan.bounds.y1)/WORLD_GRID_STEP)+1;
 const blocked=new Uint8Array(width*height);
 for(let row=0;row<height;row++)for(let col=0;col<width;col++){
  const point=p(plan.bounds.x1+col*WORLD_GRID_STEP,plan.bounds.y1+row*WORLD_GRID_STEP);
  blocked[row*width+col]=outside(point,plan.bounds)||inObstacle(point,plan)?1:0;
 }
 const grid={plan,width,height,blocked};grids.set(theme,grid);return grid;
}
export function worldRoomPlan(theme:CharacterMode):WorldRoomPlan{return gridOf(theme).plan;}
/**
 * Register an extra floor plan under a key no room theme uses (prototypes such as the Living Universe HD camera lab).
 * Existing themes cannot be replaced, so the app's rooms are never affected.
 */
export function worldRegisterLabPlan(key:string,plan:WorldRoomPlan):CharacterMode{
 if(!/^lab-[a-z0-9-]{1,32}$/.test(key))throw new Error("Lab plan keys start with lab-");
 const table=plans as Record<string,WorldRoomPlan>;
 table[key]=plan;grids.delete(key as CharacterMode);
 return key as CharacterMode;
}
export function worldPointIsWalkable(point:WorldPoint,theme:CharacterMode):boolean{
 const plan=worldRoomPlan(theme);
 return Number.isFinite(point.x)&&Number.isFinite(point.y)&&!outside(point,plan.bounds)&&!inObstacle(point,plan);
}
const pointOf=(g:Grid,id:number)=>p(g.plan.bounds.x1+(id%g.width)*WORLD_GRID_STEP,g.plan.bounds.y1+Math.floor(id/g.width)*WORLD_GRID_STEP);
/** Nearest walkable grid cell (Euclidean), so a requested spot never resolves into furniture. */
function nearestFree(g:Grid,target:WorldPoint):number{
 let best=-1,bestDistance=Infinity;
 for(let id=0;id<g.blocked.length;id++){
  if(g.blocked[id])continue;
  const q=pointOf(g,id),distance=Math.hypot(q.x-target.x,q.y-target.y);
  if(distance<bestDistance-1e-9){bestDistance=distance;best=id;}
 }
 return best;
}
/** The grid point a character actually stands on when sent to `target`. */
export function worldSnap(target:WorldPoint,theme:CharacterMode):WorldPoint|null{
 const g=gridOf(theme),id=nearestFree(g,target);
 return id<0?null:pointOf(g,id);
}
const STEPS=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]] as const;
/**
 * A* eight-direction foot path on the theme grid; diagonal moves cannot cut furniture corners. Empty when unreachable.
 * `avoid` marks extra temporarily blocked cells (other characters) for crowd detours; the goal cell is never avoided.
 */
export function worldPath(from:WorldPoint,to:WorldPoint,theme:CharacterMode,avoid?:(point:WorldPoint)=>boolean):WorldPoint[]{
 const g=gridOf(theme),start=nearestFree(g,from),end=nearestFree(g,to);
 if(start<0||end<0)return [];
 if(start===end)return [pointOf(g,start)];
 const size=g.width*g.height,open=new Set<number>([start]),prev=new Int32Array(size).fill(-1),cost=new Float64Array(size).fill(Infinity),score=new Float64Array(size).fill(Infinity);
 const ec=end%g.width,er=Math.floor(end/g.width),guess=(id:number)=>Math.hypot(id%g.width-ec,Math.floor(id/g.width)-er);
 cost[start]=0;score[start]=guess(start);
 while(open.size){
  let current=-1,min=Infinity;
  for(const id of open)if(score[id]!<min){min=score[id]!;current=id;}
  if(current===end){
   const found:WorldPoint[]=[];
   for(let at=current;at!==-1;at=prev[at]!)found.unshift(pointOf(g,at));
   return found;
  }
  open.delete(current);
  const c=current%g.width,row=Math.floor(current/g.width);
  for(const [dc,dr] of STEPS){
   const nc=c+dc,nr=row+dr;
   if(nc<0||nr<0||nc>=g.width||nr>=g.height||g.blocked[nr*g.width+nc])continue;
   if(avoid&&nr*g.width+nc!==end&&avoid(pointOf(g,nr*g.width+nc)))continue;
   if(dc&&dr&&(g.blocked[row*g.width+nc]||g.blocked[nr*g.width+c]))continue;
   const next=nr*g.width+nc,total=cost[current]!+(dc&&dr?Math.SQRT2:1);
   if(total<cost[next]!){prev[next]=current;cost[next]=total;score[next]=total+guess(next);open.add(next);}
  }
 }
 return [];
}
/** Exact test (Liang–Barsky) of whether segment a→b touches a closed rectangle. */
function segmentTouches(a:WorldPoint,b:WorldPoint,x1:number,y1:number,x2:number,y2:number):boolean{
 let t0=0,t1=1;const dx=b.x-a.x,dy=b.y-a.y;
 for(const [pq,q] of [[-dx,a.x-x1],[dx,x2-a.x],[-dy,a.y-y1],[dy,y2-a.y]] as const){
  if(pq===0){if(q<0)return false;continue;}
  const t=q/pq;
  if(pq<0){if(t>t1)return false;if(t>t0)t0=t;}else{if(t<t0)return false;if(t<t1)t1=t;}
 }
 return t0<=t1;
}
/** True when a straight walk between two points stays on open floor (exact, including the furniture margin). */
export function worldSegmentClear(a:WorldPoint,b:WorldPoint,theme:CharacterMode):boolean{
 const plan=worldRoomPlan(theme),m=WORLD_OBSTACLE_MARGIN;
 if(!worldPointIsWalkable(a,theme)||!worldPointIsWalkable(b,theme))return false;
 return !plan.obstacles.some(o=>segmentTouches(a,b,o.x1-m,o.y1-m,o.x2+m,o.y2+m));
}
/** String-pull a grid path into long straight strides so walkers don't zig-zag between headings. */
export function worldSmoothPath(path:readonly WorldPoint[],theme:CharacterMode):WorldPoint[]{
 if(path.length<3)return [...path];
 const out=[path[0]!];
 for(let anchor=0;anchor<path.length-1;){
  let next=path.length-1;
  while(next>anchor+1&&!worldSegmentClear(path[anchor]!,path[next]!,theme))next--;
  out.push(path[next]!);anchor=next;
 }
 return out;
}
/** Distance as it looks on screen, in percent of scene width (vertical percentages are shorter). */
export const worldScreenDistance=(a:WorldPoint,b:WorldPoint)=>Math.hypot(b.x-a.x,(b.y-a.y)*WORLD_SCENE_ASPECT);
const HEADINGS:Heading[]=["e","se","s","sw","w","nw","n","ne"];
/** Eight-way facing for a move as it appears on screen. */
export function worldHeadingOf(dx:number,dy:number):Heading{
 if(!dx&&!dy)return "s";
 const turn=Math.atan2(dy*WORLD_SCENE_ASPECT,dx)/(Math.PI/4);
 return HEADINGS[((Math.round(turn)%8)+8)%8]??"s";
}
/** Stacking order from the feet: characters further down the floor draw in front. Range 10..110. */
export const worldDepthZ=(y:number)=>10+Math.round(Math.max(0,Math.min(100,Number.isFinite(y)?y:50)));
/** Gentle perspective shared by every backdrop: feet at the back wall (35%) draw 14% smaller than at the front (88%). */
export function worldDepthScale(y:number):number{
 const t=Math.max(0,Math.min(1,((Number.isFinite(y)?y:88)-35)/53));
 return Math.round((0.86+0.14*t)*1000)/1000;
}
