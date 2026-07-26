import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { spawn, ChildProcess, exec } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { Client } from 'ssh2';
import net from 'net';

// ssh2 has no support for OpenSSH certificate authentication. Two things are
// needed to add it:
//
//  1. `getKeyAlgos()` in ssh2/lib/client.js must know how to pick a signature
//     algorithm for `ssh-rsa-cert-v01@openssh.com` keys. That function is
//     module-local and not exported, so it cannot be patched at runtime — it is
//     patched at install time instead by patches/ssh2+1.17.0.patch (applied via
//     the `postinstall` script). Do NOT patch it here: in a packaged build
//     ssh2 lives inside a read-only app.asar and the write would fail silently.
//  2. The in-memory patches below, which make the parsed key present itself as
//     the certificate and fix up the USERAUTH_REQUEST packet layout.
function verifySsh2CertPatch() {
  try {
    const content = fs.readFileSync(require.resolve('ssh2/lib/client.js'), 'utf8');
    if (!content.includes('ssh-rsa-cert-v01@openssh.com')) {
      console.warn(
        'ssh2/lib/client.js is missing the certificate key-algo patch. ' +
        'SSH certificate authentication will not work. ' +
        'Run `npx patch-package` (or reinstall dependencies) to apply patches/ssh2+1.17.0.patch.'
      );
    }
  } catch (err) {
    console.error('Could not verify the ssh2 certificate patch:', err);
  }
}

verifySsh2CertPatch();

function applySSH2MonkeyPatches() {
  try {
    const keyParser = require('ssh2/lib/protocol/keyParser.js');
    const Protocol = require('ssh2/lib/protocol/Protocol.js');
    const utils = require('ssh2/lib/protocol/utils.js');
    const { writeUInt32BE } = utils;

    // 1. Monkey-patch keyParser.parseKey to auto-extract certificate from buffer.certificate
    const originalParseKey = keyParser.parseKey;
    keyParser.parseKey = function(data: any, passphrase: any) {
      const key = originalParseKey(data, passphrase);
      if (key && !(key instanceof Error) && data && data.certificate) {
        const certStr = data.certificate.toString().trim();
        const parts = certStr.split(/\s+/);
        if (parts.length >= 2) {
          const certBuffer = Buffer.from(parts[1], 'base64');
          const certKey = originalParseKey(data.certificate);
          if (certKey && !(certKey instanceof Error)) {
            key.type = certKey.type; // e.g. 'ssh-rsa-cert-v01@openssh.com'
            key.getPublicSSH = function() {
              return certBuffer; // Return the binary certificate buffer
            };
          }
        }
      }
      return key;
    };

    // 2. Monkey-patch Protocol.prototype.authPK to format signature block with base algorithm
    const originalAuthPK = Protocol.prototype.authPK;
    Protocol.prototype.authPK = function(username: any, pubKey: any, keyAlgo: any, cbSign: any) {
      if (!cbSign) {
        return originalAuthPK.call(this, username, pubKey, keyAlgo, cbSign);
      }
      
      const parsedKey = keyParser.parseKey(pubKey);
      if (parsedKey instanceof Error)
        throw new Error('Invalid key');

      const keyType = parsedKey.type;
      pubKey = parsedKey.getPublicSSH();

      if (!keyAlgo)
        keyAlgo = keyType;

      const userLen = Buffer.byteLength(username);
      const algoLen = Buffer.byteLength(keyAlgo);
      const pubKeyLen = pubKey.length;
      const sessionID = this._kex.sessionID;
      const sesLen = sessionID.length;
      const payloadLen = 4 + sesLen + 1 + 4 + userLen + 4 + 14 + 4 + 9 + 1 + 4 + algoLen + 4 + pubKeyLen;

      const packet = Buffer.allocUnsafe(payloadLen);
      let p = 0;
      writeUInt32BE(packet, sesLen, p);
      packet.set(sessionID, p += 4);
      p += sesLen;

      packet[p] = 50; // MESSAGE.USERAUTH_REQUEST

      writeUInt32BE(packet, userLen, ++p);
      (packet as any).utf8Write(username, p += 4, userLen);

      writeUInt32BE(packet, 14, p += userLen);
      (packet as any).utf8Write('ssh-connection', p += 4, 14);

      writeUInt32BE(packet, 9, p += 14);
      (packet as any).utf8Write('publickey', p += 4, 9);

      packet[p += 9] = 1; // cbSign is true, so 1

      writeUInt32BE(packet, algoLen, ++p);
      (packet as any).utf8Write(keyAlgo, p += 4, algoLen);

      writeUInt32BE(packet, pubKeyLen, p += algoLen);
      packet.set(pubKey, p += 4);

      cbSign(packet, (signature: any) => {
        signature = utils.convertSignature(signature, keyType);
        if (signature === false)
          throw new Error('Error while converting handshake signature');

        // Strip -cert-v01@openssh.com suffix from algorithm name inside signature block
        const sigAlgo = keyAlgo.endsWith('-cert-v01@openssh.com') ? keyAlgo.replace('-cert-v01@openssh.com', '') : keyAlgo;
        const sigAlgoLen = Buffer.byteLength(sigAlgo);
        const sigLen = signature.length;

        const writeStart = this._packetRW.write.allocStart;
        const finalPacket = this._packetRW.write.alloc(
          1 + 4 + userLen + 4 + 14 + 4 + 9 + 1 + 4 + algoLen + 4 + pubKeyLen + 4
            + 4 + sigAlgoLen + 4 + sigLen
        );

        let fp = writeStart;
        finalPacket[fp] = 50; // MESSAGE.USERAUTH_REQUEST

        writeUInt32BE(finalPacket, userLen, ++fp);
        (finalPacket as any).utf8Write(username, fp += 4, userLen);

        writeUInt32BE(finalPacket, 14, fp += userLen);
        (finalPacket as any).utf8Write('ssh-connection', fp += 4, 14);

        writeUInt32BE(finalPacket, 9, fp += 14);
        (finalPacket as any).utf8Write('publickey', fp += 4, 9);

        finalPacket[fp += 9] = 1;

        writeUInt32BE(finalPacket, algoLen, ++fp);
        (finalPacket as any).utf8Write(keyAlgo, fp += 4, algoLen);

        writeUInt32BE(finalPacket, pubKeyLen, fp += algoLen);
        finalPacket.set(pubKey, fp += 4);

        writeUInt32BE(finalPacket, 4 + sigAlgoLen + 4 + sigLen, fp += pubKeyLen);

        writeUInt32BE(finalPacket, sigAlgoLen, fp += 4);
        (finalPacket as any).utf8Write(sigAlgo, fp += 4, sigAlgoLen);

        writeUInt32BE(finalPacket, sigLen, fp += sigAlgoLen);
        finalPacket.set(signature, fp += 4);

        this._authsQueue.push('publickey');

        this._debug && this._debug(
          'Outbound: Sending USERAUTH_REQUEST (publickey) [patched]'
        );
        utils.sendPacket(this, this._packetRW.write.finalize(finalPacket));
      });
    };
    console.log('Successfully applied SSH2 certificate authentication monkey patches!');
  } catch (err) {
    console.error('Failed to apply SSH2 monkey patches:', err);
  }
}

applySSH2MonkeyPatches();

// Global exception and rejection handlers to prevent crash dialogs
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception in main process:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in main process:', reason);
});

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let sshClient: Client | null = null;
let tunnelServer: net.Server | null = null;
let authToken: string = '';
let isBootstrapping = false;
let PORT = 8000;
let remotePortActive: number | null = null;
let zmonLocalProcess: ChildProcess | null = null;
let zmonTunnelServer: net.Server | null = null;
let activeZmonRemotePort: number | null = null;

interface ManualSSHConfig {
  host: string;
  port?: number;
  username?: string;
  privateKeyPath?: string;
  label?: string;
}

