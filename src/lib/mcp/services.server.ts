// Process-wide workflow-agent service singletons used by the MCP tools (server-only).
import {
  NodeKnowledgeService,
  WorkflowDiffService,
  WorkflowOperationPolicyService,
  WorkflowValidationService,
} from "@/lib/workflow-agent";
import {
  createKnowledgeClient,
  type KnowledgeClient,
} from "@/lib/workflow-agent/knowledge-client.server";

export const nodeKnowledgeService = new NodeKnowledgeService();
export const workflowValidationService = new WorkflowValidationService();
export const workflowDiffService = new WorkflowDiffService();
export const workflowOperationPolicyService = new WorkflowOperationPolicyService();

// Created on first use, so importing the gateway never builds a Knowledge client.
let productionKnowledgeClient: KnowledgeClient | undefined;
export const deferredProductionKnowledgeClient: KnowledgeClient = {
  searchTemplates: (...args) =>
    (productionKnowledgeClient ??= createKnowledgeClient()).searchTemplates(...args),
  getTemplate: (...args) =>
    (productionKnowledgeClient ??= createKnowledgeClient()).getTemplate(...args),
  searchNodes: (...args) =>
    (productionKnowledgeClient ??= createKnowledgeClient()).searchNodes(...args),
  getNode: (...args) => (productionKnowledgeClient ??= createKnowledgeClient()).getNode(...args),
  validateNode: (...args) =>
    (productionKnowledgeClient ??= createKnowledgeClient()).validateNode(...args),
  validateWorkflow: (...args) =>
    (productionKnowledgeClient ??= createKnowledgeClient()).validateWorkflow(...args),
};
