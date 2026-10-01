import { io } from 'socket.io-client';
const socket = io('http://localhost:3014', { transports: ['websocket', 'polling'] });
socket.on('connect', () => {
  socket.emit('tv:meta', { symbol: 'BINANCE:BTCUSDT' }, (res: unknown) => {
    console.log('META:', JSON.stringify(res).slice(0, 300));
    process.exit(0);
  });
});
setTimeout(() => process.exit(1), 20000);
