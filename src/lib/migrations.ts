import type { Migration } from "./migrate";

/**
 * The migrations that exist. Add new ones at the END with the next number; never edit or renumber a released one.
 * Each lists the keys (file names on the server, localStorage keys in the browser) it may change, so they can be restored on failure.
 */
export const SERVER_VERSION_FILE = "data-version.json";
export const CLIENT_VERSION_KEY = "pixel-pals-config-version";

export const serverMigrations: Migration[] = [
  // 1: baseline. Existing installs are stamped as "version 1" so later migrations know what they are starting from. Changes no data.
  { id: 1, name: "baseline", keys: [], up: () => undefined },
];

export const clientMigrations: Migration[] = [
  { id: 1, name: "baseline", keys: [], up: () => undefined },
];
