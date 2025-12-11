
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Share2, LogOut, Trophy, Hourglass, RefreshCw } from 'lucide-react';
import { GameState, RoomStatus, SocketEvents } from '../types';
import { socketService } from '../services/socketService';
import { Dice3D } from './Dice3D';
import { Button } from './Button';

interface GameRoomProps {
  gameState: GameState;
  onReset: () => void;
}

export const GameRoom: React.FC<GameRoomProps> = ({ gameState, onReset }) => {
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);
  const self = gameState.players.find(p => p.isSelf);
  const opponent = gameState.players.find(p => !p.isSelf);

  const copyRoomId = () => {
    if (gameState.roomId) {
      navigator.clipboard.writeText(gameState.roomId);
      setShowCopyFeedback(true);
      setTimeout(() => setShowCopyFeedback(false), 2000);
    }
  };

  const handleLeave = () => {
    socketService.emit(SocketEvents.LEAVE_MATCH, {});
    onReset();
  };

  if (gameState.status === RoomStatus.PENDING) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <div className="bg-slate-800 p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-700 animate-in fade-in zoom-in duration-300">
          <div className="w-16 h-16 mx-auto bg-amber-500/20 rounded-full flex items-center justify-center mb-6">
            <Share2 className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Waiting for Opponent</h2>
          <p className="text-slate-400 mb-6">Share this code with a friend to start the duel.</p>
          
          <div 
            onClick={copyRoomId}
            className="bg-slate-900 border-2 border-dashed border-slate-600 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-indigo-500 hover:bg-slate-900/80 transition-all group mb-4"
          >
            <code className="text-3xl font-mono text-indigo-400 font-black tracking-widest">{gameState.roomId}</code>
            <div className="text-slate-500 group-hover:text-white transition-colors">
              {showCopyFeedback ? <span className="text-xs text-emerald-500 font-bold">COPIED!</span> : <Copy className="w-5 h-5" />}
            </div>
          </div>
          
           <div className="flex items-center justify-center gap-2 text-slate-500 text-sm mb-6">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-ping" />
              Listening for player to join...
           </div>

           <Button variant="secondary" onClick={handleLeave} className="w-full">
            Cancel Lobby
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-black z-0" />
      
      {/* Header */}
      <header className="relative z-10 flex justify-between items-center p-4 md:p-6 border-b border-slate-800/50 bg-slate-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]" />
          <span className="text-xs font-bold tracking-widest text-emerald-500 uppercase">Live PVP</span>
        </div>
        <div className="font-mono text-slate-500 text-sm hidden md:block">ROOM: {gameState.roomId}</div>
        <button onClick={handleLeave} className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Main Game Area */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 gap-8 md:gap-16">
        
        {/* Opponent Area (Top) */}
        <div className="flex flex-col items-center">
           <div className="flex items-center gap-4 mb-4">
             <div className="text-right">
                <h3 className="font-bold text-slate-300">{opponent?.name || 'Opponent'}</h3>
             </div>
             <div className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-500 to-orange-600 flex items-center justify-center shadow-lg text-white font-bold text-lg">
                {opponent?.name?.charAt(0).toUpperCase() || '?'}
             </div>
           </div>
           
           <Dice3D 
             value={opponent?.lastRoll} 
             rolling={gameState.isRolling} 
             color="secondary" 
           />
        </div>

        {/* Center Info / Status */}
        <div className="h-24 flex items-center justify-center w-full max-w-md text-center">
          <AnimatePresence mode='wait'>
            {gameState.message && (
               <motion.div
                 key="message"
                 initial={{ opacity: 0, scale: 0.8 }}
                 animate={{ opacity: 1, scale: 1 }}
                 exit={{ opacity: 0, scale: 0.8 }}
                 className="px-6 py-2 bg-slate-800/80 rounded-full border border-indigo-500/30 backdrop-blur-md shadow-xl"
               >
                 <span className="text-lg font-bold text-indigo-300">{gameState.message}</span>
               </motion.div>
            )}
            {!gameState.message && !gameState.isRolling && (
               <motion.div
                 key="waiting"
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 exit={{ opacity: 0 }}
                 className="flex flex-col items-center gap-2 text-slate-500"
               >
                 <div className="flex items-center gap-2">
                    <Hourglass className="w-4 h-4 animate-spin-slow" />
                    <span className="text-xs uppercase tracking-widest font-bold">Synchronizing...</span>
                 </div>
               </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Player Area (Bottom) */}
        <div className="flex flex-col items-center">
            <div className="relative mb-8">
              <Dice3D 
                value={self?.lastRoll} 
                rolling={gameState.isRolling} 
                color="primary" 
              />
           </div>

           <div className="flex items-center gap-4 mt-2 opacity-90">
             <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-lg text-white font-bold text-lg ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-900">
                {self?.name?.charAt(0).toUpperCase()}
             </div>
             <div>
                <h3 className="font-bold text-white text-lg">{self?.name || 'You'}</h3>
             </div>
           </div>
        </div>
      </main>

      {/* Game Over Modal */}
      {gameState.status === RoomStatus.COMPLETE && gameState.roundWinnerId && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-800 border-2 border-indigo-500 p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full"
          >
             <div className="w-20 h-20 mx-auto bg-indigo-500 rounded-full flex items-center justify-center mb-4 shadow-[0_0_20px_#6366f1]">
                <Trophy className="w-10 h-10 text-white" />
             </div>
             <h2 className="text-3xl font-black text-white mb-2">
               {gameState.roundWinnerId === self?.id ? 'VICTORY!' : 'DEFEAT'}
             </h2>
             <p className="text-slate-400 mb-8 font-medium">
                {gameState.roundWinnerId === self?.id ? 'You crushed the opponent!' : 'Better luck next time.'}
             </p>
             <Button onClick={handleLeave} className="w-full">
               Return to Lobby
             </Button>
          </motion.div>
        </div>
      )}
    </div>
  );
};
