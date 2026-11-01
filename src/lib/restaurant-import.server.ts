import { validMenuFood, type MenuFood } from "./restaurant-food";

function plain(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(amp|quot|apos|lt|gt|nbsp);/g,
      (_, k: string) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " })[k] ?? "",
    )
    .replace(/\s+/g, " ")
    .trim();
}
/** Bounded structured MenuItem data only. A page's unrelated nutrition cannot become a meal. */
export function extractMenuFoods(html: string, source: string): MenuFood[] {
  if (html.length > 1500000) return [];
  const result: MenuFood[] = [],
    seen = new Set<string>();
  let budget = 4000;
  const add = (raw: MenuFood) => {
    const food = validMenuFood(raw),
      key = `${raw.name}|${raw.serving}|${raw.nutrition}`;
    if (food && !seen.has(key) && result.length < 100) {
      seen.add(key);
      result.push(food);
    }
  };
  const visit = (v: unknown, depth = 0) => {
    if (--budget < 0 || depth > 12 || !v || typeof v !== "object" || result.length >= 100) return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>,
      types = Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]];
    if (types.some((t) => typeof t === "string" && /(?:^|[/#])MenuItem$/.test(t))) {
      const n = o["nutrition"];
      if (n && typeof n === "object" && !Array.isArray(n)) {
        const facts = n as Record<string, unknown>;
        // Numeric JSON values without units are deliberately not interpreted as kcal/grams.
        const nutrition = ["calories", "proteinContent", "carbohydrateContent", "fatContent"]
          .filter((k) => typeof facts[k] === "string")
          .map((k) => `${k}: ${plain(facts[k])}`)
          .join(" · ");
        if (nutrition)
          add({ name: plain(o["name"]), serving: plain(facts["servingSize"]), nutrition, source });
      }
    }
    for (const item of Object.values(o)) visit(item, depth + 1);
  };
  for (const m of html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    try {
      visit(JSON.parse(m[1]!));
    } catch {
      /* Other blocks may be usable. */
    }
    if (budget < 0) break;
  }
  // Static nutrition tables: headers must explicitly identify units; never guess column order.
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)) {
    if (budget < 0 || result.length >= 100) break;
    let headers: string[] | null = null;
    for (const row of table[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
      if (--budget < 0 || result.length >= 100) break;
      if (/\b(?:colspan|rowspan)\s*=/i.test(row[1]!)) {
        headers = null;
        continue;
      }
      const cells = [...row[1]!.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi)].map((m) =>
        plain(m[1]).toLowerCase(),
      );
      if (cells.some((c) => /^(?:item|menu item|name|food)$/.test(c))) {
        headers = cells;
        continue;
      }
      if (!headers || cells.length !== headers.length) continue;
      const original = [...row[1]!.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi)].map((m) =>
        plain(m[1]),
      );
      const name =
        original[headers.findIndex((c) => /^(?:item|menu item|name|food)$/.test(c))] ?? "";
      const facts: string[] = [];
      headers.forEach((h, i) => {
        const key = /^calories(?:\s*\(kcal\))?$/.test(h)
          ? "calories"
          : /^(?:protein|total protein)\s*\(g\)$/.test(h)
            ? "protein"
            : /^(?:carbs|carbohydrates|total carbohydrate[s]?)\s*\(g\)$/.test(h)
              ? "carbs"
              : /^(?:fat|total fat)\s*\(g\)$/.test(h)
                ? "fat"
                : "";
        if (key && /^\d+(?:\.\d+)?$/.test(cells[i]!))
          facts.push(`${key}: ${cells[i]} ${key === "calories" ? "kcal" : "g"}`);
      });
      if (facts.length)
        add({
          name,
          serving: original[headers.indexOf("serving size")] ?? "",
          nutrition: facts.join(" · "),
          source,
        });
    }
  }
  return result;
}
