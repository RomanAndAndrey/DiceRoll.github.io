
import { SocketEvents, DiceResultPayload, LeaderboardEntry, LoginPayload, Player, RoomStatus } from '../types';
import { Peer, DataConnection } from 'peerjs';

type Listener = (data: any) => void;

interface NetworkMessage {
  type: string;
  payload: any;
}

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
    this.isHost = true;
    
    // Generate a 4 digit code
    const shortCode = Math.floor(1000 + Math.random() * 9000).toString();
    const fullId = this.ID_PREFIX + shortCode;

    this.peer = new Peer(fullId, {
      debug: 1,
    });

    this.peer.on('open', (id) => {
      console.log('Host Open:', id);
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
      console.log('Host: Connection received');
      this.conn = conn;
      this.setupConnectionHandlers(conn);
    });

    this.peer.on('error', (err) => {
        console.error('Peer Error:', err);
        // If ID is taken, retry? For now, just error.
        alert('Connection Error: ' + err.type);
    });
  }

  /**
   * GUEST: Connects to an existing Host ID.
   */
  private joinHost(shortCode: string) {
    if (!this.currentUser) return;
    this.isHost = false;

    const fullTargetId = this.ID_PREFIX + shortCode.trim();

    // Guest gets a random ID
    this.peer = new Peer({ debug: 1 });

    this.peer.on('open', () => {
      // Connect to Host
      const conn = this.peer!.connect(fullTargetId);
      this.conn = conn;

      conn.on('open', () => {
        console.log('Guest: Connected to Host');
        // Send our info to Host
        this.send({
          type: 'JOIN_REQUEST',
          payload: { 
            id: this.currentUser!.id, 
            name: this.currentUser!.name 
          }
        });
      });

      this.setupConnectionHandlers(conn);
    });

    this.peer.on('error', (err: any) => {
      console.error('Peer Error:', err);
      if (err.type === 'peer-unavailable') {
         alert('Room not found! Check the code.');
      } else {
         alert('Connection Error: ' + err.type);
      }
      this.disconnect();
    });
  }

  private disconnect() {
    this.stopGameLoop();
    if (this.conn) this.conn.close();
    if (this.peer) this.peer.destroy();
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
      alert('Connection lost');
      this.trigger(SocketEvents.MATCH_END, { winnerId: null });
      this.disconnect();
    });
  }

  private send(msg: NetworkMessage) {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
    }
  }

  // --- HOST LOGIC (Server Authority) ---

  private handleHostMessage(msg: NetworkMessage) {
    switch (msg.type) {
      case 'JOIN_REQUEST':
        if (this.players.length >= 2) return; // Full

        const guestPlayer: Player = {
          id: msg.payload.id,
          name: msg.payload.name,
          score: 0,
          isSelf: false 
        };
        
        this.players.push(guestPlayer);

        // Notify Guest they joined
        this.send({
          type: SocketEvents.MATCH_START,
          payload: { roomId: this.peerId, players: this.players }
        });

        // Notify Host UI
        this.trigger(SocketEvents.MATCH_START, {
          roomId: this.peerId,
          players: this.players.map(p => ({...p, isSelf: p.id === this.currentUser?.id}))
        });

        // Start Game
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
  }

  private trigger(event: string, data: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}

export const socketService = new P2PSocketService();
