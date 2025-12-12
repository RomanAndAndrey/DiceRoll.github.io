
import { SocketEvents, DiceResultPayload, LeaderboardEntry, LoginPayload, Player, RoomStatus } from '../types';
import { Peer, DataConnection, PeerOptions } from 'peerjs';

type Listener = (data: any) => void;

interface NetworkMessage {
  type: string;
  payload: any;
}

// FIX: Use exactly 2 reliable Google STUN servers.
// Using more triggers the "slows down discovery" warning and causes timeouts.
const PEER_CONFIG: PeerOptions = {
    debug: 1, // Lower debug level to reduce console noise
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
  
  // NEW PREFIX: Ensures we don't connect to old/stale cached peers from previous versions
  private readonly ID_PREFIX = 'cube-v7-'; 

  constructor() {
    console.log('[System] P2P Service v7 Initialized');
    this.restoreSession();
    
    // Safety: Disconnect when closing the tab to free up the ID
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
        // Mock data for leaderboard
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

    console.log(`[Host] Creating Room: ${shortCode} (ID: ${fullId})`);

    try {
        this.peer = new Peer(fullId, PEER_CONFIG);
    } catch (e) {
        console.error("Peer creation failed", e);
        this.trigger(SocketEvents.ERROR, { message: 'Failed to initialize network.' });
        return;
    }

    this.peer.on('open', (id) => {
      console.log('[Host] Online. Ready for connections.');
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
      console.log('[Host] Guest connecting...');
      
      // If we already have a guest, reject new ones
      if (this.conn && this.conn.open) {
          console.warn('[Host] Rejecting extra player');
          conn.close();
          return;
      }
      
      this.conn = conn;
      this.setupConnectionHandlers(conn);
    });

    this.peer.on('error', (err) => {
        console.error('[Host] Error:', err);
        if (err.type === 'unavailable-id') {
           this.trigger(SocketEvents.ERROR, { message: 'Room ID collision. Please try again.' });
        } else if (err.type === 'network') {
           this.trigger(SocketEvents.ERROR, { message: 'Network error. Check your connection.' });
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
    console.log(`[Guest] Connecting to Room: ${shortCode} (${fullTargetId})`);

    // Guest creates a random ID
    this.peer = new Peer(PEER_CONFIG);

    // Global timeout: If we don't connect in 10s, fail gracefully
    this.connectionTimeout = setTimeout(() => {
        console.error('[Guest] Connection Timeout');
        this.trigger(SocketEvents.CONNECT_ERROR, { message: 'Connection timed out. Host may be offline.' });
        this.disconnect();
    }, 10000);

    this.peer.on('open', (myId) => {
      console.log('[Guest] Peer initialized. Dialing host...');
      
      const conn = this.peer!.connect(fullTargetId, {
          reliable: true,
          serialization: 'json' // Explicitly use JSON serialization
      });
      
      this.conn = conn;

      conn.on('open', () => {
        console.log('[Guest] Connected to Host!');
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        
        this.setupConnectionHandlers(conn);

        // Send handshake immediately
        this.send({
          type: 'JOIN_REQUEST',
          payload: { 
            id: this.currentUser!.id, 
            name: this.currentUser!.name 
          }
        });
      });

      // Handle immediate closure (e.g. host rejected)
      conn.on('close', () => {
          console.log('[Guest] Connection closed by host or lost');
      });

      conn.on('error', (err) => {
          console.error('[Guest] Connection Error', err);
      });
    });

    this.peer.on('error', (err: any) => {
      console.error('[Guest] Peer Error:', err.type);
      if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
      
      if (err.type === 'peer-unavailable') {
         this.trigger(SocketEvents.CONNECT_ERROR, { message: 'Room not found. Is the Host online?' });
      } else {
         this.trigger(SocketEvents.CONNECT_ERROR, { message: 'Connection failed: ' + err.type });
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
      // Data is already JSON object due to serialization: 'json'
      const msg = data as NetworkMessage;
      
      if (this.isHost) {
        this.handleHostMessage(msg);
      } else {
        this.handleGuestMessage(msg);
      }
    });

    conn.on('close', () => {
      console.log('[Connection] Disconnected');
      this.trigger(SocketEvents.MATCH_END, { winnerId: null });
      // If we are guest, we might want to return to lobby
      if (!this.isHost) {
          this.trigger(SocketEvents.ERROR, { message: 'Host disconnected.' });
      }
    });
  }

  private send(msg: NetworkMessage) {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
    } else {
      console.warn('Cannot send message, connection is not open');
    }
  }

  // --- GAMEPLAY LOGIC ---

  private handleHostMessage(msg: NetworkMessage) {
    if (msg.type === 'JOIN_REQUEST') {
        console.log('[Host] Player joined:', msg.payload.name);
        this.stopGameLoop();

        const guestPlayer: Player = {
          id: msg.payload.id,
          name: msg.payload.name,
          score: 0,
          isSelf: false 
        };
        
        const hostPlayer = this.players.find(p => p.isSelf)!;
        this.players = [hostPlayer, guestPlayer];

        // 1. Notify Guest
        this.send({
          type: SocketEvents.MATCH_START,
          payload: { roomId: this.peerId?.replace(this.ID_PREFIX, ''), players: this.players }
        });

        // 2. Notify Host UI
        this.trigger(SocketEvents.MATCH_START, {
          roomId: this.peerId?.replace(this.ID_PREFIX, ''),
          players: this.players.map(p => ({...p, isSelf: p.id === this.currentUser?.id}))
        });

        // Start game loop after delay
        setTimeout(() => this.runGameLoop(), 2000);
    }
  }

  private runGameLoop() {
    if (!this.isHost || this.players.length < 2) return;

    // Logic: Roll dice
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

    // Broadcast result
    this.send({ type: SocketEvents.DICE_RESULT, payload: result });
    this.trigger(SocketEvents.DICE_RESULT, result);

    if (winnerId) {
        // Match over
        setTimeout(() => {
            const endMsg = { winnerId };
            this.send({ type: SocketEvents.MATCH_END, payload: endMsg });
            this.trigger(SocketEvents.MATCH_END, endMsg);
        }, 3500);
    } else {
        // Tie -> Reroll
        this.gameLoopTimeout = setTimeout(() => this.runGameLoop(), 4000);
    }
  }

  private stopGameLoop() {
    if (this.gameLoopTimeout) clearTimeout(this.gameLoopTimeout);
  }

  private handleGuestMessage(msg: NetworkMessage) {
    if (msg.type === SocketEvents.MATCH_START) {
        // Remap players so "isSelf" is correct for the guest
        const players = msg.payload.players.map((p: Player) => ({
            ...p,
            isSelf: p.id === this.currentUser?.id
        }));
        this.trigger(msg.type, { ...msg.payload, players });
    } else {
        this.trigger(msg.type, msg.payload);
    }
  }
  
  private handleLogin(payload: LoginPayload) {
    // Simple mock login
    this.currentUser = { 
      id: 'u_' + Math.floor(Math.random() * 100000), 
      name: payload.username 
    };
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
