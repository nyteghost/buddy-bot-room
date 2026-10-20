import { logServer } from "./server-log.server";
import { TtlCache } from "./ttl-cache";
import { shapeWeather, type Units, type Weather } from "./weather";

/**
 * Weather from Open-Meteo (free, no key). Set WEATHER_LOCATION ("Atlanta, GA") or WEATHER_LAT and WEATHER_LON.
 * WEATHER_UNITS=metric for °C and km/h (default imperial). The place is only ever read from the server environment.
 */
const cache = new TtlCache<Weather>(20 * 60_000, 4);
let located: { key: string; lat: number; lon: number; name: string } | null = null;

const units = (): Units => ((process.env["WEATHER_UNITS"] ?? "").toLowerCase() === "metric" ? "metric" : "imperial");

async function locate(): Promise<{ lat: number; lon: number; name: string } | null> {
  const lat = Number(process.env["WEATHER_LAT"]);
  const lon = Number(process.env["WEATHER_LON"]);
  const name = (process.env["WEATHER_LOCATION"] ?? "").trim().slice(0, 80);
  if (process.env["WEATHER_LAT"] && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon, name: name || "Your location" };
  if (!name) return null;
  if (located?.key === name) return located;
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: name.split(",")[0] ?? name, count: "1", language: "en", format: "json" })}`, { signal: AbortSignal.timeout(8000) });
  const hit = ((await res.json()) as { results?: { latitude: number; longitude: number; name: string; admin1?: string }[] }).results?.[0];
  if (!hit) return null;
  located = { key: name, lat: hit.latitude, lon: hit.longitude, name: [hit.name, hit.admin1].filter(Boolean).join(", ") };
  return located;
}

export const weatherConfigured = (): boolean => !!(process.env["WEATHER_LOCATION"] || process.env["WEATHER_LAT"]);

export async function getWeather(): Promise<{ weather: Weather } | { error: string }> {
  if (!weatherConfigured()) return { error: "Set WEATHER_LOCATION (for example \"Atlanta, GA\") on the stack to see the weather." };
  const u = units();
  const hit = cache.get(u);
  if (hit) return { weather: hit };
  try {
    const where = await locate();
    if (!where) return { error: "I couldn't find that place. Try WEATHER_LOCATION=\"City, State\" or set WEATHER_LAT and WEATHER_LON." };
    const q = new URLSearchParams({
      latitude: String(where.lat), longitude: String(where.lon), timezone: "auto", forecast_days: "4",
      current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      temperature_unit: u === "imperial" ? "fahrenheit" : "celsius", wind_speed_unit: u === "imperial" ? "mph" : "kmh",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { error: `The weather service answered ${res.status}.` };
    const w = shapeWeather(await res.json(), where.name, u);
    if (!w) return { error: "The weather service sent something unexpected." };
    cache.set(u, w);
    return { weather: w };
  } catch (e) {
    logServer("warn", `Weather failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`);
    return { error: "Couldn't reach the weather service." };
  }
}

export async function handleWeather(): Promise<Response> {
  const r = await getWeather();
  return Response.json(r, { status: "error" in r ? 503 : 200 });
}
