/**
 * Master Script - Run All Background Services
 * 
 * This script runs all background services concurrently:
 * - Market Data Sync
 * - Technical Indicators Sync
 * - AI Trading System
 * - 5-Minute Data Sync (optional)
 * 
 * Usage:
 *   npm run sync:all          - Start all services continuously
 *   npm run sync:all:once      - Run all services once and exit
 *   npx tsx server/scripts/runAll.ts
 */

import 'dotenv/config';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  // Scripts to run
  SCRIPTS: [
    {
      name: 'Market Data Sync',
      file: 'marketDataSync.ts',
      description: 'Syncs market movers and historical data'
    },
    {
      name: 'Technical Indicators',
      file: 'technicalIndicatorsSync.ts',
      description: 'Calculates and stores technical indicators'
    },
    {
      name: 'AI Trading System',
      file: 'aiTradingSystem.ts',
      description: 'Runs AI trading strategies and executes trades'
    },
    // Optional: Uncomment to include 5-minute data sync
    // {
    //   name: '5-Min Data Sync',
    //   file: 'dataSync5min.ts',
    //   description: 'Syncs data every 5 minutes'
    // }
  ],
  // Logging
  LOG_PREFIX: '[Master]',
};

// Track running processes
const processes: Map<string, ChildProcess> = new Map();
let isShuttingDown = false;

/**
 * Log with timestamp
 */
function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${CONFIG.LOG_PREFIX} ${message}`);
}

/**
 * Error log
 */
function error(message: string) {
  console.error(`[${new Date().toISOString()}] ${CONFIG.LOG_PREFIX} ERROR: ${message}`);
}

/**
 * Start a script (non-blocking, runs in parallel)
 */
function startScript(script: { name: string; file: string; description: string }, runOnce: boolean = false): ChildProcess {
  const scriptPath = path.join(__dirname, script.file);
  const args = runOnce ? ['--once'] : [];
  
  log(`[PARALLEL] Starting ${script.name}...`);
  log(`  Description: ${script.description}`);
  log(`  Mode: ${runOnce ? 'Once' : 'Continuous'}`);
  
  // Spawn process immediately (non-blocking, runs in parallel)
  const child = spawn('tsx', [scriptPath, ...args], {
    cwd: path.join(__dirname, '../..'),
    stdio: 'inherit',
    shell: true,
    detached: false, // Keep attached to parent for proper cleanup
  });

  child.on('error', (err) => {
    error(`${script.name} failed to start: ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    if (!isShuttingDown) {
      if (code === 0) {
        log(`${script.name} exited successfully`);
      } else if (code !== null) {
        error(`${script.name} exited with code ${code}`);
        // Restart the script if it crashed (only in continuous mode)
        if (!runOnce && !isShuttingDown) {
          log(`Restarting ${script.name} in 5 seconds...`);
          setTimeout(() => {
            if (!isShuttingDown) {
              const newProcess = startScript(script, false);
              processes.set(script.name, newProcess);
            }
          }, 5000);
        }
      } else if (signal) {
        log(`${script.name} was terminated by signal ${signal}`);
      }
    }
  });

  return child;
}

/**
 * Stop all processes gracefully
 */
function stopAll() {
  if (isShuttingDown) return;
  
  isShuttingDown = true;
  log('Shutting down all services...');
  
  processes.forEach((process, name) => {
    log(`Stopping ${name}...`);
    process.kill('SIGTERM');
  });

  // Force kill after 10 seconds if processes don't exit
  setTimeout(() => {
    processes.forEach((process, name) => {
      if (!process.killed) {
        log(`Force killing ${name}...`);
        process.kill('SIGKILL');
      }
    });
    process.exit(0);
  }, 10000);
}

/**
 * Main function
 */
async function main() {
  const runOnce = process.argv.includes('--once');
  
  log('='.repeat(60));
  log('Market Watcher - Master Script');
  log('='.repeat(60));
  log(`Mode: ${runOnce ? 'Run Once' : 'Continuous'}`);
  log(`Starting ${CONFIG.SCRIPTS.length} service(s)...`);
  log('');

  // Start all scripts in parallel (simultaneously)
  log('Starting all services in parallel...');
  const startPromises = CONFIG.SCRIPTS.map(script => {
    return new Promise<void>((resolve) => {
      const proc = startScript(script, runOnce);
      processes.set(script.name, proc);
      
      // Give process a moment to start, then resolve
      setTimeout(() => {
        resolve();
      }, 100);
    });
  });

  // Wait for all processes to start (but they run in parallel)
  await Promise.all(startPromises);

  log('');
  log('✓ All services started successfully in parallel!');
  log('Press Ctrl+C to stop all services');
  log('='.repeat(60));
  log('');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('\nReceived SIGINT, shutting down...');
    stopAll();
  });

  process.on('SIGTERM', () => {
    log('\nReceived SIGTERM, shutting down...');
    stopAll();
  });

  // If running once, wait for all processes to complete
  if (runOnce) {
    log('Waiting for all services to complete...');
    const promises = Array.from(processes.values()).map(p => {
      return new Promise<void>((resolve) => {
        p.on('exit', () => resolve());
      });
    });
    
    await Promise.all(promises);
    log('All services completed!');
    process.exit(0);
  }
}

// Run main function
main().catch((err) => {
  error(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});

