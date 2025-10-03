const express = require('express');
const { createServer } = require('http');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = createServer(app);

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 게임 상태 저장 (메모리)
const rooms = new Map();
const players = new Map();
const gameEvents = new Map(); // 플레이어별 이벤트 큐

// AI 플레이어 클래스
class AIPlayer {
  constructor() {
    this.name = 'AI';
    this.id = 'ai_player';
    this.position = 'player2';
  }
  
  chooseCard(availableCards) {
    if (availableCards.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * availableCards.length);
    return availableCards[randomIndex];
  }
}

// 게임 로직 함수들
function createRoom(isAIGame = false) {
  const roomId = uuidv4().substring(0, 8).toUpperCase();
  const room = {
    id: roomId,
    players: [],
    gameState: 'waiting',
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
  
  if (!room.cards[playerPosition].includes(card)) return false;
  if (room.currentPlay[playerPosition] !== null) return false;
  
  room.currentPlay[playerPosition] = card;
  room.cards[playerPosition] = room.cards[playerPosition].filter(c => c !== card);
  
  return true;
}

function evaluateRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  
  const { player1, player2 } = room.currentPlay;
  
  if (player1 === null || player2 === null) return null;
  
  let winner = null;
  let reason = '';
  
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
  
  if (winner === 'player1') {
    room.scores.player1++;
  } else if (winner === 'player2') {
    room.scores.player2++;
  }
  
  room.currentPlay = { player1: null, player2: null };
  room.currentRound++;
  
  if (room.currentRound > room.maxRounds) {
    room.gameState = 'finished';
  }
  
  return result;
}

function aiPlayCard(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.isAIGame || !room.aiPlayer) return false;
  
  const availableCards = room.cards.player2;
  if (availableCards.length === 0) return false;
  
  const selectedCard = room.aiPlayer.chooseCard(availableCards);
  if (selectedCard === null) return false;
  
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

// 이벤트 큐 관리
function addEvent(playerId, event) {
  if (!gameEvents.has(playerId)) {
    gameEvents.set(playerId, []);
  }
  gameEvents.get(playerId).push(event);
}

function getEvents(playerId) {
  const events = gameEvents.get(playerId) || [];
  gameEvents.set(playerId, []); // 이벤트 큐 초기화
  return events;
}

// 폴링 엔드포인트
app.get('/poll/:playerId', (req, res) => {
  const playerId = req.params.playerId;
  const events = getEvents(playerId);
  
  res.json({
    events: events,
    timestamp: Date.now()
  });
});

