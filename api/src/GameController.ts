import express from "express";
import { GameService, GameConfig } from "./GameService";
import { Game, GameStatus } from "./Game";
import { Round } from "./Round";
import { User } from "./User";
import { Guess } from "./Guess";
import { Party, PartyType } from "./Party";
import { authenticateToken, AuthenticatedRequest } from "./auth-middleware";
import { soloGameRouter } from "./SoloGameController"; // Import du nouveau router solo
import { WebSocketService } from './WebSocketService';

export const gameRouter = express.Router();

gameRouter.use(authenticateToken);

gameRouter.use("/solo", soloGameRouter);

gameRouter.post("/solo/start-legacy", async (req: AuthenticatedRequest, res) => {
  try {
    const { roundsNumber = 3, time = 60, map = 'World', gamemode } = req.body;
    const userId = req.user!.userId;

    const user = await User.findOneBy({ id: userId });
    if (!user) return res.status(404).json({ error: "User not found" });

    const config: GameConfig = { roundsNumber, time, map, gamemode };
    const game = await GameService.createSoloGame(user, config);

    res.json({ 
      gameId: game.id,
      user: { id: user.id, name: user.name },
      roundsNumber: game.rounds_number,
      time: game.time,
      map: game.map,
      status: game.status
    });
  } catch (error) {
    console.error("Error creating solo game:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create solo game" });
  }
});

gameRouter.post("/party/create", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const user = await User.findOneBy({ id: userId });
    if (!user) return res.status(404).json({ error: "User not found" });

    const config: GameConfig = { roundsNumber: 3, time: 60, map: 'World' };
    const party = await GameService.createPrivateParty(user, config);

    res.json({
      partyId: party.id,
      code: party.code,
      admin: { id: user.id, name: user.name },
      players: [{ id: user.id, name: user.name }],
      type: party.type
    });
  } catch (error) {
    console.error("Error creating party:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create party" });
  }
});

// Rejoint une party avec un code
gameRouter.post("/party/join", async (req: AuthenticatedRequest, res) => {
  try {
    const { code } = req.body;
    const userId = req.user!.userId;

    if (!code) {
      return res.status(400).json({ error: "Party code is required" });
    }

    const user = await User.findOneBy({ id: userId });
    if (!user) return res.status(404).json({ error: "User not found" });

    const party = await GameService.joinParty(code, user);

    res.json({
      partyId: party.id,
      code: party.code,
      admin: { id: party.admin.id, name: party.admin.name },
      players: party.players.map(p => ({ id: p.id, name: p.name })),
      type: party.type,
      message: "Successfully joined party"
    });
  } catch (error) {
    console.error("Error joining party:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to join party" });
  }
});

// Démarre un jeu pour une party
gameRouter.post("/party/:partyId/start", async (req: AuthenticatedRequest, res) => {
  try {
    const { partyId } = req.params;
    const { roundsNumber = 3, time = 60, map = 'World', gamemode } = req.body;
    const userId = req.user!.userId;

    const config: GameConfig = { roundsNumber, time, map, gamemode };
    const game = await GameService.startPartyGame(parseInt(partyId), userId, config);

    res.json({
      gameId: game.id,
      partyId: game.party?.id,
      roundsNumber: game.rounds_number,
      time: game.time,
      map: game.map,
      status: game.status,
      players: game.players.map(p => ({ id: p.id, name: p.name }))
    });
  } catch (error) {
    console.error("Error starting party game:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to start party game" });
  }
});

// Récupère les informations d'une party
gameRouter.get("/party/:partyId", async (req: AuthenticatedRequest, res) => {
  try {
    const { partyId } = req.params;
    const userId = req.user!.userId;

    const party = await GameService.getPartyInfo(parseInt(partyId));
    if (!party) {
      return res.status(404).json({ error: "Party not found" });
    }

    // Vérifier que l'utilisateur fait partie de la party
    const isPlayerInParty = party.players.some(player => player.id === userId);
    if (!isPlayerInParty) {
      return res.status(403).json({ error: "Access denied: You are not part of this party" });
    }

    // Vérifier s'il y a un jeu actif
    const activeGame = await Game.findOne({
      where: { party: { id: parseInt(partyId) }, status: GameStatus.IN_PROGRESS }
    });

    res.json({
      id: party.id,
      code: party.code,
      admin: { id: party.admin.id, name: party.admin.name },
      players: party.players.map(p => ({ id: p.id, name: p.name })),
      type: party.type,
      activeGame: activeGame ? {
        id: activeGame.id,
        status: activeGame.status,
        map: activeGame.map,
        roundsNumber: activeGame.rounds_number
      } : null
    });
  } catch (error) {
    console.error("Error fetching party info:", error);
    res.status(500).json({ error: "Failed to fetch party information" });
  }
});

