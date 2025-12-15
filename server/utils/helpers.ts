// Utility functions

export function log(message: string, source: string = 'server') {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  console.log(`${timestamp} [${source}] ${message}`);
}