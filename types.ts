
export enum RoomStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETE = 'COMPLETE',
}

export interface Player {
  id: string;
  name: string;
  score: number;
  isSelf: boolean;
  lastRoll?: number;
}

export interface GameState {
  roomId: string | null;
  status: RoomStatus;
  players: Player[];
  roundWinnerId: string | null;
  isRolling: boolean; // Visual state for optimistic UI
  message: string | null;
}

export interface LeaderboardEntry {
  name: string;
  wins: number;
}

// Socket Events Protocol (matching the report)
export enum SocketEvents {
  // Client -> Server
  LOGIN_REQUEST = 'login_request', // New
  CREATE_MATCH = 'create_match',
  JOIN_MATCH = 'join_match',
  LEAVE_MATCH = 'leave_match',
  GET_LEADERBOARD = 'get_leaderboard',
  LOGOUT = 'logout', // New

  // Server -> Client
  LOGIN_SUCCESS = 'login_success', // New
  LOGIN_FAIL = 'login_fail', // New
  MATCH_CREATED = 'match_created', // Ack
  MATCH_START = 'match_start',
  DICE_RESULT = 'dice_result',
  MATCH_END = 'match_end',
  LEADERBOARD_DATA = 'leaderboard_data',
  ERROR = 'error',
}

export interface DiceResultPayload {
  rolls: Record<string, number>; // playerId -> roll value
  winnerId: string | null; // null if tie
  newRound: boolean;
}

export interface LoginPayload {
  username: string;
  password?: string;
}

export interface CreateMatchPayload {
  playerName: string;
}

export interface JoinMatchPayload {
  roomId: string;
  playerName: string;
}
