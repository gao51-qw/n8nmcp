import type en from "./en";

const docs: typeof en = {
  nav: {
    sections: {
      introduction: "はじめに",
      connectClient: "クライアント接続",
      configuration: "設定",
      operations: "運用",
    },
    items: {
      overview: "概要",
      gettingStarted: "クイックスタート",
      concepts: "コンセプト",
      clients: "MCP クライアント一覧",
      apiKeys: "API キー",
      n8nInstances: "n8n インスタンス",
      tools: "MCP ツールリファレンス",
      quotas: "クォータと請求",
      security: "セキュリティ",
      admin: "管理者ガイド",
      selfHosting: "セルフホスト",
      troubleshooting: "トラブルシューティング",
    },
    mobileTitle: "ドキュメントを見る",
  },
  index: {
    title: "ドキュメント — n8n-mcp",
    description: "n8n-mcp の運用マニュアル: Model Context Protocol で AI クライアントを n8n に接続し、API キー・n8n インスタンス・クォータ・セキュリティ・管理タスクを扱います。",
    h1: "ドキュメント",
    lead: "n8n-mcp は、あなたの n8n インスタンスの前段に置く Model Context Protocol ゲートウェイです。MCP 対応クライアントなら、ワークフローを型付きツールとして一覧・実行でき、~1,650 個の n8n ノード知識ベースで新規ワークフローも作成できます。",
    pickPrefix: "下のトピックを選ぶか、",
    pickLink: "クイックスタート",
    pickSuffix: " に直接進んでください。",
    cards: [
      { to: "/docs/getting-started", title: "クイックスタート", desc: "登録、キー発行、最初のクライアント接続まで 5 分。" },
      { to: "/docs/concepts", title: "コンセプト", desc: "MCP ゲートウェイ・API キー・n8n インスタンスの関係を理解。" },
      { to: "/docs/clients", title: "クライアント接続", desc: "Claude・ChatGPT・Cursor・VS Code などの設定スニペット。" },
      { to: "/docs/api-keys", title: "API キー", desc: "プラットフォームトークンの発行・ローテーション・失効。" },
      { to: "/docs/n8n-instances", title: "n8n インスタンス", desc: "セルフホスト or クラウドの n8n を暗号化付きで登録。" },
      { to: "/docs/tools", title: "MCP ツールリファレンス", desc: "ゲートウェイが公開する全ツール (実行・知識・管理)。" },
      { to: "/docs/quotas", title: "クォータと請求", desc: "プラン上限、使用量計測、アップグレード。" },
      { to: "/docs/security", title: "セキュリティ", desc: "保存時暗号化、SSRF 防御、RLS、監査。" },
    ],
  },
  gettingStarted: {
    title: "クイックスタート — n8n-mcp ドキュメント",
    description: "登録、プラットフォーム API キー作成、n8n インスタンス接続、最初の MCP クライアント設定まで 5 分以内に。",
    h1: "クイックスタート",
    body: `<p>所要時間は約 5 分。最後には Claude (または任意の MCP クライアント) があなたの n8n 上のワークフローを一覧・実行できる状態になります。</p>
<h2>1. アカウント作成</h2>
<p><a href="/signup">/signup</a> でメール+パスワード または Google で登録。新規アカウントは <strong>Free</strong> プラン (1 日 100 MCP コール、n8n インスタンス 1 つ) から始まります。</p>
<h2>2. プラットフォーム API キーを発行</h2>
<ol>
<li>ダッシュボードの <a href="/api-keys">API Keys</a> を開く。</li>
<li><strong>New key</strong> をクリックしラベルを付ける (例: <code>claude-laptop</code>)。</li>
<li><code>nmcp_…</code> トークンをすぐコピー —— 1 度しか表示されません。</li>
</ol>
<p>トークンはパスワード同様に扱ってください。所持者は誰でもあなたのアカウントのクォータでゲートウェイを呼び出せます。</p>
<h2>3. n8n インスタンスを接続</h2>
<ol>
<li><a href="/instances">n8n Instances</a> → <strong>Add</strong> を開く。</li>
<li>n8n の base URL を貼り付け (例: <code>https://n8n.example.com</code>)。</li>
<li>n8n の <em>Settings → n8n API</em> で API キーを生成し、貼り付け。</li>
<li>DB に保存される前に AES-256-GCM で暗号化されます。</li>
</ol>
<h2>4. MCP クライアントを設定</h2>
<p>任意の MCP クライアントをゲートウェイ URL に向け、トークンを bearer ヘッダーで送ります:</p>
<pre>{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}</pre>
<p>クライアント別の設定は <a href="/docs/clients">クライアント接続</a> を参照。</p>
<h2>5. 試す</h2>
<p>クライアントを再起動し、 <em>「私の n8n ワークフローを一覧して」</em> と聞いてみましょう。<code>list_workflows</code> が呼ばれて結果が返ります。</p>
<h2>次のステップ</h2>
<ul>
<li><a href="/docs/tools">全ツールカタログを見る</a></li>
<li><a href="/docs/quotas">クォータとアップグレード方法</a></li>
<li><a href="/docs/security">セキュリティモデルを読む</a></li>
</ul>`,
  },
  concepts: {
    title: "コンセプト — n8n-mcp ドキュメント",
    description: "n8n-mcp ゲートウェイ、プラットフォーム API キー、n8n インスタンス、MCP ツールの関係。",
    h1: "コンセプト",
    body: `<p>3 つのプリミティブを押さえれば全体が理解できます。</p>
<h2>ゲートウェイ</h2>
<p><code>/api/public/mcp</code> にあるマルチテナント HTTPS エンドポイント。Streamable HTTP 上で Model Context Protocol を話します。プラットフォーム API キーで呼び出し元を認証し、転送先の n8n インスタンスを解決し、各 MCP ツール呼び出しを対応する n8n REST リクエストに変換します。</p>
<h2>プラットフォーム API キー</h2>
<p><code>nmcp_</code> プレフィックスのトークンで、ゲートウェイに対して <em>あなたのアカウント</em> を識別します。MCP クライアントが <code>Authorization: Bearer …</code> として送信します。1 アカウントに複数キーを発行可能 —— デバイス/ワークスペース毎に発行すると個別失効できます。</p>
<h2>n8n インスタンス</h2>
<p>アカウント配下の <code>(base URL, n8n API キー)</code> ペア。n8n API キーは AES-256-GCM で保存時暗号化されます。Free プランは 1 インスタンス、有料プランは増えます。ゲートウェイは n8n キーをクライアントに返しません。</p>
<h2>ツールルーティング</h2>
<p>クライアントがツールを呼ぶと、ゲートウェイは:</p>
<ol>
<li>bearer トークンを検証し所有アカウントを解決。</li>
<li>1 日のクォータを確認、超過なら <code>429</code>。</li>
<li>実行ツール (<code>list_workflows</code>、<code>execute_workflow</code> 等) は n8n キーをメモリ内で復号して proxy。</li>
<li>知識ツール (<code>search_nodes</code>、<code>get_node_essentials</code> 等) は内蔵 SQLite からのみ返答 —— n8n は呼ばない。</li>
<li>使用量を記録 (ダッシュボード/請求向け)。</li>
</ol>
<h2>なぜゲートウェイ?</h2>
<ul>
<li>n8n API キーがサーバから出ない。</li>
<li>n8n を再デプロイしても URL が安定。</li>
<li>全クライアント横断のツール毎クォータと可観測性。</li>
<li>~1,650 個の n8n ノード知識を内蔵 (AI 作成向け)。</li>
</ul>`,
  },
  clients: {
    title: "あらゆる MCP クライアントを接続 — n8n-mcp ドキュメント",
    description: "Claude Desktop / Code、ChatGPT、Cursor、Windsurf、VS Code、Continue、Cline、Zed、Gemini CLI、Codex CLI の設定スニペット。",
    h1: "クライアント接続",
    body: `<p>すべての MCP 対応クライアントは同じゲートウェイ URL と同じ bearer トークンを使います。違うのは設定ファイルの場所だけ。</p>
<p>エンドポイント: <code>https://n8nmcp.lovable.app/api/public/mcp</code></p>
<h2 id="claude-desktop">Claude Desktop</h2>
<p>macOS は <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>、Windows は <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> を編集:</p>
<pre>{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}</pre>
<p>Claude を再起動。ハンマーアイコンに n8n-mcp ツールが表示されます。</p>
<h2 id="claude-code">Claude Code</h2>
<pre>claude mcp add --transport http n8n-mcp https://n8nmcp.lovable.app/api/public/mcp \\
  --header "Authorization: Bearer nmcp_..."</pre>
<h2 id="chatgpt">ChatGPT (カスタムコネクタ)</h2>
<p>ChatGPT 設定 → Connectors → <strong>カスタムコネクタを追加</strong>:</p>
<ul>
<li>URL: <code>https://n8nmcp.lovable.app/api/public/mcp</code></li>
<li>認証ヘッダー: <code>Authorization: Bearer nmcp_...</code></li>
</ul>
<h2 id="cursor">Cursor</h2>
<p>Cursor 設定 → MCP → <strong>Add new MCP server</strong>、Claude Desktop と同じ JSON を貼り付け。</p>
<h2 id="windsurf">Windsurf</h2>
<p>Settings → MCP servers → <code>mcp_config.json</code> を上記の <code>mcpServers</code> ブロックで編集。</p>
<h2 id="vscode">VS Code (Copilot Chat) と Continue</h2>
<p>どちらも設定 UI で MCP サーバ一覧を提供。ゲートウェイ URL と bearer ヘッダーを設定。</p>
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
<p>3 つとも JSON 設定で同じ URL+ヘッダーを使います。各ツールの MCP ドキュメントで正確なファイル名を確認してください。</p>
<h2 id="verifying">接続確認</h2>
<p>設定後 <em>「どんな n8n ツールがある?」</em> と聞きましょう。<code>list_workflows</code>、<code>execute_workflow</code>、知識ツール、権限のある管理ツールが返ります。</p>`,
  },
  apiKeys: {
    title: "プラットフォーム API キー — n8n-mcp ドキュメント",
    description: "MCP クライアントが使う nmcp_ プラットフォーム API キーの作成・命名・ローテーション・失効。",
    h1: "プラットフォーム API キー",
    body: `<p>プラットフォーム API キー (プレフィックス <code>nmcp_</code>) は MCP クライアントをゲートウェイに認証します。あなたの n8n API キーとは <em>別物</em> —— こちらはサーバ側に留まります。</p>
<h2>キーを作成</h2>
<ol>
<li><a href="/api-keys">API Keys</a> を開く。</li>
<li><strong>New key</strong> をクリックしラベルを付ける (例: <code>cursor-work</code>)。</li>
<li>表示されたトークンをすぐコピー。閉じた後はプレフィックスとハッシュのみ DB に残ります。</li>
</ol>
<h2>ベストプラクティス</h2>
<ul>
<li>デバイス/ワークスペース毎に 1 キー、個別に失効可能に。</li>
<li>git にコミットせず、チャットで共有しない。パスワードと同様に扱う。</li>
<li>四半期毎、またはメンバーが離れた時にローテーション。</li>
</ul>
<h2>キーをローテーション</h2>
<p>現状、その場でのローテーションには未対応。新しいキーを発行 → クライアント設定を更新 → 同じページで旧キーを失効、の順です。</p>
<h2>キーを失効</h2>
<p>キー横のゴミ箱アイコンをクリック。即時失効 —— そのトークンを使う次の呼び出しは <code>401</code> を返します。</p>
<h2>クォータ</h2>
<p>クォータはアカウント単位、キー単位ではありません。キーを分けても 1 日上限は増えません。<a href="/docs/quotas">クォータと請求</a> を参照。</p>`,
  },
  n8nInstances: {
    title: "n8n インスタンス — n8n-mcp ドキュメント",
    description: "セルフホストや n8n.cloud のインスタンスを接続。API キーは暗号化保存、SSRF 対策あり。",
    h1: "n8n インスタンス",
    body: `<p><strong>インスタンス</strong> は、ゲートウェイが通信する 1 つの n8n 環境。1 つ (n8n.cloud) でも複数 (環境別セルフホスト) でも登録可能。</p>
<h2 id="add">インスタンスを追加</h2>
<ol>
<li><code>Dashboard → n8n instances → New instance</code> を開く。</li>
<li>ラベル (例: <code>prod</code>、<code>staging</code>) を付ける。</li>
<li>n8n の <strong>base URL</strong> を貼り付け (末尾に <code>/rest</code> は付けない)。例: <code>https://n8n.example.com</code>、<code>https://your-tenant.app.n8n.cloud</code>。</li>
<li><code>n8n → Settings → n8n API → Create API key</code> で作った <strong>n8n API キー</strong> を貼り付け。</li>
</ol>
<h2 id="encryption">キーの保存方法</h2>
<p>n8n API キーはサーバ側キーで保存時暗号化。プロキシ時のみメモリで復号され、初回保存後はクライアントに返りません。</p>
<h2 id="ssrf">SSRF 防御</h2>
<p>すべての outbound リクエスト前に、ゲートウェイは <code>assertPublicUrl()</code> を実行。プライベート/ループバック (<code>127.0.0.0/8</code>、<code>10.0.0.0/8</code>、<code>172.16.0.0/12</code>、<code>192.168.0.0/16</code>、IPv6 link-local 等) に解決される URL は拒否されます。プライベート網でセルフホストする場合は、公開ホスト名やリバースプロキシ経由で公開してください。</p>
<h2 id="health">ヘルスチェック</h2>
<p>各行に最終疎通時刻と最新エラーが表示されます。<strong>Test connection</strong> で <code>GET /rest/login</code> を再実行 (副作用なし)。</p>
<h2 id="multiple">特定インスタンスを指定</h2>
<p>複数登録時、MCP ツール呼び出しはオプションの <code>instance</code> パラメータ (ラベル) を受け取ります。指定しない場合はワークスペース既定。</p>
<h2 id="rotate">n8n キーをローテーション</h2>
<p>n8n で新キー生成 → 行に貼り付けて保存。旧暗号文は即座に上書きされます。</p>`,
  },
  tools: {
    title: "MCP ツールリファレンス — n8n-mcp ドキュメント",
    description: "n8n-mcp ゲートウェイが公開する実行・知識・管理ツールの完全リファレンス。",
    h1: "MCP ツールリファレンス",
    body: `<p>ツールは 3 カテゴリ。すべて任意の <code>instance</code> 引数で対象 n8n インスタンスを指定できます。</p>
<h2 id="runtime">実行ツール</h2>
<p>あなたの n8n のワークフロー・実行への直接操作。</p>
<table>
<thead><tr><th>ツール</th><th>説明</th></tr></thead>
<tbody>
<tr><td><code>list_workflows</code></td><td>条件 (有効/タグ/プロジェクト) でワークフロー一覧。</td></tr>
<tr><td><code>get_workflow</code></td><td>id でワークフロー取得 (ノード/接続込み)。</td></tr>
<tr><td><code>create_workflow</code></td><td>JSON 定義から新規作成。</td></tr>
<tr><td><code>update_workflow</code></td><td>ノード/設定/有効状態を更新。</td></tr>
<tr><td><code>delete_workflow</code></td><td>id で削除。</td></tr>
<tr><td><code>execute_workflow</code></td><td>手動実行を起動し結果をストリーム。</td></tr>
<tr><td><code>list_executions</code></td><td>ステータスで実行履歴を一覧。</td></tr>
<tr><td><code>get_execution</code></td><td>1 件の実行データとエラーを参照。</td></tr>
</tbody>
</table>
<h2 id="knowledge">知識ツール</h2>
<p>内蔵 n8n ノードカタログへの読み取り専用クエリ。ローカルデータのみで n8n は呼びません。</p>
<table>
<thead><tr><th>ツール</th><th>説明</th></tr></thead>
<tbody>
<tr><td><code>search_nodes</code></td><td>n8n コア+コミュニティノードを全文検索。</td></tr>
<tr><td><code>get_node_info</code></td><td>ノードのパラメータ・認証・操作を返す。</td></tr>
<tr><td><code>list_node_categories</code></td><td>カテゴリ別 (AI/データ/通信…) に閲覧。</td></tr>
<tr><td><code>get_node_examples</code></td><td>ノードの公式サンプルワークフローを返す。</td></tr>
</tbody>
</table>
<h2 id="management">管理ツール</h2>
<p>n8n REST API への管理操作。<code>management</code> スコープを持つキーのみ利用可。</p>
<table>
<thead><tr><th>ツール</th><th>説明</th></tr></thead>
<tbody>
<tr><td><code>list_credentials</code></td><td>認証情報一覧 (秘密値は含まない)。</td></tr>
<tr><td><code>list_users</code></td><td>n8n インスタンスのユーザ一覧。</td></tr>
<tr><td><code>list_projects</code></td><td>n8n プロジェクト一覧 (Enterprise)。</td></tr>
<tr><td><code>list_tags</code></td><td>ワークフロータグ一覧。</td></tr>
<tr><td><code>get_audit</code></td><td>n8n 監査を実行しレポートを返す。</td></tr>
</tbody>
</table>
<h2 id="errors">エラーセマンティクス</h2>
<p>ツールエラーは MCP <code>isError: true</code> で返り、メッセージはサニタイズ済み。n8n の生スタックトレースは決して転送しません。</p>`,
  },
  quotas: {
    title: "クォータと請求 — n8n-mcp ドキュメント",
    description: "キー単位のリクエストクォータ、プラン上限、MCP ツール呼び出しの計測方法。",
    h1: "クォータと請求",
    body: `<p>ゲートウェイはプラットフォーム API キー単位で計測。各 MCP ツール呼び出しは payload サイズに関わらず 1 リクエストとカウント。</p>
<h2 id="plans">プラン上限</h2>
<table>
<thead><tr><th>プラン</th><th>月間リクエスト</th><th>n8n インスタンス</th><th>API キー</th></tr></thead>
<tbody>
<tr><td>Free</td><td>1,000</td><td>1</td><td>2</td></tr>
<tr><td>Pro</td><td>50,000</td><td>5</td><td>20</td></tr>
<tr><td>Team</td><td>250,000</td><td>無制限</td><td>無制限</td></tr>
</tbody>
</table>
<p>セルフホストにはクォータ強制なし。観測用に同じカウンタは記録されます。</p>
<h2 id="counting">何が 1 リクエスト?</h2>
<ul>
<li>各 MCP <code>tools/call</code> = 1 リクエスト。</li>
<li><code>tools/list</code> と <code>initialize</code> ハンドシェイクは無料。</li>
<li>失敗呼び出し (ゲートウェイが 4xx を返す) もカウント。</li>
<li>クライアントのリトライは別カウント。</li>
</ul>
<h2 id="windows">リセット周期</h2>
<p>カウンタは毎月 1 日 <code>00:00 UTC</code> にリセット。現在の使用量はダッシュボードヘッダーと各 API キー行に表示されます。</p>
<h2 id="overages">クォータ超過時</h2>
<p>呼び出しは MCP エラー <code>QUOTA_EXCEEDED</code> と HTTP <code>429</code> を返し、次のリセットを示す <code>Retry-After</code> ヘッダーが付きます。</p>
<h2 id="upgrading">アップグレード</h2>
<p><code>Dashboard → Billing</code> でプラン変更。新クォータは即時有効、当期請求は日割り計算されます。</p>`,
  },
  security: {
    title: "セキュリティ — n8n-mcp ドキュメント",
    description: "保存時暗号化、SSRF 防御、RLS ポリシー、ゲートウェイの脅威モデル。",
    h1: "セキュリティ",
    body: `<p>ゲートウェイは AI クライアントとあなたの n8n の間で MCP トラフィックを仲介します。プラットフォームキーが漏れても、プライベート網に到達したり、他テナントのデータを取得したり、管理者へ昇格できないよう設計されています。</p>
<h2 id="key-storage">資格情報の保存</h2>
<ul>
<li><strong>プラットフォーム API キー</strong> (<code>nmcp_…</code>) は保存前に SHA-256 でハッシュ。表示用に <code>last4</code> のみ保持。</li>
<li><strong>n8n API キー</strong> はサーバ側キーで AES-GCM 保存時暗号化。平文はプロキシ中のメモリにのみ存在。</li>
<li>service-role での DB アクセスはサーバ専用。ブラウザは触れません。</li>
</ul>
<h2 id="ssrf">SSRF ガード</h2>
<p>サーバが解決するすべてのユーザ制御 URL は <code>assertPublicUrl()</code> を通ります。拒否対象:</p>
<ul>
<li>ループバック (<code>127.0.0.0/8</code>、<code>::1</code>)。</li>
<li>RFC1918 プライベート、IPv4/IPv6 link-local。</li>
<li>クラウドメタデータ (<code>169.254.169.254</code>、GCP/Azure 同等品)。</li>
<li>非 <code>http(s)</code> スキーム (<code>file:</code>、<code>gopher:</code>…)。</li>
<li>DNS リバインディング —— 解決後の IP も再チェック。</li>
</ul>
<h2 id="rls">行レベルセキュリティ</h2>
<p>テナントデータ (ワークスペース、API キー、n8n インスタンス、監査ログ) は <code>auth.uid()</code> を軸とした Postgres RLS で保護。管理テーブル (roles、audit、secrets) は realtime publication から明示的に除外。</p>
<h2 id="roles">ロールと管理者</h2>
<p>ロールは専用の <code>user_roles</code> テーブルに保管し、<code>has_role()</code> security-definer 関数で確認。管理ロールがクライアントストレージに由来することはありません。</p>
<h2 id="errors">エラーのサニタイズ</h2>
<p>サーバ関数は上流エラーを捕捉し、ユーザに安全な汎用メッセージを返します。スタックトレースとエッジ例外はサーバ側のみに記録。</p>
<h2 id="reporting">脆弱性報告</h2>
<p>再現手順を添えて <code>security@n8nmcp.lovable.app</code> へ。公開 issue では報告しないでください。</p>`,
  },
};

export default docs;