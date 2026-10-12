import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Спавны для 1×1
const SPAWNS = {
  A: { x: 0, z: -25 },
  B: { x: 0, z:  25 }
};
const KILLS_TO_WIN = 3;

// roomId -> {
//   players: [{ id, slot, nick, score }],
//   round: number,
//   state: 'waiting' | 'playing' | 'ended'
// }
const rooms = new Map();

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', rooms: rooms.size });
});

// Утилита — найти комнату по socketId
function findRoomBySocket(socketId) {
  for (const [roomId, room] of rooms) {
    const p = room.players.find(pl => pl.id === socketId);
    if (p) return { roomId, room, player: p };
  }
  return null;
}

// Утилита — публичный вид комнаты для клиента
function roomPublicView(room) {
  return {
    players: room.players.map(p => ({
      id: p.id,
      slot: p.slot,
      nick: p.nick,
      score: p.score,
      spawn: SPAWNS[p.slot]
    })),
    round: room.round,
    killsToWin: KILLS_TO_WIN
  };
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // ============================================================
  // СОЗДАТЬ КОМНАТУ
  // ============================================================
  socket.on('create-room', () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms.set(roomId, {
      players: [{
        id: socket.id,
        slot: 'A',
        nick: 'Host',
        score: 0
      }],
      round: 1,
      state: 'waiting'
    });
    socket.join(roomId);
    socket.emit('room-created', { roomId });
    console.log('Room created:', roomId);
  });

  // ============================================================
  // УСТАНОВИТЬ НИК
  // ============================================================
  socket.on('set-nick', ({ roomId, nick }) => {
    const room = rooms.get(String(roomId).toUpperCase());
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p) {
      p.nick = String(nick || 'Player').slice(0, 16);
      console.log('Nick set:', roomId, p.slot, p.nick);
    }
  });

  // ============================================================
  // ВОЙТИ В КОМНАТУ
  // ============================================================
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
    if (room.state !== 'waiting') {
      socket.emit('error-msg', 'Игра уже началась');
      return;
    }

    room.players.push({
      id: socket.id,
      slot: 'B',
      nick: 'Guest',
      score: 0
    });
    socket.join(roomId);
    socket.emit('room-joined', { roomId });

    // Обоим — старт
    room.state = 'playing';
    io.to(roomId).emit('game-start', roomPublicView(room));
    console.log('Game start:', roomId, room.players.map(p => p.slot + ':' + p.nick));
  });

  // ============================================================
  // СИНХРОНИЗАЦИЯ ПОЗИЦИИ
  // ============================================================
  socket.on('player-state', ({ roomId, state }) => {
    socket.to(roomId).emit('opponent-state', state);
  });

  // ============================================================
  // ВЫСТРЕЛ (визуал)
  // ============================================================
  socket.on('player-shoot', ({ roomId, shot }) => {
    socket.to(roomId).emit('opponent-shoot', shot);
  });

  // ============================================================
  // УРОН (клиент сам считает попадания, сервер доверяет)
  // ============================================================
  socket.on('player-hit', ({ roomId, damage }) => {
    socket.to(roomId).emit('opponent-hit', damage);
  });

  // ============================================================
  // ИГРОК УБИЛ ОППОНЕНТА → засчитываем кил
  // ============================================================
  socket.on('player-killed', ({ roomId }) => {
    const room = rooms.get(String(roomId).toUpperCase());
    if (!room || room.state !== 'playing') return;

    const killer = room.players.find(p => p.id === socket.id);
    if (!killer) return;

    killer.score += 1;
    console.log(`Kill! ${roomId}: ${killer.slot}(${killer.nick}) = ${killer.score}`);

    const matchOver = killer.score >= KILLS_TO_WIN;

    if (matchOver) {
      room.state = 'ended';
      io.to(roomId).emit('match-end', {
        winnerId: killer.id,
        winnerSlot: killer.slot,
        players: room.players.map(p => ({ id: p.id, slot: p.slot, nick: p.nick, score: p.score }))
      });
    } else {
      // Новый раунд
      room.round += 1;
      io.to(roomId).emit('new-round', {
        round: room.round,
        players: room.players.map(p => ({
          id: p.id,
          slot: p.slot,
          nick: p.nick,
          score: p.score,
          spawn: SPAWNS[p.slot]
        }))
      });
    }
  });

  // ============================================================
  // ОТКЛЮЧЕНИЕ
  // ============================================================
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    rooms.forEach((room, roomId) => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit('opponent-left');
          room.state = 'ended';
        }
      }
    });
  });
});

const port = process.env.PORT || 3000;
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
