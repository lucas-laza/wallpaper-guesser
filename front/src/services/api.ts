// services/api.ts
const API_BASE_URL = 'http://localhost:3300';

// Variable globale pour stocker la fonction de déconnexion
let logoutCallback: (() => void) | null = null;

// Types
export interface User {
  id: number;
  name: string;
  email: string;
}

export interface LoginResponse {
  message: string;
  token: string;
  user: User;
}

export interface Game {
  gameId: number;
  user: User;
  roundsNumber: number;
  time: number;
  map?: string;
  status?: string;
  currentRound?: number;
}

export interface ActiveGameInfo {
  hasActiveGame: boolean;
  gameId?: number;
  currentRound?: number;
  totalRounds?: number;
  map?: string;
  time?: number;
  isCompleted?: boolean;
  partyId?: number | null;
  isMultiplayer?: boolean;
  totalPlayers?: number;
  playersFinished?: number;
  waitingForPlayers?: boolean;
  roundData?: {
    id: number;
    relative_id: number;
    guesses: number;
    wallpaper: {
      id: number;
      title: string;
      image: string;
      copyright: string;
    };
  };
}

export interface Party {
  id: number;
  code: string;
  admin: User;
  players: User[];
  type: 'solo' | 'private';
  status?: 'waiting' | 'in_progress' | 'completed' | 'disbanded';
  activeGame?: {
    id: number;
    status: string;
    map: string;
    roundsNumber: number;
  } | null;
}

export interface Round {
  id: number;
  relative_id: number;
  guesses: number;
  wallpaper: {
    id: number;
    title: string;
    image: string;
    copyright: string;
  };
}

export interface GuessResult {
  roundId: number;
  relative_id: number;
  guessNumber: number;
  isCorrect: boolean;
  score: number;
  correctLocation: {
    country: { code: string; text: string };
    state?: { code: string; text: string };
    title: string;
    tags: string[];
  };
  userGuess: {
    country: string;
  };
  isMultiplayer?: boolean;
  roundComplete?: boolean;
  waitingPlayers?: number;
  totalPlayers?: number;
}

export interface Map {
  name: string;
  count: number;
}

export interface CountryList {
  continents: string[];
  countries: string[];
  all: string[];
}

// Token management
export const getToken = (): string | null => {
  return localStorage.getItem('auth_token');
};

export const setToken = (token: string): void => {
  localStorage.setItem('auth_token', token);
};

export const removeToken = (): void => {
  localStorage.removeItem('auth_token');
};

export const setUser = (user: User): void => {
  localStorage.setItem('user', JSON.stringify(user));
};

export const getUser = (): User | null => {
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
};

export const removeUser = (): void => {
  localStorage.removeItem('user');
};

// Fonction pour configurer l'intercepteur avec le callback de déconnexion
export const setupApiInterceptor = (forceLogout: () => void) => {
  logoutCallback = forceLogout;
};

// API request helper avec gestion automatique de l'expiration
const apiRequest = async (endpoint: string, options: RequestInit = {}): Promise<any> => {
  const token = getToken();
  
  const config: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
    
    // Vérifier si c'est une erreur 401 (Unauthorized) et qu'on a un token
    // Cela signifie que le token est expiré/invalide
    if (response.status === 401 && token && logoutCallback) {
      console.log('Token expiré/invalide. Déconnexion automatique...');
      logoutCallback();
    }
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'An error occurred');
    }

    return response.json();
  } catch (error) {
    throw error;
  }
};