interface AppSettings {
  recentProjects: any[];
  lastConnection: string;
  windowWidth: number;
  windowHeight: number;
  customSshHosts?: ManualSSHConfig[];
}

const settingsPath = path.join(app.getPath('userData'), 'zx_settings.json');

function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(data);
      if (!parsed.customSshHosts) {
        parsed.customSshHosts = [];
      }
      return parsed;
    }
  } catch (e) {
    console.error('Failed to load settings', e);
  }
  return {
    recentProjects: [],
    lastConnection: 'Local',
    windowWidth: 1200,
    windowHeight: 800,
    customSshHosts: [],
  };
}

function saveSettings(settings: AppSettings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save settings', e);
  }
}

// Generate Auth Token
authToken = crypto.randomUUID();

async function stopZmon(): Promise<void> {
  console.log('stopZmon: stopping active zmon processes/tunnels...');
  if (sshClient && activeZmonRemotePort !== null) {
    try {
      console.log(`Stopping remote zmon process on port ${activeZmonRemotePort}...`);
      const killCmd = `kill $(cat ~/.zx/zmon_${activeZmonRemotePort}.pid) 2>/dev/null || kill $(lsof -t -i :${activeZmonRemotePort}) 2>/dev/null || rm -f ~/.zx/zmon_${activeZmonRemotePort}.pid || true`;
      const pkillPromise = execCommand(sshClient, killCmd);
      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1500));
      await Promise.race([pkillPromise, timeoutPromise]);
      console.log('Remote zmon shutdown complete or timed out.');
    } catch (e) {
      console.error('Failed to execute remote zmon kill command:', e);
    }
    activeZmonRemotePort = null;
  }

  if (zmonLocalProcess) {
    try {
      console.log('Killing local zmon process...');
      zmonLocalProcess.kill();
    } catch (e) {
      console.error('Error killing local zmon process:', e);
    }
    zmonLocalProcess = null;
  }

  if (zmonTunnelServer) {
    try {
      console.log('Closing local zmon tunnel server...');
      zmonTunnelServer.close();
    } catch (e) {
      console.error('Error closing local zmon tunnel server:', e);
    }
    zmonTunnelServer = null;
  }
}

async function stopBackendProcesses(): Promise<void> {
  console.log('stopBackendProcesses: stopping active backend processes...');
  await stopZmon();
  if (sshClient) {
    if (remotePortActive !== null) {
      try {
        console.log(`Stopping remote backend process on port ${remotePortActive}...`);
        const killCmd = `kill $(cat ~/.zx/backend_${remotePortActive}.pid) 2>/dev/null || kill $(lsof -t -i :${remotePortActive}) 2>/dev/null || rm -f ~/.zx/backend_${remotePortActive}.pid || true`;
        const pkillPromise = execCommand(sshClient, killCmd);
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1500));
        await Promise.race([pkillPromise, timeoutPromise]);
        console.log('Remote backend shutdown complete or timed out.');
      } catch (e) {
        console.error('Failed to execute remote port/PID kill command:', e);
      }
    }
    try {
      sshClient.end();
    } catch (e) {
      console.error('Error closing ssh client:', e);
    }
    sshClient = null;
    remotePortActive = null;
  }

  if (backendProcess) {
    try {
      console.log('Killing local backend process...');
      backendProcess.kill();
    } catch (e) {
      console.error('Error killing local backend process:', e);
    }
    backendProcess = null;
  }

  if (tunnelServer) {
    try {
      tunnelServer.close();
    } catch (e) {
      console.error('Error closing local tunnel server:', e);
    }
    tunnelServer = null;
  }
}

function resolveLocalWheel(): { localWheel: string; wheelFilename: string } {
  const possibleDirs = [
    path.join(__dirname, '../backend/dist'),
    path.join(app.getAppPath(), 'backend/dist'),
    path.join(process.resourcesPath, 'backend/dist'),
    path.join(process.cwd(), 'backend/dist')
  ];

  let localWheel = '';
  let wheelFilename = 'zx_backend-0.1.0-py3-none-any.whl'; // fallback default

  for (const dir of possibleDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        const found = files.find(f => f.startsWith('zx_backend-') && f.endsWith('.whl'));
        if (found) {
          localWheel = path.join(dir, found);
          wheelFilename = found;
          break;
        }
      } catch (e) {
        console.error(`Failed to scan directory ${dir}:`, e);
      }
    }
  }

  if (!localWheel) {
    localWheel = path.join(__dirname, '../backend/dist/zx_backend-0.1.0-py3-none-any.whl');
    if (!fs.existsSync(localWheel)) {
      localWheel = path.join(app.getAppPath(), 'backend/dist/zx_backend-0.1.0-py3-none-any.whl');
    }
    if (!fs.existsSync(localWheel)) {
      localWheel = path.join(process.resourcesPath, 'backend/dist/zx_backend-0.1.0-py3-none-any.whl');
    }
    if (!fs.existsSync(localWheel)) {
      localWheel = path.join(process.cwd(), 'backend/dist/zx_backend-0.1.0-py3-none-any.whl');
    }
  }
  return { localWheel, wheelFilename };
}

function resolveLocalProjectsDir(): string {
  const possibleDirs = [
    path.join(__dirname, '../projects'),
    path.join(app.getAppPath(), 'projects'),
    path.join(process.resourcesPath, 'projects'),
    path.join(process.cwd(), 'projects')
  ];

  for (const dir of possibleDirs) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      return dir;
    }
  }
  return path.join(process.cwd(), 'projects');
}

