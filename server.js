const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO 경로 확인을 위한 헬스체크
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    socketIO: 'enabled',
    environment: process.env.NODE_ENV || 'development'
  });
});

// 게임 상태 저장 (메모리)
const rooms = new Map();
const players = new Map();

// AI 플레이어 클래스
class AIPlayer {
  constructor() {
    this.name = 'AI';
    this.id = 'ai_player';
    this.position = 'player2';
  }
  
  // 간단한 AI 전략: 랜덤하게 카드 선택
  chooseCard(availableCards) {
    if (availableCards.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * availableCards.length);
    return availableCards[randomIndex];
  }
  
  // 더 똑똑한 AI 전략 (향후 개선 가능)
  chooseCardSmart(availableCards, opponentCards, roundNumber) {
    // 현재는 랜덤 전략 사용
    return this.chooseCard(availableCards);
  }
}

// 게임 로직 함수들
function createRoom(isAIGame = false) {
  const roomId = uuidv4().substring(0, 8).toUpperCase();
  const room = {
    id: roomId,
    players: [],
    gameState: 'waiting', // waiting, playing, finished
    currentRound: 0,
    maxRounds: 9,
    scores: { player1: 0, player2: 0 },
    cards: {
      player1: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      player2: [1, 2, 3, 4, 5, 6, 7, 8, 9]
    },
    currentPlay: {
      player1: null,
      player2: null
    },
    roundResults: [],
    isAIGame: isAIGame,
    aiPlayer: isAIGame ? new AIPlayer() : null
  };
  rooms.set(roomId, room);
  return room;
}

function joinRoom(roomId, playerId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return null;
  
  if (room.players.length >= 2) return null;
  
  const player = {
    id: playerId,
    name: playerName,
    position: room.players.length === 0 ? 'player1' : 'player2'
  };
  
  room.players.push(player);
  return { room, player };
}

function startGame(roomId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  
  // AI 게임인 경우 플레이어 1명만 있어도 시작 가능
  if (room.isAIGame && room.players.length !== 1) return false;
  if (!room.isAIGame && room.players.length !== 2) return false;
  
  room.gameState = 'playing';
  room.currentRound = 1;
  room.scores = { player1: 0, player2: 0 };
  room.cards = {
    player1: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    player2: [1, 2, 3, 4, 5, 6, 7, 8, 9]
  };
  room.currentPlay = { player1: null, player2: null };
  room.roundResults = [];
  
  // AI 게임인 경우 AI 플레이어 추가
  if (room.isAIGame && room.aiPlayer) {
    room.players.push(room.aiPlayer);
  }
  
  return true;
}

function playCard(roomId, playerId, card) {
  const room = rooms.get(roomId);
  if (!room || room.gameState !== 'playing') return false;
  
  const player = room.players.find(p => p.id === playerId);
  if (!player) return false;
  
  const playerPosition = player.position;
  
  // 카드가 플레이어의 손패에 있는지 확인
  if (!room.cards[playerPosition].includes(card)) return false;
  
  // 이미 카드를 낸 경우
  if (room.currentPlay[playerPosition] !== null) return false;
  
  // 카드 제출
  room.currentPlay[playerPosition] = card;
  
  // 카드 제거
  room.cards[playerPosition] = room.cards[playerPosition].filter(c => c !== card);
  
  return true;
}

function evaluateRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  
  const { player1, player2 } = room.currentPlay;
  
  // 둘 다 카드를 낸 경우에만 판정
  if (player1 === null || player2 === null) return null;
  
  let winner = null;
  let reason = '';
  
  // 특수 규칙: 1은 9를 이김
  if (player1 === 1 && player2 === 9) {
    winner = 'player1';
    reason = '1이 9를 이김';
  } else if (player1 === 9 && player2 === 1) {
    winner = 'player2';
    reason = '1이 9를 이김';
  } else if (player1 > player2) {
    winner = 'player1';
    reason = `${player1} > ${player2}`;
  } else if (player2 > player1) {
    winner = 'player2';
    reason = `${player2} > ${player1}`;
  } else {
    winner = 'tie';
    reason = '무승부';
  }
  
  const result = {
    round: room.currentRound,
    player1Card: player1,
    player2Card: player2,
    winner,
    reason
  };
  
  room.roundResults.push(result);
  
  // 점수 업데이트
  if (winner === 'player1') {
    room.scores.player1++;
  } else if (winner === 'player2') {
    room.scores.player2++;
  }
  
  // 다음 라운드 준비
  room.currentPlay = { player1: null, player2: null };
  room.currentRound++;
  
  // 게임 종료 확인
  if (room.currentRound > room.maxRounds) {
    room.gameState = 'finished';
  }
  
  return result;
}

