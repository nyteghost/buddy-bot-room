ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS openrouter_key_ciphertext text;
UPDATE public.user_settings SET engine_kind = 'cloud' WHERE engine_kind <> 'local';
ALTER TABLE public.user_settings ALTER COLUMN engine_kind SET DEFAULT 'cloud';