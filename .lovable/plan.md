## 目标

把账号管理体验补到主流 SaaS 标准：

- 用户侧：改密码/邮箱、活跃会话、TOTP 二步验证、头像 + Google 关联管理
- 管理员侧：用户详情抽屉、改 tier/角色/重置密码/强制登出、封禁、待删除请求队列、备注/标签、CSV 导出
- 所有 admin 写操作落 `admin_audit_logs`

竞品 (`dashboard.n8n-mcp.com`) 自身的 Profile 页跟我们当前实现几乎一致（Display Name / Email Preferences / Telemetry / Delete Account），密码/会话/MFA/Google 关联都托管给 Auth0；我们用 Supabase 自管，需要在应用层自己做。

---

## Phase 1 — 数据库与基础设施

### 1.1 新表

```text
admin_audit_logs
  id, actor_id, action, target_user_id, summary, changes(jsonb), created_at
  RLS: admin select / admin insert(actor_id=auth.uid())

admin_user_notes
  id, user_id (unique), note, tags text[], updated_by, updated_at
  RLS: admin all

storage.buckets: 'avatars' (public read, owner write)
  policy: owner = (storage.foldername(name))[1] = auth.uid()::text
```

### 1.2 现有表加列

```text
profiles      + avatar_url 已存在 ✓
subscriptions + 由 admin 通过 server fn 改 tier（无需新列）
auth.users    + banned_until 由 supabase.auth.admin.updateUserById 控制（无需迁移）
```

### 1.3 SECURITY DEFINER

- `admin_set_user_tier(_user_id, _tier)`：admin only，写 audit
- `admin_grant_role / admin_revoke_role`：admin only，写 audit
- 全部 `REVOKE EXECUTE FROM authenticated, anon, PUBLIC`，仅在 server fn 内通过 admin client 调

---

## Phase 2 — 用户自助 (`/settings`)

把现 settings.tsx 拆成 tabs 减少文件膨胀：

```text
/settings                 → Profile（含头像）
/settings/security        → 密码、邮箱、2FA、会话
/settings/connections     → Google 关联管理
/settings/notifications   → 现有 email + telemetry
/settings/danger          → 现有导出/删除
```

### 2.1 Profile + 头像
- `<Avatar>` + 上传到 `avatars/{user_id}/avatar.png`
- 更新 `profiles.avatar_url`，header 头像同步

### 2.2 Security
- **改密码**：当前密码 + 新密码 + 确认；调 `supabase.auth.updateUser({ password })`，前端先用 `signInWithPassword` 验当前密码
- **改邮箱**：`supabase.auth.updateUser({ email })` 触发确认邮件（沿用 Lovable auth-email 模板）
- **2FA TOTP**：`supabase.auth.mfa.enroll/challenge/verify/unenroll`，QR 码 + 6 位验证；登录页加 challenge step
- **活跃会话**：列出 `auth.refresh_tokens`（通过 server fn + admin client 按 user_id 查），显示创建时间/UA/IP；单条/全部撤销 → `signOut({ scope: 'others' })` + admin 删 token

### 2.3 Connections
- 列已链接的 OAuth identities（`supabase.auth.getUserIdentities()`）
- 关联 Google：`linkIdentity({ provider: 'google' })`
- 解绑：`unlinkIdentity()`，至少保留一种登录方式

---

## Phase 3 — 管理员 (`/admin/users`)

### 3.1 列表升级
- 顶部搜索框（email / display_name 模糊）
- 列加：状态徽章（active / banned / pending-delete）、tags
- 排序（注册日期 / 今日 calls）
- 服务端分页（25/页）—— 改用 server fn 避免 1000 行限制
- 右上角「Export CSV」按钮

### 3.2 用户详情抽屉（点行打开）
Tabs：
- **Overview**：profile、subscription、近 30 天 calls 折线、instances 列表、API keys 列表
- **Activity**：最近 50 条 mcp_call_logs
- **Notes**：admin_user_notes 编辑（备注 + tags）
- **Audit**：该用户为 target 的 admin_audit_logs

底部 action bar：
- 改 tier（Free / Pro / Enterprise）
- 授予/撤销 admin
- 重置密码：`auth.admin.generateLink({ type:'recovery' })` 发邮件
- 强制登出：`auth.admin.signOut(userId, 'global')`
- 封禁/解封：`auth.admin.updateUserById(userId, { ban_duration: '8760h' | 'none' })`
- 删除账号（复用现 `deleteAccountNow` 逻辑，admin 版）

### 3.3 待删除请求队列 `/admin/deletion-requests`
- 列 `account_deletion_requests` 未处理的
- 「Approve & delete」/「Cancel & dismiss」按钮 → 写 processed_at + audit

### 3.4 全部 admin 写操作
- 走 `src/lib/admin-actions.functions.ts` 的 createServerFn
- 每个 handler 用 `requireAdmin` 中间件（getAdminStatus 复用），失败返回 403 不泄漏细节
- 成功后 `INSERT INTO admin_audit_logs`

---

## Phase 4 — 文件清单

新增：
```text
supabase/migrations/<ts>_account_management.sql
src/lib/security.functions.ts             # 改密码、会话列表、撤销、2FA helpers
src/lib/connections.functions.ts          # OAuth identity 管理
src/lib/admin-actions.functions.ts        # 改 tier/角色/封禁/重置/强登/删除
src/lib/admin-users.functions.ts          # 分页查询 + CSV 导出
src/lib/avatar-upload.ts                  # storage helper（client）
src/components/avatar-uploader.tsx
src/components/admin/user-detail-drawer.tsx
src/components/require-admin-middleware.ts
src/routes/_authenticated/settings.tsx                  # 改成 layout + Outlet
src/routes/_authenticated/settings.index.tsx            # Profile
src/routes/_authenticated/settings.security.tsx
src/routes/_authenticated/settings.connections.tsx
src/routes/_authenticated/settings.notifications.tsx
src/routes/_authenticated/settings.danger.tsx
src/routes/_authenticated/_admin/admin.deletion-requests.tsx
src/routes/login.tsx                                     # 加 MFA challenge step
```

修改：
```text
src/routes/_authenticated/_admin/admin.users.tsx        # 升级为详情抽屉版
src/components/site-header.tsx (or sidebar)             # 头像同步显示
```

---

## 实施顺序

1. Phase 1 数据库迁移（一次性 migration + storage bucket）→ 等你审批
2. Phase 2.1 头像 + Phase 2.2 改密码/改邮箱（用户最高频）
3. Phase 2.2 会话管理 + 2FA
4. Phase 2.3 Google 关联
5. Phase 3.1 + 3.2 admin 列表升级 + 详情抽屉
6. Phase 3.3 待删除队列
7. Phase 4 整体回归 + 顺手把 settings 路由拆分的 link 全改好

我会保证每步通过 lint/typecheck，admin 写操作 100% 落审计。

---

## 不在本次范围

- 团队/工作区（多人协作）—— 现产品是单人账户模型，要做需要单独立项
- SAML/SSO —— Supabase 支持但当前用户量级不需要
- 邮件验证模板的视觉重做 —— 现有模板可用，单独优化
