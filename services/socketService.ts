
import { SocketEvents, DiceResultPayload, LeaderboardEntry, LoginPayload, Player, RoomStatus } from '../types';

type Listener = (data: any) => void;

interface UserData {
  password?: string;
  wins: number;
}

interface RoomData {
  id: string;
  hostId: string;
  players: Player[];
  status: RoomStatus;
  lastRoll?: DiceResultPayload;
  timestamp: number;
}

interface DB {
  users: Record<string, UserData>;
  rooms: Record<string, RoomData>;
}

/**
 * LOCAL STORAGE P2P IMPLEMENTATION
 * 
 * Replaces the Bot simulation with a LocalStorage-based
 * sync mechanism allowing two tabs to play against each other.
 */
class MockSocketService {
  private listeners: Record<string, Listener[]> = {};
  private currentRoomId: string | null = null;
  
  // Session State
  public currentUser: { id: string; name: string } | null = null;
  
  // Game Loop State (Only active for Host)
  private gameLoopTimeout: any = null;

  private readonly DB_KEY = 'duel_cubes_db';
  private readonly SESSION_KEY = 'duel_cubes_session';
  private readonly ROOMS_KEY = 'duel_cubes_rooms';

  constructor() {
    console.log('[System] Socket Service Initialized (P2P Mode)');
    this.restoreSession();
    
    // Listen for changes from OTHER tabs
    window.addEventListener('storage', (e) => {
      if (e.key === this.ROOMS_KEY && this.currentRoomId) {
        this.syncRoomState();
      }
    });
  }

  // --- Helpers ---
  
  private getDB(): DB {
    const rawDB = localStorage.getItem(this.DB_KEY);
    const rawRooms = localStorage.getItem(this.ROOMS_KEY);
    
    const db: DB = rawDB ? JSON.parse(rawDB) : { users: {} };
    // Rooms are stored in a separate key to trigger storage events specifically for room updates
    db.rooms = rawRooms ? JSON.parse(rawRooms) : {};
    
    return db;
  }

  private saveDB(db: DB) {
    localStorage.setItem(this.DB_KEY, JSON.stringify({ users: db.users }));
  }

  private saveRooms(rooms: Record<string, RoomData>) {
    localStorage.setItem(this.ROOMS_KEY, JSON.stringify(rooms));
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
    console.log(`[Client -> LocalServer] ${event}`, payload);
    // Execute logic immediately
    this.handleServerLogic(event, payload);
  }

  // --- Core Logic ---

  private handleServerLogic(event: string, payload: any) {
    const db = this.getDB();

    switch (event) {
      case SocketEvents.LOGIN_REQUEST:
        this.handleLogin(payload as LoginPayload, db);
        break;

      case SocketEvents.LOGOUT:
        this.currentUser = null;
        localStorage.removeItem(this.SESSION_KEY);
        break;

      case SocketEvents.GET_LEADERBOARD:
        const sorted = Object.entries(db.users)
          .sort(([, a], [, b]) => b.wins - a.wins)
          .slice(0, 10)
          .map(([name, data]) => ({ name, wins: data.wins }));
        this.trigger(SocketEvents.LEADERBOARD_DATA, sorted);
        break;

      case SocketEvents.CREATE_MATCH:
        this.handleCreateMatch();
        break;

      case SocketEvents.JOIN_MATCH:
        this.handleJoinMatch(payload.roomId);
        break;
        
      case SocketEvents.LEAVE_MATCH:
         this.handleLeaveMatch();
         break;
    }
  }