function runLocalCommand(cmd: string, env: any): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`[BOOTSTRAP EXEC]: ${cmd}`);
    exec(cmd, { env }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[BOOTSTRAP ERROR]: Command failed: ${cmd}\nError: ${error.message}\nStderr: ${stderr}`);
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort(startPort: number): Promise<number> {
  let port = startPort;
  while (!(await isPortFree(port))) {
    console.log(`Port ${port} is busy, checking next port...`);
    port++;
  }
  return port;
}

async function startBackend(): Promise<number> {
  if (backendProcess) {
    console.log('Local FastAPI backend is already running.');
    return PORT;
  }
  if (isBootstrapping) {
    console.log('Local FastAPI backend is already bootstrapping.');
    return PORT;
  }
  isBootstrapping = true;

  try {
    // Dynamically scan and find a free port starting from 8000
    PORT = await findFreePort(8000);
    console.log(`Discovered free local port: ${PORT}`);

    console.log('Spawning Local FastAPI backend...');
    const isDev = !app.isPackaged;

    const homeDir = app.getPath('home');
    const localBin = path.join(homeDir, '.local/bin');
    const systemPath = process.env.PATH || '';
    const extendedPath = process.platform === 'darwin'
      ? `${localBin}:/opt/homebrew/bin:/usr/local/bin:${systemPath}`
      : systemPath;

    const env: Record<string, string> = {
      ...process.env,
      PATH: extendedPath,
      ZX_AUTH_TOKEN: authToken,
      ZX_PROJECTS_DIR: resolveLocalProjectsDir(),
    } as Record<string, string>;

    // Clean up any stray backend processes currently occupying port 8000
    console.log('Cleaning up any stray backend processes on port 8000...');
    if (process.platform === 'win32') {
      try {
        await runLocalCommand('taskkill /F /IM python.exe /T || true', env);
      } catch (e) {
        console.log('Windows taskkill ignored:', e);
      }
    } else {
      try {
        await runLocalCommand('pkill -f "uvicorn zx_backend.main:app" || true', env);
        // We no longer run lsof kill since we dynamically find a free port!
      } catch (e) {
        console.log('Unix pkill ignored:', e);
      }
    }

    let pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    let backendDir = '';

    if (isDev) {
      const venvDir = path.join(__dirname, '..', '.venv');
      const venvPython = process.platform === 'win32'
        ? path.join(venvDir, 'Scripts', 'python.exe')
        : path.join(venvDir, 'bin', 'python3');
      if (fs.existsSync(venvPython)) {
        pythonCmd = venvPython;
        console.log(`Using virtual environment python: ${pythonCmd}`);
      } else {
        console.log(`Virtual environment python not found at ${venvPython}, using system fallback.`);
      }
      backendDir = path.join(__dirname, '../backend');
      env.PYTHONPATH = backendDir;
    } else {
      // Packaged App: Let's bootstrap and use our dedicated local venv at ~/.zx/venv!
      console.log('Packaged App: Initiating local bootstrapping for FastAPI backend...');
      const zxDir = path.join(homeDir, '.zx');
      const localVenvDir = path.join(zxDir, 'venv');
      const localVenvPython = process.platform === 'win32'
        ? path.join(localVenvDir, 'Scripts', 'python.exe')
        : path.join(localVenvDir, 'bin', 'python3');

      try {
        // 1. Ensure ~/.zx exists
        if (!fs.existsSync(zxDir)) {
          fs.mkdirSync(zxDir, { recursive: true });
        }

        // Set VIRTUAL_ENV env var so uv automatically targets our local virtual environment
        env.VIRTUAL_ENV = localVenvDir;

        // 2. Resolve the local wheel package
        const { localWheel } = resolveLocalWheel();
        console.log(`Resolved local wheel for bootstrapping: ${localWheel}`);

        // 3. Check if we need to bootstrap or reinstall
        let needsInstall = false;
        if (!fs.existsSync(localVenvPython)) {
          needsInstall = true;
          console.log('Local virtual environment not found. Bootstrapping...');
        } else {
          // Run a lightweight install without force-reinstall to verify dependencies in under 0.2s
          needsInstall = true;
        }

        if (needsInstall) {
          // Ensure uv is installed
          console.log('Checking for local uv installation...');
          let hasUv = false;
          try {
            await runLocalCommand(process.platform === 'win32' ? 'where uv' : 'which uv', env);
            hasUv = true;
          } catch (e) {
            console.log('uv is not installed locally. Bootstrapping uv...');
            if (process.platform !== 'win32') {
              await runLocalCommand('curl -LsSf https://astral.sh/uv/install.sh | sh', env);
              hasUv = true;
            }
          }

          if (hasUv) {
            console.log('Using uv to bootstrap local environment...');
            await runLocalCommand('uv python install', env);
            if (!fs.existsSync(localVenvPython)) {
              await runLocalCommand(`uv venv "${localVenvDir}"`, env);
            }
            console.log('Installing backend wheel using uv...');
            await runLocalCommand(`uv pip install --python "${localVenvPython}" "${localWheel}"`, env);
          } else {
            console.log('uv not available. Falling back to system python3 to create venv...');
            if (!fs.existsSync(localVenvPython)) {
              await runLocalCommand(`python3 -m venv "${localVenvDir}"`, env);
            }
            const localVenvPip = process.platform === 'win32'
              ? path.join(localVenvDir, 'Scripts', 'pip.exe')
              : path.join(localVenvDir, 'bin', 'pip');
            console.log('Installing backend wheel using pip...');
            await runLocalCommand(`"${localVenvPip}" install "${localWheel}"`, env);
          }
          console.log('Local environment bootstrapping complete!');
        }

        pythonCmd = localVenvPython;
        backendDir = localVenvDir;
      } catch (bootstrapErr) {
        console.error('Failed to bootstrap local backend environment, falling back to system python:', bootstrapErr);
        // Fallback to system python3
        pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        backendDir = path.join(process.resourcesPath, 'backend');
        env.PYTHONPATH = backendDir;
      }
    }

    console.log(`Starting FastAPI backend with: ${pythonCmd} -m uvicorn zx_backend.main:app`);
    backendProcess = spawn(
      pythonCmd,
      ['-m', 'uvicorn', 'zx_backend.main:app', '--port', PORT.toString(), '--host', '127.0.0.1'],
      {
        cwd: backendDir,
        env: env,
        shell: true
      }
    );

    backendProcess.stdout?.on('data', (data) => {
      console.log(`[FastAPI stdout]: ${data}`);
    });

    backendProcess.stderr?.on('data', (data) => {
      console.error(`[FastAPI stderr]: ${data}`);
    });
  } finally {
    isBootstrapping = false;
  }
  return PORT;
}

function createWindow() {
  const settings = loadSettings();

  mainWindow = new BrowserWindow({
    width: settings.windowWidth,
    height: settings.windowHeight,
    backgroundColor: '#0d0e12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('resize', () => {
    if (!mainWindow) return;
    const [width, height] = mainWindow.getSize();
    const current = loadSettings();
    saveSettings({ ...current, windowWidth: width, windowHeight: height });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  const settings = loadSettings();
  if (settings.lastConnection === 'Local') {
    startBackend();
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let isQuitting = false;
app.on('before-quit', async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    console.log('App is quitting. Performing cleanup...');
    await stopBackendProcesses();
    app.quit();
  }
});

app.on('quit', () => {
  // Synchronous fallback
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch (e) { }
  }
  if (sshClient) {
    try {
      sshClient.end();
    } catch (e) { }
  }
  if (tunnelServer) {
    try {
      tunnelServer.close();
    } catch (e) { }
  }
  if (zmonLocalProcess) {
    try {
      zmonLocalProcess.kill();
    } catch (e) { }
  }
  if (zmonTunnelServer) {
    try {
      zmonTunnelServer.close();
    } catch (e) { }
  }
});

// IPC communication channel definitions
ipcMain.handle('get-auth-token', () => authToken);
ipcMain.handle('get-backend-port', () => PORT);
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, settings: AppSettings) => {
  saveSettings(settings);
  return true;
});
ipcMain.handle('start-local-backend', async () => {
  await stopBackendProcesses();
  const port = await startBackend();
  return port;
});
ipcMain.handle('stop-backend', async () => {
  await stopBackendProcesses();
  return true;
});

ipcMain.handle('run-zmon', async (_, activeProject: string, rowId: number, theme?: string) => {
  console.log(`ipcMain: run-zmon requested for row ${rowId} (project: ${activeProject}, theme: ${theme})`);

  // 1. Stop any existing zmon processes/tunnels to avoid port conflicts
  await stopZmon();

  try {
    if (sshClient) {
      // REMOTE zmon path
      console.log('Running zmon remotely...');

      // Query remote state for zmon_install path if configured
      let remoteZmonCommand = 'zmon';
      if (activeProject) {
        try {
          const catCmd = `cat "${activeProject}/zx_state.json" 2>/dev/null || echo "{}"`;
          const stateContent = await execCommand(sshClient, catCmd);
          const state = JSON.parse(stateContent.trim());
          if (state && state.zmon_install) {
            const installPath = state.zmon_install.trim();
            if (installPath) {
              let targetCommand = installPath;
              const remoteCheck = `python3 -c "import os; p = os.path.expanduser('${installPath}'); print('DIR' if os.path.isdir(p) else 'FILE')"`;
              try {
                const checkRes = await execCommand(sshClient, remoteCheck);
                if (checkRes.trim() === 'DIR' || !installPath.endsWith('zmon')) {
                  targetCommand = installPath.endsWith('/') ? `${installPath}zmon` : `${installPath}/zmon`;
                }
              } catch (e) {
                if (!installPath.endsWith('zmon')) {
                  targetCommand = installPath.endsWith('/') ? `${installPath}zmon` : `${installPath}/zmon`;
                }
              }
              remoteZmonCommand = targetCommand;
              console.log(`Remote zmon command resolved to: ${remoteZmonCommand}`);
            }
          }
        } catch (e) {
          console.log('Remote zmon_install key check failed or not found:', e);
        }
      }

      // A. Discover a free port on the remote server
      const remotePortStr = await execCommand(sshClient, 'python3 -c "import socket; s=socket.socket(); s.bind((\'127.0.0.1\', 0)); print(s.getsockname()[1]); s.close()"');
      const remotePort = parseInt(remotePortStr.trim(), 10);
      if (isNaN(remotePort)) {
        throw new Error('Failed to discover free remote port for zmon');
      }
      console.log(`Remote free port discovered for zmon: ${remotePort}`);

      // Pre-flight check: Verify zmon exists and is executable on remote host
      try {
        await execCommand(sshClient, `command -v "${remoteZmonCommand}" || which "${remoteZmonCommand}"`);
      } catch (err) {
        throw new Error(`The remote zmon executable "${remoteZmonCommand}" was not found or is not executable.\n\nPlease check the "zmon_install" path configured in your project's zx_state.json.`);
      }

      // B. Start zmon remotely in background
      const remoteRunDir = `${activeProject}/runs/run_${rowId}`;
      const startCmd = `
        mkdir -p "${remoteRunDir}"
        cd "${remoteRunDir}"
        export PATH="$HOME/.nvm/versions/node/v*/bin:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
        export PORT=${remotePort}
        nohup ${remoteZmonCommand} --port ${remotePort} > ~/.zx/zmon.log 2>&1 &
        echo $! > ~/.zx/zmon_${remotePort}.pid
        
        # Wait up to 10s for the zmon port to bind and become active
        i=0
        while [ $i -lt 20 ]; do
          if python3 -c "import socket; s=socket.socket(); s.connect(('127.0.0.1', ${remotePort}))" 2>/dev/null; then
            exit 0
          fi
          sleep 0.5
          i=$((i+1))
        done
        echo "Error: Remote zmon failed to bind on port ${remotePort} within 10 seconds" >&2
        exit 1
      `;

      try {
        await execCommand(sshClient, startCmd);
        console.log(`Remote zmon started on remote port ${remotePort}`);
      } catch (err: any) {
        console.error('Remote zmon start command failed:', err);
        let logTail = '';
        try {
          logTail = await execCommand(sshClient, 'tail -n 15 ~/.zx/zmon.log 2>/dev/null');
        } catch (tailErr) {
          console.log('Failed to fetch remote zmon log tail:', tailErr);
        }
        const logMsg = logTail.trim() ? `\n\nRemote log output:\n${logTail.trim()}` : '';
        throw new Error(`Failed to start zmon remotely: ${err.message || err}${logMsg}`);
      }

      activeZmonRemotePort = remotePort;

      // C. Allocate a free local port
      const localPort = await getFreeLocalPort();
      console.log(`Local free port discovered for zmon forwarding: ${localPort}`);

      // D. Establish local TCP port forwarding tunnel
      zmonTunnelServer = await createLocalForwardTunnel(sshClient, localPort, remotePort);
      console.log(`Local port forward tunnel established for zmon: 127.0.0.1:${localPort} -> remote:${remotePort}`);

      // E. Start web browser locally to connect to localPort
      let url = `http://127.0.0.1:${localPort}`;
      if (theme) {
        const isLight = theme === 'light';
        url += `?theme=${theme}`;
      }
      console.log(`Opening browser at ${url}`);
      await openMinimalistBrowser(url);

      return { status: 'success', isRemote: true, port: localPort };
    } else {
      // LOCAL zmon path
      console.log('Running zmon locally...');

      // Query local state for zmon_install path if configured
      let localZmonCommand = 'zmon';
      if (activeProject) {
        try {
          const statePath = path.join(activeProject, 'zx_state.json');
          if (fs.existsSync(statePath)) {
            const stateContent = fs.readFileSync(statePath, 'utf8');
            const state = JSON.parse(stateContent);
            if (state && state.zmon_install) {
              const installPath = state.zmon_install.trim();
              if (installPath) {
                let targetCommand = installPath;
                try {
                  if (fs.existsSync(installPath) && fs.statSync(installPath).isDirectory()) {
                    targetCommand = path.join(installPath, 'zmon');
                  } else if (!installPath.endsWith('zmon')) {
                    targetCommand = path.join(installPath, 'zmon');
                  }
                } catch (e) {
                  if (!installPath.endsWith('zmon')) {
                    targetCommand = path.join(installPath, 'zmon');
                  }
                }
                localZmonCommand = targetCommand;
                console.log(`Local zmon command resolved to: ${localZmonCommand}`);
              }
            }
          }
        } catch (e) {
          console.log('Local zmon_install key check failed or not found:', e);
        }
      }

      // A. Discover a free local port
      const localPort = await getFreeLocalPort();
      console.log(`Local free port discovered for zmon: ${localPort}`);

      // B. Start zmon locally in background
      const homeDir = app.getPath('home');
      const localBin = path.join(homeDir, '.local/bin');
      const systemPath = process.env.PATH || '';
      const extendedPath = process.platform === 'darwin'
        ? `${localBin}:/opt/homebrew/bin:/usr/local/bin:${systemPath}`
        : systemPath;

      const env = {
        ...process.env,
        PATH: extendedPath,
        PORT: String(localPort)
      };

      // Pre-flight check: Verify local zmon exists and is executable
      let exists = true;
      if (localZmonCommand.includes('/') || localZmonCommand.includes('\\')) {
        exists = fs.existsSync(localZmonCommand);
      } else {
        try {
          const checkCmd = process.platform === 'win32' ? `where "${localZmonCommand}"` : `which "${localZmonCommand}"`;
          await new Promise((resolve, reject) => {
            exec(checkCmd, { env }, (err) => {
              if (err) reject(err);
              else resolve(true);
            });
          });
        } catch (e) {
          exists = false;
        }
      }
      if (!exists) {
        throw new Error(`The local zmon executable "${localZmonCommand}" was not found.\n\nPlease configure the correct path in zx_state.json under "zmon_install" or ensure zmon is installed in your PATH.`);
      }

      const localRunDir = path.join(activeProject, 'runs', `run_${rowId}`);
      try {
        if (!fs.existsSync(localRunDir)) {
          fs.mkdirSync(localRunDir, { recursive: true });
        }
      } catch (err) {
        console.error('Failed to create local run directory for zmon:', err);
      }

      console.log(`Spawning local zmon [${localZmonCommand}] on port ${localPort} inside ${localRunDir}...`);
      zmonLocalProcess = spawn(localZmonCommand, ['--port', String(localPort)], {
        shell: true,
        cwd: localRunDir,
        env
      });

      let localStdout = '';
      let localStderr = '';

      zmonLocalProcess.on('error', (err) => {
        console.error('Failed to start local zmon process:', err);
        localStderr += `Failed to start local zmon process: ${err.message}\n`;
      });

      zmonLocalProcess.stdout?.on('data', (data) => {
        const str = data.toString();
        console.log(`[zmon stdout]: ${str}`);
        localStdout += str;
        if (localStdout.length > 2000) {
          localStdout = localStdout.slice(-2000);
        }
      });

      zmonLocalProcess.stderr?.on('data', (data) => {
        const str = data.toString();
        console.error(`[zmon stderr]: ${str}`);
        localStderr += str;
        if (localStderr.length > 2000) {
          localStderr = localStderr.slice(-2000);
        }
      });

      // Wait up to 5s for the local port to bind and become active
      const startTime = Date.now();
      const timeoutMs = 5000;
      let portBound = false;
      
      while (Date.now() - startTime < timeoutMs) {
        const ready = await new Promise<boolean>((resolve) => {
          const socket = net.connect(localPort, '127.0.0.1', () => {
            socket.end();
            resolve(true);
          });
          socket.on('error', () => {
            resolve(false);
          });
        });
        if (ready) {
          portBound = true;
          break;
        }
        if (zmonLocalProcess && zmonLocalProcess.exitCode !== null) {
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!portBound) {
        const logs = (localStderr.trim() || localStdout.trim()) 
          ? `\n\nProcess output:\n${(localStderr || localStdout).trim()}`
          : '';
        throw new Error(`Local zmon failed to start or bind to port ${localPort} within 5 seconds.${logs}`);
      }

      // C. Start web browser to connect to localPort
      let url = `http://127.0.0.1:${localPort}`;
      if (theme) {
        const isLight = theme === 'light';
        url += `?theme=${theme}`;
      }
      console.log(`Opening browser at ${url}`);
      await openMinimalistBrowser(url);

      return { status: 'success', isRemote: false, port: localPort };
    }
  } catch (err: any) {
    console.error('Failed to run zmon:', err);
    dialog.showErrorBox('zMon Launch Failed', err.message || String(err));
    return { status: 'error', message: err.message || String(err) };
  }
});

