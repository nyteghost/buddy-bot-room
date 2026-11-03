export function transcriptMoments(text: string) {
  const lines = text.split("\n");
  return lines.flatMap((line, index) => {
    const m =
      /^\[(\d{2}):([0-5]\d):([0-5]\d)(\.\d{1,3})?\s*-\s*(\d{2}):([0-5]\d):([0-5]\d)(\.\d{1,3})?\]\s*(.*)$/.exec(
        line,
      );
    if (!m) return [];
    const start = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4] ?? 0);
    const end = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8] ?? 0);
    if (end < start || end > 43200) return [];
    return [{ line: index, start, end, label: line.slice(1, line.indexOf("]")), text: m[9] ?? "" }];
  });
}
export function assignMomentSpeaker(text: string, line: number, name: string): string {
  const moment = transcriptMoments(text).find((m) => m.line === line);
  if (!moment) return text;
  const clean = name
    .replace(/[\r\n[\]:]/g, " ")
    .trim()
    .slice(0, 60);
  if (!clean) return text;
  const lines = text.split("\n");
  const original = lines[line]!;
  const speech = moment.text.replace(/^\{Speaker: [^}]*\}\s*/, "");
  lines[line] =
    original.slice(0, original.indexOf("]") + 1) +
    " {Speaker: " +
    clean.replace(/[{}]/g, "") +
    "} " +
    speech;
  return lines.join("\n");
}
