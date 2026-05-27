import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { spawn, ChildProcess, exec } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { Client } from 'ssh2';
import net from 'net';

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let sshClient: Client | null = null;
let tunnelServer: net.Server | null = null;
let authToken: string = '';
let isBootstrapping = false;
let PORT = 8000;
let remotePortActive: number | null = null;

interface AppSettings {
  recentProjects: any[];
  lastConnection: string;
  windowWidth: number;
  windowHeight: number;
}

const settingsPath = path.join(app.getPath('userData'), 'zx_settings.json');

function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load settings', e);
  }
  return {
    recentProjects: [],
    lastConnection: 'Local',
    windowWidth: 1200,
    windowHeight: 800,
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

async function stopBackendProcesses(): Promise<void> {
  console.log('stopBackendProcesses: stopping active backend processes...');
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
    } catch (e) {}
  }
  if (sshClient) {
    try {
      sshClient.end();
    } catch (e) {}
  }
  if (tunnelServer) {
    try {
      tunnelServer.close();
    } catch (e) {}
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


// Parse SSH Config for Hosts
ipcMain.handle('get-ssh-hosts', async () => {
  const sshConfigPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', 'config');
  if (!fs.existsSync(sshConfigPath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(sshConfigPath, 'utf8');
    const hosts: string[] = [];
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^Host\s+(.+)$/i);
      if (match) {
        const hostVal = match[1].trim();
        if (!hostVal.includes('*')) {
          hosts.push(hostVal);
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
  agent?: string;
}

function getSSHConfigForHost(hostName: string): SSHHostConfig {
  const config: SSHHostConfig = {
    host: '127.0.0.1',
    port: 22,
    username: process.env.USER || 'root',
    agent: process.env.SSH_AUTH_SOCK
  };
  
  const sshConfigPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', 'config');
  if (!fs.existsSync(sshConfigPath)) {
    return config;
  }
  
  try {
    const content = fs.readFileSync(sshConfigPath, 'utf8');
    const lines = content.split('\n');
    let insideTargetHost = false;
    
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      
      const hostMatch = line.match(/^Host\s+(.+)$/i);
      if (hostMatch) {
        const currentHost = hostMatch[1].trim();
        if (currentHost === hostName) {
          insideTargetHost = true;
        } else {
          insideTargetHost = false;
        }
        continue;
      }
      
      if (insideTargetHost) {
        const keyValueMatch = line.match(/^([a-zA-Z0-9_\-]+)\s+(.+)$/);
        if (keyValueMatch) {
          const key = keyValueMatch[1].toLowerCase();
          const value = keyValueMatch[2].trim();
          
          if (key === 'hostname') {
            config.host = value;
          } else if (key === 'user') {
            config.username = value;
          } else if (key === 'port') {
            const p = parseInt(value, 10);
            if (!isNaN(p)) {
              config.port = p;
            }
          } else if (key === 'identityfile') {
            let keyPath = value;
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
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to parse ssh config for host details', err);
  }
  
  return config;
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
      client.forwardOut('127.0.0.1', socket.remotePort || 0, '127.0.0.1', remotePort, (err, stream) => {
        if (err) {
          console.error('forwardOut error:', err);
          socket.destroy();
          return;
        }
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

// SSH Bootstrapping & Port Forwarding Manager (Phase 6)
ipcMain.handle('connect-ssh-remote', async (_, hostName: string) => {
  console.log(`SSH Remote Connection to host: ${hostName}`);
  
  await stopBackendProcesses();

  return new Promise((resolve, reject) => {
    sshClient = new Client();

    sshClient.on('ready', async () => {
      console.log('SSH connection established successfully.');
      
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

        // Upload projects templates directory recursively
        const localProjectsDir = resolveLocalProjectsDir();
        const remoteProjectsDir = '.zx/projects';
        console.log(`Uploading projects directory from ${localProjectsDir} to remote ${remoteProjectsDir}...`);
        await uploadDirectorySFTP(sshClient!, localProjectsDir, remoteProjectsDir);
        console.log('Projects directory uploaded successfully.');

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
        resolve({ status: 'success', host: hostName, port: localPort });
      } catch (bootstrapErr: any) {
        console.error('Bootstrapping failed:', bootstrapErr);
        reject(bootstrapErr);
      }
    });

    sshClient.on('error', (err) => {
      console.error('SSH Client Error:', err);
      reject(err);
    });

    // Load config matching host from ~/.ssh/config using our parser,
    // falling back to local credentials if no configuration is found.
    const connConfig = getSSHConfigForHost(hostName);
    console.log(`Connecting to SSH host [${hostName}] using target: ${connConfig.host}:${connConfig.port} (user: ${connConfig.username})`);
    sshClient.connect(connConfig);
  });
});
