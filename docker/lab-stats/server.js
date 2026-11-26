const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 8080;
const CACHE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;

const config = {
  pveUrl: process.env.PVE_URL,
  pveNode: process.env.PVE_NODE,
  pveTokenUser: process.env.PVE_TOKEN_USER,
  pveTokenId: process.env.PVE_TOKEN_ID,
  pveTokenSecret: process.env.PVE_TOKEN_SECRET,
  kumaUrl: process.env.KUMA_URL,
  kumaSlug: process.env.KUMA_SLUG,
  piholeUrl: process.env.PIHOLE_URL,
  piholePassword: process.env.PIHOLE_PASSWORD,
  portainerUrl: process.env.PORTAINER_URL,
  portainerEndpointId: process.env.PORTAINER_ENDPOINT_ID,
  portainerApiKey: process.env.PORTAINER_API_KEY
};

const required = Object.entries(config);

for (const [name, value] of required) {
  if (!value) {
    throw new Error(`Missing required environment variable for ${name}`);
  }
}

const pveAuth = `PVEAPIToken=${config.pveTokenUser}!${config.pveTokenId}=${config.pveTokenSecret}`;

let cache = null;
let cacheTime = 0;
let refreshPromise = null;
let piholeSession = null;
let shuttingDown = false;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response;
}

async function getJson(url, options = {}) {
  const response = await request(url, options);
  return response.json();
}

async function getProxmox() {
  const headers = {
    Authorization: pveAuth
  };

  const [node, resources] = await Promise.all([
    getJson(
      `${config.pveUrl}/api2/json/nodes/${encodeURIComponent(config.pveNode)}/status`,
      { headers }
    ),
    getJson(
      `${config.pveUrl}/api2/json/cluster/resources?type=vm`,
      { headers }
    )
  ]);

  const status = node.data;
  const vms = resources.data;

  if (!status || !Array.isArray(vms)) {
    throw new Error('Unexpected Proxmox response');
  }

  const nodeVms = vms.filter(vm => vm.type === 'qemu' || vm.type === 'lxc');
  const running = nodeVms.filter(vm => vm.status === 'running');

  return {
    ok: true,
    cpu: status.cpu,
    memUsed: status.memory?.used ?? 0,
    memTotal: status.memory?.total ?? 0,
    vmsRunning: running.length,
    vmsTotal: nodeVms.length,
    uptime: status.uptime
  };
}

async function getKuma() {
  const url =
    `${config.kumaUrl}/api/status-page/heartbeat/` +
    encodeURIComponent(config.kumaSlug);

  const data = await getJson(url);

  const heartbeatList = data.heartbeatList;

  if (!heartbeatList || typeof heartbeatList !== 'object') {
    throw new Error('Unexpected Uptime Kuma response');
  }

  const latest = Object.values(heartbeatList)
    .map(heartbeats => Array.isArray(heartbeats) ? heartbeats.at(-1) : null)
    .filter(Boolean);

  const up = latest.filter(heartbeat => heartbeat.status === 1).length;

  const uptimeValues = Object.values(data.uptimeList ?? {})
    .map(value => Number(value['24']))
    .filter(Number.isFinite);

  return {
    ok: true,
    up,
    total: latest.length,
    uptime24h: uptimeValues.length
      ? uptimeValues.reduce((sum, value) => sum + value, 0) / uptimeValues.length
      : 0
  };
}

async function loginPiHole() {
  const data = await getJson(`${config.piholeUrl}/api/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      password: config.piholePassword
    })
  });

  const sid = data.session?.sid;

  if (!sid || data.session?.valid === false) {
    throw new Error('Pi-hole authentication failed');
  }

  piholeSession = sid;
}

async function logoutPiHole() {
  if (!piholeSession) return;

  const sid = piholeSession;
  piholeSession = null;

  try {
    await fetch(`${config.piholeUrl}/api/auth`, {
      method: 'DELETE',
      headers: {
        'X-FTL-SID': sid
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    // Shutdown should not be blocked by a failed logout.
  }
}

async function getPiHole() {
  if (!piholeSession) {
    await loginPiHole();
  }

  let response = await fetch(`${config.piholeUrl}/api/stats/summary`, {
    headers: {
      'X-FTL-SID': piholeSession
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (response.status === 401) {
    piholeSession = null;
    await loginPiHole();

    response = await fetch(`${config.piholeUrl}/api/stats/summary`, {
      headers: {
        'X-FTL-SID': piholeSession
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  const queries = data.queries?.total ?? 0;
  const blocked = data.queries?.blocked ?? 0;

  return {
    ok: true,
    queries,
    blocked,
    percentBlocked: queries ? blocked / queries : 0
  };
}

async function getDocker() {
  const url =
    `${config.portainerUrl}/api/endpoints/` +
    `${encodeURIComponent(config.portainerEndpointId)}/docker/containers/json?all=1`;

  const containers = await getJson(url, {
    headers: {
      'X-API-Key': config.portainerApiKey
    }
  });

  if (!Array.isArray(containers)) {
    throw new Error('Unexpected Portainer response');
  }

  const running = containers.filter(
    container => container.State === 'running'
  ).length;

  return {
    ok: true,
    running,
    total: containers.length,
    stopped: containers.length - running
  };
}

async function safeSource(name, getter, fallback) {
  try {
    return await getter();
  } catch (error) {
    console.error(`${name} stats unavailable: ${error.message}`);
    return fallback;
  }
}

async function refreshStats() {
  const [proxmox, kuma, pihole,docker] = await Promise.all([
    safeSource('Proxmox', getProxmox, {
      ok: false,
      cpu: 0,
      memUsed: 0,
      memTotal: 0,
      vmsRunning: 0,
      vmsTotal: 0,
      uptime: 0
    }),
    safeSource('Uptime Kuma', getKuma, {
      ok: false,
      up: 0,
      total: 0,
      uptime24h: 0
    }),
    safeSource('Pi-hole', getPiHole, {
      ok: false,
      queries: 0,
      blocked: 0,
      percentBlocked: 0
    }),
     safeSource('Portainer', getDocker, {
      ok: false,
      running: 0,
      total: 0,
      stopped: 0
    })
  ]);

  cache = {
    updated: new Date().toISOString(),
    proxmox,
    kuma,
    pihole,
    docker
  };

  cacheTime = Date.now();
  return cache;
}

async function getStats() {
  if (cache && Date.now() - cacheTime < CACHE_MS) {
    return cache;
  }

  if (!refreshPromise) {
    refreshPromise = refreshStats().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

const publicDir = path.join(__dirname, 'public');

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/stats') {
    try {
      const stats = await getStats();

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });

      res.end(JSON.stringify(stats));
    } catch {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8'
      });

      res.end(JSON.stringify({ error: 'Stats refresh failed' }));
    }

    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    try {
      const html = fs.readFileSync(path.join(publicDir, 'index.html'));

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });

      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Page unavailable');
    }

    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Lab stats listening on port ${PORT}`);
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  server.close();

  await logoutPiHole();

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
