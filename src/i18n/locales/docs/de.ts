import type en from "./en";

const docs: typeof en = {
  nav: {
    sections: {
      introduction: "Einführung",
      connectClient: "Client verbinden",
      configuration: "Konfiguration",
      operations: "Betrieb",
    },
    items: {
      overview: "Übersicht",
      gettingStarted: "Schnellstart",
      concepts: "Konzepte",
      clients: "Alle MCP-Clients",
      apiKeys: "API-Schlüssel",
      n8nInstances: "n8n-Instanzen",
      tools: "MCP-Tool-Referenz",
      quotas: "Kontingente & Abrechnung",
      security: "Sicherheit",
      admin: "Admin-Leitfaden",
      selfHosting: "Self-Hosting",
      troubleshooting: "Fehlerbehebung",
    },
    mobileTitle: "Doku durchstöbern",
  },
  index: {
    title: "Dokumentation — n8n-mcp",
    description: "Vollständiges Betriebshandbuch für n8n-mcp: AI-Clients per Model Context Protocol an n8n anbinden, API-Schlüssel, n8n-Instanzen, Kontingente, Sicherheit und Admin-Aufgaben verwalten.",
    h1: "Dokumentation",
    lead: "n8n-mcp ist ein gehostetes Model-Context-Protocol-Gateway vor deiner n8n-Instanz. Jeder MCP-fähige Client kann deine Workflows als typisierte Tools auflisten und ausführen und über die mitgelieferte Wissensbasis von ~1.650 n8n-Nodes neue erstellen.",
    pickPrefix: "Wähle unten ein Thema oder springe direkt zu ",
    pickLink: "Schnellstart",
    pickSuffix: ".",
    cards: [
      { to: "/docs/getting-started", title: "Schnellstart", desc: "Registrieren, Schlüssel erzeugen, ersten Client in 5 Minuten verbinden." },
      { to: "/docs/concepts", title: "Konzepte", desc: "Wie MCP-Gateway, API-Schlüssel und n8n-Instanzen zusammenspielen." },
      { to: "/docs/clients", title: "Client verbinden", desc: "Konfigs für Claude, ChatGPT, Cursor, VS Code u. v. m." },
      { to: "/docs/api-keys", title: "API-Schlüssel", desc: "Plattform-Tokens erstellen, rotieren, sperren." },
      { to: "/docs/n8n-instances", title: "n8n-Instanzen", desc: "Self-Hosted oder Cloud n8n mit verschlüsselten Credentials anbinden." },
      { to: "/docs/tools", title: "MCP-Tool-Referenz", desc: "Alle Runtime-, Wissens- und Management-Tools des Gateways." },
      { to: "/docs/quotas", title: "Kontingente & Abrechnung", desc: "Plan-Limits, Nutzungs-Tracking und Upgrades." },
      { to: "/docs/security", title: "Sicherheit", desc: "Verschlüsselung at rest, SSRF-Schutz, RLS und Audit." },
    ],
  },
  gettingStarted: {
    title: "Schnellstart — n8n-mcp Dokumentation",
    description: "Registrieren, Plattform-API-Schlüssel anlegen, n8n-Instanz verbinden und ersten MCP-Client in unter fünf Minuten einrichten.",
    h1: "Schnellstart",
    body: `<p>Diese Anleitung dauert etwa fünf Minuten. Am Ende kann Claude (oder jeder andere MCP-Client) Workflows auf deiner n8n-Instanz auflisten und ausführen.</p>
<h2>1. Konto anlegen</h2>
<p>Registriere dich unter <a href="/signup">/signup</a> mit E-Mail + Passwort oder Google. Neue Konten starten im <strong>Free</strong>-Tarif (100 MCP-Aufrufe/Tag, 1 n8n-Instanz).</p>
<h2>2. Plattform-API-Schlüssel erzeugen</h2>
<ol>
<li>Öffne <a href="/api-keys">API Keys</a> im Dashboard.</li>
<li>Klick auf <strong>New key</strong> und gib ihm ein Label (z. B. <code>claude-laptop</code>).</li>
<li>Kopiere den <code>nmcp_…</code>-Token sofort — er wird nur einmal angezeigt.</li>
</ol>
<p>Behandle den Token wie ein Passwort. Wer ihn besitzt, kann unter deinem Kontingent das Gateway aufrufen.</p>
<h2>3. n8n-Instanz verbinden</h2>
<ol>
<li>Öffne <a href="/instances">n8n Instances</a> → <strong>Add</strong>.</li>
<li>Füge die n8n-Base-URL ein (z. B. <code>https://n8n.example.com</code>).</li>
<li>Erzeuge in n8n unter <em>Settings → n8n API</em> einen API-Schlüssel und füge ihn ein.</li>
<li>Wir verschlüsseln den Schlüssel mit AES-256-GCM, bevor er in die Datenbank gelangt.</li>
</ol>
<h2>4. MCP-Client einrichten</h2>
<p>Verbinde einen beliebigen MCP-Client mit der Gateway-URL und sende den Token im Bearer-Header:</p>
<pre>{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}</pre>
<p>Snippets je Client siehe <a href="/docs/clients">Client verbinden</a>.</p>
<h2>5. Ausprobieren</h2>
<p>Starte den Client neu. Frage: <em>„Liste meine n8n-Workflows."</em> Der Client sollte <code>list_workflows</code> auf deiner Instanz aufrufen und das Ergebnis liefern.</p>
<h2>Wie geht's weiter?</h2>
<ul>
<li><a href="/docs/tools">Vollständigen Tool-Katalog ansehen</a></li>
<li><a href="/docs/quotas">Kontingente und Upgrade-Wege verstehen</a></li>
<li><a href="/docs/security">Sicherheitsmodell lesen</a></li>
</ul>`,
  },
  concepts: {
    title: "Konzepte — n8n-mcp Dokumentation",
    description: "Wie n8n-mcp-Gateway, Plattform-API-Schlüssel, n8n-Instanzen und MCP-Tools zusammenspielen.",
    h1: "Konzepte",
    body: `<p>Drei Primitive reichen, um das ganze System zu verstehen.</p>
<h2>Das Gateway</h2>
<p>Ein mandantenfähiger HTTPS-Endpunkt unter <code>/api/public/mcp</code>, der das Model Context Protocol über Streamable HTTP spricht. Er authentifiziert Anfragen per Plattform-API-Schlüssel, ermittelt die Ziel-n8n-Instanz und übersetzt jeden MCP-Tool-Aufruf in den passenden n8n-REST-Request.</p>
<h2>Plattform-API-Schlüssel</h2>
<p>Tokens mit Präfix <code>nmcp_</code>, die <em>dein Konto</em> gegenüber dem Gateway identifizieren. Dein MCP-Client sendet sie als <code>Authorization: Bearer …</code>. Mehrere Schlüssel pro Konto sind möglich — am besten einen pro Gerät/Workspace, damit du sie einzeln sperren kannst.</p>
<h2>n8n-Instanzen</h2>
<p>Ein Paar <code>(Base-URL, n8n-API-Schlüssel)</code> in deinem Konto. Der n8n-API-Schlüssel ist mit AES-256-GCM at rest verschlüsselt. Der Free-Tarif erlaubt eine Instanz; bezahlte Tarife mehr. Das Gateway gibt den n8n-Schlüssel niemals an Clients zurück.</p>
<h2>Tool-Routing</h2>
<p>Wenn dein Client ein Tool aufruft, tut das Gateway:</p>
<ol>
<li>Bearer-Token prüfen, Eigentümer-Konto auflösen.</li>
<li>Tageskontingent prüfen; bei Erschöpfung <code>429</code>.</li>
<li>Bei Runtime-Tools (<code>list_workflows</code>, <code>execute_workflow</code>, …) den n8n-Schlüssel im Speicher entschlüsseln und proxien.</li>
<li>Bei Wissens-Tools (<code>search_nodes</code>, <code>get_node_essentials</code>, …) Ergebnisse aus der mitgelieferten SQLite-Wissensbasis liefern — kein n8n-Aufruf.</li>
<li>Nutzung für Dashboard und Abrechnung protokollieren.</li>
</ol>
<h2>Warum ein Gateway?</h2>
<ul>
<li>Dein n8n-API-Schlüssel verlässt nie den Server.</li>
<li>Stabile URL, auch wenn du n8n neu deployst.</li>
<li>Pro-Tool-Kontingente und Observability über alle Clients.</li>
<li>Eingebautes Wissen über ~1.650 n8n-Nodes für AI-Authoring.</li>
</ul>`,
  },
  clients: {
    title: "Beliebigen MCP-Client verbinden — n8n-mcp Dokumentation",
    description: "Konfigurations-Snippets für Claude Desktop, Claude Code, ChatGPT, Cursor, Windsurf, VS Code, Continue, Cline, Zed, Gemini CLI und Codex CLI.",
    h1: "Client verbinden",
    body: `<p>Jeder MCP-kompatible Client nutzt dieselbe Gateway-URL und denselben Bearer-Token. Nur der Pfad der Konfigurationsdatei ändert sich.</p>
<p>Endpunkt: <code>https://n8nmcp.lovable.app/api/public/mcp</code></p>
<h2 id="claude-desktop">Claude Desktop</h2>
<p>Bearbeite unter macOS <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> oder unter Windows <code>%APPDATA%\\Claude\\claude_desktop_config.json</code>:</p>
<pre>{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}</pre>
<p>Claude beenden und neu öffnen. Im Hammer-Icon erscheinen die n8n-mcp-Tools.</p>
<h2 id="claude-code">Claude Code</h2>
<pre>claude mcp add --transport http n8n-mcp https://n8nmcp.lovable.app/api/public/mcp \\
  --header "Authorization: Bearer nmcp_..."</pre>
<h2 id="chatgpt">ChatGPT (Custom Connectors)</h2>
<p>In ChatGPT-Einstellungen → Connectors → <strong>Custom Connector hinzufügen</strong>:</p>
<ul>
<li>URL: <code>https://n8nmcp.lovable.app/api/public/mcp</code></li>
<li>Auth-Header: <code>Authorization: Bearer nmcp_...</code></li>
</ul>
<h2 id="cursor">Cursor</h2>
<p>Cursor-Einstellungen → MCP → <strong>Add new MCP server</strong>, denselben JSON-Block wie bei Claude Desktop einfügen.</p>
<h2 id="windsurf">Windsurf</h2>
<p>Settings → MCP servers → <code>mcp_config.json</code> mit dem obigen Standard-<code>mcpServers</code>-Block bearbeiten.</p>
<h2 id="vscode">VS Code (Copilot Chat) &amp; Continue</h2>
<p>Beide bieten in den Einstellungen eine MCP-Server-Liste. Gateway-URL und Bearer-Header eintragen.</p>
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
<p>Alle drei nutzen JSON-Konfigs mit derselben URL + Header. Den exakten Dateinamen findest du in der MCP-Doku des jeweiligen Tools.</p>
<h2 id="verifying">Verbindung prüfen</h2>
<p>Nach der Konfiguration frag: <em>„Welche n8n-Tools hast du?"</em>. Der Client sollte <code>list_workflows</code>, <code>execute_workflow</code>, die Wissens-Tools und alle Management-Tools auflisten, auf die du Zugriff hast.</p>`,
  },
  apiKeys: {
    title: "Plattform-API-Schlüssel — n8n-mcp Dokumentation",
    description: "Erstelle, beschrifte, rotiere und sperre nmcp_-Plattform-API-Schlüssel für deine MCP-Clients.",
    h1: "Plattform-API-Schlüssel",
    body: `<p>Plattform-API-Schlüssel (Präfix <code>nmcp_</code>) authentifizieren deinen MCP-Client gegenüber dem Gateway. Sie sind <em>nicht</em> dein n8n-API-Schlüssel — der bleibt serverseitig.</p>
<h2>Schlüssel erzeugen</h2>
<ol>
<li>Öffne <a href="/api-keys">API Keys</a>.</li>
<li>Klick <strong>New key</strong> und gib ein Label (z. B. <code>cursor-work</code>).</li>
<li>Kopiere den angezeigten Token sofort. Nach dem Schließen bleiben in der DB nur Präfix und Hash.</li>
</ol>
<h2>Best Practices</h2>
<ul>
<li>Ein Schlüssel pro Gerät/Workspace, damit du sie einzeln sperren kannst.</li>
<li>Niemals in Git committen oder im Chat teilen. Wie ein Passwort behandeln.</li>
<li>Quartalsweise rotieren oder wenn jemand das Team verlässt.</li>
</ul>
<h2>Schlüssel rotieren</h2>
<p>In-place-Rotation wird derzeit nicht unterstützt. Neuen Schlüssel erzeugen, Client-Konfig aktualisieren, alten Schlüssel auf derselben Seite sperren.</p>
<h2>Schlüssel sperren</h2>
<p>Klick das Mülleimer-Icon neben dem Schlüssel. Sofort wirksam — der nächste Aufruf mit diesem Token liefert <code>401</code>.</p>
<h2>Kontingente</h2>
<p>Kontingente gelten pro Konto, nicht pro Schlüssel. Mehr Schlüssel erhöhen das Tageslimit nicht. Siehe <a href="/docs/quotas">Kontingente &amp; Abrechnung</a>.</p>`,
  },
  n8nInstances: {
    title: "n8n-Instanzen — n8n-mcp Dokumentation",
    description: "Verbinde deine self-hosted oder n8n.cloud-Instanz, speichere API-Schlüssel verschlüsselt und schütze dich vor SSRF.",
    h1: "n8n-Instanzen",
    body: `<p>Eine <strong>Instanz</strong> ist ein einzelnes n8n-Deployment, mit dem das Gateway sprechen kann. Du kannst eine (n8n.cloud) oder mehrere (per Umgebung self-hosted) registrieren.</p>
<h2 id="add">Instanz hinzufügen</h2>
<ol>
<li>Öffne <code>Dashboard → n8n instances → New instance</code>.</li>
<li>Vergib ein Label (z. B. <code>prod</code>, <code>staging</code>).</li>
<li>Füge die <strong>Base-URL</strong> deines n8n ein (ohne <code>/rest</code> am Ende). Beispiele: <code>https://n8n.example.com</code>, <code>https://your-tenant.app.n8n.cloud</code>.</li>
<li>Füge einen <strong>n8n-API-Schlüssel</strong> aus <code>n8n → Settings → n8n API → Create API key</code> ein.</li>
</ol>
<h2 id="encryption">Wie Schlüssel gespeichert werden</h2>
<p>n8n-API-Schlüssel werden mit einem serverseitigen Key at rest verschlüsselt. Sie werden nur im Speicher entschlüsselt, wenn das Gateway proxiert, und nach dem ersten Speichern nie wieder an Clients zurückgegeben.</p>
<h2 id="ssrf">SSRF-Schutz</h2>
<p>Vor jedem ausgehenden Request läuft <code>assertPublicUrl()</code> über die Instanz-URL. URLs, die in private/loopback-Bereiche (<code>127.0.0.0/8</code>, <code>10.0.0.0/8</code>, <code>172.16.0.0/12</code>, <code>192.168.0.0/16</code>, IPv6 link-local etc.) auflösen, werden abgelehnt. Bei Self-Hosting im privaten Netz: per öffentlichem Hostnamen oder Reverse-Proxy exponieren.</p>
<h2 id="health">Health Checks</h2>
<p>Jede Instanz-Zeile zeigt den letzten erfolgreichen Kontakt und den letzten Fehler. <strong>Test connection</strong> führt <code>GET /rest/login</code> erneut aus, ohne etwas zu ändern.</p>
<h2 id="multiple">Bestimmte Instanz ansprechen</h2>
<p>Bei mehreren Instanzen akzeptieren MCP-Tool-Aufrufe einen <code>instance</code>-Parameter (das Label). Ohne diesen wird die Workspace-Default-Instanz verwendet.</p>
<h2 id="rotate">n8n-Schlüssel rotieren</h2>
<p>In n8n neuen Schlüssel erzeugen, in der Instanz-Zeile einfügen und speichern. Der vorherige Ciphertext wird sofort überschrieben.</p>`,
  },
  tools: {
    title: "MCP-Tool-Referenz — n8n-mcp Dokumentation",
    description: "Vollständige Referenz der Runtime-, Wissens- und Management-Tools des n8n-mcp-Gateways.",
    h1: "MCP-Tool-Referenz",
    body: `<p>Tools sind in drei Kategorien gruppiert. Alle akzeptieren ein optionales <code>instance</code>-Argument, um eine bestimmte n8n-Instanz anzusprechen.</p>
<h2 id="runtime">Runtime-Tools</h2>
<p>Direkte Interaktion mit Workflows und Executions auf deinem n8n.</p>
<table>
<thead><tr><th>Tool</th><th>Beschreibung</th></tr></thead>
<tbody>
<tr><td><code>list_workflows</code></td><td>Workflows mit Filtern auflisten (aktiv, Tags, Projekt).</td></tr>
<tr><td><code>get_workflow</code></td><td>Workflow nach id abrufen, inkl. Nodes und Verbindungen.</td></tr>
<tr><td><code>create_workflow</code></td><td>Workflow aus JSON-Definition anlegen.</td></tr>
<tr><td><code>update_workflow</code></td><td>Nodes, Settings oder Aktivierungsstatus aktualisieren.</td></tr>
<tr><td><code>delete_workflow</code></td><td>Workflow nach id löschen.</td></tr>
<tr><td><code>execute_workflow</code></td><td>Manuelle Ausführung anstoßen, Ergebnis streamen.</td></tr>
<tr><td><code>list_executions</code></td><td>Letzte Executions mit Status-Filter auflisten.</td></tr>
<tr><td><code>get_execution</code></td><td>Daten und Fehler einer Execution einsehen.</td></tr>
</tbody>
</table>
<h2 id="knowledge">Wissens-Tools</h2>
<p>Read-only-Lookups auf den eingebauten n8n-Node-Katalog. Lokal, kein n8n-Aufruf.</p>
<table>
<thead><tr><th>Tool</th><th>Beschreibung</th></tr></thead>
<tbody>
<tr><td><code>search_nodes</code></td><td>Volltextsuche über Core- und Community-Nodes.</td></tr>
<tr><td><code>get_node_info</code></td><td>Parameter, Credentials und Operationen eines Nodes liefern.</td></tr>
<tr><td><code>list_node_categories</code></td><td>Nodes nach Kategorie (AI, Daten, Comms…) durchblättern.</td></tr>
<tr><td><code>get_node_examples</code></td><td>Kanonische Beispiel-Workflows zu einem Node liefern.</td></tr>
</tbody>
</table>
<h2 id="management">Management-Tools</h2>
<p>Administrative Aktionen gegen die n8n-REST-API. Nur für Schlüssel mit Scope <code>management</code>.</p>
<table>
<thead><tr><th>Tool</th><th>Beschreibung</th></tr></thead>
<tbody>
<tr><td><code>list_credentials</code></td><td>Credentials auflisten (ohne Geheimwerte).</td></tr>
<tr><td><code>list_users</code></td><td>Benutzer auf deiner n8n-Instanz auflisten.</td></tr>
<tr><td><code>list_projects</code></td><td>n8n-Projekte auflisten (Enterprise).</td></tr>
<tr><td><code>list_tags</code></td><td>Workflow-Tags auflisten.</td></tr>
<tr><td><code>get_audit</code></td><td>n8n-Audit ausführen, Sicherheitsbericht liefern.</td></tr>
</tbody>
</table>
<h2 id="errors">Fehler-Semantik</h2>
<p>Tool-Fehler werden als MCP-Ergebnisse mit <code>isError: true</code> und bereinigter Nachricht zurückgegeben. Das Gateway leitet keine rohen n8n-Stacktraces an Clients weiter.</p>`,
  },
  quotas: {
    title: "Kontingente & Abrechnung — n8n-mcp Dokumentation",
    description: "Request-Kontingente pro Schlüssel, Plan-Limits und wie MCP-Tool-Aufrufe gemessen werden.",
    h1: "Kontingente & Abrechnung",
    body: `<p>Das Gateway misst die Nutzung pro Plattform-API-Schlüssel. Jeder MCP-Tool-Aufruf zählt als ein Request, unabhängig von der Payload-Größe.</p>
<h2 id="plans">Plan-Limits</h2>
<table>
<thead><tr><th>Plan</th><th>Requests / Monat</th><th>n8n-Instanzen</th><th>API-Schlüssel</th></tr></thead>
<tbody>
<tr><td>Free</td><td>1.000</td><td>1</td><td>2</td></tr>
<tr><td>Pro</td><td>50.000</td><td>5</td><td>20</td></tr>
<tr><td>Team</td><td>250.000</td><td>Unbegrenzt</td><td>Unbegrenzt</td></tr>
</tbody>
</table>
<p>Self-hosted Deployments haben kein erzwungenes Kontingent; dieselben Zähler werden zur Beobachtung erfasst.</p>
<h2 id="counting">Was zählt als Request</h2>
<ul>
<li>Jedes MCP-<code>tools/call</code> = 1 Request.</li>
<li><code>tools/list</code>- und <code>initialize</code>-Handshakes sind kostenlos.</li>
<li>Fehlgeschlagene Aufrufe (4xx vom Gateway) zählen ebenfalls.</li>
<li>Vom Client ausgelöste Retries zählen separat.</li>
</ul>
<h2 id="windows">Reset-Fenster</h2>
<p>Zähler werden am 1. jedes Kalendermonats um <code>00:00 UTC</code> zurückgesetzt. Aktuelle Nutzung sichtbar im Dashboard-Header und in jeder API-Schlüssel-Zeile.</p>
<h2 id="overages">Bei Überschreitung</h2>
<p>Aufrufe liefern den MCP-Fehler <code>QUOTA_EXCEEDED</code> mit HTTP <code>429</code>. Das Gateway setzt einen <code>Retry-After</code>-Header zum nächsten Reset.</p>
<h2 id="upgrading">Upgrade</h2>
<p>Öffne <code>Dashboard → Billing</code>, um den Tarif zu wechseln. Das neue Kontingent ist sofort wirksam und wird im laufenden Abrechnungszeitraum anteilig berechnet.</p>`,
  },
  security: {
    title: "Sicherheit — n8n-mcp Dokumentation",
    description: "Verschlüsselung at rest, SSRF-Schutz, RLS-Policies und das Bedrohungsmodell des Gateways.",
    h1: "Sicherheit",
    body: `<p>Das Gateway vermittelt MCP-Traffic zwischen AI-Clients und deinem n8n. Es ist so gebaut, dass ein kompromittierter Plattform-Schlüssel keine privaten Netze erreicht, keine Daten anderer Mandanten exfiltriert und nicht zu Admin eskaliert.</p>
<h2 id="key-storage">Credential-Speicherung</h2>
<ul>
<li><strong>Plattform-API-Schlüssel</strong> (<code>nmcp_…</code>) werden vor Speicherung mit SHA-256 gehasht. Nur ein <code>last4</code>-Hinweis bleibt zur Anzeige.</li>
<li><strong>n8n-API-Schlüssel</strong> sind at rest mit einem serverseitigen Key (AES-GCM) verschlüsselt. Klartext existiert nur im Speicher während eines proxierten Requests.</li>
<li>Service-Role-DB-Zugriff ist serverseitig; der Browser sieht ihn nie.</li>
</ul>
<h2 id="ssrf">SSRF-Guard</h2>
<p>Jede vom Server aufgelöste, nutzergesteuerte URL läuft durch <code>assertPublicUrl()</code>. Abgelehnt werden:</p>
<ul>
<li>Loopback-Adressen (<code>127.0.0.0/8</code>, <code>::1</code>).</li>
<li>RFC1918 Private und IPv4/IPv6 link-local.</li>
<li>Cloud-Metadata-Endpunkte (<code>169.254.169.254</code>, GCP/Azure-Äquivalente).</li>
<li>Nicht-<code>http(s)</code>-Schemata (<code>file:</code>, <code>gopher:</code>…).</li>
<li>DNS-Rebinding — Namen werden aufgelöst und die IP erneut geprüft.</li>
</ul>
<h2 id="rls">Row-Level Security</h2>
<p>Mandantendaten (Workspaces, API-Schlüssel, n8n-Instanzen, Audit-Logs) sind durch Postgres-RLS auf <code>auth.uid()</code> beschränkt. Admin-Tabellen (Roles, Audit, Secrets) sind explizit aus der Realtime-Publication ausgeschlossen.</p>
<h2 id="roles">Rollen &amp; Admin</h2>
<p>Rollen liegen in einer eigenen <code>user_roles</code>-Tabelle und werden über die Security-Definer-Funktion <code>has_role()</code> geprüft. Die Admin-Rolle wird nie aus Client-Storage abgeleitet.</p>
<h2 id="errors">Fehler-Sanitisierung</h2>
<p>Server-Functions fangen Upstream-Fehler ab und liefern generische, nutzerfreundliche Meldungen. Stacktraces und Edge-Runtime-Exceptions werden nur serverseitig geloggt.</p>
<h2 id="reporting">Schwachstellen melden</h2>
<p>Schreib an <code>security@n8nmcp.lovable.app</code> mit Reproduktionsschritten. Bitte keine öffentlichen Issues für Sicherheitsmeldungen.</p>`,
  },
};

export default docs;