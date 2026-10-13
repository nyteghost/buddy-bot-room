import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

const engineKinds = ["cloud", "local", "auto", "ollama"] as const;
const themes = ["normal", "hellraiser", "horror", "matrix", "finalfantasy", "devteam", "cyberpunk"] as const;
const modes = ["roundtable", "broadcast", "direct", "solve"] as const;

export const loadAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { decryptText } = await import("./settings-crypto.server");
    const { data: s, error } = await context.supabase
      .from("user_settings").select("*").eq("user_id", context.userId).maybeSingle();
    if (error) throw new Error("Could not load your settings.");
    const { data: rows, error: e2 } = await context.supabase
      .from("saved_discussions").select("*").order("updated_at", { ascending: false });
    if (e2) throw new Error("Could not load your saved discussions.");
    const safe = async (v: string | null) => { try { return v ? await decryptText(v) : ""; } catch { return ""; } };
    return {
      settings: s
        ? { engineKind: s.engine_kind, characterMode: s.character_mode, groqKey: await safe(s.groq_key_ciphertext), geminiKey: await safe(s.gemini_key_ciphertext), openrouterKey: await safe(s.openrouter_key_ciphertext) }
        : null,
      discussions: (rows ?? []).map((r) => ({
        id: r.id, title: r.title, messages: JSON.stringify(r.messages), theme: r.character_mode, mode: r.discussion_mode, updatedAt: r.updated_at,
      })),
    };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    engineKind: z.enum(engineKinds), characterMode: z.enum(themes),
    groqKey: z.string().max(500), geminiKey: z.string().max(500), openrouterKey: z.string().max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { encryptText } = await import("./settings-crypto.server");
    const { error } = await context.supabase.from("user_settings").upsert({
      user_id: context.userId,
      engine_kind: data.engineKind,
      character_mode: data.characterMode,
      groq_key_ciphertext: data.groqKey.trim() ? await encryptText(data.groqKey.trim()) : null,
      gemini_key_ciphertext: data.geminiKey.trim() ? await encryptText(data.geminiKey.trim()) : null,
      openrouter_key_ciphertext: data.openrouterKey.trim() ? await encryptText(data.openrouterKey.trim()) : null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Could not save your settings.");
    return { ok: true };
  });

export const saveCloudDiscussion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(), title: z.string().min(1).max(120), theme: z.enum(themes), mode: z.enum(modes),
    messages: z.array(z.any()).max(2000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("saved_discussions").upsert({
      id: data.id, user_id: context.userId, title: data.title, character_mode: data.theme,
      discussion_mode: data.mode, messages: data.messages as Json, updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Could not save this discussion to your account.");
    return { ok: true };
  });

export const deleteCloudDiscussion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("saved_discussions").delete().eq("id", data.id);
    if (error) throw new Error("Could not delete this discussion.");
    return { ok: true };
  });