// Quitte une party
gameRouter.post("/party/:partyId/leave", async (req: AuthenticatedRequest, res) => {
  try {
    const { partyId } = req.params;
    const userId = req.user!.userId;

    await GameService.leaveParty(parseInt(partyId), userId);

    res.json({ message: "Successfully left the party" });
  } catch (error) {
    console.error("Error leaving party:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to leave party" });
  }
});

// Récupère les parties de l'utilisateur
gameRouter.get("/user/parties", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const parties = await GameService.getUserParties(userId);

    const formattedParties = parties.map(party => ({
      id: party.id,
      code: party.code,
      admin: { id: party.admin.id, name: party.admin.name },
      players: party.players.map(p => ({ id: p.id, name: p.name })),
      type: party.type,
      isAdmin: party.admin.id === userId
    }));

    res.json(formattedParties);
  } catch (error) {
    console.error("Error fetching user parties:", error);
    res.status(500).json({ error: "Failed to fetch user parties" });
  }
});

// ===== ROUTES GAME MANAGEMENT =====

// Récupère les informations d'un jeu
gameRouter.get("/game/:gameId", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;
    
    const game = await GameService.verifyUserInGame(parseInt(gameId), userId);
    if (!game) {
      return res.status(404).json({ error: "Game not found or access denied" });
    }

    res.json({
      id: game.id,
      status: game.status,
      gamemode: game.gamemode,
      map: game.map,
      roundsNumber: game.rounds_number,
      time: game.time,
      players: game.players.map(p => ({ id: p.id, name: p.name })),
      party: game.party ? {
        id: game.party.id,
        code: game.party.code,
        type: game.party.type
      } : null,
      winner: game.winner ? { id: game.winner.id, name: game.winner.name } : null
    });
  } catch (error) {
    console.error("Error fetching game:", error);
    res.status(500).json({ error: "Failed to fetch game" });
  }
});

// Récupère tous les rounds d'un jeu
gameRouter.get("/game/:gameId/rounds", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;
    
    const game = await GameService.verifyUserInGame(parseInt(gameId), userId);
    if (!game) {
      return res.status(404).json({ error: "Game not found or access denied" });
    }

    const rounds = await Round.find({
      where: { game: { id: parseInt(gameId) } },
      relations: ["wallpaper", "players"],
      order: { relative_id: "ASC" }
    });

    const formattedRounds = rounds.map(round => ({
      id: round.id,
      relative_id: round.relative_id,
      guesses: round.guesses,
      wallpaper: {
        id: round.wallpaper.id,
        title: round.wallpaper.title,
        image: round.wallpaper.img,
        copyright: round.wallpaper.copyright,
        country: round.wallpaper.country,
        state: round.wallpaper.state,
        tags: round.wallpaper.tags
      }
    }));

    res.json(formattedRounds);
  } catch (error) {
    console.error("Error fetching rounds:", error);
    res.status(500).json({ error: "Failed to fetch rounds" });
  }
});

// Récupère un round spécifique
gameRouter.get("/game/:gameId/round/:relativeId", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId, relativeId } = req.params;
    const userId = req.user!.userId;
    
    const game = await GameService.verifyUserInGame(parseInt(gameId), userId);
    if (!game) {
      return res.status(404).json({ error: "Game not found or access denied" });
    }

    const round = await Round.findOne({
      where: { 
        relative_id: parseInt(relativeId),
        game: { id: parseInt(gameId) }
      },
      relations: ["wallpaper", "players"]
    });

    if (!round) {
      return res.status(404).json({ error: "Round not found" });
    }

    // Formater pour le jeu (sans révéler la réponse pendant le jeu)
    const roundData = {
      id: round.id,
      relative_id: round.relative_id,
      guesses: round.guesses,
      wallpaper: {
        id: round.wallpaper.id,
        title: round.wallpaper.title,
        image: round.wallpaper.img,
        copyright: round.wallpaper.copyright
        // Ne pas révéler les coordonnées et la localisation pendant le jeu
      }
    };

    res.json(roundData);
  } catch (error) {
    console.error("Error fetching round:", error);
    res.status(500).json({ error: "Failed to fetch round" });
  }
});