// AI가 자동으로 카드를 선택하는 함수
function aiPlayCard(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.isAIGame || !room.aiPlayer) return false;
  
  const availableCards = room.cards.player2;
  if (availableCards.length === 0) return false;
  
  // AI가 카드 선택
  const selectedCard = room.aiPlayer.chooseCard(availableCards);
  if (selectedCard === null) return false;
  
  // 카드 제출
  room.currentPlay.player2 = selectedCard;
  room.cards.player2 = room.cards.player2.filter(c => c !== selectedCard);
  
  return true;
}

function getGameResult(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.gameState !== 'finished') return null;
  
  const { player1, player2 } = room.scores;
  let winner = 'tie';
  
  if (player1 > player2) {
    winner = 'player1';
  } else if (player2 > player1) {
    winner = 'player2';
  }
  
  return {
    winner,
    scores: room.scores,
    rounds: room.roundResults
  };
}

// Socket.IO 연결 처리
io.on('connection', (socket) => {
  console.log('새로운 클라이언트 연결:', socket.id);
  
  socket.on('message', (data) => {
    try {
      const { type, roomId, playerId, playerName, card } = data;
      
      switch (type) {
        case 'create_room':
          const newRoom = createRoom();
          const createPlayerId = playerId || uuidv4();
          const createPlayerName = playerName || '플레이어';
          
          // 방을 만든 사람을 자동으로 플레이어 1로 추가
          const createResult = joinRoom(newRoom.id, createPlayerId, createPlayerName);
          if (createResult) {
            const { room, player } = createResult;
            players.set(createPlayerId, { socket, roomId: newRoom.id, player });
            
            socket.emit('message', {
              type: 'room_created',
              roomId: newRoom.id,
              player: player,
              room: {
                players: room.players,
                gameState: room.gameState
              }
            });
          }
          break;
          
        case 'create_ai_room':
          const newAIRoom = createRoom(true);
          const createAIPlayerId = playerId || uuidv4();
          const createAIPlayerName = playerName || '플레이어';
          
          // 방을 만든 사람을 자동으로 플레이어 1로 추가
          const createAIResult = joinRoom(newAIRoom.id, createAIPlayerId, createAIPlayerName);
          if (createAIResult) {
            const { room, player } = createAIResult;
            players.set(createAIPlayerId, { ws, roomId: newAIRoom.id, player });
            
            // AI 게임은 바로 시작
            startGame(newAIRoom.id);
            const updatedRoom = rooms.get(newAIRoom.id);
            
            socket.emit('message', {
              type: 'ai_game_started',
              roomId: newAIRoom.id,
              player: player,
              room: {
                players: updatedRoom.players,
                gameState: updatedRoom.gameState,
                isAIGame: true
              }
            });
          }
          break;
          
        case 'join_room':
          const joinResult = joinRoom(roomId, playerId, playerName);
          if (joinResult) {
            const { room, player } = joinResult;
            players.set(playerId, { socket, roomId, player });
            
            socket.emit('message', {
              type: 'joined_room',
              roomId: room.id,
              player: player,
              room: {
                players: room.players,
                gameState: room.gameState
              }
            });
            
            // 다른 플레이어들에게 새 플레이어 입장 알림
            broadcastToRoom(roomId, {
              type: 'player_joined',
              player: player,
              room: {
                players: room.players,
                gameState: room.gameState
              }
            }, playerId);
          } else {
            socket.emit('message', {
              type: 'join_failed',
              message: '방을 찾을 수 없거나 이미 가득참'
            });
          }
          break;
          
        case 'start_game':
          if (startGame(roomId)) {
            broadcastToRoom(roomId, {
              type: 'game_started',
              room: rooms.get(roomId)
            });
          }
          break;
          
        case 'play_card':
          if (playCard(roomId, playerId, card)) {
            const room = rooms.get(roomId);
            
            // 모든 플레이어에게 카드 제출 상태 업데이트
            broadcastToRoom(roomId, {
              type: 'card_played',
              playerId: playerId,
              card: card,
              currentPlay: room.currentPlay,
              cards: room.cards
            });
            
            // AI 게임이고 플레이어 1이 카드를 낸 경우, AI가 자동으로 카드 선택
            if (room.isAIGame && room.currentPlay.player1 !== null && room.currentPlay.player2 === null) {
              setTimeout(() => {
                if (aiPlayCard(roomId)) {
                  const room = rooms.get(roomId);
                  broadcastToRoom(roomId, {
                    type: 'card_played',
                    playerId: 'ai_player',
                    card: room.currentPlay.player2,
                    currentPlay: room.currentPlay,
                    cards: room.cards
                  });
                  
                  // 둘 다 카드를 낸 경우 판정
                  const result = evaluateRound(roomId);
                  if (result) {
                    const room = rooms.get(roomId);
                    broadcastToRoom(roomId, {
                      type: 'round_result',
                      result: result,
                      scores: room.scores,
                      currentRound: room.currentRound,
                      gameState: room.gameState
                    });
                    
                    // 게임 종료 확인
                    if (room.gameState === 'finished') {
                      const gameResult = getGameResult(roomId);
                      broadcastToRoom(roomId, {
                        type: 'game_finished',
                        result: gameResult
                      });
                    }
                  }
                }
              }, 1000); // 1초 후 AI가 카드 선택
            } else {
              // 일반 게임: 둘 다 카드를 낸 경우 판정
              if (room.currentPlay.player1 !== null && room.currentPlay.player2 !== null) {
                const result = evaluateRound(roomId);
                if (result) {
                  const room = rooms.get(roomId);
                  broadcastToRoom(roomId, {
                    type: 'round_result',
                    result: result,
                    scores: room.scores,
                    currentRound: room.currentRound,
                    gameState: room.gameState
                  });
                  
                  // 게임 종료 확인
                  if (room.gameState === 'finished') {
                    const gameResult = getGameResult(roomId);
                    broadcastToRoom(roomId, {
                      type: 'game_finished',
                      result: gameResult
                    });
                  }
                }
              }
            }
          } else {
            socket.emit('message', {
              type: 'play_failed',
              message: '카드를 낼 수 없음'
            });
          }
          break;
          
        case 'get_room_status':
          const room = rooms.get(roomId);
          if (room) {
            socket.emit('message', {
              type: 'room_status',
              room: room
            });
          }
          break;
      }
    } catch (error) {
      console.error('메시지 처리 오류:', error);
      socket.emit('message', {
        type: 'error',
        message: '서버 오류가 발생했습니다'
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('클라이언트 연결 종료:', socket.id);
    
    // 연결된 모든 플레이어 중에서 해당 Socket을 찾아서 정리
    for (const [playerId, playerInfo] of players.entries()) {
      if (playerInfo.socket === socket) {
        const { roomId } = playerInfo;
        players.delete(playerId);
        
        // 방에서 플레이어 제거
        const room = rooms.get(roomId);
        if (room) {
          room.players = room.players.filter(p => p.id !== playerId);
          
          // 방이 비었으면 삭제
          if (room.players.length === 0) {
            rooms.delete(roomId);
          } else {
            // 다른 플레이어들에게 플레이어 퇴장 알림
            broadcastToRoom(roomId, {
              type: 'player_left',
              playerId: playerId,
              room: room
            }, playerId);
          }
        }
        break;
      }
    }
  });
});

// 방에 있는 모든 플레이어에게 메시지 전송 (자신 제외)
function broadcastToRoom(roomId, message, excludePlayerId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  room.players.forEach(player => {
    if (excludePlayerId && player.id === excludePlayerId) return;
    
    const playerInfo = players.get(player.id);
    if (playerInfo && playerInfo.socket.connected) {
      playerInfo.socket.emit('message', message);
    }
  });
}

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`게임 사이트: http://localhost:${PORT}`);
  console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
});
