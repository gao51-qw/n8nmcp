import type { Metadata } from "next";
import Link from "next/link";
import {
  AppWindow,
  BarChart3,
  Bot,
  CreditCard,
  Headphones,
  KeyRound,
  Server,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { dashboardMetadata } from "@/components/dashboard/page-metadata";
import { surfaceHref } from "@/lib/site-navigation";

export const metadata: Metadata = dashboardMetadata(
  "Dashboard",
  "Manage your n8n instances, MCP access and usage.",
);

type DashboardModule = {
  title: string;
  text: string;
  icon: React.ReactNode;
  href: string;
};

const modules: DashboardModule[] = [
  {
    title: "Instances",
    text: "Connect your n8n instances and choose which one MCP clients work with.",
    icon: <Server className="h-5 w-5" aria-hidden="true" />,
    href: "/dashboard/instances",
  },
  {
    title: "API keys",
    text: "Create a key for each MCP client and revoke it when you no longer need it.",
    icon: <KeyRound className="h-5 w-5" aria-hidden="true" />,
    href: "/dashboard/api-keys",
  },
  {
    title: "Connected apps",
    text: "See which apps you approved through OAuth and disconnect them.",
    icon: <AppWindow className="h-5 w-5" aria-hidden="true" />,
    href: "/dashboard/connected-apps",
  },
  {
    title: "Usage",
    text: "Check today's MCP calls against your plan's daily limit and review recent calls.",
    icon: <BarChart3 className="h-5 w-5" aria-hidden="true" />,
    href: "/dashboard/usage",
  },
  {
    title: "Agent Console",
    text: "Review workflow changes proposed by your AI agent, then apply or roll them back.",
    icon: <Bot className="h-5 w-5" aria-hidden="true" />,
    href: "/dashboard/agent-console",
  },
  {
    title: "Billing",
    text: "See your plan and manage your subscription.",
    icon: <CreditCard className="h-5 w-5" aria-hidden="true" />,
    href: "/dashboard/billing",
  },
  {
    title: "Account",
    text: "Your sign-in details and account deletion.",
    icon: <UserRound className="h-5 w-5" aria-hidden="true" />,
    href: "/dashboard/account",
  },
  {
    title: "Support",
    text: "Follow up on your support requests and reply to the team.",
    icon: <Headphones className="h-5 w-5" aria-hidden="true" />,
    href: "/dashboard/support",
  },
];

const cardClass =
  "group flex h-full flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ModuleCard({ module }: { module: DashboardModule }) {
  return (
    <Link href={module.href} className={cardClass}>
      <span className="flex items-center gap-2 text-sm font-semibold text-primary">
        {module.icon}
        <span className="underline-offset-4 group-hover:underline">{module.title}</span>
      </span>
      <span className="mt-3 text-sm leading-6 text-muted-foreground">{module.text}</span>
    </Link>
  );
}

export default function DashboardPage() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-6 py-12 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-bold">Dashboard</h1>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">
          Connect your n8n instances, give your AI clients access through MCP and keep an eye on
          what they do.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          {/* The security model lives on the docs host, so this is a plain cross-surface link. */}
          <a
            href={surfaceHref("docs", "/security")}
            className="inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:underline"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            How we keep your keys and instances safe
          </a>
        </p>
      </div>
      {/* Eight modules: 1, 2 or 4 per row, so every row is full at every width. */}
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {modules.map((module) => (
          <li key={module.title}>
            <ModuleCard module={module} />
          </li>
        ))}
      </ul>
    </main>
  );
}