// Soumet une réponse pour un round
gameRouter.post("/game/:gameId/round/:relativeId/guess", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId, relativeId } = req.params;
    const { country } = req.body;
    const userId = req.user!.userId;

    // Si country n'est pas fourni, on le traite comme une chaîne vide (mauvaise réponse)
    const userCountry = country || "";

    const game = await Game.findOne({
      where: { id: parseInt(gameId) },
      relations: ['players', 'party']
    });

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    const isMultiplayer = game.party && game.players.length > 1;

    if (isMultiplayer) {
      console.log(`[GameController] Multiplayer detected for game ${gameId}, using sync processing`);

      const result = await GameService.processGuessWithSync(
        parseInt(gameId),
        parseInt(relativeId),
        userId,
        userCountry
      );
      
      // AJOUT : Broadcaster via WebSocket quand le round se termine via HTTP
      if (result.roundComplete && game.party) {
        console.log(`[GameController] 🏁 Round completed via HTTP for party ${game.party.id}, broadcasting via WebSocket`);

        const webSocketService = req.app.locals.webSocketService;

        if (webSocketService) {
          // Broadcast à tous les joueurs que le round est terminé
          webSocketService.broadcastToParty(game.party.id, 'round_completed', {
            roundNumber: parseInt(relativeId),
            results: [],
            isLastRound: parseInt(relativeId) >= game.rounds_number,
            nextRoundAvailable: parseInt(relativeId) < game.rounds_number
          });

          // Broadcast le status du joueur qui vient de finir
          webSocketService.broadcastToParty(game.party.id, 'player_finished_round', {
            playerId: userId,
            playerName: game.players.find(p => p.id === userId)?.name || 'Unknown',
            finishedCount: result.totalPlayers - result.waitingPlayers,
            totalPlayers: result.totalPlayers,
            stillWaiting: 0
          });
        }
      }
      
      return res.json({
        roundId: result.roundId,
        relative_id: result.relative_id,
        guessNumber: result.guessNumber,
        isCorrect: result.isCorrect,
        score: result.score,
        correctLocation: result.correctLocation,
        userGuess: result.userGuess,
        roundComplete: result.roundComplete,
        waitingPlayers: result.waitingPlayers,
        totalPlayers: result.totalPlayers,
        isMultiplayer: true
      });
    } else {
      console.log(`[GameController] Solo game detected for game ${gameId}, using normal processing`);

      const result = await GameService.processGuess(
        parseInt(gameId),
        parseInt(relativeId),
        userId,
        userCountry
      );
      
      return res.json({
        ...result,
        isMultiplayer: false
      });
    }
  } catch (error) {
    console.error("Error processing guess:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to process guess" });
  }
});

// Termine un jeu
gameRouter.post("/game/:gameId/finish", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;

    const game = await GameService.finishGame(parseInt(gameId), userId);

    res.json({ 
      message: "Game finished successfully",
      gameId: game.id,
      status: game.status,
      winner: game.winner ? {
        id: game.winner.id,
        name: game.winner.name
      } : null
    });
  } catch (error) {
    console.error("Error finishing game:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to finish game" });
  }
});

// ===== ROUTES STATISTIQUES =====

// Récupère les jeux de l'utilisateur
gameRouter.get("/user/games", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    
    const games = await Game.find({
      where: {
        players: {
          id: userId
        }
      },
      relations: ["players", "party", "winner"],
      order: { id: "DESC" }
    });

    const formattedGames = games.map(game => ({
      id: game.id,
      status: game.status,
      gamemode: game.gamemode,
      map: game.map,
      roundsNumber: game.rounds_number,
      time: game.time,
      players: game.players.map(p => ({ id: p.id, name: p.name })),
      party: game.party ? {
        id: game.party.id,
        code: game.party.code,
        type: game.party.type
      } : null,
      winner: game.winner ? { id: game.winner.id, name: game.winner.name } : null,
      isSolo: game.party?.type === PartyType.SOLO
    }));

    res.json(formattedGames);
  } catch (error) {
    console.error("Error fetching user games:", error);
    res.status(500).json({ error: "Failed to fetch games" });
  }
});

