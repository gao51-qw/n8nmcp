const DEFAULT_SITE_CONTACT_EMAIL = "server@n8nworkflow.com";

export const SITE_CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_SECURITY_EMAIL?.trim() || DEFAULT_SITE_CONTACT_EMAIL;

export const SITE_CONTACT_MAILTO = `mailto:${SITE_CONTACT_EMAIL}`;