ipcMain.handle('open-directory-dialog', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});


function resolveIncludePattern(pattern: string): string[] {
  let resolvedPattern = pattern;
  if (resolvedPattern.startsWith('~/')) {
    resolvedPattern = path.join(process.env.HOME || process.env.USERPROFILE || '', resolvedPattern.slice(2));
  } else if (!path.isAbsolute(resolvedPattern)) {
    resolvedPattern = path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', resolvedPattern);
  }

  if (resolvedPattern.includes('*') || resolvedPattern.includes('?')) {
    const wildcardIdx = Math.min(
      resolvedPattern.indexOf('*') !== -1 ? resolvedPattern.indexOf('*') : resolvedPattern.length,
      resolvedPattern.indexOf('?') !== -1 ? resolvedPattern.indexOf('?') : resolvedPattern.length
    );
    const dirPart = resolvedPattern.substring(0, wildcardIdx);
    const lastSepIdx = dirPart.lastIndexOf('/');
    if (lastSepIdx === -1) {
      return [];
    }
    const searchDir = dirPart.substring(0, lastSepIdx);
    const filePattern = resolvedPattern.substring(lastSepIdx + 1);

    if (!fs.existsSync(searchDir)) {
      return [];
    }

    try {
      const files = fs.readdirSync(searchDir);
      const regexStr = '^' + filePattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') + '$';
      const regex = new RegExp(regexStr);

      const matched: string[] = [];
      for (const file of files) {
        if (regex.test(file)) {
          matched.push(path.join(searchDir, file));
        }
      }
      return matched;
    } catch (e) {
      console.error(`Error resolving ssh config include glob pattern ${pattern}`, e);
      return [];
    }
  }

  return [resolvedPattern];
}

function readSSHConfigLines(configPath: string, visited: Set<string> = new Set()): string[] {
  let resolvedPath = configPath;
  if (resolvedPath.startsWith('~/')) {
    resolvedPath = path.join(process.env.HOME || process.env.USERPROFILE || '', resolvedPath.slice(2));
  } else if (!path.isAbsolute(resolvedPath)) {
    resolvedPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', resolvedPath);
  }

  const realPath = fs.existsSync(resolvedPath) ? fs.realpathSync(resolvedPath) : resolvedPath;
  if (visited.has(realPath)) {
    return [];
  }
  visited.add(realPath);

  if (!fs.existsSync(resolvedPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const lines = content.split('\n');
    const resultLines: string[] = [];

    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        resultLines.push(line);
        continue;
      }

      const includeMatch = trimmed.match(/^Include\s+(.+)$/i);
      if (includeMatch) {
        const includePattern = includeMatch[1].trim().replace(/['"]/g, '');
        const matchedPaths = resolveIncludePattern(includePattern);
        for (const matchedPath of matchedPaths) {
          resultLines.push(...readSSHConfigLines(matchedPath, visited));
        }
      } else {
        resultLines.push(line);
      }
    }
    return resultLines;
  } catch (err) {
    console.error(`Failed to read SSH config file at ${resolvedPath}`, err);
    return [];
  }
}

// Parse SSH Config for Hosts
ipcMain.handle('get-ssh-hosts', async () => {
  const sshConfigPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', 'config');
  try {
    const lines = readSSHConfigLines(sshConfigPath);
    const hosts: string[] = [];
    for (const line of lines) {
      const match = line.trim().match(/^Host\s+(.+)$/i);
      if (match) {
        const hostVal = match[1].trim();
        const individualHosts = hostVal.split(/\s+/);
        for (const host of individualHosts) {
          if (!host.includes('*')) {
            hosts.push(host);
          }
        }
      }
    }
    return hosts;
  } catch (err) {
    console.error('Failed to parse ssh config', err);
    return [];
  }
});

interface SSHHostConfig {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  certificate?: string;
  agent?: string;
  proxyJump?: string;
  alias?: string;
  identitiesOnly?: boolean;
}

function matchHostLine(hostVal: string, hostName: string): boolean {
  const patterns = hostVal.split(/\s+/);
  const host = hostName.toLowerCase();
  
  let hasPositive = false;
  let matchedPositive = false;
  let matchedNegative = false;

  for (const pattern of patterns) {
    if (!pattern) continue;
    
    const isNegated = pattern.startsWith('!');
    const cleanPattern = isNegated ? pattern.slice(1) : pattern;
    
    const pat = cleanPattern.toLowerCase();
    const regexStr = '^' + pat
      .replace(/[\-\[\]\/\{\}\(\)\+\.\^\$\|]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') + '$';
    const regex = new RegExp(regexStr);
    const isMatch = regex.test(host);

    if (isNegated) {
      if (isMatch) {
        matchedNegative = true;
      }
    } else {
      hasPositive = true;
      if (isMatch) {
        matchedPositive = true;
      }
    }
  }

  if (matchedNegative) {
    return false;
  }
  if (hasPositive) {
    return matchedPositive;
  }
  return true;
}

function isOpenSSHKeyEncrypted(keyStr: string): boolean {
  if (keyStr.includes('ENCRYPTED') || keyStr.includes('encrypted')) {
    return true;
  }
  if (keyStr.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) {
    const lines = keyStr.split('\n');
    let base64Str = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('-----')) {
        base64Str += trimmed;
      }
    }
    try {
      const buffer = Buffer.from(base64Str, 'base64');
      const magic = buffer.toString('utf8', 0, 15);
      if (magic === 'openssh-key-v1\0') {
        const cipherLen = buffer.readUInt32BE(15);
        const cipher = buffer.toString('utf8', 19, 19 + cipherLen);
        return cipher !== 'none';
      }
    } catch (e) {
      return true;
    }
  }
  return false;
}

