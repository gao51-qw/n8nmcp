// Locale-agnostic FAQ metadata. The user-facing question, answer and
// category label live in the i18n dictionary (faqItems / faqCategories).
// Tags stay as English slugs — they're treated as universal keywords.

export type FaqCategoryKey =
  | "general"
  | "clients"
  | "security"
  | "pricing"
  | "selfHosting"
  | "openSource";

export const FAQ_CATEGORY_KEYS: FaqCategoryKey[] = [
  "general",
  "clients",
  "security",
  "pricing",
  "selfHosting",
  "openSource",
];

export type FaqMeta = {
  id: string;
  category: FaqCategoryKey;
  tags: string[];
};

export const FAQ_META: FaqMeta[] = [
  { id: "vs-mcp-node",      category: "general",     tags: ["gateway", "n8n", "mcp"] },
  { id: "supported-clients", category: "clients",     tags: ["claude", "chatgpt", "cursor", "vscode"] },
  { id: "api-key-safety",    category: "security",    tags: ["encryption", "api-key", "aes-256"] },
  { id: "paid-plan-needed",  category: "pricing",     tags: ["free", "quota"] },
  { id: "private-network",   category: "selfHosting", tags: ["tunnel", "cloudflare", "tailscale", "private-network"] },
  { id: "source-available",  category: "openSource",  tags: ["oss", "license", "spec"] },
];

export type LocalizedFaqItem = FaqMeta & {
  q: string;
  a: string;
  categoryLabel: string;
};

export type FaqDict = {
  faqCategories: Record<FaqCategoryKey, string>;
  faqItems: Record<string, { q: string; a: string }>;
};

export function getLocalizedFaq(t: FaqDict): LocalizedFaqItem[] {
  return FAQ_META.map((m) => {
    const item = t.faqItems[m.id];
    return {
      ...m,
      q: item?.q ?? m.id,
      a: item?.a ?? "",
      categoryLabel: t.faqCategories[m.category],
    };
  });
}

// Canonical English JSON-LD for SEO — search engines see one consistent
// FAQPage schema regardless of the visitor's UI locale.
import enDict from "@/i18n/locales/en";
export function buildFaqJsonLd() {
  const items = getLocalizedFaq(enDict as unknown as FaqDict);
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