gameRouter.get("/party/code/:partyCode", async (req: AuthenticatedRequest, res) => {
  try {
    const { partyCode } = req.params;
    const userId = req.user!.userId;

    const party = await Party.findOne({
      where: { code: partyCode.toUpperCase() },
      relations: ["admin", "players"]
    });

    if (!party) {
      return res.status(404).json({ error: "Party not found" });
    }

    // Vérifier que l'utilisateur fait partie de la party
    const isPlayerInParty = party.players.some(player => player.id === userId);
    if (!isPlayerInParty) {
      return res.status(403).json({ error: "Access denied: You are not part of this party" });
    }

    // Vérifier s'il y a un jeu actif
    const activeGame = await Game.findOne({
      where: { party: { id: party.id }, status: GameStatus.IN_PROGRESS }
    });

    res.json({
      id: party.id,
      code: party.code,
      admin: { id: party.admin.id, name: party.admin.name },
      players: party.players.map(p => ({ id: p.id, name: p.name })),
      type: party.type,
      status: party.status,
      activeGame: activeGame ? {
        id: activeGame.id,
        status: activeGame.status,
        map: activeGame.map,
        roundsNumber: activeGame.rounds_number
      } : null
    });
  } catch (error) {
    console.error("Error fetching party info:", error);
    res.status(500).json({ error: "Failed to fetch party information" });
  }
});

// Démarre un jeu pour une party par CODE
gameRouter.post("/party/code/:partyCode/start", async (req: AuthenticatedRequest, res) => {
  try {
    const { partyCode } = req.params;
    const { roundsNumber = 3, time = 60, map = 'World', gamemode } = req.body;
    const userId = req.user!.userId;

    const party = await Party.findOne({
      where: { code: partyCode.toUpperCase() },
      relations: ["players", "admin"]
    });

    if (!party) {
      return res.status(404).json({ error: "Party not found" });
    }

    const config: GameConfig = { roundsNumber, time, map, gamemode };
    const game = await GameService.startPartyGame(party.id, userId, config);

    res.json({
      gameId: game.id,
      partyId: game.party?.id,
      partyCode: party.code,
      roundsNumber: game.rounds_number,
      time: game.time,
      map: game.map,
      status: game.status,
      players: game.players.map(p => ({ id: p.id, name: p.name }))
    });
  } catch (error) {
    console.error("Error starting party game:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to start party game" });
  }
});

// Quitte une party par CODE
gameRouter.post("/party/code/:partyCode/leave", async (req: AuthenticatedRequest, res) => {
  try {
    const { partyCode } = req.params;
    const userId = req.user!.userId;

    const party = await Party.findOne({
      where: { code: partyCode.toUpperCase() },
      relations: ["players"]
    });

    if (!party) {
      return res.status(404).json({ error: "Party not found" });
    }

    await GameService.leaveParty(party.id, userId);

    res.json({ message: "Successfully left the party" });
  } catch (error) {
    console.error("Error leaving party:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to leave party" });
  }
});

// Route pour marquer un joueur comme prêt pour le round suivant
gameRouter.post("/game/:gameId/ready-next-round", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;

    const game = await GameService.verifyUserInGame(parseInt(gameId), userId);
    if (!game) {
      return res.status(404).json({ error: "Game not found or access denied" });
    }

    const syncResult = GameService.markPlayerReady(parseInt(gameId), userId);

    res.json({
      message: "Player marked as ready",
      allPlayersReady: syncResult.allPlayersReady,
      gameId: parseInt(gameId),
      userId
    });
  } catch (error) {
    console.error("Error marking player as ready:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to mark player as ready" });
  }
});

// Route pour obtenir l'état de synchronisation d'une partie
gameRouter.get("/game/:gameId/sync-state", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;

    const game = await GameService.verifyUserInGame(parseInt(gameId), userId);
    if (!game) {
      return res.status(404).json({ error: "Game not found or access denied" });
    }

    const syncState = GameService.getGameSync(parseInt(gameId));
    
    if (!syncState) {
      return res.json({
        isSynchronized: false,
        message: "This game is not synchronized (solo game)"
      });
    }

    res.json({
      isSynchronized: true,
      gameId: syncState.gameId,
      currentRound: syncState.currentRound,
      playersFinished: syncState.playersWhoFinished.size,
      allPlayersFinished: syncState.allPlayersFinished,
      playersReady: syncState.playersReady.size,
      totalPlayers: game.players.length
    });
  } catch (error) {
    console.error("Error getting sync state:", error);
    res.status(500).json({ error: "Failed to get sync state" });
  }
});

