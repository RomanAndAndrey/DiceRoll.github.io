
import { SocketEvents, DiceResultPayload, LeaderboardEntry, LoginPayload, Player, RoomStatus } from '../types';
import { Peer, DataConnection, PeerOptions } from 'peerjs';

type Listener = (data: any) => void;

interface NetworkMessage {
  type: string;
  payload: any;
}

// Config: Standard Google STUN servers.
const PEER_CONFIG: PeerOptions = {
    debug: 2, 
    secure: true,
    config: {
        iceServers: [
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
        ]
    }
};

class P2PSocketService {
  private listeners: Record<string, Listener[]> = {};
  
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private peerId: string | null = null;
  private isHost: boolean = false;
  
  public currentUser: { id: string; name: string } | null = null;
  private players: Player[] = [];

  private gameLoopTimeout: any = null;
  private connectionTimeout: any = null;
  
  // VERSION CHECK: v11 - Independent Leave Button
  private readonly ID_PREFIX = 'cube-v11-'; 

  constructor() {
    console.log('%c [System] P2P Service v11 (Independent Leave) LOADED ', 'background: #06b6d4; color: white; font-weight: bold;');
    this.restoreSession();
    
    // Safety: Disconnect when closing the tab
    window.addEventListener('beforeunload', () => {
        this.disconnect();
    });
  }

  private restoreSession() {
    const session = sessionStorage.getItem('dc_user');
    if (session) {
      try {
        this.currentUser = JSON.parse(session);
      } catch(e) {}
    }
  }

  public getUserId(): string {
    return this.currentUser?.id || 'guest';
  }

  public isLoggedIn(): boolean {
    return !!this.currentUser;
  }

  public on(event: string, callback: Listener) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  public off(event: string, callback: Listener) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  public emit(event: string, payload: any) {
    console.log(`[UI Action] ${event}`, payload);

    switch (event) {
      case SocketEvents.LOGIN_REQUEST:
        this.handleLogin(payload);
        break;
      case SocketEvents.LOGOUT:
        this.handleLogout();
        break;
      case SocketEvents.CREATE_MATCH:
        this.createHost();
        break;
      case SocketEvents.JOIN_MATCH:
        this.joinHost(payload.roomId);
        break;
      case SocketEvents.LEAVE_MATCH:
        this.disconnect();
        break;
      case SocketEvents.GET_LEADERBOARD:
        // Mock data
        this.trigger(SocketEvents.LEADERBOARD_DATA, [
            { name: "CyberKing", wins: 42 },
            { name: "DiceMaster", wins: 38 },
            { name: "LuckBox", wins: 15 }
        ]);
        break;
    }
  }

  // --- HOST LOGIC ---

  private createHost() {
    if (!this.currentUser) return;
    this.disconnect(); 
    this.isHost = true;
    
    const shortCode = Math.floor(1000 + Math.random() * 9000).toString();
    const fullId = this.ID_PREFIX + shortCode;

    console.log(`[Host] Initializing with ID: ${fullId}`);

    try {
        this.peer = new Peer(fullId, PEER_CONFIG);
    } catch (e) {
        console.error("Peer creation failed", e);
        this.trigger(SocketEvents.ERROR, { message: 'Failed to create Peer instance.' });
        return;
    }

    this.peer.on('open', (id) => {
      console.log(`%c [Host] ONLINE: ${id} `, 'background: #6366f1; color: white;');
      this.peerId = id;
      
      this.players = [{
        id: this.currentUser!.id,
        name: this.currentUser!.name,
        score: 0,
        isSelf: true
      }];

      this.trigger(SocketEvents.MATCH_CREATED, { roomId: shortCode });
    });

    this.peer.on('connection', (conn) => {
      console.log('[Host] Incoming connection from Guest...');
      
      if (this.conn && this.conn.open) {
          console.warn('[Host] Rejecting extra player');
          conn.close();
          return;
      }
      
      this.conn = conn;
      this.setupConnectionHandlers(conn);
    });

    this.peer.on('error', (err) => {
        console.error('[Host] Peer Error:', err);
        if (err.type === 'unavailable-id') {
           this.trigger(SocketEvents.ERROR, { message: 'ID Collision. Try again.' });
        } else if (err.type === 'network') {
           this.trigger(SocketEvents.ERROR, { message: 'Network error. Check connection.' });
        } else {
           this.trigger(SocketEvents.ERROR, { message: `Host Error: ${err.type}` });
        }
    });
  }

