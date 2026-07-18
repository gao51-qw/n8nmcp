/**
 * 复合工具（Orchestrated Tools）定义
 *
 * 这些工具将多个原子操作组合成一个高级功能，
 * 极大简化用户体验（从 5 步变 1 步）
 */

export const orchestratedTools = [
  // ============================================
  // 1. 创建定时工作流（最高频需求）
  // ============================================
  {
    name: "create_scheduled_workflow",
    description: `Create a complete scheduled workflow in one step. Combines scheduleTrigger + action nodes + activation.

Popular use cases:
- Daily reports at 9 AM
- Hourly data sync
- Weekly cleanup tasks
- Monthly invoicing

Example: "Create a workflow that sends me a daily summary email at 8 AM"`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: 'Workflow name (e.g., "Daily Sales Report")',
        },
        schedule: {
          type: "string",
          description:
            'Cron expression (e.g., "0 9 * * *" for 9 AM daily) or human-readable like "every day at 9am"',
        },
        action: {
          type: "string",
          enum: ["send_email", "http_request", "slack_message"],
          description: "What action to perform on schedule",
        },
        actionConfig: {
          type: "object",
          description: "Configuration for the action (recipient, URL, query, etc.)",
        },
        activate: {
          type: "boolean",
          description:
            "Deployment intent for a later gated activation; creation itself remains inactive.",
          default: true,
        },
      },
      required: ["name", "schedule", "action", "actionConfig"],
    },
    annotations: {
      readOnly: false,
      riskLevel: "low",
      category: "orchestrated",
      estimatedSteps: 5,
      popularity: "very-high",
    },
  },

  // ============================================
  // 2. 创建 Webhook 工作流（最流行！）
  // ============================================
  {
    name: "create_webhook_workflow",
    description: `Create a webhook-triggered workflow with automatic response handling. Most popular workflow type!

The workflow includes:
- Webhook trigger node (generates URL)
- Optional data transformation
- Response node (sends JSON back)

Perfect for:
- REST API endpoints
- Webhook receivers (GitHub, Stripe, etc.)
- Form submissions
- External integrations

Example: "Create a webhook that receives user data and stores it in a database"`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: 'Workflow name (e.g., "User Registration API")',
        },
        path: {
          type: "string",
          description: 'Webhook path (e.g., "/api/register"). Leave empty for auto-generated.',
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
          description: "HTTP method to accept",
          default: "POST",
        },
        processing: {
          type: "array",
          items: {
            type: "object",
            required: ["action", "config"],
            properties: {
              action: {
                type: "string",
                enum: ["transform", "validate"],
                description: "Processing step type",
              },
              config: {
                type: "object",
                description: "Configuration for this step",
              },
            },
          },
          description: "Processing steps to apply to webhook data",
        },
        responseTemplate: {
          type: "object",
          description: 'JSON response template (e.g., {"success": true, "message": "..."})',
        },
        activate: {
          type: "boolean",
          description:
            "Deployment intent for a later gated activation; creation itself remains inactive.",
          default: true,
        },
      },
      required: ["name"],
    },
    annotations: {
      readOnly: false,
      riskLevel: "low",
      category: "orchestrated",
      estimatedSteps: 4,
      popularity: "very-high",
    },
  },

  // ============================================
  // 3. 创建 AI 聊天机器人工作流
  // ============================================
  {
    name: "create_ai_chatbot_workflow",
    description: `Create an AI chatbot workflow with human handoff capability. One of the most requested templates in 2026!

Features:
- AI responds to common questions
- Escalates complex queries to humans
- Prevents simultaneous AI/human responses
- Tracks conversation context

Use cases:
- Customer support automation
- FAQ chatbot
- Lead qualification
- Internal help desk

Example: "Create a chatbot that answers product questions and escalates to support if needed"`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Chatbot workflow name",
        },
        interface: {
          type: "string",
          enum: ["webhook", "slack"],
          description: "Where the chatbot operates",
        },
        aiProvider: {
          type: "string",
          enum: ["openai"],
          description: "AI model provider",
          default: "openai",
        },
        aiConfig: {
          type: "object",
          required: ["model"],
          properties: {
            model: {
              type: "string",
              description: "Explicit provider model name",
            },
            credentialId: {
              type: "string",
              description: "n8n credential ID required for OpenAI-backed nodes",
            },
            credentialName: {
              type: "string",
              description: "n8n credential name required for OpenAI-backed nodes",
            },
            systemPrompt: {
              type: "string",
              description: "AI personality and instructions",
            },
            temperature: {
              type: "number",
              minimum: 0,
              maximum: 2,
            },
            maxTokens: {
              type: "integer",
              minimum: 1,
            },
          },
        },
        interfaceConfig: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Webhook path when interface is webhook",
            },
            humanEmail: {
              type: "string",
              description: "Email address for human handoff notifications",
            },
            humanEmailCredentials: {
              type: "object",
              required: ["smtp"],
              additionalProperties: false,
              description: "Structured n8n email credential references for human handoff",
              properties: {
                smtp: {
                  type: "object",
                  required: ["id", "name"],
                  additionalProperties: false,
                  properties: {
                    id: { type: "string", minLength: 1 },
                    name: { type: "string", minLength: 1 },
                  },
                },
              },
            },
          },
        },
        features: {
          type: "object",
          properties: {
            humanHandoff: { type: "boolean" },
            sentimentAnalysis: { type: "boolean" },
          },
        },
        activate: {
          type: "boolean",
          description:
            "Deployment intent for a later gated activation; creation itself remains inactive.",
          default: true,
        },
      },
      required: ["name", "interface", "aiConfig"],
      allOf: [
        {
          if: {
            anyOf: [
              { properties: { aiProvider: { const: "openai" } } },
              {
                required: ["features"],
                properties: {
                  features: {
                    required: ["sentimentAnalysis"],
                    properties: { sentimentAnalysis: { const: true } },
                  },
                },
              },
            ],
          },
          then: {
            properties: {
              aiConfig: { required: ["model", "credentialId", "credentialName"] },
            },
          },
        },
        {
          if: {
            required: ["features"],
            properties: {
              features: {
                required: ["humanHandoff"],
                properties: { humanHandoff: { const: true } },
              },
            },
          },
          then: {
            required: ["interfaceConfig"],
            properties: {
              interfaceConfig: {
                required: ["humanEmail", "humanEmailCredentials"],
              },
            },
          },
        },
      ],
    },
    annotations: {
      readOnly: false,
      riskLevel: "medium",
      category: "orchestrated",
      estimatedSteps: 8,
      popularity: "very-high",
    },
  },

  // ============================================
  // 4. 部署和测试工作流
  // ============================================
  {
    name: "deploy_and_test_workflow",
    description: `Deploy a workflow and automatically test it with sample data. Ensures production readiness!

This tool:
1. Validates workflow configuration
2. Activates the workflow
3. Runs test execution with sample data
4. Verifies the output
5. Returns deployment status + test results

Perfect for:
- Pre-production checks
- CI/CD integration
- Ensuring workflow reliability
- Quick smoke tests

Example: "Deploy this workflow and test it with a sample order"`,
    inputSchema: {
      type: "object",
      properties: {
        workflowId: {
          type: "string",
          description: "Workflow ID to deploy",
        },
        testData: {
          type: "object",
          description: "Sample data to test the workflow (JSON object)",
        },
        validationRules: {
          type: "array",
          items: {
            type: "object",
            required: ["field", "condition"],
            properties: {
              field: {
                type: "string",
                description: "Output field to validate",
              },
              condition: {
                type: "string",
                enum: ["exists", "equals", "contains", "matches"],
              },
              expectedValue: {
                type: "string",
                description: "Expected value (for equals, contains, matches)",
              },
            },
          },
          description: "Validation rules for test output",
        },
        rollbackOnFailure: {
          type: "boolean",
          description: "Deactivate workflow if test fails",
          default: true,
        },
        confirm: {
          type: "boolean",
          description: "Required with confirmationToken to confirm workflow deployment.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Short-lived token returned by the previous deploy_and_test_workflow confirmation challenge.",
        },
      },
      required: ["workflowId", "testData"],
    },
    annotations: {
      readOnly: false,
      riskLevel: "medium",
      category: "orchestrated",
      estimatedSteps: 5,
      popularity: "high",
    },
  },

  // ============================================
  // 5. 自动修复工作流错误
  // ============================================
  {
    name: "fix_workflow_errors",
    description: `Analyze a failed workflow and attempt automatic fixes. Addresses the community's #1 pain point: stability!

This tool:
1. Retrieves error logs
2. Identifies common error patterns
3. Returns supported repair operations for trusted preview
4. Keeps credential and endpoint issues advisory

Common fixes:
- Missing required fields → Add default values
- Invalid JSON → Fix syntax
- Timeout errors → Add retry logic
- Missing credentials → Guide user to configure

Example: "This workflow keeps failing, can you fix it?"`,
    inputSchema: {
      type: "object",
      properties: {
        workflowId: {
          type: "string",
          description: "Workflow ID that is failing",
        },
      },
      required: ["workflowId"],
    },
    annotations: {
      readOnly: true,
      riskLevel: "low",
      category: "orchestrated",
      estimatedSteps: 6,
      popularity: "high",
    },
  },

  // ============================================
  // 6. 创建邮件自动化工作流
  // ============================================
  {
    name: "create_email_workflow",
    description: `Create email automation workflows with triggers and conditions.

Common patterns:
- Send welcome email on signup
- Daily/weekly digest emails
- Alert emails on events
- Email sequences (drip campaigns)

Example: "Send a welcome email when someone fills the contact form"`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Workflow name",
        },
        trigger: {
          type: "string",
          enum: ["webhook", "schedule", "manual"],
          description: "What triggers the email",
        },
        triggerConfig: {
          type: "object",
          description: "Trigger configuration (schedule, webhook path, etc.)",
        },
        emailTemplate: {
          type: "object",
          properties: {
            from: {
              type: "string",
              description: "Sender email",
            },
            to: {
              type: "string",
              description: "Recipient email (can use variables like {{email}})",
            },
            subject: {
              type: "string",
              description: "Email subject line",
            },
            body: {
              type: "string",
              description: "Email body (supports HTML and variables)",
            },
          },
        },
        conditions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              operator: {
                type: "string",
                enum: ["equals", "contains", "greater_than", "exists"],
              },
              value: { type: "string" },
            },
          },
          description: "Only send email if these conditions are met",
        },
        activate: {
          type: "boolean",
          description:
            "Deployment intent for a later gated activation; creation itself remains inactive.",
          default: true,
        },
      },
      required: ["name", "trigger", "emailTemplate"],
    },
    annotations: {
      readOnly: false,
      riskLevel: "medium",
      category: "orchestrated",
      estimatedSteps: 4,
      popularity: "very-high",
    },
  },
];
