-- chat_conversations
CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_conv_user ON public.chat_conversations(user_id, updated_at DESC);
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_conv_select_own ON public.chat_conversations FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY chat_conv_insert_own ON public.chat_conversations FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY chat_conv_update_own ON public.chat_conversations FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY chat_conv_delete_own ON public.chat_conversations FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER chat_conv_set_updated_at BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- chat_messages
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_msg_conv ON public.chat_messages(conversation_id, created_at);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_msg_select_own ON public.chat_messages FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY chat_msg_insert_own ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY chat_msg_delete_own ON public.chat_messages FOR DELETE TO authenticated USING (user_id = auth.uid());

-- prompt_usage_daily
CREATE TABLE public.prompt_usage_daily (
  user_id uuid NOT NULL,
  day date NOT NULL,
  prompts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.prompt_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY prompt_usage_select_own_or_admin ON public.prompt_usage_daily FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.get_today_prompt_usage(_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(prompts, 0) FROM public.prompt_usage_daily WHERE user_id = _user_id AND day = CURRENT_DATE;
$$;

CREATE OR REPLACE FUNCTION public.increment_prompt_usage(_user_id uuid, _n integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.prompt_usage_daily(user_id, day, prompts)
  VALUES (_user_id, CURRENT_DATE, GREATEST(_n, 0))
  ON CONFLICT (user_id, day)
  DO UPDATE SET prompts = prompt_usage_daily.prompts + GREATEST(_n, 0);
END $$;