  // --- GUEST LOGIC ---

  private joinHost(shortCode: string) {
    if (!this.currentUser) return;
    this.disconnect();
    this.isHost = false;

    const fullTargetId = this.ID_PREFIX + shortCode.trim();
    console.log(`[Guest] Target Room: ${fullTargetId}`);

    // Create Guest Peer (random ID)
    this.peer = new Peer(PEER_CONFIG);

    // Timeout safety
    this.connectionTimeout = setTimeout(() => {
        console.error('[Guest] Global Connection Timeout');
        this.trigger(SocketEvents.CONNECT_ERROR, { message: 'Connection timed out. Room ID might be wrong or Host offline.' });
        this.disconnect();
    }, 12000);

    this.peer.on('open', (myId) => {
      console.log(`[Guest] Peer initialized (${myId}). Connecting to ${fullTargetId}...`);
      
      const conn = this.peer!.connect(fullTargetId, {
          reliable: true,
          serialization: 'json'
      });
      
      this.conn = conn;

      conn.on('open', () => {
        console.log('%c [Guest] CONNECTED TO HOST! ', 'background: #22c55e; color: black;');
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        
        this.setupConnectionHandlers(conn);

        // Handshake
        this.send({
          type: 'JOIN_REQUEST',
          payload: { 
            id: this.currentUser!.id, 
            name: this.currentUser!.name 
          }
        });
      });

      // If connection fails immediately
      conn.on('close', () => {
          console.log('[Guest] Connection immediately closed');
      });

      conn.on('error', (err) => {
          console.error('[Guest] DataConnection Error:', err);
      });
    });

    this.peer.on('error', (err: any) => {
      console.error('[Guest] Peer Error:', err.type);
      if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
      
      if (err.type === 'peer-unavailable') {
         this.trigger(SocketEvents.CONNECT_ERROR, { message: 'Room not found. Check the ID.' });
      } else {
         this.trigger(SocketEvents.CONNECT_ERROR, { message: `Connection failed: ${err.type}` });
      }
      this.disconnect();
    });
  }

  private disconnect() {
    this.stopGameLoop();
    if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
    
    if (this.conn) {
        this.conn.close();
    }
    if (this.peer) {
        this.peer.destroy();
    }
    this.conn = null;
    this.peer = null;
    this.players = [];
  }

  // --- SHARED HANDLERS ---

  private setupConnectionHandlers(conn: DataConnection) {
    conn.on('data', (data: any) => {
      const msg = data as NetworkMessage;
      
      if (this.isHost) {
        this.handleHostMessage(msg);
      } else {
        this.handleGuestMessage(msg);
      }
    });

    conn.on('close', () => {
      console.log('[Connection] Stream closed');
      this.trigger(SocketEvents.MATCH_END, { winnerId: null });
      if (!this.isHost) {
          this.trigger(SocketEvents.ERROR, { message: 'Disconnected from Host.' });
      }
    });
  }

