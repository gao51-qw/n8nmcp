-- Tighten chat_messages INSERT RLS.
--
-- The original policy (20260509135916_*) only checked `user_id = auth.uid()`,
-- so an authenticated user who guessed/learned another user's conversation UUID
-- could insert rows referencing that conversation (the row still carried the
-- attacker's user_id). This binds inserts to a conversation the caller owns.

DROP POLICY IF EXISTS chat_msg_insert_own ON public.chat_messages;

CREATE POLICY chat_msg_insert_own ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.chat_conversations c
      WHERE c.id = chat_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );
