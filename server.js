const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

if (typeof fetch !== 'function') {
  throw new Error('This server requires Node.js 18+ with global fetch support.');
}

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

loadEnv();

const CONFIG = {
  panelBaseUrl: (process.env.PTERODACTYL_BASE_URL || '').replace(/\/$/, ''),
  appKey: process.env.PTERODACTYL_APP_KEY || '',
  defaultAllocationId: process.env.PTERODACTYL_ALLOCATION_ID || '',
  nestId: parseInt(process.env.PTERODACTYL_NEST_ID || '1', 10),
  eggId: parseInt(process.env.PTERODACTYL_EGG_ID || '20', 10),
  memoryMb: parseInt(process.env.PTERODACTYL_MEMORY_MB || '3072', 10),
  diskMb: parseInt(process.env.PTERODACTYL_DISK_MB || '10240', 10),
  swapMb: parseInt(process.env.PTERODACTYL_SWAP_MB || '1024', 10),
  cpuLimit: parseInt(process.env.PTERODACTYL_CPU_LIMIT || '200', 10),
};

validateConfig(CONFIG);

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && parsedUrl.pathname === '/api/register') {
    handleRegister(req, res).catch((error) => {
      console.error('[register] unhandled', error);
      sendJson(res, 500, {
        error: 'Unexpected error when creating your account. Please try again later.',
      });
    });
    return;
  }

  serveStatic(res, parsedUrl.pathname);
});

server.listen(PORT, () => {
  console.log(`WitchyWorlds site listening on port ${PORT}`);
});

function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const idx = trimmed.indexOf('=');
    if (idx === -1) {
      continue;
    }

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function validateConfig(config) {
  const missing = [];
  if (!config.panelBaseUrl) missing.push('PTERODACTYL_BASE_URL');
  if (!config.appKey) missing.push('PTERODACTYL_APP_KEY');
  if (!config.defaultAllocationId) missing.push('PTERODACTYL_ALLOCATION_ID');
  if (missing.length) {
    console.warn(
      `Warning: missing required environment variables: ${missing.join(', ')}. ` +
        'API registration requests will fail until these are configured.'
    );
  }
}

function serveStatic(res, pathname) {
  let safePath = pathname;
  if (safePath === '/' || safePath === '') {
    safePath = '/index.html';
  }

  const decoded = decodeURIComponent(safePath);
  const fullPath = path.join(ROOT_DIR, decoded);

  if (!fullPath.startsWith(ROOT_DIR)) {
    sendNotFound(res);
    return;
  }

  fs.stat(fullPath, (err, stats) => {
    if (err) {
      sendNotFound(res);
      return;
    }

    if (stats.isDirectory()) {
      serveStatic(res, path.join(decoded, 'index.html'));
      return;
    }

    const stream = fs.createReadStream(fullPath);
    stream.on('error', () => sendNotFound(res));
    res.writeHead(200, { 'Content-Type': getContentType(fullPath) });
    stream.pipe(res);
  });
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

async function handleRegister(req, res) {
  const body = await readJsonBody(req, res);
  if (!body) {
    return;
  }

  const { username = '', email = '', password = '' } = body;
  const trimmedUsername = username.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedPassword = password.trim();

  const errors = [];
  if (!trimmedUsername || trimmedUsername.length < 3) {
    errors.push('Username must be at least 3 characters long.');
  }
  if (!trimmedEmail || !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
    errors.push('A valid email address is required.');
  }
  if (!trimmedPassword || trimmedPassword.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }

  if (errors.length) {
    sendJson(res, 422, { error: errors.join(' ') });
    return;
  }

  if (!CONFIG.panelBaseUrl || !CONFIG.appKey || !CONFIG.defaultAllocationId) {
    sendJson(res, 500, {
      error:
        'Registration is not available right now. Please contact staff while we finish configuration.',
    });
    return;
  }

  let userExists = false;
  try {
    userExists = await findExistingUser(trimmedEmail, trimmedUsername);
  } catch (error) {
    console.error('[register] failed to check existing user', error);
    sendJson(res, 502, {
      error: 'We could not reach the panel to verify your account. Please try again in a moment.',
    });
    return;
  }

  if (userExists) {
    sendJson(res, 409, {
      error: 'An account with that email or username already exists on the panel.',
    });
    return;
  }

  let user;
  try {
    user = await createUser({
      email: trimmedEmail,
      username: trimmedUsername,
      password: trimmedPassword,
    });
  } catch (error) {
    console.error('[register] failed to create user', error);
    sendJson(res, 502, {
      error:
        error.message ||
        'We could not create your panel account right now. Please try again or contact staff.',
    });
    return;
  }

  try {
    await ensureServerForUser(user);
  } catch (error) {
    console.error('[register] failed to create server', error);
    await deleteUserSafe(user.id);
    sendJson(res, 502, {
      error:
        'We created your panel login but could not provision the server. Please try again or reach out to staff.',
    });
    return;
  }

  sendJson(res, 201, {
    message:
      'Your WitchyWorlds panel account and starter server are ready! You can log in at the panel using the credentials you just provided.',
  });
}

async function readJsonBody(req, res) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        data = '';
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large.' }));
        req.connection.destroy();
        resolve(null);
      }
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        const json = JSON.parse(data);
        resolve(json);
      } catch (err) {
        sendJson(res, 400, { error: 'Invalid JSON payload.' });
        resolve(null);
      }
    });
  });
}

