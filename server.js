import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Комнаты: roomId -> { players: [socketId1, socketId2] }
const rooms = new Map();

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', rooms: rooms.size });
});

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Создать комнату
  socket.on('create-room', () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms.set(roomId, {
      players: [socket.id]
    });
    socket.join(roomId);
    socket.emit('room-created', { roomId });
    console.log('Room created:', roomId);
  });

  // Подключиться к комнате
  socket.on('join-room', (roomId) => {
    roomId = String(roomId).toUpperCase();
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('error-msg', 'Комната не найдена');
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('error-msg', 'Комната полна');
      return;
    }

    room.players.push(socket.id);
    socket.join(roomId);
    socket.emit('room-joined', { roomId });

    // Обоим — старт
    io.to(roomId).emit('game-start', {
      players: room.players
    });
    console.log('Player joined:', roomId, room.players);
  });

  // Синхронизация позиции
  socket.on('player-state', (data) => {
    const { roomId, state } = data;
    socket.to(roomId).emit('opponent-state', state);
  });

  // Выстрел
  socket.on('player-shoot', (data) => {
    const { roomId, shot } = data;
    socket.to(roomId).emit('opponent-shoot', shot);
  });

  // Урон
  socket.on('player-hit', (data) => {
    const { roomId, damage } = data;
    socket.to(roomId).emit('opponent-hit', damage);
  });

  // Смерть игрока
  socket.on('player-died', () => {
    rooms.forEach((room, roomId) => {
      if (room.players.includes(socket.id)) {
        socket.to(roomId).emit('opponent-died');
      }
    });
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    rooms.forEach((room, roomId) => {
      const idx = room.players.indexOf(socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit('opponent-left');
        }
      }
    });
  });
});

const port = process.env.PORT || 3000;
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