// 게임 액션 처리
app.post('/game/:action', (req, res) => {
  const { action } = req.params;
  const { roomId, playerId, playerName, card } = req.body;
  
  try {
    switch (action) {
      case 'create_room':
        const newRoom = createRoom();
        const createPlayerId = playerId || uuidv4();
        const createPlayerName = playerName || '플레이어';
        
        const createResult = joinRoom(newRoom.id, createPlayerId, createPlayerName);
        if (createResult) {
          const { room, player } = createResult;
          players.set(createPlayerId, { roomId: newRoom.id, player });
          
          addEvent(createPlayerId, {
            type: 'room_created',
            roomId: newRoom.id,
            player: player,
            room: {
              players: room.players,
              gameState: room.gameState
            }
          });
          
          res.json({ success: true, playerId: createPlayerId });
        } else {
          res.status(400).json({ success: false });
        }
        break;
        
      case 'create_ai_room':
        const newAIRoom = createRoom(true);
        const createAIPlayerId = playerId || uuidv4();
        const createAIPlayerName = playerName || '플레이어';
        
        const createAIResult = joinRoom(newAIRoom.id, createAIPlayerId, createAIPlayerName);
        if (createAIResult) {
          const { room, player } = createAIResult;
          players.set(createAIPlayerId, { roomId: newAIRoom.id, player });
          
          startGame(newAIRoom.id);
          const updatedRoom = rooms.get(newAIRoom.id);
          
          addEvent(createAIPlayerId, {
            type: 'ai_game_started',
            roomId: newAIRoom.id,
            player: player,
            room: {
              players: updatedRoom.players,
              gameState: updatedRoom.gameState,
              isAIGame: true
            }
          });
          
          res.json({ success: true, playerId: createAIPlayerId });
        } else {
          res.status(400).json({ success: false });
        }
        break;
        
      case 'join_room':
        const joinResult = joinRoom(roomId, playerId, playerName);
        if (joinResult) {
          const { room, player } = joinResult;
          players.set(playerId, { roomId: room.id, player });
          
          addEvent(playerId, {
            type: 'joined_room',
            roomId: room.id,
            player: player,
            room: {
              players: room.players,
              gameState: room.gameState
            }
          });
          
          // 다른 플레이어들에게 알림
          room.players.forEach(p => {
            if (p.id !== playerId) {
              addEvent(p.id, {
                type: 'player_joined',
                player: player,
                room: {
                  players: room.players,
                  gameState: room.gameState
                }
              });
            }
          });
          
          res.json({ success: true });
        } else {
          res.status(400).json({
            type: 'join_failed',
            message: '방을 찾을 수 없거나 이미 가득참'
          });
        }
        break;
        
      case 'start_game':
        if (startGame(roomId)) {
          const room = rooms.get(roomId);
          room.players.forEach(player => {
            addEvent(player.id, {
              type: 'game_started',
              room: room
            });
          });
          res.json({ success: true });
        } else {
          res.status(400).json({ success: false });
        }
        break;
        
      case 'play_card':
        if (playCard(roomId, playerId, card)) {
          const room = rooms.get(roomId);
          
          // 모든 플레이어에게 카드 플레이 알림
          room.players.forEach(player => {
            addEvent(player.id, {
              type: 'card_played',
              playerId: playerId,
              card: card,
              currentPlay: room.currentPlay,
              cards: room.cards
            });
          });
          
          if (room.isAIGame && room.currentPlay.player1 !== null && room.currentPlay.player2 === null) {
            setTimeout(() => {
              if (aiPlayCard(roomId)) {
                const room = rooms.get(roomId);
                room.players.forEach(player => {
                  addEvent(player.id, {
                    type: 'card_played',
                    playerId: 'ai_player',
                    card: room.currentPlay.player2,
                    currentPlay: room.currentPlay,
                    cards: room.cards
                  });
                });
                
                const result = evaluateRound(roomId);
                if (result) {
                  const room = rooms.get(roomId);
                  room.players.forEach(player => {
                    addEvent(player.id, {
                      type: 'round_result',
                      result: result,
                      scores: room.scores,
                      currentRound: room.currentRound,
                      gameState: room.gameState
                    });
                  });
                  
                  if (room.gameState === 'finished') {
                    const gameResult = getGameResult(roomId);
                    room.players.forEach(player => {
                      addEvent(player.id, {
                        type: 'game_finished',
                        result: gameResult
                      });
                    });
                  }
                }
              }
            }, 1000);
          } else {
            if (room.currentPlay.player1 !== null && room.currentPlay.player2 !== null) {
              const result = evaluateRound(roomId);
              if (result) {
                const room = rooms.get(roomId);
                room.players.forEach(player => {
                  addEvent(player.id, {
                    type: 'round_result',
                    result: result,
                    scores: room.scores,
                    currentRound: room.currentRound,
                    gameState: room.gameState
                  });
                });
                
                if (room.gameState === 'finished') {
                  const gameResult = getGameResult(roomId);
                  room.players.forEach(player => {
                    addEvent(player.id, {
                      type: 'game_finished',
                      result: gameResult
                    });
                  });
                }
              }
            }
          }
          res.json({ success: true });
        } else {
          res.status(400).json({
            type: 'play_failed',
            message: '카드를 낼 수 없음'
          });
        }
        break;
        
      default:
        res.status(404).json({ error: 'Unknown action' });
    }
  } catch (error) {
    console.error('게임 액션 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`게임 사이트: http://localhost:${PORT}`);
  console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
});