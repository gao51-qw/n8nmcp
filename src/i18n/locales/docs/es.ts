import type en from "./en";

const docs: typeof en = {
  nav: {
    sections: {
      introduction: "Introducción",
      connectClient: "Conectar un cliente",
      configuration: "Configuración",
      operations: "Operaciones",
    },
    items: {
      overview: "Visión general",
      gettingStarted: "Primeros pasos",
      concepts: "Conceptos",
      clients: "Todos los clientes MCP",
      apiKeys: "Claves API",
      n8nInstances: "Instancias de n8n",
      tools: "Referencia de herramientas MCP",
      quotas: "Cuotas y facturación",
      security: "Seguridad",
      admin: "Guía de administración",
      selfHosting: "Auto-alojamiento",
      troubleshooting: "Resolución de problemas",
    },
    mobileTitle: "Explorar la documentación",
  },
  index: {
    title: "Documentación — n8n-mcp",
    description: "Manual operativo completo de n8n-mcp: conecta clientes de IA a n8n vía Model Context Protocol, gestiona claves API, instancias de n8n, cuotas, seguridad y tareas de administración.",
    h1: "Documentación",
    lead: "n8n-mcp es una pasarela hospedada de Model Context Protocol delante de tu instancia n8n. Cualquier cliente compatible con MCP puede listar y ejecutar tus workflows como herramientas tipadas, y usar la base de conocimiento integrada de ~1.650 nodos n8n para crear nuevos.",
    pickPrefix: "Elige un tema abajo o ve directamente a ",
    pickLink: "Primeros pasos",
    pickSuffix: ".",
    cards: [
      { to: "/docs/getting-started", title: "Primeros pasos", desc: "Regístrate, crea una clave y conecta tu primer cliente en 5 minutos." },
      { to: "/docs/concepts", title: "Conceptos", desc: "Cómo encajan la pasarela MCP, las claves API y las instancias n8n." },
      { to: "/docs/clients", title: "Conectar un cliente", desc: "Snippets para Claude, ChatGPT, Cursor, VS Code y más." },
      { to: "/docs/api-keys", title: "Claves API", desc: "Crea, rota y revoca tokens de plataforma." },
      { to: "/docs/n8n-instances", title: "Instancias de n8n", desc: "Añade tu n8n auto-alojado o cloud con credenciales cifradas." },
      { to: "/docs/tools", title: "Referencia de herramientas MCP", desc: "Todas las herramientas runtime, de conocimiento y de gestión." },
      { to: "/docs/quotas", title: "Cuotas y facturación", desc: "Límites por plan, métricas de uso y mejoras." },
      { to: "/docs/security", title: "Seguridad", desc: "Cifrado en reposo, protección SSRF, RLS y auditoría." },
    ],
  },
  gettingStarted: {
    title: "Primeros pasos — Documentación n8n-mcp",
    description: "Regístrate, crea una clave API de plataforma, conecta tu instancia n8n y configura tu primer cliente MCP en menos de cinco minutos.",
    h1: "Primeros pasos",
    body: `<p>Esta guía te llevará unos cinco minutos. Al final, Claude (o cualquier otro cliente MCP) podrá listar y ejecutar workflows en tu propia instancia n8n.</p>
<h2>1. Crea una cuenta</h2>
<p>Regístrate en <a href="/signup">/signup</a> con email + contraseña o con Google. Las cuentas nuevas empiezan en el plan <strong>Free</strong> (100 llamadas MCP/día, 1 instancia n8n).</p>
<h2>2. Genera una clave API de plataforma</h2>
<ol>
<li>Abre <a href="/api-keys">API Keys</a> en el panel.</li>
<li>Pulsa <strong>Nueva clave</strong> y dale una etiqueta (p. ej. <code>claude-laptop</code>).</li>
<li>Copia el token <code>nmcp_…</code> al instante — solo se muestra una vez.</li>
</ol>
<p>Trata el token como una contraseña. Quien lo tenga puede llamar a tu pasarela bajo la cuota de tu cuenta.</p>
<h2>3. Conecta una instancia n8n</h2>
<ol>
<li>Abre <a href="/instances">Instancias n8n</a> → <strong>Añadir</strong>.</li>
<li>Pega la base URL de tu n8n (p. ej. <code>https://n8n.example.com</code>).</li>
<li>Genera una clave API de n8n en <em>Settings → n8n API</em> y pégala.</li>
<li>Ciframos la clave con AES-256-GCM antes de tocar la base de datos.</li>
</ol>
<h2>4. Configura tu cliente MCP</h2>
<p>Apunta cualquier cliente MCP a la URL de la pasarela con tu token como cabecera bearer:</p>
<pre>{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}</pre>
<p>Consulta <a href="/docs/clients">Conectar un cliente</a> para snippets por cliente.</p>
<h2>5. Pruébalo</h2>
<p>Reinicia tu cliente. Pregunta: <em>«Lista mis workflows de n8n.»</em> El cliente debería invocar <code>list_workflows</code> contra tu instancia y devolver la respuesta.</p>
<h2>Siguientes pasos</h2>
<ul>
<li><a href="/docs/tools">Explora el catálogo completo de herramientas</a></li>
<li><a href="/docs/quotas">Entiende las cuotas y cómo mejorar de plan</a></li>
<li><a href="/docs/security">Lee el modelo de seguridad</a></li>
</ul>`,
  },
  concepts: {
    title: "Conceptos — Documentación n8n-mcp",
    description: "Cómo encajan la pasarela n8n-mcp, las claves API de plataforma, las instancias n8n y las herramientas MCP.",
    h1: "Conceptos",
    body: `<p>Tres primitivas bastan para entender todo el sistema.</p>
<h2>La pasarela</h2>
<p>Un endpoint HTTPS multi-tenant en <code>/api/public/mcp</code> que habla Model Context Protocol sobre Streamable HTTP. Autentica al llamador con una clave API de plataforma, resuelve a qué instancia n8n reenviar y traduce cada llamada MCP a la petición REST de n8n correspondiente.</p>
<h2>Claves API de plataforma</h2>
<p>Tokens con prefijo <code>nmcp_</code> que identifican <em>tu cuenta</em> ante la pasarela. Tu cliente MCP los envía como <code>Authorization: Bearer …</code>. Se admiten múltiples claves por cuenta — emite una por dispositivo o workspace para revocarlas por separado.</p>
<h2>Instancias n8n</h2>
<p>Un par <code>(URL base, clave API n8n)</code> almacenado en tu cuenta. La clave API n8n se cifra en reposo con AES-256-GCM. El plan Free permite una instancia; los de pago amplían el límite. La pasarela nunca devuelve la clave n8n al cliente.</p>
<h2>Enrutado de herramientas</h2>
<p>Cuando tu cliente llama a una herramienta, la pasarela:</p>
<ol>
<li>Valida el token bearer y resuelve la cuenta propietaria.</li>
<li>Comprueba la cuota diaria; rechaza con <code>429</code> si se agota.</li>
<li>Para herramientas runtime (<code>list_workflows</code>, <code>execute_workflow</code>, …), descifra la clave n8n en memoria y hace de proxy.</li>
<li>Para herramientas de conocimiento (<code>search_nodes</code>, <code>get_node_essentials</code>, …) sirve resultados desde la base SQLite incluida — sin llamar a n8n.</li>
<li>Registra el uso para el panel y la facturación.</li>
</ol>
<h2>¿Por qué una pasarela?</h2>
<ul>
<li>Tu clave API n8n nunca sale del servidor.</li>
<li>URL estable aunque redespliegues n8n.</li>
<li>Cuotas por herramienta y observabilidad cruzada para todos los clientes.</li>
<li>Conocimiento integrado de ~1.650 nodos n8n para escritura asistida por IA.</li>
</ul>`,
  },
  clients: {
    title: "Conecta cualquier cliente MCP — Documentación n8n-mcp",
    description: "Snippets de configuración para Claude Desktop, Claude Code, ChatGPT, Cursor, Windsurf, VS Code, Continue, Cline, Zed, Gemini CLI y Codex CLI.",
    h1: "Conectar un cliente",
    body: `<p>Todos los clientes compatibles con MCP usan la misma URL de pasarela y el mismo token bearer. Solo cambia la ubicación del archivo de configuración.</p>
<p>Endpoint: <code>https://n8nmcp.lovable.app/api/public/mcp</code></p>
<h2 id="claude-desktop">Claude Desktop</h2>
<p>Edita <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> en macOS o <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> en Windows:</p>
<pre>{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}</pre>
<p>Cierra y vuelve a abrir Claude. El icono del martillo debería mostrar las herramientas n8n-mcp.</p>
<h2 id="claude-code">Claude Code</h2>
<pre>claude mcp add --transport http n8n-mcp https://n8nmcp.lovable.app/api/public/mcp \\
  --header "Authorization: Bearer nmcp_..."</pre>
<h2 id="chatgpt">ChatGPT (conectores personalizados)</h2>
<p>En ajustes de ChatGPT → Connectors → <strong>Añadir conector personalizado</strong>:</p>
<ul>
<li>URL: <code>https://n8nmcp.lovable.app/api/public/mcp</code></li>
<li>Cabecera de autenticación: <code>Authorization: Bearer nmcp_...</code></li>
</ul>
<h2 id="cursor">Cursor</h2>
<p>Ajustes de Cursor → MCP → <strong>Añadir nuevo servidor MCP</strong>, pega el mismo bloque JSON que en Claude Desktop.</p>
<h2 id="windsurf">Windsurf</h2>
<p>Settings → MCP servers → edita <code>mcp_config.json</code> con el bloque <code>mcpServers</code> estándar.</p>
<h2 id="vscode">VS Code (Copilot Chat) y Continue</h2>
<p>Ambos exponen una lista de servidores MCP en su UI. Usa la URL de pasarela con la cabecera bearer.</p>
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
<p>Los tres usan un JSON con la misma URL + cabecera. Consulta la documentación MCP de cada herramienta para el nombre exacto del archivo.</p>
<h2 id="verifying">Verificar la conexión</h2>
<p>Tras configurar, pregunta: <em>«¿Qué herramientas n8n tienes?»</em>. El cliente debería listar <code>list_workflows</code>, <code>execute_workflow</code>, las herramientas de conocimiento y cualquier herramienta de gestión a la que tengas acceso.</p>`,
  },
  apiKeys: {
    title: "Claves API de plataforma — Documentación n8n-mcp",
    description: "Crea, etiqueta, rota y revoca claves API de plataforma nmcp_ usadas por tus clientes MCP.",
    h1: "Claves API de plataforma",
    body: `<p>Las claves API de plataforma (prefijo <code>nmcp_</code>) autentican a tu cliente MCP frente a la pasarela. <em>No</em> son tu clave API de n8n — esa se queda en el servidor.</p>
<h2>Crear una clave</h2>
<ol>
<li>Abre <a href="/api-keys">API Keys</a>.</li>
<li>Pulsa <strong>Nueva clave</strong> y ponle una etiqueta (p. ej. <code>cursor-work</code>).</li>
<li>Copia el token mostrado al instante. Tras cerrar el diálogo, en la BD solo queda el prefijo y un hash.</li>
</ol>
<h2>Buenas prácticas</h2>
<ul>
<li>Una clave por dispositivo o workspace para poder revocarlas por separado.</li>
<li>Nunca la subas a git ni la compartas en chat. Trátala como una contraseña.</li>
<li>Rótalas trimestralmente o cuando alguien deje el equipo.</li>
</ul>
<h2>Rotar una clave</h2>
<p>Por ahora no soportamos rotación in-place. Crea una clave nueva, actualiza la configuración del cliente y revoca la antigua desde la misma página.</p>
<h2>Revocar una clave</h2>
<p>Pulsa el icono de papelera junto a la clave. La revocación es inmediata — la siguiente llamada con ese token devolverá <code>401</code>.</p>
<h2>Cuotas</h2>
<p>La cuota es por cuenta, no por clave. Dividir claves no multiplica tu límite diario. Ver <a href="/docs/quotas">Cuotas y facturación</a>.</p>`,
  },
  n8nInstances: {
    title: "Instancias n8n — Documentación n8n-mcp",
    description: "Conecta tu n8n auto-alojado o n8n.cloud, guarda las claves cifradas y protégete contra SSRF.",
    h1: "Instancias n8n",
    body: `<p>Una <strong>instancia</strong> es un despliegue n8n con el que la pasarela puede hablar. Puedes registrar una (n8n.cloud) o varias (auto-alojadas por entorno).</p>
<h2 id="add">Añadir una instancia</h2>
<ol>
<li>Abre <code>Panel → Instancias n8n → Nueva instancia</code>.</li>
<li>Ponle una etiqueta (p. ej. <code>prod</code>, <code>staging</code>).</li>
<li>Pega la <strong>URL base</strong> de tu n8n (sin <code>/rest</code> al final). Ejemplos: <code>https://n8n.example.com</code>, <code>https://your-tenant.app.n8n.cloud</code>.</li>
<li>Pega una <strong>clave API de n8n</strong> creada desde <code>n8n → Settings → n8n API → Create API key</code>.</li>
</ol>
<h2 id="encryption">Cómo se almacenan las claves</h2>
<p>Las claves API de n8n se cifran en reposo con una clave de servidor. Solo se descifran en memoria mientras la pasarela hace de proxy y nunca se devuelven al cliente tras el guardado inicial.</p>
<h2 id="ssrf">Protección SSRF</h2>
<p>La pasarela ejecuta <code>assertPublicUrl()</code> sobre cada URL antes de cualquier petición saliente. Se rechazan las URLs que resuelven a rangos privados/loopback (<code>127.0.0.0/8</code>, <code>10.0.0.0/8</code>, <code>172.16.0.0/12</code>, <code>192.168.0.0/16</code>, IPv6 link-local, etc.). Si auto-alojas n8n en una red privada, exponlo por nombre público o reverse proxy.</p>
<h2 id="health">Health checks</h2>
<p>Cada fila muestra el último contacto exitoso y el último error. Pulsa <strong>Test connection</strong> para reejecutar <code>GET /rest/login</code> sin cambiar nada.</p>
<h2 id="multiple">Apuntar a una instancia concreta</h2>
<p>Con varias instancias registradas, las llamadas MCP aceptan el parámetro <code>instance</code> (la etiqueta). Sin él, se usa la instancia por defecto del workspace.</p>
<h2 id="rotate">Rotar una clave n8n</h2>
<p>Genera una nueva clave en n8n, pégala en la fila y guarda. El cifrado anterior queda sobreescrito al instante.</p>`,
  },
  tools: {
    title: "Referencia de herramientas MCP — Documentación n8n-mcp",
    description: "Referencia completa de las herramientas runtime, de conocimiento y de gestión expuestas por la pasarela n8n-mcp.",
    h1: "Referencia de herramientas MCP",
    body: `<p>Las herramientas se agrupan en tres categorías. Todas aceptan un argumento opcional <code>instance</code> para apuntar a una instancia concreta.</p>
<h2 id="runtime">Herramientas runtime</h2>
<p>Interacción directa con workflows y ejecuciones en tu n8n.</p>
<table>
<thead><tr><th>Herramienta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td><code>list_workflows</code></td><td>Lista workflows con filtros (activos, tags, proyecto).</td></tr>
<tr><td><code>get_workflow</code></td><td>Obtiene un workflow por id, con nodos y conexiones.</td></tr>
<tr><td><code>create_workflow</code></td><td>Crea un workflow desde una definición JSON.</td></tr>
<tr><td><code>update_workflow</code></td><td>Actualiza nodos, ajustes o estado de activación.</td></tr>
<tr><td><code>delete_workflow</code></td><td>Elimina un workflow por id.</td></tr>
<tr><td><code>execute_workflow</code></td><td>Lanza una ejecución manual y transmite el resultado.</td></tr>
<tr><td><code>list_executions</code></td><td>Lista ejecuciones recientes con filtros de estado.</td></tr>
<tr><td><code>get_execution</code></td><td>Inspecciona los datos y errores de una ejecución.</td></tr>
</tbody>
</table>
<h2 id="knowledge">Herramientas de conocimiento</h2>
<p>Consultas de solo lectura sobre el catálogo de nodos n8n integrado. Funcionan con datos locales y no llaman a tu n8n.</p>
<table>
<thead><tr><th>Herramienta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td><code>search_nodes</code></td><td>Búsqueda full-text en nodos core y community.</td></tr>
<tr><td><code>get_node_info</code></td><td>Devuelve parámetros, credenciales y operaciones de un nodo.</td></tr>
<tr><td><code>list_node_categories</code></td><td>Explora nodos agrupados por categoría (IA, Datos, Comms…).</td></tr>
<tr><td><code>get_node_examples</code></td><td>Devuelve workflows de ejemplo canónicos para un nodo.</td></tr>
</tbody>
</table>
<h2 id="management">Herramientas de gestión</h2>
<p>Operaciones administrativas contra la API REST de n8n. Solo disponibles para claves con scope <code>management</code>.</p>
<table>
<thead><tr><th>Herramienta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td><code>list_credentials</code></td><td>Lista credenciales (sin valores secretos).</td></tr>
<tr><td><code>list_users</code></td><td>Lista usuarios de tu instancia n8n.</td></tr>
<tr><td><code>list_projects</code></td><td>Lista proyectos n8n (Enterprise).</td></tr>
<tr><td><code>list_tags</code></td><td>Lista tags de workflows.</td></tr>
<tr><td><code>get_audit</code></td><td>Ejecuta un audit de n8n y devuelve el reporte de seguridad.</td></tr>
</tbody>
</table>
<h2 id="errors">Semántica de errores</h2>
<p>Los errores se devuelven como resultados MCP <code>isError: true</code> con un mensaje saneado. La pasarela nunca reenvía stack traces crudos de n8n al cliente.</p>`,
  },
  quotas: {
    title: "Cuotas y facturación — Documentación n8n-mcp",
    description: "Cuotas de petición por clave, límites por plan y cómo se mide el uso de las llamadas MCP.",
    h1: "Cuotas y facturación",
    body: `<p>La pasarela mide el uso por clave API de plataforma. Cada llamada MCP cuenta como una petición, sin importar el tamaño del payload.</p>
<h2 id="plans">Límites por plan</h2>
<table>
<thead><tr><th>Plan</th><th>Peticiones / mes</th><th>Instancias n8n</th><th>Claves API</th></tr></thead>
<tbody>
<tr><td>Free</td><td>1.000</td><td>1</td><td>2</td></tr>
<tr><td>Pro</td><td>50.000</td><td>5</td><td>20</td></tr>
<tr><td>Team</td><td>250.000</td><td>Ilimitadas</td><td>Ilimitadas</td></tr>
</tbody>
</table>
<p>Los despliegues auto-alojados no tienen cuota forzada; los mismos contadores se registran para observabilidad.</p>
<h2 id="counting">Qué cuenta como petición</h2>
<ul>
<li>Cada MCP <code>tools/call</code> = 1 petición.</li>
<li>Los handshakes <code>tools/list</code> e <code>initialize</code> son gratis.</li>
<li>Las llamadas fallidas (4xx devueltos por la pasarela) también cuentan.</li>
<li>Los reintentos del cliente cuentan por separado.</li>
</ul>
<h2 id="windows">Ventana de reset</h2>
<p>Los contadores se resetean el primer día de cada mes a las <code>00:00 UTC</code>. El uso actual se ve en la cabecera del panel y en cada fila de clave API.</p>
<h2 id="overages">Al superar la cuota</h2>
<p>Las llamadas devuelven el error MCP <code>QUOTA_EXCEEDED</code> con HTTP <code>429</code>. La pasarela añade una cabecera <code>Retry-After</code> apuntando al próximo reset.</p>
<h2 id="upgrading">Mejorar de plan</h2>
<p>Abre <code>Panel → Facturación</code> para cambiar de plan. La nueva cuota es efectiva al instante y se prorratea para el periodo en curso.</p>`,
  },
  security: {
    title: "Seguridad — Documentación n8n-mcp",
    description: "Cifrado en reposo, protección SSRF, políticas RLS y modelo de amenazas de la pasarela.",
    h1: "Seguridad",
    body: `<p>La pasarela media el tráfico MCP entre clientes de IA y tu n8n. Está diseñada para que una clave de plataforma comprometida no pueda alcanzar redes privadas, exfiltrar datos de otros tenants ni escalar a admin.</p>
<h2 id="key-storage">Almacenamiento de credenciales</h2>
<ul>
<li>Las <strong>claves API de plataforma</strong> (<code>nmcp_…</code>) se hashean con SHA-256 antes de guardarse. Solo se conserva una pista <code>last4</code> para mostrar.</li>
<li>Las <strong>claves API de n8n</strong> se cifran en reposo con una clave de servidor (AES-GCM). El texto plano solo existe en memoria durante una petición proxificada.</li>
<li>El acceso service-role a la BD es exclusivo del servidor; el navegador nunca lo ve.</li>
</ul>
<h2 id="ssrf">Guardia SSRF</h2>
<p>Cada URL controlada por el usuario que el servidor resuelve pasa por <code>assertPublicUrl()</code>. Rechaza:</p>
<ul>
<li>Direcciones loopback (<code>127.0.0.0/8</code>, <code>::1</code>).</li>
<li>Rangos privados RFC1918 y link-local IPv4/IPv6.</li>
<li>Endpoints de metadata cloud (<code>169.254.169.254</code>, equivalentes en GCP/Azure).</li>
<li>Esquemas no <code>http(s)</code> (<code>file:</code>, <code>gopher:</code>…).</li>
<li>DNS rebinding — los nombres se resuelven y la IP se vuelve a comprobar.</li>
</ul>
<h2 id="rls">Row-level security</h2>
<p>Los datos por tenant (workspaces, claves API, instancias n8n, logs de auditoría) están protegidos por RLS de Postgres acotado a <code>auth.uid()</code>. Las tablas admin (roles, audit, secrets) están explícitamente excluidas de la realtime publication.</p>
<h2 id="roles">Roles y admin</h2>
<p>Los roles viven en una tabla dedicada <code>user_roles</code> y se comprueban con la función security-definer <code>has_role()</code>. El rol admin nunca se deriva del almacenamiento del cliente.</p>
<h2 id="errors">Saneado de errores</h2>
<p>Las server functions capturan errores upstream y devuelven mensajes genéricos seguros para el usuario. Los stack traces y excepciones del runtime edge solo se loguean en servidor.</p>
<h2 id="reporting">Reportar una vulnerabilidad</h2>
<p>Escribe a <code>security@n8nmcp.lovable.app</code> con pasos de reproducción. No abras issues públicas para reportes de seguridad.</p>`,
  },
};

export default docs;