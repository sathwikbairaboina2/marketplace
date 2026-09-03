import { io } from 'socket.io-client';
import { readFileSync } from 'node:fs';

const token = readFileSync(process.argv[2], 'utf8').trim();
const socket = io('http://localhost:33001/agents', { auth: { token }, transports: ['websocket'] });

const die = (why) => { console.error('FAIL:', why); socket.close(); process.exit(1); };
setTimeout(() => die('timeout'), 180_000);

socket.on('connect_error', (e) => die(`connect_error ${e.message}`));
socket.on('error', (e) => console.log('error event:', JSON.stringify(e)));

let threadId = null;
socket.on('state', (s) => {
  console.log('state:', JSON.stringify({ threadId: s.threadId, phase: s.phase, messages: s.messages?.length, proposal: s.proposal ? Object.keys(s.proposal) : null }));
  if (!threadId) {
    threadId = s.threadId;
    socket.emit('message', { threadId, content: 'Add a "warranty_months" number field to Product.' });
    return;
  }
  console.log('last assistant:', JSON.stringify(s.messages?.at(-1)?.content?.slice?.(0, 400)));
  socket.close();
  process.exit(0);
});

socket.on('connect', () => { console.log('connected'); socket.emit('thread.start'); });
