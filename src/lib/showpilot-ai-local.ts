import { taskContext, TASK_SYSTEM_PROMPT, validateTaskResponse, type AiTaskInput } from "./showpilot-ai-tasks";

type Engine = Awaited<ReturnType<typeof import("@mlc-ai/web-llm")["CreateWebWorkerMLCEngine"]>>;
let engine:Engine|null=null;
let loading:Promise<Engine>|null=null;
let worker:Worker|null=null;
let loadedModel="";
export async function gpuAvailable():Promise<boolean>{
 try{
  const nav=navigator as Navigator & {gpu?:{requestAdapter:()=>Promise<unknown>}};
  return Boolean(nav.gpu&&await nav.gpu.requestAdapter());
 }catch{return false}
}
export async function localModelOptions() {
 const webllm=await import("@mlc-ai/web-llm");
 const models=webllm.prebuiltAppConfig.model_list.map(m=>m.model_id);
 const preferred=["Qwen2.5-1.5B-Instruct-q4f16_1-MLC","Llama-3.2-1B-Instruct-q4f16_1-MLC"];
 const short=models.filter(m=>/Qwen2.*0\.5B|Qwen2.*1\.5B|Llama-3\.2-1B|SmolLM.*1\.7B/i.test(m)&&/q4/i.test(m));
 return [...new Set([...preferred.filter(m=>models.includes(m)),...short])].slice(0,10);
}
export async function loadLocalModel(model:string,onProgress:(message:string)=>void):Promise<void> {
 if(engine&&loadedModel===model)return;
 if(loading) {await loading;if(loadedModel===model)return;}
 if(!await gpuAvailable())throw new Error("No supported WebGPU adapter found. Offline rule-based tasks remain available.");
 const webllm=await import("@mlc-ai/web-llm");
 if(!webllm.prebuiltAppConfig.model_list.some(x=>x.model_id===model))throw new Error("This model is not part of the supported local model list.");
 if(engine){await engine.unload();engine=null;}
 if(worker){worker.terminate();worker=null;}
 worker=new Worker(new URL("./showpilot-ai-worker.ts",import.meta.url),{type:"module"});
 const current=worker;
 loading=webllm.CreateWebWorkerMLCEngine(current,model,{initProgressCallback:(p)=>onProgress(p.text||"Loading model...")});
 try{engine=await loading;loadedModel=model;onProgress("Local AI ready. Cached models can be used offline.");}
 catch(err){current.terminate();if(worker===current)worker=null;throw err}
 finally{loading=null}
}
export async function runLocalTaskAI(input:AiTaskInput,model:string,onProgress:(message:string)=>void){
 await loadLocalModel(model,onProgress);
 const context=taskContext(input);
 onProgress("Generating suggestions on this computer's GPU...");
 const completion=await engine!.chat.completions.create({
  messages:[{role:"system",content:TASK_SYSTEM_PROMPT},{role:"user",content:JSON.stringify(context)}],
  response_format:{type:"json_object"},temperature:0.2,max_tokens:900,
 });
 const text=completion.choices[0]?.message?.content??"";
 if(typeof text!=="string")throw new Error("Local model did not return text.");
 let result:unknown;
 try{result=JSON.parse(text.replace(/^```(?:json)?\s*/,"").replace(/\s*```$/,""));}catch{throw new Error("Local model produced malformed JSON; no tasks were added.");}
 return validateTaskResponse(result,context,"local");
}