async function findExistingUser(email, username) {
  const urlEmail = `${CONFIG.panelBaseUrl}/api/application/users?filter[email]=${encodeURIComponent(
    email
  )}`;
  const urlUsername = `${CONFIG.panelBaseUrl}/api/application/users?filter[username]=${encodeURIComponent(
    username
  )}`;

  const [byEmail, byUsername] = await Promise.all([
    pterodactylFetch(urlEmail),
    pterodactylFetch(urlUsername),
  ]);

  return (
    (byEmail && Array.isArray(byEmail.data) && byEmail.data.length > 0) ||
    (byUsername && Array.isArray(byUsername.data) && byUsername.data.length > 0)
  );
}

async function createUser({ email, username, password }) {
  const payload = {
    email,
    username,
    first_name: username.substring(0, 30) || 'Player',
    last_name: 'Witchy',
    password,
  };

  const response = await pterodactylFetch(
    `${CONFIG.panelBaseUrl}/api/application/users`,
    'POST',
    payload
  );

  if (!response || !response.attributes) {
    throw new Error('Unable to create user.');
  }

  return response.attributes;
}

async function ensureServerForUser(user) {
  const externalId = `witchyworlds-user-${user.id}`;
  const existingServer = await pterodactylFetch(
    `${CONFIG.panelBaseUrl}/api/application/servers?filter[external_id]=${encodeURIComponent(
      externalId
    )}`
  );

  if (existingServer && Array.isArray(existingServer.data) && existingServer.data.length > 0) {
    return existingServer.data[0].attributes;
  }

  const egg = await loadEggDetails();
  const environment = buildEnvironmentFromEgg(egg);

  const payload = {
    name: `${user.username}-server`.substring(0, 191) || `witchyworlds-${user.id}`,
    user: user.id,
    external_id: externalId,
    nest: CONFIG.nestId,
    egg: CONFIG.eggId,
    docker_image: egg.attributes.docker_image,
    startup: egg.attributes.startup,
    limits: {
      memory: CONFIG.memoryMb,
      swap: CONFIG.swapMb,
      disk: CONFIG.diskMb,
      io: 500,
      cpu: CONFIG.cpuLimit,
    },
    feature_limits: {
      databases: 0,
      backups: 1,
    },
    allocation: {
      default: parseInt(CONFIG.defaultAllocationId, 10),
    },
    environment,
    start_on_completion: true,
  };

  const response = await pterodactylFetch(
    `${CONFIG.panelBaseUrl}/api/application/servers`,
    'POST',
    payload
  );

  if (!response || !response.attributes) {
    throw new Error('Unable to create server for user.');
  }

  return response.attributes;
}

let cachedEgg = null;
async function loadEggDetails() {
  if (cachedEgg) {
    return cachedEgg;
  }

  const url = `${CONFIG.panelBaseUrl}/api/application/nests/${CONFIG.nestId}/eggs/${CONFIG.eggId}?include=variables`;
  const response = await pterodactylFetch(url);
  if (!response) {
    throw new Error('Unable to load egg details.');
  }

  cachedEgg = response;
  return response;
}

function buildEnvironmentFromEgg(egg) {
  const env = {};
  const relationships = egg && egg.attributes && egg.attributes.relationships;
  if (relationships && relationships.variables && Array.isArray(relationships.variables.data)) {
    for (const variable of relationships.variables.data) {
      const attr = variable.attributes;
      env[attr.env_variable] = attr.default_value || '';
    }
  }
  return env;
}

async function deleteUserSafe(userId) {
  if (!userId) {
    return;
  }

  try {
    await pterodactylFetch(
      `${CONFIG.panelBaseUrl}/api/application/users/${userId}`,
      'DELETE'
    );
  } catch (error) {
    console.error('[register] cleanup failed', error);
  }
}

async function pterodactylFetch(url, method = 'GET', body) {
  const headers = {
    Authorization: `Bearer ${CONFIG.appKey}`,
    Accept: 'application/json',
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Pterodactyl API error ${response.status}: ${text}`);
    let errorMessage = 'Panel API request failed.';
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.errors && parsed.errors.length) {
        errorMessage = parsed.errors.map((err) => err.detail || err.code).join(' ');
      }
    } catch (err) {
      // ignore parse error
    }

    throw new Error(errorMessage);
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    return { raw: text };
  }
}

function sendJson(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}
