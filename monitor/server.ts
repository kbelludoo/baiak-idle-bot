const port = Number(process.env.PORT || 8081);
const bots = {
  vps1: process.env.VPS1_URL || 'http://host.docker.internal:8080',
  vps2: process.env.VPS2_URL || 'http://137.131.226.117:8080',
};

const html = await Bun.file('./index.html').text();
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning',
};

async function fetchBot(base: string, path: string): Promise<unknown> {
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const type = response.headers.get('content-type') || '';
    if (type.includes('image/')) return response.arrayBuffer();
    return response.json();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function botBundle(base: string) {
  const [status, benchmarks, matrix] = await Promise.all([
    fetchBot(base, '/api/status'),
    fetchBot(base, '/api/benchmarks'),
    fetchBot(base, '/api/matrix'),
  ]);
  return { status, benchmarks, matrix };
}

Bun.serve({
  port,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors } });
    }
    if (url.pathname === '/api/overview') {
      const [vps1, vps2] = await Promise.all([botBundle(bots.vps1), botBundle(bots.vps2)]);
      return Response.json({ generatedAt: new Date().toISOString(), bots: { vps1, vps2 } }, {
        headers: { 'Cache-Control': 'no-store', ...cors },
      });
    }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[monitor] http://0.0.0.0:${port}`);
