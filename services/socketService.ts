
import { SocketEvents, DiceResultPayload, LeaderboardEntry, LoginPayload, Player, RoomStatus } from '../types';
import { Peer, DataConnection, PeerOptions } from 'peerjs';

type Listener = (data: any) => void;

interface NetworkMessage {
  type: string;
  payload: any;
}

// Configuration for NAT Traversal (STUN Servers)
// This is critical for connecting users on different networks (e.g. WiFi vs 4G)
const PEER_CONFIG: PeerOptions = {
    debug: 2, // Errors and Warnings
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    }
};

/**
 * P2P SOCKET SERVICE (WebRTC / PeerJS)
 * 
 * Enables real multiplayer between different devices/browsers.
 * Host acts as the Server.
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
  
  // Prefix to avoid collisions on public PeerJS server
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

  // Handle outgoing actions from UI
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
        // Mock data for P2P version (no persistent DB)
        this.trigger(SocketEvents.LEADERBOARD_DATA, [
            { name: "CyberKing", wins: 42 },
            { name: "DiceMaster", wins: 38 },
            { name: "LuckBox", wins: 15 }
        ]);
        break;
    }
  }

  // --- Core P2P Logic ---

  /**
   * HOST: Creates a new Peer with a specific short code ID.
   */
  private createHost() {
    if (!this.currentUser) return;
    this.disconnect(); // Clear previous sessions
    this.isHost = true;
    
    // Generate a 4 digit code
    const shortCode = Math.floor(1000 + Math.random() * 9000).toString();
    const fullId = this.ID_PREFIX + shortCode;

    console.log(`[Host] Creating room: ${shortCode} (${fullId})`);

    // Merge custom ID with default config
    this.peer = new Peer(fullId, PEER_CONFIG);

    this.peer.on('open', (id) => {
      console.log('[Host] Peer Open:', id);
      this.peerId = id;
      
      // Initialize Host Player
      this.players = [{
        id: this.currentUser!.id,
        name: this.currentUser!.name,
        score: 0,
        isSelf: true
      }];

      this.trigger(SocketEvents.MATCH_CREATED, { roomId: shortCode });
    });

    this.peer.on('connection', (conn) => {
      console.log('[Host] Connection received from Guest');
      
      if (this.conn) {
          console.warn('[Host] Rejecting extra connection');
          conn.close();
          return;
      }
      
      this.conn = conn;
      this.setupConnectionHandlers(conn);
    });

    this.peer.on('error', (err) => {
        console.error('[Host] Peer Error:', err);
        let msg = 'Could not create room.';
        if (err.type === 'unavailable-id') {
            msg = 'Room code collision. Please try again.';
        } else if (err.type === 'network') {
            msg = 'Network error. Check your internet.';
        }
        // We can define a simplified alert or trigger an error event
        alert(msg);
    });
  }

  /**
   * GUEST: Connects to an existing Host ID.
   */
  private joinHost(shortCode: string) {
    if (!this.currentUser) return;
    this.disconnect(); // Clear previous
    this.isHost = false;

    const fullTargetId = this.ID_PREFIX + shortCode.trim();
    console.log(`[Guest] Attempting to connect to: ${fullTargetId}`);

    // Create our own peer first
    this.peer = new Peer(PEER_CONFIG);

    // Set a timeout to catch "hanging" connections
    this.connectionTimeout = setTimeout(() => {
        console.error('[Guest] Connection timed out');
        this.trigger(SocketEvents.CONNECT_ERROR, { message: 'Connection timed out. Check code or internet.' });
        this.disconnect();
    }, 10000); // 10 seconds timeout

    this.peer.on('open', (myId) => {
      console.log('[Guest] My Peer ID:', myId);
      
      // Attempt connection to Host
      const conn = this.peer!.connect(fullTargetId, {
          reliable: true,
          serialization: 'json'
      });
      
      this.conn = conn;

      // Bind handlers immediately
      this.setupConnectionHandlers(conn);

      conn.on('open', () => {
        console.log('[Guest] Connection Open! Sending JOIN_REQUEST...');
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);

        // Send our info to Host
        this.send({
          type: 'JOIN_REQUEST',
          payload: { 
            id: this.currentUser!.id, 
            name: this.currentUser!.name 
          }
        });
      });
    });

    this.peer.on('error', (err: any) => {
      console.error('[Guest] Peer Error:', err);
      if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
      
      let msg = 'Connection failed';
      if (err.type === 'peer-unavailable') {
         msg = 'Room not found! Check code.';
      } else if (err.type === 'network') {
         msg = 'Network connection failed.';
      }
      this.trigger(SocketEvents.CONNECT_ERROR, { message: msg });
      this.disconnect(); // Cleanup
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

  // --- Communication Handler ---

  private setupConnectionHandlers(conn: DataConnection) {
    conn.on('data', (data: any) => {
      const msg = data as NetworkMessage;
      // console.log(`[Received] ${msg.type}`, msg.payload);
      
      if (this.isHost) {
        this.handleHostMessage(msg);
      } else {
        this.handleGuestMessage(msg);
      }
    });

    conn.on('close', () => {
      console.log('[Connection] Closed');
      this.trigger(SocketEvents.MATCH_END, { winnerId: null });
      // Don't fully disconnect peer here to allow reconnects if we wanted, 
      // but for this game, we reset.
      // this.disconnect(); 
    });
    
    conn.on('error', (err) => {
        console.error('[Connection] Error:', err);
        this.trigger(SocketEvents.CONNECT_ERROR, { message: 'Connection interrupted' });
    });
  }

  private send(msg: NetworkMessage) {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
    } else {
        console.warn('[Network] Cannot send, connection not open');
    }
  }

  // --- HOST LOGIC (Server Authority) ---

  private handleHostMessage(msg: NetworkMessage) {
    switch (msg.type) {
      case 'JOIN_REQUEST':
        console.log('[Host] Player joining:', msg.payload.name);
        
        // Reset game state for new match
        this.stopGameLoop();

        const guestPlayer: Player = {
          id: msg.payload.id,
          name: msg.payload.name,
          score: 0,
          isSelf: false 
        };
        
        // Ensure host is always player[0]
        const hostPlayer = this.players.find(p => p.isSelf)!;
        this.players = [hostPlayer, guestPlayer];

        // Notify Guest they joined (send short code as roomId for display)
        this.send({
          type: SocketEvents.MATCH_START,
          payload: { roomId: this.peerId?.replace(this.ID_PREFIX, ''), players: this.players }
        });

        // Notify Host UI
        this.trigger(SocketEvents.MATCH_START, {
          roomId: this.peerId?.replace(this.ID_PREFIX, ''),
          players: this.players.map(p => ({...p, isSelf: p.id === this.currentUser?.id}))
        });

        // Start Game Loop
        setTimeout(() => this.runGameLoop(), 2000);
        break;
    }
  }

  private runGameLoop() {
    if (!this.isHost || this.players.length < 2) return;

    // 1. Roll Dice
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

    // 2. Broadcast to Guest
    this.send({ type: SocketEvents.DICE_RESULT, payload: result });

    // 3. Update Host UI
    this.trigger(SocketEvents.DICE_RESULT, result);

    // 4. Handle End or Loop
    if (winnerId) {
        setTimeout(() => {
            const endMsg = { winnerId };
            this.send({ type: SocketEvents.MATCH_END, payload: endMsg });
            this.trigger(SocketEvents.MATCH_END, endMsg);
        }, 3000);
    } else {
        // Tie, re-roll
        this.gameLoopTimeout = setTimeout(() => this.runGameLoop(), 4000);
    }
  }

  private stopGameLoop() {
    if (this.gameLoopTimeout) clearTimeout(this.gameLoopTimeout);
  }

  // --- GUEST LOGIC ---

  private handleGuestMessage(msg: NetworkMessage) {
    // Pass events directly to UI
    // Need to process players array to set correct 'isSelf'
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
    // Simple mock login
    this.currentUser = { 
      id: 'u_' + Math.floor(Math.random() * 10000), 
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