function getSSHConfigForHost(hostName: string): SSHHostConfig | null {
  const sshConfigPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', 'config');
  try {
    const lines = readSSHConfigLines(sshConfigPath);
    let insideTargetHost = false;
    let found = false;
    const setKeys = new Set<string>();

    const config: SSHHostConfig = {
      host: '',
      port: 22,
      username: process.env.USER || 'root',
      agent: process.env.SSH_AUTH_SOCK
    };

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;

      const hostMatch = line.match(/^Host\s+(.+)$/i);
      if (hostMatch) {
        const hostVal = hostMatch[1].trim();
        if (matchHostLine(hostVal, hostName)) {
          insideTargetHost = true;
          found = true;
        } else {
          insideTargetHost = false;
        }
        continue;
      }

      if (insideTargetHost) {
        const keyValueMatch = line.match(/^([a-zA-Z0-9_\-]+)\s+(.+)$/);
        if (keyValueMatch) {
          const key = keyValueMatch[1].toLowerCase();
          const value = keyValueMatch[2].trim().replace(/['"]/g, '');

          if (key === 'hostname' && !setKeys.has('host')) {
            config.host = value;
            setKeys.add('host');
          } else if (key === 'user' && !setKeys.has('username')) {
            config.username = value;
            setKeys.add('username');
          } else if (key === 'port' && !setKeys.has('port')) {
            const p = parseInt(value, 10);
            if (!isNaN(p)) {
              config.port = p;
              setKeys.add('port');
            }
          } else if (key === 'identityfile' && !setKeys.has('privatekey')) {
            let keyPath = value;
            if (keyPath.startsWith('~/')) {
              keyPath = path.join(process.env.HOME || process.env.USERPROFILE || '', keyPath.slice(2));
            }
            if (fs.existsSync(keyPath)) {
              try {
                config.privateKey = fs.readFileSync(keyPath, 'utf8');
                setKeys.add('privatekey');
              } catch (e) {
                console.error(`Failed to read identity file ${keyPath}`, e);
              }
            }
          } else if (key === 'certificatefile' && !setKeys.has('certificate')) {
            let certPath = value;
            if (certPath.startsWith('~/')) {
              certPath = path.join(process.env.HOME || process.env.USERPROFILE || '', certPath.slice(2));
            }
            if (fs.existsSync(certPath)) {
              try {
                config.certificate = fs.readFileSync(certPath, 'utf8');
                setKeys.add('certificate');
              } catch (e) {
                console.error(`Failed to read certificate file ${certPath}`, e);
              }
            }
          } else if (key === 'proxyjump' && !setKeys.has('proxyjump')) {
            config.proxyJump = value;
            setKeys.add('proxyjump');
          } else if (key === 'identitiesonly' && !setKeys.has('identitiesonly')) {
            config.identitiesOnly = value.toLowerCase() === 'yes';
            setKeys.add('identitiesonly');
          }
        }
      }
    }
    if (found) {
      if (!config.host) {
        config.host = hostName;
      }
      config.alias = hostName;

      // If identitiesonly is yes, or if privateKey is unencrypted, disable agent!
      if (config.privateKey && (config.identitiesOnly || !isOpenSSHKeyEncrypted(config.privateKey))) {
        config.agent = undefined;
      }

      return config;
    }
  } catch (err) {
    console.error('Failed to parse ssh config for host details', err);
  }

  return null;
}

function execCommand(client: Client, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      stream.on('data', (data: any) => {
        const str = data.toString();
        stdout += str;
        console.log(`[SSH STDOUT]: ${str.trim()}`);
      });

      stream.stderr.on('data', (data: any) => {
        const str = data.toString();
        stderr += str;
        console.error(`[SSH STDERR]: ${str.trim()}`);
      });

      stream.on('close', (code: number) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command "${cmd}" exited with code ${code}. Stderr: ${stderr}`));
        }
      });
    });
  });
}

function getFreeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
    server.on('error', (err) => {
      reject(err);
    });
  });
}

async function openMinimalistBrowser(url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let cmd = '';
    if (process.platform === 'win32') {
      cmd = `start chrome --app=${url}`;
    } else if (process.platform === 'darwin') {
      cmd = `open -n -a "Google Chrome" --args --app=${url}`;
    } else {
      cmd = `google-chrome --app=${url}`;
    }

    console.log(`Launching minimalist browser: ${cmd}`);
    exec(cmd, async (error) => {
      if (error) {
        console.error(`Failed to launch minimalist browser with command: ${cmd}. Falling back to default browser. Error:`, error);
        try {
          await shell.openExternal(url);
        } catch (fallbackErr) {
          console.error(`Fallback browser launch also failed:`, fallbackErr);
        }
      }
      resolve();
    });
  });
}

function getLocalFileMD5(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Local file not found: ${filePath}`);
  }
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('md5');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

async function getRemoteFileMD5(client: Client, remotePath: string): Promise<string | null> {
  const checkCmd = `
    if [ -f "${remotePath}" ]; then
      python3 -c "import hashlib; print(hashlib.md5(open('${remotePath}', 'rb').read()).hexdigest())" 2>/dev/null || md5sum "${remotePath}" | cut -d' ' -f1 || md5 -q "${remotePath}"
    else
      echo "NF"
    fi
  `;
  try {
    const res = await execCommand(client, checkCmd);
    const cleaned = res.trim();
    if (cleaned === 'NF' || !cleaned) {
      return null;
    }
    const match = cleaned.match(/[a-fA-F0-9]{32}/);
    return match ? match[0] : null;
  } catch (e) {
    return null;
  }
}

function uploadFileSFTP(client: Client, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);

      console.log(`SFTP: Uploading ${localPath} to ${remotePath}...`);
      sftp.fastPut(localPath, remotePath, {}, (uploadErr) => {
        if (uploadErr) return reject(uploadErr);
        console.log(`SFTP: Upload completed successfully.`);
        resolve();
      });
    });
  });
}

function uploadDirectorySFTP(client: Client, localDir: string, remoteDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);

      const uploadRecursive = async (localPath: string, remotePath: string): Promise<void> => {
        const stat = fs.statSync(localPath);
        if (stat.isDirectory()) {
          const items = fs.readdirSync(localPath);
          await execCommand(client, `mkdir -p "${remotePath}"`);
          for (const item of items) {
            await uploadRecursive(path.join(localPath, item), `${remotePath}/${item}`);
          }
        } else {
          await new Promise<void>((res, rej) => {
            console.log(`SFTP: Uploading ${localPath} to ${remotePath}...`);
            sftp.fastPut(localPath, remotePath, {}, (uploadErr) => {
              if (uploadErr) rej(uploadErr);
              else {
                console.log(`SFTP: Upload completed successfully.`);
                res();
              }
            });
          });
        }
      };

      console.log(`SFTP session started. Uploading directory recursively...`);
      uploadRecursive(localDir, remoteDir)
        .then(() => {
          sftp.end();
          resolve();
        })
        .catch((uploadErr) => {
          sftp.end();
          reject(uploadErr);
        });
    });
  });
}

