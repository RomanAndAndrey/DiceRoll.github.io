
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, User, Dices, AlertCircle } from 'lucide-react';
import { Button } from './Button';
import { socketService } from '../services/socketService';
import { SocketEvents } from '../types';

interface LoginProps {
  isLoading: boolean;
  serverError?: string | null;
  onClearError?: () => void;
}

export const Login: React.FC<LoginProps> = ({ isLoading, serverError, onClearError }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const validate = (name: string): string | null => {
    if (!name) return null;
    if (name.length < 3) return 'Nickname must be at least 3 chars';
    if (/^[0-9]+$/.test(name)) return 'Nickname cannot be only numbers';
    if (!/^[a-zA-Z0-9]+$/.test(name)) return 'Only letters and numbers allowed';
    return null;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setUsername(val);
    setLocalError(validate(val));
    if (serverError && onClearError) onClearError();
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (serverError && onClearError) onClearError();
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const valError = validate(username);
    if (valError) {
      setLocalError(valError);
      return;
    }
    if (!username || !password) {
      setLocalError('All fields are required');
      return;
    }
    // Clear previous errors
    if (onClearError) onClearError();
    
    socketService.emit(SocketEvents.LOGIN_REQUEST, { username, password });
  };

  const isValid = !localError && username.length >= 3 && password.length > 0;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-800/80 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-sm relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
        
        <div className="text-center mb-8">
          <div className="inline-flex p-3 rounded-xl bg-indigo-500/10 mb-4 ring-1 ring-indigo-500/30">
            <Dices className="w-8 h-8 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-black text-white">Welcome Back</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in or create an account to play</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <AnimatePresence>
            {serverError && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 flex items-start gap-2 overflow-hidden"
              >
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <p className="text-sm text-rose-200 font-medium leading-tight">{serverError}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nickname</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="text"
                value={username}
                onChange={handleNameChange}
                className={`w-full bg-slate-900 border rounded-lg py-2.5 pl-10 pr-4 text-white focus:ring-2 outline-none transition-all placeholder:text-slate-600 ${localError ? 'border-rose-500/50 focus:ring-rose-500' : 'border-slate-700 focus:ring-indigo-500'}`}
                placeholder="CyberPlayer123"
              />
            </div>
            {localError && (
              <div className="flex items-center gap-1.5 mt-2 text-rose-500 text-xs font-medium">
                <AlertCircle className="w-3 h-3" />
                {localError}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="password"
                value={password}
                onChange={handlePasswordChange}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-slate-600"
                placeholder="••••••••"
              />
            </div>
          </div>

          <Button type="submit" fullWidth isLoading={isLoading} disabled={!isValid}>
            Enter Arena
          </Button>
        </form>
      </motion.div>
    </div>
  );
};
