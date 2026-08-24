/**
 * Bridges 192.168.5.200:4001 and :9000 → 127.0.0.1 so mobile devices
 * on the same WiFi can reach the TinaCMS content API (which only binds
 * to loopback). Run alongside `npm run dev`.
 *
 * Port 4001 uses an HTTP proxy so we can inject CORS headers — without them
 * the browser blocks cross-origin <script type="module"> on the network IP.
 * Port 9000 (datalayer) is plain TCP.
 */
import http from 'http';
import net from 'net';
import os from 'os';

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '0.0.0.0';
}

function tcpProxy(listenPort, targetPort, host) {
  const server = net.createServer(socket => {
    const upstream = net.createConnection({ host: '127.0.0.1', port: targetPort });
    socket.pipe(upstream);
    upstream.pipe(socket);
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
  });
  server.listen(listenPort, host, () =>
    console.log(`  proxy       ${host}:${listenPort} → 127.0.0.1:${targetPort}`)
  );
}

function httpCorsProxy(listenPort, targetPort, host) {
  const server = http.createServer((req, res) => {
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${targetPort}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
          ...proxyRes.headers,
          'access-control-allow-origin': '*',
          'access-control-allow-methods': '*',
          'access-control-allow-headers': '*',
        });
        proxyRes.pipe(res);
      }
    );
    req.pipe(proxyReq);
    proxyReq.on('error', () => res.end());
  });

  // WebSocket passthrough for Vite HMR
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.createConnection({ host: '127.0.0.1', port: targetPort });
    upstream.on('connect', () => {
      const headers = { ...req.headers, host: `localhost:${targetPort}` };
      const headerLines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
      socket.on('error', () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
    });
  });

  server.listen(listenPort, host, () =>
    console.log(`  cors-proxy  ${host}:${listenPort} → 127.0.0.1:${targetPort}`)
  );
}

const ip = getLocalIP();
console.log(`TinaCMS network proxy (local IP: ${ip})`);
httpCorsProxy(4001, 4001, ip);
tcpProxy(9000, 9000, ip);