function createLocalForwardTunnel(client: Client, localPort: number, remotePort: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on('error', (err) => {
        console.error('Tunnel local socket error:', err);
        socket.destroy();
      });

      client.forwardOut('127.0.0.1', socket.remotePort || 0, '127.0.0.1', remotePort, (err, stream) => {
        if (err) {
          console.error('forwardOut error:', err);
          socket.destroy();
          return;
        }

        stream.on('error', (err: any) => {
          console.error('Tunnel SSH stream error:', err);
          stream.destroy();
        });

        socket.pipe(stream).pipe(socket);
      });
    });

    server.listen(localPort, '127.0.0.1', () => {
      console.log(`Local port forward server listening on 127.0.0.1:${localPort} -> remote:${remotePort}`);
      resolve(server);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

function resolveSSHConfig(hostNameOrConfig: string | ManualSSHConfig): { config: SSHHostConfig, displayName: string } {
  const defaultUser = process.env.USER || 'root';
  
  if (typeof hostNameOrConfig !== 'string') {
    const cfg = hostNameOrConfig;
    const host = cfg.host;
    
    // Check if the hostname entered manually is an alias in ~/.ssh/config
    const sshConfig = getSSHConfigForHost(host);
    
    // Use values from .ssh/config, override with manually provided ones
    const resolvedHost = sshConfig ? sshConfig.host : host;
    const port = cfg.port || (sshConfig ? sshConfig.port : 22);
    const username = cfg.username || (sshConfig ? sshConfig.username : defaultUser);
    const displayName = `${username}@${host}:${port}`;
    
    const config: SSHHostConfig = {
      host: resolvedHost,
      port,
      username,
      agent: process.env.SSH_AUTH_SOCK,
      alias: host,
      proxyJump: sshConfig ? sshConfig.proxyJump : undefined,
      certificate: sshConfig ? sshConfig.certificate : undefined,
      identitiesOnly: sshConfig ? sshConfig.identitiesOnly : undefined
    };
    
    // Use manual private key first, fallback to ssh config key
    if (cfg.privateKeyPath) {
      let keyPath = cfg.privateKeyPath;
      if (keyPath.startsWith('~/')) {
        keyPath = path.join(process.env.HOME || process.env.USERPROFILE || '', keyPath.slice(2));
      }
      if (fs.existsSync(keyPath)) {
        try {
          config.privateKey = fs.readFileSync(keyPath, 'utf8');
        } catch (e) {
          console.error(`Failed to read identity file ${keyPath}`, e);
        }
      }
    } else if (sshConfig && sshConfig.privateKey) {
      config.privateKey = sshConfig.privateKey;
    }

    if (config.privateKey && (config.identitiesOnly || !isOpenSSHKeyEncrypted(config.privateKey))) {
      config.agent = undefined;
    }
    
    return { config, displayName };
  }

  const hostName = hostNameOrConfig;
  
  // 1. Check custom saved hosts in settings
  const settings = loadSettings();
  if (settings.customSshHosts) {
    const matched = settings.customSshHosts.find(c => c.label === hostName || `${c.username}@${c.host}:${c.port}` === hostName);
    if (matched) {
      // Delegate to the object-based path to correctly lookup alias in .ssh/config and use privateKeyPath
      return resolveSSHConfig({
        host: matched.host,
        port: matched.port,
        username: matched.username,
        privateKeyPath: matched.privateKeyPath
      });
    }
  }

  // 2. Check ~/.ssh/config using getSSHConfigForHost
  const sshConfig = getSSHConfigForHost(hostName);
  if (sshConfig) {
    return { config: sshConfig, displayName: hostName };
  }

  // 3. Fallback: Parse hostname of format [username@]host[:port]
  let host = hostName;
  let username = defaultUser;
  let port = 22;

  if (host.includes('@')) {
    const parts = host.split('@');
    username = parts[0];
    host = parts[1];
  }
  if (host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    const p = parseInt(parts[1], 10);
    if (!isNaN(p)) {
      port = p;
    }
  }

  // Check if the parsed hostname matches an alias in .ssh/config
  const fallbackSshConfig = getSSHConfigForHost(host);
  if (fallbackSshConfig) {
    // Override with parsed username/port if explicitly provided in connection string
    if (hostName.includes('@')) {
      fallbackSshConfig.username = username;
    }
    if (hostName.includes(':')) {
      fallbackSshConfig.port = port;
    }
    return { config: fallbackSshConfig, displayName: `${username}@${host}:${port}` };
  }

  const config: SSHHostConfig = {
    host,
    port,
    username,
    agent: process.env.SSH_AUTH_SOCK,
    alias: host
  };
  return { config, displayName: `${username}@${host}:${port}` };
}

function prepareConnectOptions(opts: any): any {
  const prepared = { ...opts };
  if (prepared.privateKey && prepared.certificate) {
    const keyBuffer = Buffer.from(prepared.privateKey) as any;
    keyBuffer.certificate = prepared.certificate;
    prepared.privateKey = keyBuffer;
  }
  return prepared;
}

// Summarise a config for logging. Never include privateKey/certificate — those
// would put key material in plaintext into the console and log files.
function describeSSHConfig(config: SSHHostConfig): string {
  const creds: string[] = [];
  if (config.privateKey) creds.push('key');
  if (config.certificate) creds.push('cert');
  if (config.agent) creds.push('agent');
  const parts = [`${config.username}@${config.host}:${config.port}`];
  if (config.alias && config.alias !== config.host) parts.push(`alias=${config.alias}`);
  if (config.proxyJump) parts.push(`proxyJump=${config.proxyJump}`);
  parts.push(`auth=${creds.length ? creds.join('+') : 'none'}`);
  return parts.join(' ');
}

function establishSSHStream(connConfig: SSHHostConfig, jumpClients: Client[] = []): Promise<any> {
  console.log(`establishSSHStream: ${describeSSHConfig(connConfig)}`);
  return new Promise(async (resolve, reject) => {
    try {
      if (!connConfig.proxyJump) {
        resolve(undefined);
        return;
      }

      // Parse the ProxyJump string
      const proxyStr = connConfig.proxyJump.split(',')[0].trim();
      let proxyUser = '';
      let proxyHost = proxyStr;
      
      if (proxyStr.includes('@')) {
        const parts = proxyStr.split('@');
        proxyUser = parts[0];
        proxyHost = parts[1];
      }

      // Replace %r, %n, %h, %p tokens
      const replaceTokens = (str: string) => {
        return str
          .replace(/%r/g, connConfig.username)
          .replace(/%n/g, connConfig.alias || connConfig.host)
          .replace(/%h/g, connConfig.host)
          .replace(/%p/g, String(connConfig.port));
      };
      
      proxyHost = replaceTokens(proxyHost);
      if (proxyUser) {
        proxyUser = replaceTokens(proxyUser);
      }

      // Resolve config for the jump host
      const jumpHostConfig = getSSHConfigForHost(proxyHost);
      const resolvedJumpConfig: SSHHostConfig = jumpHostConfig || {
        host: proxyHost,
        port: 22,
        username: proxyUser || process.env.USER || 'root',
        agent: process.env.SSH_AUTH_SOCK
      };

      if (proxyUser) {
        resolvedJumpConfig.username = proxyUser;
      }

      console.log(`Connecting to ProxyJump host: ${resolvedJumpConfig.host}:${resolvedJumpConfig.port} (user: ${resolvedJumpConfig.username})`);
      
      // Check if the jump host itself has a ProxyJump
      const jumpSock = await establishSSHStream(resolvedJumpConfig, jumpClients);

      // Create jump client
      const jumpClient = new Client();
      jumpClients.push(jumpClient);

      await new Promise<void>((resJumpConnect, rejJumpConnect) => {
        jumpClient.on('ready', () => resJumpConnect());
        jumpClient.on('error', (err: any) => rejJumpConnect(err));
        
        const opts: any = prepareConnectOptions(resolvedJumpConfig);
        if (jumpSock) {
          opts.sock = jumpSock;
        }
        jumpClient.connect(opts);
      });

      console.log(`Forwarding connection through proxy to target: ${connConfig.host}:${connConfig.port}`);
      jumpClient.forwardOut(
        '127.0.0.1',
        0,
        connConfig.host,
        connConfig.port,
        (err: any, stream: any) => {
          if (err) reject(err);
          else resolve(stream);
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

// SSH Bootstrapping & Port Forwarding Manager (Phase 6)
ipcMain.handle('connect-ssh-remote', async (_, hostNameOrConfig: string | ManualSSHConfig) => {
  const { config: connConfig, displayName } = resolveSSHConfig(hostNameOrConfig);
  console.log(`SSH Remote Connection to host: ${displayName}`);

  await stopBackendProcesses();

  return new Promise(async (resolve, reject) => {
    sshClient = new Client();
    const jumpClients: Client[] = [];

    const cleanupTunnels = () => {
      console.log('Cleaning up ProxyJump clients...');
      for (const jc of jumpClients) {
        try { jc.end(); } catch (e) {}
      }
    };

    sshClient.on('ready', async () => {
      console.log('SSH connection established successfully.');

      // If it was a ManualSSHConfig object, save it to settings!
      if (typeof hostNameOrConfig !== 'string') {
        try {
          const settings = loadSettings();
          if (!settings.customSshHosts) {
            settings.customSshHosts = [];
          }
          const exists = settings.customSshHosts.some(
            c => c.host === hostNameOrConfig.host &&
                 c.port === hostNameOrConfig.port &&
                 c.username === hostNameOrConfig.username
          );
          if (!exists) {
            settings.customSshHosts.push({
              host: hostNameOrConfig.host,
              port: hostNameOrConfig.port,
              username: hostNameOrConfig.username,
              privateKeyPath: hostNameOrConfig.privateKeyPath,
              label: displayName
            });
            saveSettings(settings);
          }
        } catch (saveErr) {
          console.error('Failed to save manual SSH config to settings:', saveErr);
        }
      }

      try {
        // 1. Perform bootstrapping remotely
        console.log('Bootstrapping uv remotely...');
        await execCommand(sshClient!, 'curl -LsSf https://astral.sh/uv/install.sh | sh');
        console.log('Remote uv installer bootstrapped.');

        const setupCmd = `
          export PATH="$HOME/.local/bin:$PATH"
          uv python install
          mkdir -p ~/.zx
          if [ ! -d "$HOME/.zx/venv" ]; then
            uv venv "$HOME/.zx/venv"
          fi
        `;
        console.log('Installing Python environment and creating ~/.zx...');
        await execCommand(sshClient!, setupCmd);
        console.log('Remote Python environment ready.');

        // 2. Discover free port on remote system
        console.log('Discovering free port on remote...');
        const remotePortStr = await execCommand(sshClient!, 'python3 -c "import socket; s=socket.socket(); s.bind((\'127.0.0.1\', 0)); print(s.getsockname()[1]); s.close()"');
        const remotePort = parseInt(remotePortStr.trim(), 10);
        if (isNaN(remotePort)) {
          throw new Error('Failed to discover free remote port');
        }
        console.log(`Remote free port discovered: ${remotePort}`);

        // 3. Discover free port on local system
        console.log('Discovering free port on local...');
        const localPort = await getFreeLocalPort();
        console.log(`Local free port discovered: ${localPort}`);

        // 4. Resolve local wheel path dynamically
        const { localWheel, wheelFilename } = resolveLocalWheel();
        console.log(`Local wheel resolved at: ${localWheel} (filename: ${wheelFilename})`);

        // 5. Compare MD5 sums prior to transfer
        const remoteWheelPath = `.zx/${wheelFilename}`;
        const checkRemotePath = `~/.zx/${wheelFilename}`;

        const localMD5 = getLocalFileMD5(localWheel);
        console.log(`Local wheel MD5: ${localMD5}`);

        const remoteMD5 = await getRemoteFileMD5(sshClient!, checkRemotePath);
        console.log(`Remote wheel MD5: ${remoteMD5}`);

        if (localMD5 === remoteMD5) {
          console.log('Wheel MD5 matches remote. Skipping package transfer.');
        } else {
          console.log('Wheel MD5 differs or is absent. Transferring wheel to remote server...');
          await uploadFileSFTP(sshClient!, localWheel, remoteWheelPath);
        }

        // Upload projects templates directory recursively as a zipped archive for speed,
        // with a fallback to standard recursive SFTP upload if compression/extraction fails.
        const localProjectsDir = resolveLocalProjectsDir();
        const remoteProjectsDir = '.zx/projects';
        console.log(`Uploading projects directory from ${localProjectsDir} to remote ${remoteProjectsDir}...`);

        let archiveUploaded = false;
        const tempArchivePath = path.join(app.getPath('temp'), `projects_${Date.now()}.tar.gz`);
        const parentDir = path.dirname(localProjectsDir);
        const folderName = path.basename(localProjectsDir);

        try {
          console.log(`Attempting to compress templates to ${tempArchivePath}...`);
          await new Promise<void>((resolveTar, rejectTar) => {
            exec(`tar -czf "${tempArchivePath}" -C "${parentDir}" "${folderName}"`, (err, stdout, stderr) => {
              if (err) {
                rejectTar(new Error(stderr || err.message));
              } else {
                resolveTar();
              }
            });
          });

          console.log('Archive created successfully. Uploading archive to remote...');
          const remoteArchiveFilename = `projects_${Date.now()}.tar.gz`;
          const remoteArchivePath = `.zx/${remoteArchiveFilename}`;
          await uploadFileSFTP(sshClient!, tempArchivePath, remoteArchivePath);

          console.log('Archive uploaded. Extracting archive on remote...');
          const extractCmd = `
            mkdir -p ~/.zx
            tar -xzf ~/.zx/${remoteArchiveFilename} -C ~/.zx/
            rm -f ~/.zx/${remoteArchiveFilename}
          `;
          await execCommand(sshClient!, extractCmd);
          console.log('Archive extracted successfully on remote.');
          archiveUploaded = true;
        } catch (archiveErr) {
          console.warn('Failed to upload zipped projects archive, falling back to recursive SFTP upload:', archiveErr);
        } finally {
          // Clean up local temp archive file if it was created
          if (fs.existsSync(tempArchivePath)) {
            try {
              fs.unlinkSync(tempArchivePath);
            } catch (unlinkErr) {
              console.error('Failed to clean up local temp archive:', unlinkErr);
            }
          }
        }

        if (!archiveUploaded) {
          console.log('Falling back: uploading projects directory via recursive SFTP...');
          await uploadDirectorySFTP(sshClient!, localProjectsDir, remoteProjectsDir);
        } else {
          console.log('Projects directory uploaded and extracted via zip archive successfully.');
        }

        // 6. Install the wheel on the remote system
        console.log('Installing package wheel on remote...');
        const installCmd = `
          export PATH="$HOME/.local/bin:$PATH"
          export VIRTUAL_ENV="$HOME/.zx/venv"
          uv pip install --force-reinstall ~/.zx/${wheelFilename}
        `;
        await execCommand(sshClient!, installCmd);
        console.log('Package wheel installed successfully.');

        // 7. Start the backend on the remote system using the discovered remote port
        console.log(`Preparing remote port ${remotePort}...`);
        try {
          const checkCmd = `kill $(cat ~/.zx/backend_${remotePort}.pid) 2>/dev/null || kill $(lsof -t -i :${remotePort}) 2>/dev/null || rm -f ~/.zx/backend_${remotePort}.pid || true`;
          await execCommand(sshClient!, checkCmd);
        } catch (cleanErr) {
          console.log('Port cleanup ignored:', cleanErr);
        }

        const startCmd = `
          export ZX_AUTH_TOKEN="${authToken}"
          export PATH="$HOME/.local/bin:$PATH"
          nohup ~/.zx/venv/bin/python3 -m uvicorn zx_backend.main:app --host 127.0.0.1 --port ${remotePort} > ~/.zx/backend.log 2>&1 &
          echo $! > ~/.zx/backend_${remotePort}.pid
          
          # Wait up to 10s for the backend port to bind and become active
          i=0
          while [ $i -lt 10 ]; do
            if python3 -c "import socket; s=socket.socket(); s.connect(('127.0.0.1', ${remotePort}))" 2>/dev/null; then
              exit 0
            fi
            sleep 1
            i=$((i+1))
          done
          echo "Error: Remote backend failed to bind on port ${remotePort} within 10 seconds" >&2
          exit 1
        `;
        await execCommand(sshClient!, startCmd);
        console.log(`Remote sidecar backend started and successfully bound on port ${remotePort}.`);

        // 8. Establish programmatic local TCP port forwarding tunnel
        console.log(`Setting up local port forward 127.0.0.1:${localPort} -> remote 127.0.0.1:${remotePort}...`);
        tunnelServer = await createLocalForwardTunnel(sshClient!, localPort, remotePort);
        console.log(`Local port forward tunnel server successfully listening.`);

        remotePortActive = remotePort;
        resolve({ status: 'success', host: displayName, port: localPort });
      } catch (bootstrapErr: any) {
        console.error('Bootstrapping failed:', bootstrapErr);
        reject(bootstrapErr);
      }
    });

    sshClient.on('error', (err) => {
      console.error('SSH Client Error:', err);
      cleanupTunnels();
      reject(err);
    });

    sshClient.on('close', () => {
      cleanupTunnels();
    });

    try {
      const sock = await establishSSHStream(connConfig, jumpClients);
      const connectOpts: any = prepareConnectOptions(connConfig);
      if (sock) {
        connectOpts.sock = sock;
      }
      console.log(`Connecting to target SSH host [${displayName}] using target: ${connConfig.host}:${connConfig.port} (user: ${connConfig.username})`);
      sshClient.connect(connectOpts);
    } catch (err) {
      console.error('ProxyJump setup failed:', err);
      cleanupTunnels();
      reject(err);
    }
  });
});
