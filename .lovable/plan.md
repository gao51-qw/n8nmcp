
# UI 舒适性修复计划

按上一轮诊断的优先级,从 P0 到 P2 依次修改。每步独立、可单独验收。

---

## 步骤 1 — P0:移动端汉堡菜单

**问题**:`marketing-header.tsx` 的导航 `hidden md:flex`,< 768px 用户完全看不到 Features / Pricing / Docs / Community / FAQ / GitHub。

**改动**:
- 在 `src/components/marketing-header.tsx` 右侧、ThemeToggle 之前加一个 `md:hidden` 的汉堡按钮
- 用现成的 `@/components/ui/sheet`(Drawer 风格)展开右侧侧栏
- 侧栏内复用同一组导航链接 + 登录/注册按钮
- 点击链接后自动关闭 Sheet(`onOpenChange`)

**验收**:375px 视口下汉堡可点开,所有导航可达。

---

## 步骤 2 — P1:Hero 文案与移动端断行

**问题**:
- Hero 副标题 `text-lg + muted-foreground` 在桌面偏弱
- 移动端 "into any AI / client" gradient 文字被切两行,观感差

**改动**(`src/routes/index.tsx` 的 Hero 段):
- 副标题 `text-lg` → `text-lg md:text-xl`,颜色保持但加 `leading-relaxed`
- h1 第二行包一个 `whitespace-nowrap md:whitespace-normal` 或在移动端缩字号(`text-4xl md:text-6xl`)避免 gradient 拆行

**验收**:375px 与 1440px 截图,gradient 不被尴尬截断。

---

## 步骤 3 — P1:Stats 间距与 count-up 动画

**问题**:
- `mt-16` (64px) 让数字与 hero 视觉断开
- 静态数字缺乏可信度

**改动**:
- `mt-16` → `mt-12`
- 新建 `src/components/marketing/count-up.tsx`:轻量 hook,用 `requestAnimationFrame` + `IntersectionObserver`,数字滚动 ~1.2s
- 解析 `1,084` / `20+` / `<200ms` 中的数值部分做动画,前后缀保留

**验收**:首次滚入视口时数字从 0 滚到目标值。

---

## 步骤 4 — P2:Two-ways 卡片视觉平衡

**问题**:左卡有 glow,右卡没有,重量失衡;移动端永远左卡在上,引导单一。

**改动**(`src/routes/index.tsx`):
- 右卡加上一个更弱的 hover glow:`hover:border-primary/40 hover:shadow-[var(--shadow-elegant)]`
- 左卡 glow 强度保持但移除常驻 `boxShadow`,改为同样 hover 触发,二者对称
- 或保留左卡 "Just launched" 主推地位,但右卡加 `transition-shadow` 让它"活"起来

**验收**:两卡视觉重量接近,hover 反馈一致。

---

## 步骤 5 — P2:FAQ 搜索框

**问题**:FAQ 条目超过 6 条时,Accordion 全展开找答案累。

**改动**(`src/routes/index.tsx` FAQ 段 + `src/routes/faq.tsx`):
- 在标题下加一个 `<Input>` 搜索框
- 受控 state,按 `q` 或 `a` 包含关键词过滤 `FAQ` 数组
- 无结果时显示 "No questions match — try another keyword."

**验收**:输入关键词,Accordion 实时过滤。

---

## 技术细节(给开发者)

| 步骤 | 涉及文件 | 新增依赖 |
|---|---|---|
| 1 | `src/components/marketing-header.tsx` | 无(已有 sheet.tsx) |
| 2 | `src/routes/index.tsx` | 无 |
| 3 | `src/routes/index.tsx`,新建 `src/components/marketing/count-up.tsx` | 无(原生 API) |
| 4 | `src/routes/index.tsx` | 无 |
| 5 | `src/routes/index.tsx`,`src/routes/faq.tsx` | 无 |

无新增 npm 包,无后端改动,无数据库迁移。完全是前端展示层。

---

## 执行顺序确认

默认按 1→5 顺序一次性提交一个 PR 级别的改动。如果你想:
- **只做 P0**(最紧急的移动端导航)→ 告诉我"只做步骤 1"
- **跳过某步** → 告诉我"跳过步骤 X"
- **全部做** → 直接批准这个计划
