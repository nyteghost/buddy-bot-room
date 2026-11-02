export async function assistantApi(body?: unknown, query = "") {
  const r = await fetch(
    "/api/assistant" + query,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Assistant request failed");
  return d;
}
