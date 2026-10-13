CREATE TABLE public.saved_discussions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 title text NOT NULL DEFAULT 'Untitled discussion',
 messages jsonb NOT NULL DEFAULT '[]'::jsonb,
 character_mode text NOT NULL DEFAULT 'normal',
 discussion_mode text NOT NULL DEFAULT 'roundtable',
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_discussions TO authenticated;
GRANT ALL ON public.saved_discussions TO service_role;
ALTER TABLE public.saved_discussions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read discussions" ON public.saved_discussions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners create discussions" ON public.saved_discussions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners update discussions" ON public.saved_discussions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners delete discussions" ON public.saved_discussions FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX saved_discussions_owner_updated ON public.saved_discussions(user_id, updated_at DESC);