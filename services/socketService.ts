
import { SocketEvents, DiceResultPayload, LeaderboardEntry, LoginPayload, Player, RoomStatus } from '../types';
import { Peer, DataConnection, PeerOptions } from 'peerjs';

type Listener = (data: any) => void;

interface NetworkMessage {
  type: string;
  payload: any;
}

// Extended List of Free STUN Servers to bypass NAT/Firewalls
const PEER_CONFIG: PeerOptions = {
    debug: 1,
    secure: true,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    }
};

/**
 * P2P SOCKET SERVICE (WebRTC / PeerJS)
 */
class P2PSocketService {
  private listeners: Record<string, Listener[]> = {};
  
  // PeerJS State
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private peerId: string | null = null;
  private isHost: boolean = false;
  
  // App State
  public currentUser: { id: string; name: string } | null = null;
  private players: Player[] = [];

  // Game Loop State (Host Only)
  private gameLoopTimeout: any = null;
  private connectionTimeout: any = null;
  private retryCount = 0;
  private maxRetries = 5;
  
  private readonly ID_PREFIX = 'dc-v1-'; 

  constructor() {
    console.log('[System] P2P Service Initialized');
    this.restoreSession();
  }

  // --- Session ---
  private restoreSession() {
    const session = sessionStorage.getItem('dc_user');
    if (session) {
      try {
        this.currentUser = JSON.parse(session);
      } catch(e) {}
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
        this.trigger(SocketEvents.LEADERBOARD_DATA, [
            { name: "CyberKing", wins: 42 },
            { name: "DiceMaster", wins: 38 },
            { name: "LuckBox", wins: 15 }
        ]);
        break;
    }
  }

  // --- Core P2P Logic ---

  private createHost() {
    if (!this.currentUser) return;
    this.disconnect(); 
    this.isHost = true;
    
    // Generate simple 4 digit code
    const shortCode = Math.floor(1000 + Math.random() * 9000).toString();
    const fullId = this.ID_PREFIX + shortCode;

    console.log(`[Host] Creating room: ${shortCode}`);

    this.peer = new Peer(fullId, PEER_CONFIG);

    this.peer.on('open', (id) => {
      console.log('[Host] Peer Open:', id);
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
      console.log('[Host] Connection received');
      
      if (this.conn && this.conn.open) {
          console.warn('[Host] Room full, rejecting');
          conn.close();
          return;
      }
      
      this.conn = conn;
      this.setupConnectionHandlers(conn);
    });

    this.peer.on('error', (err) => {
        console.error('[Host] Peer Error:', err);
        // If ID is taken, try to regenerate automatically or alert
        if (err.type === 'unavailable-id') {
           this.trigger(SocketEvents.ERROR, { message: 'Room code collision. Try again.' });
        } else {
           this.trigger(SocketEvents.ERROR, { message: 'Failed to create room.' });
        }
        this.disconnect();
    });
  }

  private joinHost(shortCode: string) {
    if (!this.currentUser) return;
    this.disconnect();
    this.isHost = false;
    this.retryCount = 0;

    const fullTargetId = this.ID_PREFIX + shortCode.trim();
    console.log(`[Guest] Initializing Peer to join: ${shortCode}`);

    // Create a random peer ID for the guest
    this.peer = new Peer(PEER_CONFIG);

    this.peer.on('open', (myId) => {
      console.log('[Guest] Peer Ready:', myId);
      this.attemptConnection(fullTargetId);
    });

    this.peer.on('error', (err: any) => {
      console.error('[Guest] Peer Error:', err);
      // Critical errors
      if (err.type === 'network' || err.type === 'browser-incompatible') {
         this.trigger(SocketEvents.CONNECT_ERROR, { message: 'Network error or incompatible browser.' });
         this.disconnect();
      }
    });
  }

  private attemptConnection(targetId: string) {
    if (!this.peer) return;

    this.retryCount++;
    console.log(`[Guest] Connection attempt ${this.retryCount}/${this.maxRetries} to ${targetId}`);

    // Clean up previous attempt
    if (this.conn) {
        this.conn.close();
    }

    // Connect without 'serialization: json' to rely on default binary/utf8 which is sometimes more stable
    const conn = this.peer.connect(targetId, {
        reliable: true
    });
    
    this.conn = conn;

    // Set a short timeout for THIS specific attempt
    const attemptTimeout = setTimeout(() => {
        console.warn(`[Guest] Attempt ${this.retryCount} timed out.`);
        if (this.retryCount < this.maxRetries) {
            this.attemptConnection(targetId);
        } else {
            this.trigger(SocketEvents.CONNECT_ERROR, { message: 'Could not find room. Is the Host online?' });
            this.disconnect();
        }
    }, 3500); // 3.5 seconds per attempt

    conn.on('open', () => {
        console.log('[Guest] Connected to Host!');
        clearTimeout(attemptTimeout);
        this.setupConnectionHandlers(conn);

        // Send Join Request
        this.send({
          type: 'JOIN_REQUEST',
          payload: { 
            id: this.currentUser!.id, 
            name: this.currentUser!.name 
          }
        });
    });

    conn.on('error', (err) => {
        console.error('[Guest] Connection Error:', err);
        // Usually fires if peer not found immediately
        clearTimeout(attemptTimeout);
        if (this.retryCount < this.maxRetries) {
            setTimeout(() => this.attemptConnection(targetId), 1000);
        } else {
             this.trigger(SocketEvents.CONNECT_ERROR, { message: 'Room not found.' });
        }
    });
    
    // Sometimes PeerJS emits 'close' immediately if ID not found
    conn.on('close', () => {
        // If we haven't successfully joined yet (no players loaded), treat as failure
        if (this.players.length === 0) {
            // This acts like a retry trigger if it happens fast
            // But usually handled by timeout
        }
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

  // --- Handlers ---

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
      console.log('[Connection] Closed remotely');
      this.trigger(SocketEvents.MATCH_END, { winnerId: null });
    });
  }

  private send(msg: NetworkMessage) {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
    }
  }

  // --- Host Logic ---

  private handleHostMessage(msg: NetworkMessage) {
    switch (msg.type) {
      case 'JOIN_REQUEST':
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

        // Send match start to Guest
        this.send({
          type: SocketEvents.MATCH_START,
          payload: { roomId: this.peerId?.replace(this.ID_PREFIX, ''), players: this.players }
        });

        // Update Host UI
        this.trigger(SocketEvents.MATCH_START, {
          roomId: this.peerId?.replace(this.ID_PREFIX, ''),
          players: this.players.map(p => ({...p, isSelf: p.id === this.currentUser?.id}))
        });

        setTimeout(() => this.runGameLoop(), 2000);
        break;
    }
  }

  private runGameLoop() {
    if (!this.isHost || this.players.length < 2) return;

    // Game Logic
    const p1 = this.players[0];
    const p2 = this.players[1];
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
        }, 3000);
    } else {
        this.gameLoopTimeout = setTimeout(() => this.runGameLoop(), 4000);
    }
  }

  private stopGameLoop() {
    if (this.gameLoopTimeout) clearTimeout(this.gameLoopTimeout);
  }

  // --- Guest Logic ---

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

  // --- Helpers ---
  
  private handleLogin(payload: LoginPayload) {
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
