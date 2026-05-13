import type en from "./en";

const docs: typeof en = {
  nav: {
    sections: {
      introduction: "入门",
      connectClient: "连接客户端",
      configuration: "配置",
      operations: "运维",
    },
    items: {
      overview: "总览",
      gettingStarted: "快速上手",
      concepts: "核心概念",
      clients: "全部 MCP 客户端",
      apiKeys: "API 密钥",
      n8nInstances: "n8n 实例",
      tools: "MCP 工具参考",
      quotas: "配额与计费",
      security: "安全",
      admin: "管理员指南",
      selfHosting: "自托管部署",
      troubleshooting: "故障排查",
    },
    mobileTitle: "浏览文档",
  },
  index: {
    title: "文档 — n8n-mcp",
    description:
      "n8n-mcp 完整操作手册：通过 Model Context Protocol 把 AI 客户端接入 n8n，管理 API 密钥、n8n 实例、配额、安全与管理任务。",
    h1: "文档",
    lead: "n8n-mcp 是部署在你 n8n 实例前的托管 Model Context Protocol 网关。任何 MCP 客户端都能把你的工作流当作类型化工具来调用，并使用内置的 ~1,650 个 n8n 节点知识库来创建新工作流。",
    pickPrefix: "在下方选择一个主题，或直接前往 ",
    pickLink: "快速上手",
    pickSuffix: "。",
    cards: [
      { to: "/docs/getting-started", title: "快速上手", desc: "5 分钟内完成注册、生成密钥并连接首个客户端。" },
      { to: "/docs/concepts", title: "核心概念", desc: "了解 MCP 网关、API 密钥与 n8n 实例如何协同工作。" },
      { to: "/docs/clients", title: "连接客户端", desc: "Claude、ChatGPT、Cursor、VS Code 等的配置示例。" },
      { to: "/docs/api-keys", title: "API 密钥", desc: "创建、轮换并撤销平台令牌。" },
      { to: "/docs/n8n-instances", title: "n8n 实例", desc: "添加自托管或云端 n8n,凭据加密存储。" },
      { to: "/docs/tools", title: "MCP 工具参考", desc: "网关暴露的全部运行、知识与管理类工具。" },
      { to: "/docs/quotas", title: "配额与计费", desc: "套餐限额、用量统计与升级。" },
      { to: "/docs/security", title: "安全", desc: "静态加密、SSRF 防护、RLS 与审计。" },
    ],
  },
  gettingStarted: {
    title: "快速上手 — n8n-mcp 文档",
    description: "5 分钟内完成注册、创建平台 API 密钥、连接 n8n 实例，并接入第一个 MCP 客户端。",
    h1: "快速上手",
    body: `<p>本指南大约需要 5 分钟。完成后,Claude(或任意其他 MCP 客户端) 即可列出并执行你 n8n 实例上的工作流。</p>
<h2>1. 注册账号</h2>
<p>访问 <a href="/signup">/signup</a>,使用邮箱+密码或 Google 注册。新账号默认在 <strong>免费</strong> 套餐 (每天 100 次 MCP 调用,1 个 n8n 实例)。</p>
<h2>2. 生成平台 API 密钥</h2>
<ol>
<li>在控制台中打开 <a href="/api-keys">API 密钥</a>。</li>
<li>点击 <strong>新建密钥</strong>,填一个标签 (例如 <code>claude-laptop</code>)。</li>
<li>立即复制 <code>nmcp_…</code> 令牌 —— 它仅显示一次。</li>
</ol>
<p>把令牌当作密码对待。任何持有它的人都能以你的账号配额调用网关。</p>
<h2>3. 连接 n8n 实例</h2>
<ol>
<li>打开 <a href="/instances">n8n 实例</a> → <strong>添加</strong>。</li>
<li>填入 n8n 的 base URL (例如 <code>https://n8n.example.com</code>)。</li>
<li>在 n8n 界面的 <em>Settings → n8n API</em> 处生成一个 API key 并粘贴。</li>
<li>我们会在数据落库前用 AES-256-GCM 加密。</li>
</ol>
<h2>4. 接入 MCP 客户端</h2>
<p>把任意 MCP 客户端指向网关 URL,并把令牌放进 bearer 头:</p>
<pre>{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}</pre>
<p>各客户端配置见 <a href="/docs/clients">连接客户端</a>。</p>
<h2>5. 试一下</h2>
<p>重启客户端,提问: <em>"列出我的 n8n 工作流。"</em> 客户端应当调用 <code>list_workflows</code> 并返回结果。</p>
<h2>下一步</h2>
<ul>
<li><a href="/docs/tools">浏览完整工具目录</a></li>
<li><a href="/docs/quotas">了解配额与升级方式</a></li>
<li><a href="/docs/security">阅读安全模型</a></li>
</ul>`,
  },
  concepts: {
    title: "核心概念 — n8n-mcp 文档",
    description: "n8n-mcp 网关、平台 API 密钥、n8n 实例与 MCP 工具如何协同。",
    h1: "核心概念",
    body: `<p>三个核心概念足以理解整个系统。</p>
<h2>网关</h2>
<p>位于 <code>/api/public/mcp</code> 的多租户 HTTPS 端点,使用 Streamable HTTP 承载 Model Context Protocol。它用平台 API 密钥校验调用方,定位要转发的 n8n 实例,并把每次 MCP 工具调用翻译为对应的 n8n REST 请求。</p>
<h2>平台 API 密钥</h2>
<p>以 <code>nmcp_</code> 为前缀的令牌,向网关标识 <em>你的账号</em>。MCP 客户端用 <code>Authorization: Bearer …</code> 发送。每个账号支持多把密钥 —— 建议为每台设备/工作区单独签发,以便单独撤销。</p>
<h2>n8n 实例</h2>
<p>账号下保存的 <code>(base URL, n8n API 密钥)</code> 配对。n8n API 密钥使用 AES-256-GCM 静态加密。免费套餐允许 1 个实例,付费套餐放宽。网关从不向客户端回传 n8n 密钥。</p>
<h2>工具路由</h2>
<p>客户端调用工具时,网关会:</p>
<ol>
<li>校验 bearer 令牌并解析归属账号。</li>
<li>检查每日配额,超限返回 <code>429</code>。</li>
<li>对运行类工具 (<code>list_workflows</code>、<code>execute_workflow</code> 等),内存中解密 n8n 密钥并代理调用。</li>
<li>对知识类工具 (<code>search_nodes</code>、<code>get_node_essentials</code> 等),从内置 SQLite 知识库返回结果 —— 不调用 n8n。</li>
<li>记录用量供控制台与计费使用。</li>
</ol>
<h2>为什么要用网关?</h2>
<ul>
<li>n8n API 密钥永远不离开服务端。</li>
<li>即便重新部署 n8n,URL 始终保持稳定。</li>
<li>跨所有客户端的逐工具配额与可观测性。</li>
<li>内置 ~1,650 个 n8n 节点知识,适配 AI 写作。</li>
</ul>`,
  },
  clients: {
    title: "连接任意 MCP 客户端 — n8n-mcp 文档",
    description: "Claude Desktop、Claude Code、ChatGPT、Cursor、Windsurf、VS Code、Continue、Cline、Zed、Gemini CLI 与 Codex CLI 的配置示例。",
    h1: "连接客户端",
    body: `<p>所有 MCP 客户端都使用相同的网关 URL 与同一份 bearer 令牌,仅配置文件位置不同。</p>
<p>端点: <code>https://n8nmcp.lovable.app/api/public/mcp</code></p>
<h2 id="claude-desktop">Claude Desktop</h2>
<p>在 macOS 编辑 <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>,Windows 编辑 <code>%APPDATA%\\Claude\\claude_desktop_config.json</code>:</p>
<pre>{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}</pre>
<p>退出并重启 Claude,锤子图标里应能看到 n8n-mcp 工具。</p>
<h2 id="claude-code">Claude Code</h2>
<pre>claude mcp add --transport http n8n-mcp https://n8nmcp.lovable.app/api/public/mcp \\
  --header "Authorization: Bearer nmcp_..."</pre>
<h2 id="chatgpt">ChatGPT (自定义连接器)</h2>
<p>ChatGPT 设置 → Connectors → <strong>添加自定义连接器</strong>:</p>
<ul>
<li>URL: <code>https://n8nmcp.lovable.app/api/public/mcp</code></li>
<li>认证头: <code>Authorization: Bearer nmcp_...</code></li>
</ul>
<h2 id="cursor">Cursor</h2>
<p>Cursor 设置 → MCP → <strong>新增 MCP 服务</strong>,粘贴与 Claude Desktop 相同的 JSON。</p>
<h2 id="windsurf">Windsurf</h2>
<p>Settings → MCP servers → 编辑 <code>mcp_config.json</code>,使用上方相同的 <code>mcpServers</code> 块。</p>
<h2 id="vscode">VS Code (Copilot Chat) 与 Continue</h2>
<p>两者都在设置界面提供 MCP 服务列表。填入网关 URL 与 bearer 头即可。</p>
<h2 id="zed">Zed</h2>
<pre>// ~/.config/zed/settings.json
{
  "context_servers": {
    "n8n-mcp": {
      "command": { "transport": "http", "url": "https://n8nmcp.lovable.app/api/public/mcp",
        "headers": { "Authorization": "Bearer nmcp_..." } }
    }
  }
}</pre>
<h2 id="gemini-cli">Gemini CLI / Codex CLI / LM Studio</h2>
<p>三者都使用 JSON 配置,URL 与 header 一致。具体文件名请参阅各自的 MCP 文档。</p>
<h2 id="verifying">验证连通</h2>
<p>配置完毕后提问: <em>"你都能用哪些 n8n 工具?"</em> 客户端应列出 <code>list_workflows</code>、<code>execute_workflow</code>、知识工具,以及你拥有权限的管理工具。</p>`,
  },
  apiKeys: {
    title: "平台 API 密钥 — n8n-mcp 文档",
    description: "创建、命名、轮换并撤销 MCP 客户端使用的 nmcp_ 平台 API 密钥。",
    h1: "平台 API 密钥",
    body: `<p>平台 API 密钥(前缀 <code>nmcp_</code>)用于 MCP 客户端向网关进行身份验证,<em>不是</em> 你的 n8n API 密钥 —— 后者保持在服务端。</p>
<h2>创建密钥</h2>
<ol>
<li>打开 <a href="/api-keys">API 密钥</a>。</li>
<li>点击 <strong>新建密钥</strong>,填一个标签(例如 <code>cursor-work</code>)。</li>
<li>立即复制显示的令牌。关闭对话框后,数据库只保留前缀与哈希。</li>
</ol>
<h2>最佳实践</h2>
<ul>
<li>每台设备或工作区一把密钥,以便单独撤销。</li>
<li>切勿提交到 git 或在聊天中分享。请像密码一样对待。</li>
<li>每季度或团队成员离开时进行轮换。</li>
</ul>
<h2>轮换密钥</h2>
<p>暂不支持就地轮换。请新建密钥,更新客户端配置,然后在同一页面撤销旧密钥。</p>
<h2>撤销密钥</h2>
<p>点击密钥旁的垃圾桶图标。撤销立即生效 —— 该令牌的下一次调用将返回 <code>401</code>。</p>
<h2>配额</h2>
<p>配额按账号计算,而非按密钥。拆分密钥并不会增加每日上限。详见 <a href="/docs/quotas">配额与计费</a>。</p>`,
  },
  n8nInstances: {
    title: "n8n 实例 — n8n-mcp 文档",
    description: "连接你的自托管或 n8n.cloud 实例,加密保存 API 密钥,并提供 SSRF 防护。",
    h1: "n8n 实例",
    body: `<p>一个 <strong>实例</strong> 即网关可访问的一套 n8n 部署。可注册一个(n8n.cloud)或多个(按环境的自托管)。</p>
<h2 id="add">添加实例</h2>
<ol>
<li>打开 <code>控制台 → n8n 实例 → 新建实例</code>。</li>
<li>填一个标签(例如 <code>prod</code>、<code>staging</code>)。</li>
<li>填入 n8n 的 <strong>base URL</strong>(末尾不要带 <code>/rest</code>)。例如 <code>https://n8n.example.com</code>、<code>https://your-tenant.app.n8n.cloud</code>。</li>
<li>填入从 <code>n8n → Settings → n8n API → Create API key</code> 生成的 <strong>n8n API 密钥</strong>。</li>
</ol>
<h2 id="encryption">密钥如何存储</h2>
<p>n8n API 密钥用服务端密钥静态加密。仅在网关代理请求时于内存中解密,首次保存后不会再返回客户端。</p>
<h2 id="ssrf">SSRF 防护</h2>
<p>每次出站请求前,网关会对实例 URL 运行 <code>assertPublicUrl()</code>。解析到私网/回环段(<code>127.0.0.0/8</code>、<code>10.0.0.0/8</code>、<code>172.16.0.0/12</code>、<code>192.168.0.0/16</code>、IPv6 link-local 等)的 URL 会被拒绝。若你在私网自托管 n8n,请通过公网域名或反向代理暴露。</p>
<h2 id="health">健康检查</h2>
<p>每行实例显示最近一次成功联通时间和最新错误。点击 <strong>测试连接</strong> 可重新执行 <code>GET /rest/login</code>,不会修改任何数据。</p>
<h2 id="multiple">指定特定实例</h2>
<p>注册多个实例时,MCP 工具调用支持 <code>instance</code> 参数(传标签)。不传则使用工作区默认实例。</p>
<h2 id="rotate">轮换 n8n 密钥</h2>
<p>在 n8n 中生成新密钥,粘贴到实例行并保存。旧密文会立刻被覆盖。</p>`,
  },
  tools: {
    title: "MCP 工具参考 — n8n-mcp 文档",
    description: "n8n-mcp 网关暴露的运行、知识与管理类工具的完整参考。",
    h1: "MCP 工具参考",
    body: `<p>工具分为三类。所有工具都可接受可选的 <code>instance</code> 参数以指定目标 n8n 实例。</p>
<h2 id="runtime">运行类工具</h2>
<p>直接操作你 n8n 上的工作流与执行记录。</p>
<table>
<thead><tr><th>工具</th><th>说明</th></tr></thead>
<tbody>
<tr><td><code>list_workflows</code></td><td>按筛选条件(激活状态、标签、项目)列出工作流。</td></tr>
<tr><td><code>get_workflow</code></td><td>按 id 获取工作流,含节点与连线。</td></tr>
<tr><td><code>create_workflow</code></td><td>用 JSON 定义创建工作流。</td></tr>
<tr><td><code>update_workflow</code></td><td>修改节点、设置或激活状态。</td></tr>
<tr><td><code>delete_workflow</code></td><td>按 id 删除工作流。</td></tr>
<tr><td><code>execute_workflow</code></td><td>触发一次手动执行并流式返回结果。</td></tr>
<tr><td><code>list_executions</code></td><td>按状态筛选列出最近的执行记录。</td></tr>
<tr><td><code>get_execution</code></td><td>查看单次执行的数据与错误。</td></tr>
</tbody>
</table>
<h2 id="knowledge">知识类工具</h2>
<p>对内置 n8n 节点目录的只读查询,基于本地数据,不会调用你的 n8n。</p>
<table>
<thead><tr><th>工具</th><th>说明</th></tr></thead>
<tbody>
<tr><td><code>search_nodes</code></td><td>对 n8n 核心与社区节点做全文搜索。</td></tr>
<tr><td><code>get_node_info</code></td><td>返回某节点的参数、凭据与操作。</td></tr>
<tr><td><code>list_node_categories</code></td><td>按类别(AI、数据、通讯…) 浏览节点。</td></tr>
<tr><td><code>get_node_examples</code></td><td>返回某节点的官方示例工作流。</td></tr>
</tbody>
</table>
<h2 id="management">管理类工具</h2>
<p>对 n8n REST API 的管理类操作。仅对持有 <code>management</code> 范围的密钥可用。</p>
<table>
<thead><tr><th>工具</th><th>说明</th></tr></thead>
<tbody>
<tr><td><code>list_credentials</code></td><td>列出凭据(不含密文值)。</td></tr>
<tr><td><code>list_users</code></td><td>列出 n8n 实例上的用户。</td></tr>
<tr><td><code>list_projects</code></td><td>列出 n8n 项目(企业版)。</td></tr>
<tr><td><code>list_tags</code></td><td>列出工作流标签。</td></tr>
<tr><td><code>get_audit</code></td><td>运行 n8n 审计并返回安全报告。</td></tr>
</tbody>
</table>
<h2 id="errors">错误语义</h2>
<p>工具错误以 MCP <code>isError: true</code> 返回,并附经过净化的消息。网关从不把 n8n 的原始堆栈转发给客户端。</p>`,
  },
  quotas: {
    title: "配额与计费 — n8n-mcp 文档",
    description: "按密钥的请求配额、套餐限额,以及 MCP 工具调用的计量方式。",
    h1: "配额与计费",
    body: `<p>网关按平台 API 密钥计量用量。每次 MCP 工具调用算 1 次请求,与 payload 大小无关。</p>
<h2 id="plans">套餐限额</h2>
<table>
<thead><tr><th>套餐</th><th>每月请求数</th><th>n8n 实例</th><th>API 密钥</th></tr></thead>
<tbody>
<tr><td>免费</td><td>1,000</td><td>1</td><td>2</td></tr>
<tr><td>Pro</td><td>50,000</td><td>5</td><td>20</td></tr>
<tr><td>Team</td><td>250,000</td><td>不限</td><td>不限</td></tr>
</tbody>
</table>
<p>自托管部署不强制配额,同样的计数器仍会记录以便观测。</p>
<h2 id="counting">什么算一次请求</h2>
<ul>
<li>每次 MCP <code>tools/call</code> = 1 次请求。</li>
<li><code>tools/list</code> 与 <code>initialize</code> 握手不计费。</li>
<li>失败的调用(网关返回 4xx) 同样计入。</li>
<li>客户端发起的重试单独计数。</li>
</ul>
<h2 id="windows">重置周期</h2>
<p>计数器在每个自然月的 1 号 <code>00:00 UTC</code> 重置。当前用量在控制台顶部和每行 API 密钥上可见。</p>
<h2 id="overages">超限处理</h2>
<p>超限调用返回 MCP 错误 <code>QUOTA_EXCEEDED</code> 与 HTTP <code>429</code>,并附 <code>Retry-After</code> 指向下次重置时间。</p>
<h2 id="upgrading">升级</h2>
<p>打开 <code>控制台 → 计费</code> 即可切换套餐。新配额立刻生效,并按当期账单周期按比例结算。</p>`,
  },
  security: {
    title: "安全 — n8n-mcp 文档",
    description: "静态加密、SSRF 防护、RLS 策略,以及网关的威胁模型。",
    h1: "安全",
    body: `<p>网关在 AI 客户端与你的 n8n 之间转发 MCP 流量。设计目标是: 即使一把平台密钥被泄露,也无法访问私有网络、窃取其他租户数据或提权到管理员。</p>
<h2 id="key-storage">凭据存储</h2>
<ul>
<li><strong>平台 API 密钥</strong>(<code>nmcp_…</code>) 入库前用 SHA-256 哈希,仅保留 <code>last4</code> 用于显示。</li>
<li><strong>n8n API 密钥</strong> 用服务端密钥(AES-GCM) 静态加密。明文仅在代理请求时存在于内存中。</li>
<li>service-role 数据库访问仅限服务端,浏览器从不接触。</li>
</ul>
<h2 id="ssrf">SSRF 防护</h2>
<p>所有用户可控 URL 在服务端解析时都会经过 <code>assertPublicUrl()</code>,会拒绝:</p>
<ul>
<li>回环地址(<code>127.0.0.0/8</code>、<code>::1</code>)。</li>
<li>RFC1918 私网段与 IPv4/IPv6 link-local。</li>
<li>云元数据端点(<code>169.254.169.254</code>、GCP/Azure 的等价物)。</li>
<li>非 <code>http(s)</code> 协议(<code>file:</code>、<code>gopher:</code>…)。</li>
<li>DNS rebinding —— 解析后的 IP 会再次校验。</li>
</ul>
<h2 id="rls">行级安全</h2>
<p>租户数据(工作区、API 密钥、n8n 实例、审计日志) 由 Postgres RLS 按 <code>auth.uid()</code> 隔离。管理员表(角色、审计、机密) 已显式排除在 realtime publication 之外。</p>
<h2 id="roles">角色与管理员</h2>
<p>角色保存在专用的 <code>user_roles</code> 表,通过 <code>has_role()</code> 安全定义器函数检查。管理员角色绝不来自客户端存储。</p>
<h2 id="errors">错误净化</h2>
<p>服务端函数捕获上游错误并返回通用、对用户安全的消息。堆栈与边缘运行时异常仅在服务端记录。</p>
<h2 id="reporting">漏洞报告</h2>
<p>请发邮件到 <code>security@n8nmcp.lovable.app</code> 并附复现步骤。请勿在公开 issue 中提交安全报告。</p>`,
  },
};

export default docs;