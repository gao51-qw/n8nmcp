-- 工作流审计日志表
-- 记录所有工作流的修改历史，支持回滚和审计追踪

CREATE TABLE IF NOT EXISTS workflow_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 基础信息
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL,
  n8n_instance_id UUID NOT NULL REFERENCES n8n_instances(id) ON DELETE CASCADE,

  -- 操作信息
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'activate', 'deactivate')),

  -- 快照数据（JSONB 允许查询和索引）
  snapshot_before JSONB,  -- 修改前的完整工作流状态
  snapshot_after JSONB,   -- 修改后的完整工作流状态

  -- 变更详情
  changes JSONB,          -- 具体变更的字段（diff）

  -- AI 上下文
  ai_reasoning TEXT,      -- Claude 的推理过程和意图
  tool_name TEXT,         -- 调用的 MCP 工具名称
  tool_params JSONB,      -- 工具调用参数

  -- 元数据
  ip_address INET,        -- 客户端 IP
  user_agent TEXT,        -- 客户端 User-Agent
  session_id TEXT,        -- 会话 ID

  -- 状态
  is_rolled_back BOOLEAN DEFAULT FALSE,  -- 是否已回滚
  rollback_audit_id UUID REFERENCES workflow_audit_log(id),  -- 回滚操作的审计记录

  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 索引字段
  created_at_date DATE GENERATED ALWAYS AS (created_at::DATE) STORED
);

-- 索引优化查询性能
CREATE INDEX idx_workflow_audit_user ON workflow_audit_log(user_id, created_at DESC);
CREATE INDEX idx_workflow_audit_workflow ON workflow_audit_log(workflow_id, created_at DESC);
CREATE INDEX idx_workflow_audit_operation ON workflow_audit_log(operation, created_at DESC);
CREATE INDEX idx_workflow_audit_date ON workflow_audit_log(created_at_date DESC);
CREATE INDEX idx_workflow_audit_instance ON workflow_audit_log(n8n_instance_id);

-- JSONB 索引（用于查询快照内容）
CREATE INDEX idx_workflow_audit_snapshot_before ON workflow_audit_log USING GIN (snapshot_before);
CREATE INDEX idx_workflow_audit_snapshot_after ON workflow_audit_log USING GIN (snapshot_after);
CREATE INDEX idx_workflow_audit_changes ON workflow_audit_log USING GIN (changes);

-- 行级安全策略（RLS）
ALTER TABLE workflow_audit_log ENABLE ROW LEVEL SECURITY;

-- 用户只能查看自己的审计日志
CREATE POLICY "Users can view own audit logs"
  ON workflow_audit_log
  FOR SELECT
  USING (auth.uid() = user_id);

-- 只有系统可以插入审计日志（通过 service_role）
-- 普通用户不能直接插入或修改审计日志

-- 注释
COMMENT ON TABLE workflow_audit_log IS '工作流审计日志 - 记录所有修改历史';
COMMENT ON COLUMN workflow_audit_log.snapshot_before IS '修改前的完整工作流状态（JSON）';
COMMENT ON COLUMN workflow_audit_log.snapshot_after IS '修改后的完整工作流状态（JSON）';
COMMENT ON COLUMN workflow_audit_log.changes IS '具体变更的字段差异（JSON diff）';
COMMENT ON COLUMN workflow_audit_log.ai_reasoning IS 'AI 的推理过程和操作意图';
COMMENT ON COLUMN workflow_audit_log.is_rolled_back IS '标记此变更是否已被回滚';
COMMENT ON COLUMN workflow_audit_log.rollback_audit_id IS '如果是回滚操作，指向被回滚的审计记录';

-- 创建视图：最近的审计记录
CREATE VIEW recent_workflow_audits
WITH (security_invoker = true) AS
SELECT
  id,
  user_id,
  workflow_id,
  operation,
  tool_name,
  ai_reasoning,
  is_rolled_back,
  created_at,
  -- 提取工作流名称
  snapshot_after->>'name' as workflow_name,
  -- 计算变更数量
  jsonb_array_length(COALESCE(changes, '[]'::jsonb)) as num_changes
FROM workflow_audit_log
WHERE created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;

REVOKE ALL ON recent_workflow_audits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON recent_workflow_audits TO authenticated;

COMMENT ON VIEW recent_workflow_audits IS '最近30天的工作流审计记录摘要';