  private send(msg: NetworkMessage) {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
    } else {
      console.warn('Cannot send, connection not open');
    }
  }

  // --- GAMEPLAY ---

  private handleHostMessage(msg: NetworkMessage) {
    if (msg.type === 'JOIN_REQUEST') {
        console.log('[Host] JOIN_REQUEST from:', msg.payload.name);
        this.stopGameLoop();

        const guestPlayer: Player = {
          id: msg.payload.id,
          name: msg.payload.name,
          score: 0,
          isSelf: false 
        };
        
        const hostPlayer = this.players.find(p => p.isSelf)!;
        this.players = [hostPlayer, guestPlayer];

        this.send({
          type: SocketEvents.MATCH_START,
          payload: { roomId: this.peerId?.replace(this.ID_PREFIX, ''), players: this.players }
        });

        this.trigger(SocketEvents.MATCH_START, {
          roomId: this.peerId?.replace(this.ID_PREFIX, ''),
          players: this.players.map(p => ({...p, isSelf: p.id === this.currentUser?.id}))
        });

        setTimeout(() => this.runGameLoop(), 2000);
    }
  }

  private runGameLoop() {
    if (!this.isHost || this.players.length < 2) return;

    const p1 = this.players[0]; // Host
    const p2 = this.players[1]; // Guest
    const p1Roll = Math.floor(Math.random() * 6) + 1;
    const p2Roll = Math.floor(Math.random() * 6) + 1;

    let winnerId: string | null = null;
    let newRound = false;

    if (p1Roll > p2Roll) winnerId = p1.id;
    else if (p2Roll > p1Roll) winnerId = p2.id;
    else newRound = true;

    const result: DiceResultPayload = {
      rolls: { [p1.id]: p1Roll, [p2.id]: p2Roll },
      winnerId,
      newRound
    };

    this.send({ type: SocketEvents.DICE_RESULT, payload: result });
    this.trigger(SocketEvents.DICE_RESULT, result);

    if (winnerId) {
        setTimeout(() => {
            const endMsg = { winnerId };
            this.send({ type: SocketEvents.MATCH_END, payload: endMsg });
            this.trigger(SocketEvents.MATCH_END, endMsg);
        }, 3500);
    } else {
        this.gameLoopTimeout = setTimeout(() => this.runGameLoop(), 4000);
    }
  }

  private stopGameLoop() {
    if (this.gameLoopTimeout) clearTimeout(this.gameLoopTimeout);
  }

  private handleGuestMessage(msg: NetworkMessage) {
    if (msg.type === SocketEvents.MATCH_START) {
        const players = msg.payload.players.map((p: Player) => ({
            ...p,
            isSelf: p.id === this.currentUser?.id
        }));
        this.trigger(msg.type, { ...msg.payload, players });
    } else {
        this.trigger(msg.type, msg.payload);
    }
  }
  
  // --- AUTHENTICATION (Database Simulation) ---

  private handleLogin(payload: LoginPayload) {
    const { username, password } = payload;
    
    // Safety check
    if (!username || !password) {
        this.trigger(SocketEvents.LOGIN_FAIL, { message: 'Username and password required' });
        return;
    }

    // 1. Load "Database" from localStorage (Browser memory)
    const dbKey = 'dc_users_db_v1';
    let db: Record<string, { password: string, id: string }>;
    
    try {
        db = JSON.parse(localStorage.getItem(dbKey) || '{}');
    } catch {
        db = {};
    }

    // 2. Logic: Login vs Register
    if (db[username]) {
        // User exists -> Check password
        const userRecord = db[username];
        
        if (userRecord.password === password) {
            console.log(`[Auth] User ${username} logged in successfully from DB.`);
            this.currentUser = { id: userRecord.id, name: username };
            this.finalizeLogin();
        } else {
            console.warn(`[Auth] Wrong password for ${username}`);
            this.trigger(SocketEvents.LOGIN_FAIL, { message: 'Invalid password' });
        }
    } else {
        // User new -> Register
        console.log(`[Auth] Creating new database entry for: ${username}`);
        
        const newId = 'u_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
        
        // Write to DB
        db[username] = { password, id: newId };
        localStorage.setItem(dbKey, JSON.stringify(db));
        
        this.currentUser = { id: newId, name: username };
        this.finalizeLogin();
    }
  }

  private finalizeLogin() {
    // Save active session for page reloads
    sessionStorage.setItem('dc_user', JSON.stringify(this.currentUser));
    this.trigger(SocketEvents.LOGIN_SUCCESS, { user: this.currentUser });
  }

  private handleLogout() {
    this.currentUser = null;
    sessionStorage.removeItem('dc_user');
    this.disconnect();
  }

  private trigger(event: string, data: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}

export const socketService = new P2PSocketService();
