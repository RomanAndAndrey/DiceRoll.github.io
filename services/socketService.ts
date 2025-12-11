
import { SocketEvents, DiceResultPayload, LeaderboardEntry, LoginPayload } from '../types';

// Type definition for a listener function
type Listener = (data: any) => void;

interface UserData {
  password?: string; // Optional for this mock, but used for auth
  wins: number;
}

interface DB {
  users: Record<string, UserData>;
}

/**
 * MOCK SOCKET IMPLEMENTATION
 * 
 * Simulates Node.js + Socket.IO backend logic.
 * Includes: Auth, Persistent DB (localStorage), Sudden Death Game Loop.
 */
class MockSocketService {
  private listeners: Record<string, Listener[]> = {};
  private currentRoomId: string | null = null;
  
  // Session State
  public currentUser: { id: string; name: string } | null = null;
  private opponentId: string = 'bot_opponent';
  
  // Game State
  private gameLoopTimeout: any = null;

  private readonly DB_KEY = 'duel_cubes_db';
  private readonly SESSION_KEY = 'duel_cubes_session';

  constructor() {
    console.log('[System] Socket Service Initialized (Mock Mode)');
    this.restoreSession();
  }

  // --- Mock Database Helper ---
  
  private getDB(): DB {
    const raw = localStorage.getItem(this.DB_KEY);
    if (!raw) {
      // Default / Seed Data
      const seed: DB = {
        users: {
          'CyberDice': { wins: 42 },
          'RollerKing': { wins: 35 },
          'CubeMaster': { wins: 12 },
          'LuckyStrike': { wins: 8 }
        }
      };
      localStorage.setItem(this.DB_KEY, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  }

  private saveDB(db: DB) {
    localStorage.setItem(this.DB_KEY, JSON.stringify(db));
  }

  private restoreSession() {
    const session = localStorage.getItem(this.SESSION_KEY);
    if (session) {
      try {
        const user = JSON.parse(session);
        this.currentUser = user;
      } catch (e) {
        localStorage.removeItem(this.SESSION_KEY);
      }
    }
  }

  // --- Public API ---

  public getUserId(): string {
    return this.currentUser?.id || 'guest';
  }

  public isLoggedIn(): boolean {
    return !!this.currentUser;
  }

  public on(event: string, callback: Listener) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  public off(event: string, callback: Listener) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  public emit(event: string, payload: any) {
    console.log(`[Client -> Server] ${event}`, payload);
    
    // Simulate network latency
    const latency = 150 + Math.random() * 100;

    setTimeout(() => {
      this.handleServerLogic(event, payload);
    }, latency);
  }

  // --- Simulated Server Logic ---

  private handleServerLogic(event: string, payload: any) {
    const db = this.getDB();

    switch (event) {
      case SocketEvents.LOGIN_REQUEST:
        this.handleLogin(payload as LoginPayload, db);
        break;

      case SocketEvents.LOGOUT:
        this.currentUser = null;
        localStorage.removeItem(this.SESSION_KEY);
        // No client response needed really, client handles UI
        break;

      case SocketEvents.GET_LEADERBOARD:
        const sorted = Object.entries(db.users)
          .sort(([, a], [, b]) => b.wins - a.wins)
          .slice(0, 10)
          .map(([name, data]) => ({ name, wins: data.wins }));
        this.trigger(SocketEvents.LEADERBOARD_DATA, sorted);
        break;

      case SocketEvents.CREATE_MATCH:
        if (!this.currentUser) return;
        this.currentRoomId = 'room_' + Math.random().toString(36).substr(2, 5).toUpperCase();
        
        // Ack creation
        this.trigger(SocketEvents.MATCH_CREATED, { roomId: this.currentRoomId });
        
        // Simulate opponent joining
        setTimeout(() => {
          this.trigger(SocketEvents.MATCH_START, {
            roomId: this.currentRoomId,
            players: [
              { id: this.currentUser!.id, name: this.currentUser!.name, score: 0 },
              { id: this.opponentId, name: 'CyberOpponent', score: 0 }
            ]
          });
          // START AUTO LOOP
          this.startGameLoop();
        }, 2000);
        break;

      case SocketEvents.JOIN_MATCH:
        if (!this.currentUser) return;
        this.currentRoomId = payload.roomId;

        this.trigger(SocketEvents.MATCH_START, {
          roomId: this.currentRoomId,
          players: [
            { id: this.currentUser!.id, name: this.currentUser!.name, score: 0 },
            { id: this.opponentId, name: 'RoomHost', score: 0 }
          ]
        });
        // START AUTO LOOP
        this.startGameLoop();
        break;
        
      case SocketEvents.LEAVE_MATCH:
         this.stopGameLoop();
         this.currentRoomId = null;
         break;
    }
  }

  private handleLogin(payload: LoginPayload, db: DB) {
    const { username, password } = payload;
    
    if (db.users[username]) {
      // User exists
      const user = db.users[username];
      // Check password (simple equality for mock)
      if (user.password === password) {
        this.currentUser = { id: `user_${username}`, name: username };
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(this.currentUser));
        this.trigger(SocketEvents.LOGIN_SUCCESS, { user: this.currentUser });
      } else {
        this.trigger(SocketEvents.LOGIN_FAIL, { message: 'Incorrect password' });
      }
    } else {
      // Register new user
      db.users[username] = {
        password: password,
        wins: 0
      };
      this.saveDB(db);
      this.currentUser = { id: `user_${username}`, name: username };
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(this.currentUser));
      this.trigger(SocketEvents.LOGIN_SUCCESS, { user: this.currentUser });
    }
  }