// Auth API calls
export const registerUser = async (userData: {
  name: string;
  email: string;
  password: string;
  repassword: string;
}): Promise<any> => {
  return apiRequest('/user/register', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
};

export const loginUser = async (credentials: {
  email: string;
  password: string;
}): Promise<LoginResponse> => {
  const response = await apiRequest('/user/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  
  // Store token and user info
  setToken(response.token);
  setUser(response.user);
  
  return response;
};

export const logoutUser = (): void => {
  removeToken();
  removeUser();
};

export const getCurrentUser = async (): Promise<User> => {
  return apiRequest('/user/profile');
};

// Solo Game API calls - NOUVELLES FONCTIONS
export const checkActiveGame = async (): Promise<ActiveGameInfo> => {
  return apiRequest('/game/solo/active');
};

export const quitActiveGame = async (): Promise<{ message: string; gameId: number; status: string }> => {
  return apiRequest('/game/solo/quit', {
    method: 'POST',
  });
};

export const resumeGame = async (gameId: number): Promise<any> => {
  return apiRequest(`/game/solo/resume/${gameId}`, {
    method: 'POST',
  });
};

export const startSoloGame = async (gameSettings: {
  roundsNumber?: number;
  time?: number;
  map?: string;
}): Promise<Game> => {
  return apiRequest('/game/solo/start', {
    method: 'POST',
    body: JSON.stringify(gameSettings),
  });
};

// Party API calls
export const createParty = async (): Promise<Party> => {
  return apiRequest('/game/party/create', {
    method: 'POST',
  });
};

export const joinParty = async (code: string): Promise<Party> => {
  return apiRequest('/game/party/join', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
};

export const getPartyInfo = async (partyCode: string): Promise<Party> => {
  return apiRequest(`/game/party/code/${partyCode}`);
};

export const startPartyGame = async (partyCode: string, gameSettings: {
  roundsNumber?: number;
  time?: number;
  map?: string;
}): Promise<Game> => {
  return apiRequest(`/game/party/code/${partyCode}/start`, {
    method: 'POST',
    body: JSON.stringify(gameSettings),
  });
};

export const leaveParty = async (partyCode: string): Promise<void> => {
  return apiRequest(`/game/party/code/${partyCode}/leave`, {
    method: 'POST',
  });
};

export const getUserParties = async (): Promise<Party[]> => {
  return apiRequest('/game/user/parties');
};

// Game API calls (communes aux deux modes)
export const getGameInfo = async (gameId: number): Promise<any> => {
  return apiRequest(`/game/game/${gameId}`);
};

export const getGameRounds = async (gameId: number): Promise<Round[]> => {
  return apiRequest(`/game/game/${gameId}/rounds`);
};

export const getRound = async (gameId: number, relativeId: number): Promise<Round> => {
  return apiRequest(`/game/game/${gameId}/round/${relativeId}`);
};

export const submitGuess = async (
  gameId: number,
  relativeId: number,
  guess: { country: string }
): Promise<GuessResult> => {
  return apiRequest(`/game/game/${gameId}/round/${relativeId}/guess`, {
    method: 'POST',
    body: JSON.stringify(guess),
  });
};

export const finishGame = async (gameId: number): Promise<any> => {
  return apiRequest(`/game/game/${gameId}/finish`, {
    method: 'POST',
  });
};

export const getUserGames = async (): Promise<any[]> => {
  return apiRequest('/game/user/games');
};

// Maps and Countries API calls
export const getAvailableMaps = async (): Promise<Map[]> => {
  return apiRequest('/maps');
};

export const getCountryTags = async (): Promise<CountryList> => {
  return apiRequest('/wallpaper/tags');
};

// Nouveaux types pour la synchronisation
export interface SyncGuessResult extends GuessResult {
  isMultiplayer?: boolean;
  roundComplete?: boolean;
  waitingPlayers?: number;
  totalPlayers?: number;
}

export interface GameSyncState {
  isSynchronized: boolean;
  gameId?: number;
  currentRound?: number;
  playersFinished?: number;
  allPlayersFinished?: boolean;
  playersReady?: number;
  totalPlayers?: number;
}

export interface PlayerStatus {
  playerId: number;
  playerName: string;
  completedRounds: number;
  hasFinished: boolean;
}

export interface WaitingStatus {
  gameId: number;
  totalPlayers: number;
  playersStillPlaying: number;
  allPlayersFinished: boolean;
  playerStatuses: PlayerStatus[];
  totalRounds: number;
}

export interface FinishGameResult {
  message: string;
  gameId: number;
  status: string;
  allPlayersFinished: boolean;
  playersStillPlaying?: number;
  winner?: {
    id: number;
    name: string;
  };
}

// Nouvelles fonctions API pour la synchronisation multijoueur

// Soumet une réponse avec synchronisation (pour le multijoueur)
export const submitGuessWithSync = async (
  gameId: number,
  relativeId: number,
  guess: { country: string }
): Promise<SyncGuessResult> => {
  return apiRequest(`/game/game/${gameId}/round/${relativeId}/guess-sync`, {
    method: 'POST',
    body: JSON.stringify(guess),
  });
};

// Marque un joueur comme prêt pour le round suivant
export const markPlayerReady = async (gameId: number): Promise<{
  message: string;
  allPlayersReady: boolean;
  gameId: number;
  userId: number;
}> => {
  return apiRequest(`/game/game/${gameId}/ready-next-round`, {
    method: 'POST',
  });
};

// Obtient l'état de synchronisation d'une partie
export const getGameSyncState = async (gameId: number): Promise<GameSyncState> => {
  return apiRequest(`/game/game/${gameId}/sync-state`);
};

// Obtient les résultats d'un round spécifique
export const getRoundResults = async (gameId: number, relativeId: number): Promise<{
  roundId: number;
  results: Array<{
    playerId: number;
    playerName: string;
    result: GuessResult;
  }>;
  totalPlayers: number;
}> => {
  return apiRequest(`/game/game/${gameId}/round/${relativeId}/results`);
};

// Termine une partie avec vérification de synchronisation
export const finishGameWithSync = async (gameId: number): Promise<FinishGameResult> => {
  return apiRequest(`/game/game/${gameId}/finish-sync`, {
    method: 'POST',
  });
};

// Vérifie si tous les joueurs ont terminé
export const checkAllPlayersFinished = async (gameId: number): Promise<{
  gameId: number;
  allPlayersFinished: boolean;
  totalPlayers: number;
}> => {
  return apiRequest(`/game/game/${gameId}/all-players-finished`);
};

// Obtient le statut d'attente d'une partie
export const getWaitingStatus = async (gameId: number): Promise<WaitingStatus> => {
  return apiRequest(`/game/game/${gameId}/waiting-status`);
};

// Fonction modifiée pour soumettre une réponse (détecte automatiquement solo vs multijoueur)
export const submitGuessAuto = async (
  gameId: number,
  relativeId: number,
  guess: { country: string }
): Promise<GuessResult | SyncGuessResult> => {
  try {
    // Tenter d'abord la version synchronisée
    const syncResult = await submitGuessWithSync(gameId, relativeId, guess);
    return syncResult;
  } catch (error) {
    // Si ça échoue, utiliser la version classique (solo)
    return submitGuess(gameId, relativeId, guess);
  }
};

// Fonction pour détecter si une partie est multijoueur
export const isMultiplayerGame = async (gameId: number): Promise<boolean> => {
  try {
    const syncState = await getGameSyncState(gameId);
    return syncState.isSynchronized;
  } catch (error) {
    return false;
  }
};

// Fonction pour obtenir les informations complètes d'une partie avec état de synchronisation
export const getGameInfoWithSync = async (gameId: number): Promise<{
  gameInfo: any;
  syncState: GameSyncState;
  waitingStatus?: WaitingStatus;
}> => {
  const gameInfo = await getGameInfo(gameId);
  const syncState = await getGameSyncState(gameId);
  
  let waitingStatus;
  if (syncState.isSynchronized) {
    waitingStatus = await getWaitingStatus(gameId);
  }
  
  return {
    gameInfo,
    syncState,
    waitingStatus
  };
};

// Mise à jour de l'interface ActiveGameInfo pour inclure les infos multijoueur
export interface ActiveGameInfo {
  hasActiveGame: boolean;
  gameId?: number;
  currentRound?: number;
  totalRounds?: number;
  map?: string;
  time?: number;
  isCompleted?: boolean;
  // Nouvelles propriétés pour le multijoueur
  isMultiplayer?: boolean;
  totalPlayers?: number;
  partyId?: number;
  playersFinished?: number;
  waitingForPlayers?: boolean;
  roundData?: {
    id: number;
    relative_id: number;
    guesses: number;
    wallpaper: {
      id: number;
      title: string;
      image: string;
      copyright: string;
    };
  };
}

// Fonction mise à jour pour vérifier une partie active avec infos multijoueur
export const checkActiveGameWithSync = async (): Promise<ActiveGameInfo> => {
  const activeGameInfo = await checkActiveGame();
  
  if (activeGameInfo.hasActiveGame && activeGameInfo.gameId) {
    try {
      const syncState = await getGameSyncState(activeGameInfo.gameId);
      
      if (syncState.isSynchronized) {
        const waitingStatus = await getWaitingStatus(activeGameInfo.gameId);
        
        return {
          ...activeGameInfo,
          isMultiplayer: true,
          totalPlayers: syncState.totalPlayers,
          playersFinished: syncState.playersFinished,
          waitingForPlayers: !syncState.allPlayersFinished
        };
      }
    } catch (error) {
      console.warn('Could not get sync state for active game:', error);
    }
  }
  
  return {
    ...activeGameInfo,
    isMultiplayer: false,
    totalPlayers: 1
  };
};