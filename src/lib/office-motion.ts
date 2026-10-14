import type { AgentId } from "./agents";

type Point = readonly [number, number];
type Station = { home: Point; visit: Point; label: string; activity: string };

/** Shared floor routes for Linux and Assistant modes; percentages of the room. */
export const officeStations: Record<AgentId, Station> = {
  nova: { home: [26, 39], visit: [12, 46], label: "Gmail", activity: "Drafting mail" },
  byte: { home: [42, 39], visit: [44, 27], label: "Tasks", activity: "Reviewing tasks" },
  sage: { home: [58, 39], visit: [61, 27], label: "Calendar", activity: "Planning an event" },
  pip: { home: [73, 39], visit: [78, 51], label: "Notes", activity: "Writing notes" },
  echo: { home: [27, 77], visit: [12, 65], label: "Files", activity: "Reviewing files" },
  rune: { home: [51, 77], visit: [85, 45], label: "System", activity: "Reviewing stats" },
  claude: { home: [74, 77], visit: [87, 68], label: "Tux", activity: "Thinking through a fix" },
};

export function officePose(id: AgentId, index: number, elapsed: number) {
  const { home, visit } = officeStations[id];
  const aisle: Point = [home[0], home[1] < 50 ? 53 : 62];
  const corner: Point = [visit[0], aisle[1]];
  const points = [home, home, aisle, corner, visit, visit, corner, aisle, home, home];
  const durations = [6500, 2400, 3200, 2000, 4500, 2000, 3200, 2400, 5000];
  const period = durations.reduce((sum, value) => sum + value, 0);
  let phase = (elapsed + index * 4100) % period;
  for (let i = 0; i < durations.length; i++) {
    const duration = durations[i] ?? 1;
    const from = points[i] ?? home;
    const to = points[i + 1] ?? home;
    if (phase < duration) {
      const ratio = phase / duration;
      return {
        x: from[0] + (to[0] - from[0]) * ratio,
        y: from[1] + (to[1] - from[1]) * ratio,
        walking: from[0] !== to[0] || from[1] !== to[1],
        facingLeft: to[0] < from[0],
      };
    }
    phase -= duration;
  }
  return { x: home[0], y: home[1], walking: false, facingLeft: false };
}