import type { Shift } from "@/lib/work-tools";
export type GoogleCalendarStatus = {
  available: boolean; configured: boolean; connected: boolean; connecting: boolean; syncing: boolean;
};
export type GoogleCalendarSyncResult = {
  created: number; updated: number; failed: number; remaining: number; errors: string[]; message: string;
};
export interface ShowPilotCalendarBridge {
  status(): Promise<GoogleCalendarStatus>;
  saveClient(json: string): Promise<GoogleCalendarStatus>;
  connect(): Promise<GoogleCalendarStatus>;
  disconnect(): Promise<GoogleCalendarStatus>;
  forget(): Promise<GoogleCalendarStatus>;
  updateAll(payload: {title:string;shifts:Shift[]}): Promise<GoogleCalendarSyncResult>;
}
declare global {
  interface Window {showpilotCalendar?: ShowPilotCalendarBridge}
}
export {};
