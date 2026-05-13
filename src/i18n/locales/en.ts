// Master English dictionary. All other locales must mirror this shape
// exactly — TypeScript enforces it via the `Dict` type in src/i18n/dict.ts.
const en = {
  nav: {
    features: "Features",
    diy: "vs DIY",
    architecture: "Architecture",
    pricing: "Pricing",
    docs: "Docs",
    blog: "Blog",
    community: "Community",
    faq: "FAQ",
    github: "GitHub",
    signIn: "Sign in",
    getStarted: "Get started",
    dashboard: "Dashboard",
    menu: "Menu",
    openMenu: "Open menu",
    language: "Language",
  },
  footer: {
    tagline: "Hosted MCP gateway for n8n. Plug your workflows into any AI client in seconds.",
    sections: {
      product: "Product",
      resources: "Resources",
      legal: "Legal",
    },
    links: {
      pricing: "Pricing",
      docs: "Docs",
      signIn: "Sign in",
      getStarted: "Get started",
      mcp: "MCP protocol",
      n8n: "n8n",
      github: "GitHub",
      starHistory: "Star history",
      status: "Status",
      terms: "Terms of Service",
      privacy: "Privacy Policy",
      cookies: "Cookies",
      imprint: "Imprint",
      contact: "Contact",
      termsShort: "Terms",
      privacyShort: "Privacy",
      support: "Support",
    },
    copyright: "n8n-mcp. Not affiliated with n8n GmbH.",
  },
  home: {
    hero: {
      badge: "Free to use",
      titleLineOne: "Plug your n8n workflows",
      titleLineTwo: "into any AI client",
      subtitle:
        "n8n-mcp turns your self-hosted n8n into a Model Context Protocol server. Connect Claude, ChatGPT, Cursor and any MCP-compatible client with one URL and one API key — no drag-and-drop required.",
      ctaPrimary: "Start for free",
      ctaSecondary: "Read the docs",
      compareWithDiy: "Compare with DIY",
      seeArchitecture: "See architecture",
    },
  },
} as const;

export default en;