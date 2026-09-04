#!/bin/sh
set -eu

BACKEND_URL_VALUE="${BACKEND_URL:-http://localhost:8080}"
ESCAPED_BACKEND_URL=$(printf '%s' "$BACKEND_URL_VALUE" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > /usr/share/nginx/html/env.js <<EOF
window.__PFI_CONFIG__ = {"API_BASE_URL":"$ESCAPED_BACKEND_URL"};
EOF

# Cloud Run injects the port to listen on via $PORT at container start; a
# plain local `docker run` (no PORT set) keeps the historical default of 80.
# nginx.conf ships with a literal placeholder (not a real nginx variable,
# so this never collides with $uri/$document_root/etc.) rewritten in place
# here, same "generate a runtime file from an env var" pattern already used
# above for env.js.
NGINX_PORT_VALUE="${PORT:-80}"
sed -i "s/__PFI_NGINX_PORT__/$NGINX_PORT_VALUE/" /etc/nginx/conf.d/default.conf
