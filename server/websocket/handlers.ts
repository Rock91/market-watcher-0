import { ExtendedWebSocket, SubscribeMessage } from './types';

// Handle WebSocket connection
export function handleConnection(ws: ExtendedWebSocket, clients: Set<ExtendedWebSocket>) {
  console.log('Client connected');
  clients.add(ws);

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString()) as SubscribeMessage;
      if (data.type === 'subscribe' && data.symbols) {
        ws.symbols = data.symbols;
        console.log(`Client subscribed to: ${data.symbols.join(', ')}`);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
}