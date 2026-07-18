import { describe, expect, it } from "vitest";
import {
  buildTemplateSearchQuery,
  extractIntentProfile,
  rankWorkflowTemplateCandidates,
  type TemplateCandidate,
} from "./template-recommender";

const candidates: TemplateCandidate[] = [
  {
    id: 1,
    name: "Daily Amazon Ads spend to Google Sheets and Slack",
    description: "Fetch Amazon Ads campaign spend, append rows to Google Sheets, notify Slack.",
    categories_json: JSON.stringify(["Marketing", "Reporting"]),
    node_types_json: JSON.stringify([
      "scheduleTrigger",
      "httpRequest",
      "googleSheets",
      "slack",
    ]),
    views: 300,
    node_count: 4,
    source_url: "https://example.com/templates/1",
  },
  {
    id: 2,
    name: "Shopify order Slack alert",
    description: "Send a Slack alert for new Shopify orders.",
    categories_json: JSON.stringify(["Sales"]),
    node_types_json: JSON.stringify(["shopifyTrigger", "slack"]),
    views: 900,
    node_count: 2,
    source_url: "https://example.com/templates/2",
  },
  {
    id: 3,
    name: "Generic HTTP to spreadsheet",
    description: "Fetch an HTTP API and write rows to a spreadsheet.",
    categories_json: JSON.stringify(["Utility"]),
    node_types_json: JSON.stringify(["manualTrigger", "httpRequest", "googleSheets"]),
    views: 1200,
    node_count: 3,
    source_url: "https://example.com/templates/3",
  },
];

describe("template recommender", () => {
  it("extracts a lightweight structured profile from user intent", () => {
    const profile = extractIntentProfile(
      "每天获取 Amazon Ads campaign spend 写入 Google Sheets，然后 Slack 通知团队",
    );

    expect(profile).toEqual({
      normalizedIntent:
        "每天获取 amazon ads campaign spend 写入 google sheets，然后 slack 通知团队",
      systems: ["Amazon Ads", "Google Sheets", "Slack"],
      domains: ["advertising", "notifications"],
      nodeTypes: ["scheduleTrigger", "httpRequest", "googleSheets", "slack"],
      triggerTypes: ["schedule"],
      patternTypes: ["http_api_integration", "scheduled_task"],
      keywords: [
        "amazon",
        "ads",
        "campaign",
        "spend",
        "google",
        "sheets",
        "slack",
      ],
    });
  });

  it("builds a compact FTS query from intent profile", () => {
    const profile = extractIntentProfile("daily Amazon Ads spend to Google Sheets and Slack");

    expect(buildTemplateSearchQuery(profile)).toBe(
      "Amazon Ads Google Sheets Slack advertising notifications http_api_integration scheduled_task scheduleTrigger httpRequest googleSheets slack amazon ads campaign spend google sheets",
    );
  });

  it("ranks templates by system, node type, domain, keyword, and popularity matches", () => {
    const profile = extractIntentProfile(
      "每天获取 Amazon Ads campaign spend 写入 Google Sheets，然后 Slack 通知团队",
    );

    const ranked = rankWorkflowTemplateCandidates(profile, candidates, 2);

    expect(ranked).toEqual([
      expect.objectContaining({
        id: 1,
        name: "Daily Amazon Ads spend to Google Sheets and Slack",
        score: expect.any(Number),
        matchedSystems: ["Amazon Ads", "Google Sheets", "Slack"],
        matchedNodeTypes: ["scheduleTrigger", "httpRequest", "googleSheets", "slack"],
        matchedPatternTypes: ["http_api_integration", "scheduled_task"],
        reasons: expect.arrayContaining([
          "Matches systems: Amazon Ads, Google Sheets, Slack",
          "Matches required node types: scheduleTrigger, httpRequest, googleSheets, slack",
          "Matches workflow pattern: http_api_integration, scheduled_task",
        ]),
      }),
      expect.objectContaining({
        id: 3,
        name: "Generic HTTP to spreadsheet",
        matchedSystems: ["Google Sheets"],
        matchedNodeTypes: ["httpRequest", "googleSheets"],
      }),
    ]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("uses workflow pattern matches to prefer structurally similar templates", () => {
    const profile = extractIntentProfile("webhook 接收 Shopify order 然后通知 Slack");
    const ranked = rankWorkflowTemplateCandidates(profile, candidates, 2);

    expect(profile.patternTypes).toEqual(["webhook_processing"]);
    expect(ranked[0]).toEqual(
      expect.objectContaining({
        id: 2,
        matchedPatternTypes: ["webhook_processing"],
      }),
    );
  });
});
