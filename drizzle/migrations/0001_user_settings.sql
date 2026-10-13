CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY,
  engine_kind text NOT NULL DEFAULT 'lovable',
  character_mode text NOT NULL DEFAULT 'normal',
  groq_key_ciphertext text,
  gemini_key_ciphertext text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings select" ON public.user_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own settings insert" ON public.user_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own settings update" ON public.user_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own settings delete" ON public.user_settings FOR DELETE TO authenticated USING (auth.uid() = user_id);