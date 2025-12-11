
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dices, Play, Users, Trophy, LogOut, AlertCircle } from 'lucide-react';
import { Button } from './Button';
import { socketService } from '../services/socketService';
import { SocketEvents } from '../types';
import { Leaderboard } from './Leaderboard';

interface LobbyProps {
  onLogout: () => void;
}

export const Lobby: React.FC<LobbyProps> = ({ onLogout }) => {
  const [roomId, setRoomId] = useState('');
  const [mode, setMode] = useState<'menu' | 'join'>('menu');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const currentUser = socketService.currentUser;

  useEffect(() => {
    // Listen for connection errors
    const handleError = (data: { message: string }) => {
        setError(data.message);
        setIsJoining(false);
    };

    socketService.on(SocketEvents.CONNECT_ERROR, handleError);
    // Also listen for regular ERROR
    socketService.on(SocketEvents.ERROR, handleError);

    return () => {
        socketService.off(SocketEvents.CONNECT_ERROR, handleError);
        socketService.off(SocketEvents.ERROR, handleError);
    };
  }, []);

  const handleCreate = () => {
    socketService.emit(SocketEvents.CREATE_MATCH, { playerName: currentUser?.name });
  };

  const handleJoin = () => {
    if (!roomId) return;
    setError(null);
    setIsJoining(true);
    socketService.emit(SocketEvents.JOIN_MATCH, { roomId, playerName: currentUser?.name });
  };

  const handleLogout = () => {
    socketService.emit(SocketEvents.LOGOUT, {});
    onLogout();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {/* Background Decor */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/80 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-md relative z-10"
      >
        <div className="flex justify-between items-start mb-8">
          <div>
             <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 tracking-tight">
              DUEL OF CUBES
            </h1>
            <p className="text-slate-400 text-sm">Logged in as <span className="text-white font-bold">{currentUser?.name}</span></p>
          </div>
          <div className="inline-flex p-3 rounded-xl bg-slate-900 border border-slate-700">
             <Dices className="w-6 h-6 text-indigo-400" />
          </div>
        </div>

        <div className="space-y-3">
          {mode === 'menu' ? (
            <>
              <Button onClick={handleCreate} fullWidth className="group">
                <Play className="w-5 h-5 group-hover:scale-110 transition-transform" /> 
                New Match
              </Button>
              
              <Button onClick={() => setMode('join')} variant="secondary" fullWidth className="group">
                <Users className="w-5 h-5 group-hover:scale-110 transition-transform" /> 
                Join Match
              </Button>

              <Button onClick={() => setShowLeaderboard(true)} variant="outline" fullWidth className="group">
                <Trophy className="w-5 h-5 text-amber-500 group-hover:scale-110 transition-transform" /> 
                Leaderboard
              </Button>
            </>
          ) : (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Enter Room ID</label>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => {
                      setRoomId(e.target.value);
                      setError(null);
                  }}
                  placeholder="e.g. 4521"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-lg tracking-wider text-center uppercase"
                  autoFocus
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 flex items-start gap-2 overflow-hidden"
                  >
                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-rose-200 font-medium leading-tight">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => setMode('menu')} disabled={isJoining}>Cancel</Button>
                <Button onClick={handleJoin} disabled={!roomId || isJoining} isLoading={isJoining}>
                   {isJoining ? 'Connecting...' : 'Join'}
                </Button>
              </div>
            </motion.div>
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-slate-700 flex justify-center">
          <button 
            onClick={handleLogout}
            className="text-slate-500 hover:text-rose-400 text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </motion.div>

      <Leaderboard isOpen={showLeaderboard} onClose={() => setShowLeaderboard(false)} />
    </div>
  );
};
