import { expect, it } from "vitest";
import { shapeWeather, describeCode } from "@/lib/weather";
it("uses hourly temperatures from Open-Meteo without changing four-day summaries", () => {
 const json={
  current:{temperature_2m:72,apparent_temperature:74,weather_code:2,wind_speed_10m:5},
  daily:{time:["2026-10-31"],temperature_2m_max:[81],temperature_2m_min:[59],weather_code:[1],precipitation_probability_max:[20]},
  hourly:{time:["2026-10-31T07:00","2026-10-31T12:00","2026-10-31T18:00"],temperature_2m:[60.4,78.6,70.1],weather_code:[0,2,3],precipitation_probability:[0,5,40]}
 };
 const shaped=shapeWeather(json,"Atlanta, GA","imperial");
 expect(shaped?.days).toHaveLength(1);
 expect(shaped?.hours?.map(x=>x.temp)).toEqual([60,79,70]);
 expect(shaped?.hours?.[2]?.rain).toBe(40);
 expect(describeCode(shaped!.hours![1]!.code).text).toBe("Partly cloudy");
});
it("remains compatible with older API data that has no hourly values",()=>{
 const w=shapeWeather({current:{temperature_2m:30},daily:{time:["2026-11-01"]}},"Here","metric");
 expect(w?.hours).toEqual([]);
});
