import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execAsync = promisify(exec);

const ports = [3000, 8001, 24678, 5173];

async function killPort(port) {
  const os = platform();
  try {
    if (os === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const pids = stdout
        .split('\n')
        .filter(line => line.includes('LISTENING'))
        .map(line => {
          const parts = line.trim().split(/\s+/);
          return parts[parts.length - 1];
        });
      for (const pid of pids) {
        if (pid) {
          try {
            await execAsync(`taskkill /F /PID ${pid}`);
            console.log(`Killed process ${pid} on port ${port}`);
          } catch {
            // ignore
          }
        }
      }
    } else {
      // macOS / Linux
      await execAsync(`lsof -ti :${port} | xargs -r kill -9`);
      console.log(`Killed processes on port ${port}`);
    }
  } catch {
    console.log(`No processes found on port ${port}`);
  }
}

async function main() {
  console.log('Killing processes on ports:', ports);
  await Promise.all(ports.map(killPort));
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log('Done killing ports');
}

main();