  // --- Auto-Roll Game Loop (Sudden Death) ---

  private startGameLoop() {
    this.stopGameLoop();
    // First roll happens after a "Get Ready" delay
    this.gameLoopTimeout = setTimeout(() => this.runTurn(), 3000);
  }

  private stopGameLoop() {
    if (this.gameLoopTimeout) {
      clearTimeout(this.gameLoopTimeout);
      this.gameLoopTimeout = null;
    }
  }

  private runTurn() {
    if (!this.currentRoomId || !this.currentUser) return;

    // 1. Generate Secure Random Numbers
    const p1Roll = Math.floor(Math.random() * 6) + 1;
    const p2Roll = Math.floor(Math.random() * 6) + 1;

    let winnerId: string | null = null;
    let newRound = false;

    // 2. Compare (Sudden Death Logic)
    if (p1Roll > p2Roll) {
      winnerId = this.currentUser.id;
    } else if (p2Roll > p1Roll) {
      winnerId = this.opponentId;
    } else {
      // Tie
      winnerId = null;
      newRound = true; 
    }

    const payload: DiceResultPayload = {
      rolls: {
        [this.currentUser.id]: p1Roll,
        [this.opponentId]: p2Roll
      },
      winnerId,
      newRound
    };

    // 3. Emit Result
    this.trigger(SocketEvents.DICE_RESULT, payload);

    // 4. Check Win Condition
    if (winnerId) {
       // Match Over
       
       // Update Leaderboard if user won
       if (winnerId === this.currentUser.id) {
         const db = this.getDB();
         if (db.users[this.currentUser.name]) {
            db.users[this.currentUser.name].wins += 1;
            this.saveDB(db);
         }
       }

       setTimeout(() => {
         this.trigger(SocketEvents.MATCH_END, {
           winnerId: winnerId
         });
         this.stopGameLoop();
       }, 2000);
    } else {
      // 5. Schedule Next Round (Re-roll for tie)
      // Wait 3 seconds (animation + reading time) then roll again
      this.gameLoopTimeout = setTimeout(() => this.runTurn(), 3000);
    }
  }

  // Helper to trigger client listeners
  private trigger(event: string, data: any) {
    console.log(`[Server -> Client] ${event}`, data);
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}

export const socketService = new MockSocketService();
