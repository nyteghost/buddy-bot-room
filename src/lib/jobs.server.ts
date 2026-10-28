import { createJobRunner, type JobRunner } from "./job-runner";
import { logServer } from "./server-log.server";

const holder = globalThis as unknown as { __buddyJobs?: JobRunner };
/** The one job runner for this server process (survives hot reloads). Overlap, timeout and failure events go to the server log. */
export const jobs = (): JobRunner => (holder.__buddyJobs ??= createJobRunner((level, text) => logServer(level, text)));
