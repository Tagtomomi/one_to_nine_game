const express = require('express');
const { createServer } = require('http');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Ably = require('ably');

const app = express();
const server = createServer(app);

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Ably 초기화
const ably = new Ably.Realtime("qvbjOA.EbbZ6g:lHGCOz5aSbkalenzwn2qRImwpxQul9BKZo3NQmbKw6g");

ably.connection.once("connected", () => {
  console.log("Connected to Ably!");
});

ably.connection.on("disconnected", () => {
  console.log("Disconnected from Ably");
});

ably.connection.on("failed", (error) => {
  console.error("Ably connection failed:", error);
});

// 게임 상태 저장 (메모리)
const rooms = new Map();
const players = new Map();

// AI 플레이어 클래스
class AIPlayer {
  constructor() {
    this.name = 'AI🤖';
    this.id = 'ai_player';
    this.position = 'player2';
    this.difficulty = 'normal'; // easy, normal, hard
  }
  
  chooseCard(availableCards) {
    if (availableCards.length === 0) return null;
    
    // 난이도별 전략
    switch (this.difficulty) {
      case 'easy':
        return this.easyStrategy(availableCards);
      case 'hard':
        return this.hardStrategy(availableCards);
      default: // normal
        return this.normalStrategy(availableCards);
    }
  }
  
  // 쉬운 난이도: 완전 랜덤
  easyStrategy(availableCards) {
    const randomIndex = Math.floor(Math.random() * availableCards.length);
    return availableCards[randomIndex];
  }
  
  // 보통 난이도: 약간의 전략 (랜덤 + 약간의 생각)
  normalStrategy(availableCards) {
    // 70% 확률로 랜덤, 30% 확률로 약간의 전략
    if (Math.random() < 0.7) {
      return this.easyStrategy(availableCards);
    }
    
    // 약간의 전략: 중간값 근처 카드 선호
    const sortedCards = [...availableCards].sort((a, b) => a - b);
    const middleIndex = Math.floor(sortedCards.length / 2);
    const preferredCards = sortedCards.slice(
      Math.max(0, middleIndex - 1), 
      Math.min(sortedCards.length, middleIndex + 2)
    );
    
    const randomIndex = Math.floor(Math.random() * preferredCards.length);
    return preferredCards[randomIndex];
  }
  
