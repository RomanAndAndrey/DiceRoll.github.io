import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trophy, Medal } from 'lucide-react';
import { socketService } from '../services/socketService';
import { SocketEvents, LeaderboardEntry } from '../types';

interface LeaderboardProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ isOpen, onClose }) => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      socketService.emit(SocketEvents.GET_LEADERBOARD, {});
    }
  }, [isOpen]);

  useEffect(() => {
    const handleData = (data: LeaderboardEntry[]) => {
      setEntries(data);
      setLoading(false);
    };

    socketService.on(SocketEvents.LEADERBOARD_DATA, handleData);

    return () => {
      socketService.off(SocketEvents.LEADERBOARD_DATA, handleData);
    };
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-slate-700 overflow-hidden"
          >
            {/* Header */}
            <div className="p-6 bg-slate-900/50 flex justify-between items-center border-b border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <Trophy className="w-6 h-6 text-amber-500" />
                </div>
                <h2 className="text-xl font-bold text-white">Leaderboard</h2>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {loading ? (
                <div className="py-12 flex justify-center">
                  <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-3">
                  {entries.map((entry, index) => (
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      key={entry.name}
                      className={`flex items-center justify-between p-4 rounded-xl border ${
                        index === 0 
                          ? 'bg-amber-500/10 border-amber-500/30' 
                          : 'bg-slate-700/30 border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 flex items-center justify-center rounded-full font-bold ${
                           index === 0 ? 'bg-amber-500 text-slate-900' : 
                           index === 1 ? 'bg-slate-400 text-slate-900' :
                           index === 2 ? 'bg-orange-700 text-slate-200' : 'bg-slate-700 text-slate-400'
                        }`}>
                          {index + 1}
                        </div>
                        <span className={`font-bold ${index === 0 ? 'text-amber-400' : 'text-slate-200'}`}>
                          {entry.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-indigo-400">{entry.wins}</span>
                        <Medal className="w-4 h-4 text-slate-500" />
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};