// Route pour obtenir les résultats du round
gameRouter.get("/game/:gameId/round/:relativeId/results", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId, relativeId } = req.params;
    const userId = req.user!.userId;

    const game = await GameService.verifyUserInGame(parseInt(gameId), userId);
    if (!game) {
      return res.status(404).json({ error: "Game not found or access denied" });
    }

    const roundResults = GameService.getRoundResults(parseInt(gameId));
    
    if (roundResults.size === 0) {
      return res.status(404).json({ error: "Round results not available yet" });
    }

    const formattedResults = Array.from(roundResults.entries()).map(([playerId, result]) => {
      const player = game.players.find(p => p.id === playerId);
      return {
        playerId,
        playerName: player?.name || 'Unknown',
        result: {
          ...result,
          // Masquer certaines informations sensibles si nécessaire
        }
      };
    });

    res.json({
      roundId: parseInt(relativeId),
      results: formattedResults,
      totalPlayers: game.players.length
    });
  } catch (error) {
    console.error("Error getting round results:", error);
    res.status(500).json({ error: "Failed to get round results" });
  }
});

// Route modifiée pour terminer une partie avec vérification
gameRouter.post("/game/:gameId/finish-sync", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;

    const game = await GameService.verifyUserInGame(parseInt(gameId), userId);
    if (!game) {
      return res.status(404).json({ error: "Game not found or access denied" });
    }

    // Vérifier si c'est une partie multijoueur
    if (game.party && game.players.length > 1) {
      // Utiliser la méthode synchronisée
      const finishResult = await GameService.finishGameIfAllPlayersReady(parseInt(gameId));
      
      if (finishResult.canFinish) {
        res.json({
          message: "Game finished successfully",
          gameId: finishResult.game!.id,
          status: finishResult.game!.status,
          winner: finishResult.game!.winner ? {
            id: finishResult.game!.winner.id,
            name: finishResult.game!.winner.name
          } : null,
          allPlayersFinished: true
        });
      } else {
        res.json({
          message: "Waiting for other players to finish",
          gameId: parseInt(gameId),
          status: "waiting",
          allPlayersFinished: false,
          playersStillPlaying: finishResult.playersStillPlaying
        });
      }
    } else {
      // Partie solo, utiliser la méthode classique
      const finishedGame = await GameService.finishGame(parseInt(gameId), userId);
      res.json({
        message: "Game finished successfully",
        gameId: finishedGame.id,
        status: finishedGame.status,
        winner: finishedGame.winner ? {
          id: finishedGame.winner.id,
          name: finishedGame.winner.name
        } : null,
        allPlayersFinished: true
      });
    }
  } catch (error) {
    console.error("Error finishing game:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to finish game" });
  }
});

// Route pour vérifier si tous les joueurs ont terminé
gameRouter.get("/game/:gameId/all-players-finished", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;

    const game = await GameService.verifyUserInGame(parseInt(gameId), userId);
    if (!game) {
      return res.status(404).json({ error: "Game not found or access denied" });
    }

    const allPlayersFinished = await GameService.checkAllPlayersFinishedGame(parseInt(gameId));
    
    res.json({
      gameId: parseInt(gameId),
      allPlayersFinished,
      totalPlayers: game.players.length
    });
  } catch (error) {
    console.error("Error checking if all players finished:", error);
    res.status(500).json({ error: "Failed to check game completion status" });
  }
});

// Route pour obtenir le statut d'attente d'une partie
gameRouter.get("/game/:gameId/waiting-status", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;

    const game = await GameService.verifyUserInGame(parseInt(gameId), userId);
    if (!game) {
      return res.status(404).json({ error: "Game not found or access denied" });
    }

    // Obtenir le nombre de joueurs qui ont terminé chaque round
    const totalRounds = game.rounds_number;
    const playerStatuses = await Promise.all(
      game.players.map(async (player) => {
        const completedRounds = await Guess.count({
          where: {
            game: { id: parseInt(gameId) },
            user: { id: player.id }
          }
        });
        
        return {
          playerId: player.id,
          playerName: player.name,
          completedRounds,
          hasFinished: completedRounds === totalRounds
        };
      })
    );

    const playersStillPlaying = playerStatuses.filter(p => !p.hasFinished).length;
    const allPlayersFinished = playersStillPlaying === 0;

    res.json({
      gameId: parseInt(gameId),
      totalPlayers: game.players.length,
      playersStillPlaying,
      allPlayersFinished,
      playerStatuses,
      totalRounds
    });
  } catch (error) {
    console.error("Error getting waiting status:", error);
    res.status(500).json({ error: "Failed to get waiting status" });
  }
});