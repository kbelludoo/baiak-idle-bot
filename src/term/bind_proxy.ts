import http from 'http';
import net from 'net';

/**
 * Cria um micro-proxy HTTP CONNECT local para forçar todas as conexões
 * de saída (fetch e WebSocket) a usarem uma interface de rede ou IP específico (localAddress).
 * 
 * Extremamente leve (<100KB de RAM), zero dependências externas.
 */
export function setupOutboundBind(localAddress?: string): Promise<number | null> {
  if (!localAddress) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url!);
        const options = {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname + url.search,
          method: req.method,
          headers: req.headers,
          localAddress,
        };
        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on('error', () => {
          res.writeHead(502);
          res.end();
        });
        req.pipe(proxyReq);
      } catch (err) {
        res.writeHead(400);
        res.end();
      }
    });

    server.on('connect', (req, clientSocket, head) => {
      const [host, portStr] = (req.url || '').split(':');
      const port = parseInt(portStr, 10) || 443;
      const serverSocket = net.connect({ host, port, localAddress }, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      });
      serverSocket.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => serverSocket.destroy());
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      const proxyUrl = `http://127.0.0.1:${addr.port}`;
      process.env.HTTP_PROXY = proxyUrl;
      process.env.HTTPS_PROXY = proxyUrl;
      resolve(addr.port);
    });

    server.on('error', reject);
  });
}
