import type { AgentId } from "./agents";

type Point = readonly [number, number];
/** "away" = back row, seated facing the wall monitors; "toward" = front row, behind a desk facing the viewer. */
type Station = { home: Point; visit: Point; label: string; activity: string; facing: "away" | "toward" };

/** Shared floor routes for Linux and Assistant modes; percentages of the room. */
export const officeStations: Record<AgentId, Station> = {
  nova: { home: [26, 28.1], visit: [14, 41.1], label: "Gmail", activity: "Drafting mail", facing: "away" },
  byte: { home: [42.6, 28.1], visit: [34, 43.1], label: "Tasks", activity: "Reviewing tasks", facing: "away" },
  sage: { home: [59.2, 28.1], visit: [67, 43.1], label: "Calendar", activity: "Planning an event", facing: "away" },
  pip: { home: [75.2, 28.1], visit: [86, 41.1], label: "Notes", activity: "Writing notes", facing: "away" },
  echo: { home: [19, 55.9], visit: [28, 51.9], label: "Q&A", activity: "Researching an answer", facing: "toward" },
  rune: { home: [49, 55.9], visit: [58, 53.9], label: "System", activity: "Reviewing stats", facing: "toward" },
  claude: { home: [80, 55.9], visit: [88, 51.9], label: "Tux", activity: "Thinking through a fix", facing: "toward" },
};

export function officePose(id: AgentId, index: number, elapsed: number) {
  const { home, visit, facing } = officeStations[id];
  // Two lanes in the walkway, so the name tags above opposite rows never stack on one line.
  const aisle: Point = [home[0], facing === "away" ? 43 : 50.5];
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