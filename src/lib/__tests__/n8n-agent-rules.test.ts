import { describe, expect, it } from "vitest";
import { auditN8nAgentRules } from "../n8n-agent-rules";

describe("n8n agent rule hardening", () => {
  it("detects bracket and spaced runtime data references outside expression braces", () => {
    const audit = auditN8nAgentRules({
      nodes: [
        {
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          parameters: {},
        },
        {
          name: "Slack Alert",
          type: "n8n-nodes-base.slack",
          parameters: {
            bracket: "$['json'].email",
            spaced: "$ json.email",
          },
        },
      ],
    });

    expect(audit.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EXPRESSION_MISSING_BRACES",
          path: "node(Slack Alert).parameters.bracket",
        }),
        expect.objectContaining({
          code: "EXPRESSION_MISSING_BRACES",
          path: "node(Slack Alert).parameters.spaced",
        }),
      ]),
    );
  });

  it("scans alternate code-bearing parameter fields on Code nodes", () => {
    const audit = auditN8nAgentRules({
      nodes: [
        {
          name: "Legacy Code Field",
          type: "n8n-nodes-base.code",
          parameters: {
            functionCode: "const email = '{{$json.email}}';\nreturn { email };",
          },
        },
        {
          name: "Script Field",
          type: "n8n-nodes-base.code",
          parameters: {
            codeString: "const count = 1;",
          },
        },
      ],
    });

    expect(audit.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CODE_NODE_USES_EXPRESSIONS",
          path: "node(Legacy Code Field).parameters.functionCode",
        }),
        expect.objectContaining({
          code: "CODE_NODE_SUSPICIOUS_RETURN",
          path: "node(Legacy Code Field).parameters.functionCode",
        }),
        expect.objectContaining({
          code: "CODE_NODE_MISSING_RETURN",
          path: "node(Script Field).parameters.codeString",
        }),
      ]),
    );
  });

  it("flags unsafe Python standard-library imports while allowing common safe modules", () => {
    const unsafe = auditN8nAgentRules({
      nodes: [
        {
          name: "Unsafe Python",
          type: "n8n-nodes-base.code",
          parameters: {
            language: "python",
            pythonCode:
              "import json\nimport subprocess\nfrom pickle import loads\nreturn [{'json': {'ok': True}}]",
          },
        },
      ],
    });

    expect(unsafe.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PYTHON_EXTERNAL_IMPORT",
          message: expect.stringContaining("subprocess"),
        }),
        expect.objectContaining({
          code: "PYTHON_EXTERNAL_IMPORT",
          message: expect.stringContaining("pickle"),
        }),
      ]),
    );

    const safe = auditN8nAgentRules({
      nodes: [
        {
          name: "Safe Python",
          type: "n8n-nodes-base.code",
          parameters: {
            language: "python",
            pythonCode: "import json\nimport re\nimport math\nreturn [{'json': {'ok': True}}]",
          },
        },
      ],
    });

    expect(safe.warnings.filter((warning) => warning.code === "PYTHON_EXTERNAL_IMPORT")).toEqual(
      [],
    );
  });
});
