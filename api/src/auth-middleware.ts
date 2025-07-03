import express from "express";
import { User } from "./User";

// Interface pour étendre Request avec les données utilisateur
export interface AuthenticatedRequest extends express.Request {
  user?: {
    userId: number;
    email: string;
    name: string;
    role: string;
  };
}

// Middleware d'authentification réutilisable
export const authenticateToken = async (
  req: AuthenticatedRequest, 
  res: express.Response, 
  next: express.NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        error: "Access token required" 
      });
    }

    // Décoder le token et récupérer les informations utilisateur
    const decodedUser = User.getUserFromToken(token);
    
    if (!decodedUser) {
      return res.status(401).json({ 
        error: "Invalid or expired token" 
      });
    }

    // Ajouter les informations utilisateur à la requête
    req.user = decodedUser;
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(401).json({ 
      error: "Authentication failed" 
    });
  }
};