/** Pure helpers for the weather view (Open-Meteo data). */
export type Units = "imperial" | "metric";
export type Weather = {
  place: string;
  units: Units;
  now: { temp: number; feels: number; code: number; wind: number };
  days: { date: string; hi: number; lo: number; code: number; rain: number }[];
};

const CODES: [number[], string, string][] = [
  [[0], "Clear", "☀️"], [[1], "Mostly clear", "🌤️"], [[2], "Partly cloudy", "⛅"], [[3], "Overcast", "☁️"],
  [[45, 48], "Fog", "🌫️"], [[51, 53, 55, 56, 57], "Drizzle", "🌦️"], [[61, 63, 65, 66, 67, 80, 81, 82], "Rain", "🌧️"],
  [[71, 73, 75, 77, 85, 86], "Snow", "🌨️"], [[95, 96, 99], "Thunderstorms", "⛈️"],
];
export function describeCode(code: number): { text: string; icon: string } {
  const hit = CODES.find(([codes]) => codes.includes(code));
  return { text: hit?.[1] ?? "Unsettled", icon: hit?.[2] ?? "🌡️" };
}

export const unitSymbols = (u: Units) => ({ temp: u === "imperial" ? "°F" : "°C", wind: u === "imperial" ? "mph" : "km/h" });

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);

export function shapeWeather(json: unknown, place: string, units: Units): Weather | null {
  const j = json as { current?: Record<string, unknown>; daily?: Record<string, unknown[]> } | null;
  const c = j?.current;
  const d = j?.daily;
  if (!c || !d || !Array.isArray(d["time"])) return null;
  const days = (d["time"] as string[]).slice(0, 4).map((date, i) => ({
    date: String(date),
    hi: num(d["temperature_2m_max"]?.[i]), lo: num(d["temperature_2m_min"]?.[i]), code: num(d["weather_code"]?.[i]), rain: num(d["precipitation_probability_max"]?.[i]),
  }));
  return { place: place.slice(0, 60), units, now: { temp: num(c["temperature_2m"]), feels: num(c["apparent_temperature"]), code: num(c["weather_code"]), wind: num(c["wind_speed_10m"]) }, days };
}

/** One line for the brief and chat: "Rain, 54°F (feels 51°F). Today 58°/47°, 70% chance of rain." */
export function weatherLine(w: Weather): string {
  const s = unitSymbols(w.units);
  const today = w.days[0];
  const rain = today && today.rain >= 30 ? `, ${today.rain}% chance of rain` : "";
  return `${describeCode(w.now.code).text}, ${w.now.temp}${s.temp} (feels ${w.now.feels}${s.temp}).${today ? ` Today ${today.hi}°/${today.lo}°${rain}.` : ""}`;
}

export function weatherText(w: Weather): string {
  const s = unitSymbols(w.units);
  const names = (date: string, i: number) => (i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }));
  return [`${describeCode(w.now.code).icon} ${w.place}: ${w.now.temp}${s.temp}, ${describeCode(w.now.code).text.toLowerCase()}, wind ${w.now.wind} ${s.wind}.`, ...w.days.map((d, i) => `${names(d.date, i)}: ${describeCode(d.code).icon} ${d.hi}°/${d.lo}°${d.rain >= 30 ? `, ${d.rain}% rain` : ""}`)].join("\n");
}
