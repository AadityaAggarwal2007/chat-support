import { io, Socket } from 'socket.io-client';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('chat_token') : '';
    socket = io(`${SERVER}/agent`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
