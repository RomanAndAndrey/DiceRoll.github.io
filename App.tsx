
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Login } from './components/Login';
import { Lobby } from './components/Lobby';
import { GameRoom } from './components/GameRoom';
import { GameState, RoomStatus, SocketEvents, DiceResultPayload } from './types';
import { socketService } from './services/socketService';

type AppView = 'LOGIN' | 'LOBBY' | 'GAME';

const INITIAL_GAME_STATE: GameState = {
  roomId: null,
  status: RoomStatus.PENDING,
  players: [],
  roundWinnerId: null,
  isRolling: false,
  message: null
};

export default function App() {
  const [view, setView] = useState<AppView>('LOGIN');
  const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const messageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playSound = (type: 'roll' | 'win' | 'lose') => {
    // console.log(`Playing sound: ${type}`);
  };

  const handleReset = useCallback(() => {
    setGameState(INITIAL_GAME_STATE);
    setView('LOBBY'); // Return to Lobby after game
    if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
  }, []);

  const handleLogout = useCallback(() => {
    setView('LOGIN');
    setGameState(INITIAL_GAME_STATE);
    setLoginError(null);
  }, []);

  useEffect(() => {
    // Check for existing session
    if (socketService.isLoggedIn()) {
      setView('LOBBY');
    }

    // --- Socket Event Listeners ---

    // Auth
    const handleLoginSuccess = () => {
      setLoading(false);
      setLoginError(null);
      setView('LOBBY');
    };

    const handleLoginFail = (data: { message: string }) => {
      setLoading(false);
      setLoginError(data.message);
    };

    // Game
    const handleMatchCreated = (data: { roomId: string }) => {
      setGameState(prev => ({ ...prev, roomId: data.roomId, status: RoomStatus.PENDING }));
      setView('GAME');
    };

    const handleMatchStart = (data: { roomId: string, players: any[] }) => {
      const myId = socketService.getUserId();
      const formattedPlayers = data.players.map(p => ({
        ...p,
        isSelf: p.id === myId
      }));

      setGameState(prev => ({
        ...prev,
        roomId: data.roomId,
        status: RoomStatus.ACTIVE,
        players: formattedPlayers,
        message: 'MATCH START!'
      }));
      setView('GAME');
    };

    const handleDiceResult = (data: DiceResultPayload) => {
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);

      setGameState(prev => ({ ...prev, isRolling: true, message: 'ROLLING...' }));
      playSound('roll');

      setTimeout(() => {
        setGameState(prev => {
          const updatedPlayers = prev.players.map(p => ({
            ...p,
            lastRoll: data.rolls[p.id]
          }));

          let msg = '';
          if (data.newRound) msg = 'DRAW! RE-ROLLING...';
          else {
            const winner = updatedPlayers.find(p => p.id === data.winnerId);
            msg = `${winner?.name.toUpperCase()} WINS!`;
          }

          return {
            ...prev,
            players: updatedPlayers,
            isRolling: false,
            roundWinnerId: data.winnerId,
            message: msg
          };
        });

        // Clear "ROLLING..." or "DRAW" message after a delay if match continues
        messageTimeoutRef.current = setTimeout(() => {
            setGameState(prev => {
                if (prev.status === RoomStatus.ACTIVE) {
                    return { ...prev, message: null };
                }
                return prev;
            });
        }, 2000);

      }, 1000); 
    };

    const handleMatchEnd = (data: { winnerId: string | null }) => {
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
      
      setGameState(prev => {
        // CRITICAL FIX: If the match is already complete (we have a winner),
        // and we receive a disconnect event (winnerId is null/undefined),
        // IGNORE it. This prevents the "Game Over" modal from disappearing
        // when the OTHER player clicks "Return to Lobby".
        if (prev.status === RoomStatus.COMPLETE && prev.roundWinnerId && !data.winnerId) {
            return prev;
        }

        return {
          ...prev,
          status: RoomStatus.COMPLETE,
          roundWinnerId: data.winnerId, 
          message: 'GAME OVER'
        };
      });
    };

    // Register
    socketService.on(SocketEvents.LOGIN_SUCCESS, handleLoginSuccess);
    socketService.on(SocketEvents.LOGIN_FAIL, handleLoginFail);
    socketService.on(SocketEvents.MATCH_CREATED, handleMatchCreated);
    socketService.on(SocketEvents.MATCH_START, handleMatchStart);
    socketService.on(SocketEvents.DICE_RESULT, handleDiceResult);
    socketService.on(SocketEvents.MATCH_END, handleMatchEnd);

    return () => {
      socketService.off(SocketEvents.LOGIN_SUCCESS, handleLoginSuccess);
      socketService.off(SocketEvents.LOGIN_FAIL, handleLoginFail);
      socketService.off(SocketEvents.MATCH_CREATED, handleMatchCreated);
      socketService.off(SocketEvents.MATCH_START, handleMatchStart);
      socketService.off(SocketEvents.DICE_RESULT, handleDiceResult);
      socketService.off(SocketEvents.MATCH_END, handleMatchEnd);
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    };
  }, []);

  return (
    <div className="antialiased text-slate-100 bg-slate-900 min-h-screen selection:bg-indigo-500 selection:text-white font-inter">
      {view === 'LOGIN' && (
        <Login 
          isLoading={loading} 
          serverError={loginError} 
          onClearError={() => setLoginError(null)}
        />
      )}
      {view === 'LOBBY' && <Lobby onLogout={handleLogout} />}
      {view === 'GAME' && <GameRoom gameState={gameState} onReset={handleReset} />}
    </div>
  );
}
