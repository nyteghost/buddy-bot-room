import type {AiProviderId} from "@/lib/showpilot-ai-providers";
export type AiStatus = {available:boolean;providers:string[]};
export type AiTaskContext = {date:string;rooms:string[];events:{room:string;title:string;phase:string;time:string}[]};
export type AiRawResponse = {suggestions:unknown[]};
export interface ShowPilotAiBridge {
 status():Promise<AiStatus>;
 saveKey(provider:AiProviderId,key:string):Promise<AiStatus>;
 removeKey(provider:AiProviderId):Promise<AiStatus>;
 suggestTasks(provider:AiProviderId,context:AiTaskContext):Promise<AiRawResponse>;
}
declare global {interface Window {showpilotAI?:ShowPilotAiBridge}}
export {};
