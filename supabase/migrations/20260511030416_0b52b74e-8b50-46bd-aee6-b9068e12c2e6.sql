
ALTER TABLE public.subscriptions RENAME COLUMN stripe_customer_id TO billing_customer_id;
ALTER TABLE public.subscriptions RENAME COLUMN stripe_subscription_id TO billing_subscription_id;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS billing_provider text NOT NULL DEFAULT 'paddle';
CREATE INDEX IF NOT EXISTS subscriptions_billing_subscription_id_idx ON public.subscriptions(billing_subscription_id);