  // 어려운 난이도: 더 똑똑한 전략
  hardStrategy(availableCards) {
    // 50% 확률로 랜덤, 50% 확률로 전략적 선택
    if (Math.random() < 0.5) {
      return this.easyStrategy(availableCards);
    }
    
    // 전략적 선택: 높은 카드 선호 (9, 8, 7 순서)
    const sortedCards = [...availableCards].sort((a, b) => b - a);
    const topCards = sortedCards.slice(0, Math.min(3, sortedCards.length));
    
    const randomIndex = Math.floor(Math.random() * topCards.length);
    return topCards[randomIndex];
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
  console.log('playCard 호출됨:', { roomId, playerId, card });
  
  const room = rooms.get(roomId);
  if (!room) {
    console.log('방을 찾을 수 없음:', roomId);
    return false;
  }
  
  if (room.gameState !== 'playing') {
    console.log('게임 상태가 playing이 아님:', room.gameState);
    return false;
  }
  
  const player = room.players.find(p => p.id === playerId);
  if (!player) {
    console.log('플레이어를 찾을 수 없음:', playerId);
    console.log('방의 플레이어들:', room.players.map(p => ({ id: p.id, name: p.name, position: p.position })));
    return false;
  }
  
  const playerPosition = player.position;
  console.log('플레이어 위치:', playerPosition);
  console.log('사용 가능한 카드:', room.cards[playerPosition]);
  
  if (!room.cards[playerPosition].includes(card)) {
    console.log('카드가 사용 가능한 카드에 없음:', card);
    return false;
  }
  
  if (room.currentPlay[playerPosition] !== null) {
    console.log('이미 카드를 냄:', room.currentPlay[playerPosition]);
    return false;
  }
  
  room.currentPlay[playerPosition] = card;
  room.cards[playerPosition] = room.cards[playerPosition].filter(c => c !== card);
  
  console.log('카드 플레이 성공:', { card, playerPosition, remainingCards: room.cards[playerPosition] });
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

// Ably 채널 관리
function getChannel(roomId) {
  return ably.channels.get(`room:${roomId}`);
}

async function broadcastToRoom(roomId, message, excludePlayerId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const channel = getChannel(roomId);
  
  room.players.forEach(player => {
    if (excludePlayerId && player.id === excludePlayerId) return;
    
    const playerInfo = players.get(player.id);
    if (playerInfo) {
      channel.publish('game-event', {
        ...message,
        targetPlayer: player.id
      });
    }
  });
}

// Ably 토큰 생성 엔드포인트 (간단한 방식)
app.post('/ably/token', (req, res) => {
  const { clientId } = req.body;
  
  if (!clientId) {
    return res.status(400).json({ error: 'clientId is required' });
  }
  
  // 간단한 토큰 요청 생성
  const tokenRequest = {
    clientId: clientId,
    capability: {
      [`room:*`]: ['subscribe', 'publish']
    }
  };
  
  res.json(tokenRequest);
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
          
          res.json({
            success: true,
            roomId: newRoom.id,
            player: player,
            room: {
              players: room.players,
              gameState: room.gameState
            }
          });
        } else {
          res.status(400).json({ success: false });
        }
        break;
        
      case 'create_ai_room':
        const newAIRoom = createRoom(true);
        const createAIPlayerId = playerId || uuidv4();
        const createAIPlayerName = playerName || '플레이어';
        const { difficulty = 'normal' } = req.body; // 난이도 받기
        
        const createAIResult = joinRoom(newAIRoom.id, createAIPlayerId, createAIPlayerName);
        if (createAIResult) {
          const { room, player } = createAIResult;
          players.set(createAIPlayerId, { roomId: newAIRoom.id, player });
          
          // AI 난이도 설정
          if (room.aiPlayer) {
            room.aiPlayer.difficulty = difficulty;
          }
          
          startGame(newAIRoom.id);
          const updatedRoom = rooms.get(newAIRoom.id);
          
          res.json({
            success: true,
            type: 'ai_game_started',
            playerId: createAIPlayerId,
            roomId: newAIRoom.id,
            player: player,
            room: {
              players: updatedRoom.players,
              gameState: updatedRoom.gameState,
              scores: updatedRoom.scores,
              currentRound: updatedRoom.currentRound,
              currentPlay: updatedRoom.currentPlay,
              cards: updatedRoom.cards,
              isAIGame: true,
              aiDifficulty: difficulty
            }
          });
        } else {
          res.status(400).json({ success: false });
        }
        break;
        
      case 'join_room':
        const joinResult = joinRoom(roomId, playerId, playerName);
        if (joinResult) {
          const { room, player } = joinResult;
          players.set(playerId, { roomId: room.id, player });
          
          res.json({
            success: true,
            roomId: room.id,
            player: player,
            room: {
              players: room.players,
              gameState: room.gameState
            }
          });
          
          broadcastToRoom(roomId, {
            type: 'player_joined',
            player: player,
            room: {
              players: room.players,
              gameState: room.gameState
            }
          }, playerId);
        } else {
          res.status(400).json({
            success: false,
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
          res.json({ success: true });
        } else {
          res.status(400).json({ success: false });
        }
        break;
        
      case 'play_card':
        if (playCard(roomId, playerId, card)) {
          const room = rooms.get(roomId);
          
          broadcastToRoom(roomId, {
            type: 'card_played',
            playerId: playerId,
            card: card,
            currentPlay: room.currentPlay,
            cards: room.cards
          });
          
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
                  
                  if (room.gameState === 'finished') {
                    const gameResult = getGameResult(roomId);
                    broadcastToRoom(roomId, {
                      type: 'game_finished',
                      result: gameResult
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
                broadcastToRoom(roomId, {
                  type: 'round_result',
                  result: result,
                  scores: room.scores,
                  currentRound: room.currentRound,
                  gameState: room.gameState
                });
                
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
          res.json({ success: true });
        } else {
          res.status(400).json({
            success: false,
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

// 플레이어 연결 해제 처리
app.delete('/player/:playerId', (req, res) => {
  const playerId = req.params.playerId;
  
  const playerInfo = players.get(playerId);
  if (playerInfo) {
    const { roomId } = playerInfo;
    players.delete(playerId);
    
    const room = rooms.get(roomId);
    if (room) {
      room.players = room.players.filter(p => p.id !== playerId);
      
      if (room.players.length === 0) {
        rooms.delete(roomId);
      } else {
        broadcastToRoom(roomId, {
          type: 'player_left',
          playerId: playerId,
          room: room
        }, playerId);
      }
    }
  }
  
  res.json({ success: true });
});

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`게임 사이트: http://localhost:${PORT}`);
  console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Ably 연결 상태: 연결 중...`);
});