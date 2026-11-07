# Shared reverse proxy for the four frontend hosts (mcp, docs, blog,
# dashboard). Each vhost includes this file inside its `listen 443` server
# block; install-aapanel-nginx.sh copies it to /www/server/panel/vhost/nginx/.
# Every host proxies to the same app on 127.0.0.1:3001, which routes by Host
# (src/lib/site-domains.ts), so Host must reach the app unchanged.
#
# The directives below sit at server level so every location inherits them.
# nginx drops inherited add_header and proxy_set_header directives in any
# location that declares its own, so locations here must not declare either.

# Uploads (avatars, support attachments) up to 25 MB.
client_max_body_size 25m;

proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
# Append, never replace: the app trusts only the right-most X-Forwarded-For
# entry, which is the peer address nginx observed (src/lib/client-ip.server.ts).
# Do not enable real_ip_header/set_real_ip_from on these vhosts unless a CDN is
# really in front and the list is exactly that CDN's ranges.
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
# Next.js streams pages and route handlers; pass chunks through as they arrive.
proxy_buffering off;
proxy_read_timeout 300s;

# Baseline security headers. nginx is the only source of these six; hiding any
# upstream copy prevents duplicate values. The Content-Security-Policy is NOT set
# here: the app builds a per-request nonce policy (src/proxy.ts, src/lib/csp.ts)
# and a second CSP header would intersect with it and break pages. Paddle
# checkout runs in a Paddle iframe inside our page, so X-Frame-Options DENY on
# our own responses does not affect it.
proxy_hide_header Strict-Transport-Security;
proxy_hide_header X-Content-Type-Options;
proxy_hide_header X-Frame-Options;
proxy_hide_header Referrer-Policy;
proxy_hide_header Permissions-Policy;
proxy_hide_header Cross-Origin-Opener-Policy;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;

# MCP gateway (/mcp and the /api/public/mcp compatibility path): Streamable
# HTTP answers with server-sent events, which must not be buffered, cached or
# compressed, and a stream can stay open for a long time.
location ~ ^/(?:api/public/)?mcp$ {
    proxy_pass http://127.0.0.1:3001;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location / {
    proxy_pass http://127.0.0.1:3001;
}