  private handleLogin(payload: LoginPayload, db: DB) {
    const { username, password } = payload;
    
    if (db.users[username]) {
      const user = db.users[username];
      if (user.password === password) {
        this.currentUser = { id: `user_${username}`, name: username };
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(this.currentUser));
        this.trigger(SocketEvents.LOGIN_SUCCESS, { user: this.currentUser });
      } else {
        this.trigger(SocketEvents.LOGIN_FAIL, { message: 'Incorrect password' });
      }
    } else {
      db.users[username] = { password: password, wins: 0 };
      this.saveDB(db);
      this.currentUser = { id: `user_${username}`, name: username };
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(this.currentUser));
      this.trigger(SocketEvents.LOGIN_SUCCESS, { user: this.currentUser });
    }
  }

  // --- Room Management ---

  private handleCreateMatch() {
    if (!this.currentUser) return;
    
    const roomId = 'ROOM_' + Math.floor(1000 + Math.random() * 9000);
    this.currentRoomId = roomId;

    const db = this.getDB();
    const newRoom: RoomData = {
      id: roomId,
      hostId: this.currentUser.id,
      players: [{ 
        id: this.currentUser.id, 
        name: this.currentUser.name, 
        score: 0, 
        isSelf: true // This is just for local ref, overwritten on read
      }],
      status: RoomStatus.PENDING,
      timestamp: Date.now()
    };

    db.rooms[roomId] = newRoom;
    this.saveRooms(db.rooms);

    this.trigger(SocketEvents.MATCH_CREATED, { roomId });
  }

  private handleJoinMatch(roomId: string) {
    if (!this.currentUser) return;
    
    // Normalize input
    const cleanId = roomId.trim().toUpperCase();
    const db = this.getDB();
    const room = db.rooms[cleanId];

    if (!room) {
      alert("Room not found!"); // Simple feedback
      return;
    }

    if (room.players.length >= 2) {
      alert("Room is full!");
      return;
    }

    // Add Player
    room.players.push({
      id: this.currentUser.id,
      name: this.currentUser.name,
      score: 0,
      isSelf: true
    });
    room.status = RoomStatus.ACTIVE;
    
    db.rooms[cleanId] = room;
    this.saveRooms(db.rooms); // This triggers 'storage' event for Host

    this.currentRoomId = cleanId;
    
    // Trigger start for Joiner immediately
    this.syncRoomState();
  }

  private handleLeaveMatch() {
    if (this.currentRoomId) {
      const db = this.getDB();
      if (db.rooms[this.currentRoomId]) {
        // In a real app we would remove player, here we just delete room to keep it simple
        delete db.rooms[this.currentRoomId];
        this.saveRooms(db.rooms);
      }
    }
    this.stopGameLoop();
    this.currentRoomId = null;
  }

  // --- Synchronization & Game Loop ---

  /**
   * Called when 'storage' event fires OR when we locally update the room.
   * Reads state from LS and updates the UI.
   */
  private syncRoomState() {
    if (!this.currentRoomId) return;

    const db = this.getDB();
    const room = db.rooms[this.currentRoomId];

    if (!room) {
      // Room was deleted
      this.trigger(SocketEvents.MATCH_END, { winnerId: null });
      this.currentRoomId = null;
      return;
    }

    // Determine current user context
    const myId = this.currentUser?.id;
    const isHost = room.hostId === myId;

    // Trigger Match Start if we have 2 players
    if (room.players.length === 2) {
      this.trigger(SocketEvents.MATCH_START, {
        roomId: room.id,
        players: room.players
      });

      // If there is a new roll result in the storage that we haven't seen?
      // Actually, we just pass the result. The UI handles "isRolling".
      if (room.lastRoll) {
        // Check if this is a NEW roll based on timestamp or just current state?
        // For simplicity, we just trigger it. The UI debounces.
        this.trigger(SocketEvents.DICE_RESULT, room.lastRoll);
        
        // Check win
        if (room.lastRoll.winnerId) {
            // Wait a bit then end
            setTimeout(() => {
                 this.trigger(SocketEvents.MATCH_END, { winnerId: room.lastRoll!.winnerId });
                 if (isHost) this.stopGameLoop();
            }, 2000);
            return;
        }
      }

      // If I am Host and no roll is happening, start the loop
      if (isHost && !this.gameLoopTimeout && !room.lastRoll?.winnerId) {
         // If it's a fresh game or we need a re-roll
         this.startGameLoop();
      }
    }
  }

  // --- Host-Authoritative Game Loop ---

  private startGameLoop() {
    this.stopGameLoop();
    // Delay first roll
    this.gameLoopTimeout = setTimeout(() => this.runHostTurn(), 3000);
  }

  private stopGameLoop() {
    if (this.gameLoopTimeout) {
      clearTimeout(this.gameLoopTimeout);
      this.gameLoopTimeout = null;
    }
  }

  private runHostTurn() {
    if (!this.currentRoomId || !this.currentUser) return;

    const db = this.getDB();
    const room = db.rooms[this.currentRoomId];
    
    if (!room || room.players.length < 2) return;

    const p1 = room.players[0];
    const p2 = room.players[1];

    // 1. Generate Numbers
    const p1Roll = Math.floor(Math.random() * 6) + 1;
    const p2Roll = Math.floor(Math.random() * 6) + 1;

    let winnerId: string | null = null;
    let newRound = false;

    if (p1Roll > p2Roll) winnerId = p1.id;
    else if (p2Roll > p1Roll) winnerId = p2.id;
    else newRound = true;

    // 2. Update Room in Storage
    const result: DiceResultPayload = {
      rolls: {
        [p1.id]: p1Roll,
        [p2.id]: p2Roll
      },
      winnerId,
      newRound
    };

    room.lastRoll = result;
    
    // Update Leaderboard if win
    if (winnerId) {
        const winnerName = room.players.find(p => p.id === winnerId)?.name;
        if (winnerName && db.users[winnerName]) {
            db.users[winnerName].wins += 1;
        }
    }

    db.rooms[this.currentRoomId] = room;
    
    // Save (This triggers 'storage' event for Guest)
    this.saveRooms(db.rooms);
    this.saveDB(db); 

    // Trigger local update for Host
    this.syncRoomState();

    // Loop if tie
    if (newRound) {
        this.gameLoopTimeout = setTimeout(() => this.runHostTurn(), 4000); // 4s delay for re-roll
    }
  }

  // Helper to trigger client listeners
  private trigger(event: string, data: any) {
    // console.log(`[LocalServer -> Client] ${event}`, data);
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}

export const socketService = new MockSocketService();
