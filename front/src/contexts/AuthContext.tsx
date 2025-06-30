// contexts/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, getToken, getUser, loginUser, registerUser, logoutUser, setupApiInterceptor } from '../services/api';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (userData: { name: string; email: string; password: string; repassword: string }) => Promise<void>;
  logout: () => void;
  forceLogout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Utiliser useCallback pour stabiliser la fonction
  const forceLogout = useCallback(() => {
    logoutUser();
    setUser(null);
    console.log('Session expirée. Vous avez été déconnecté automatiquement.');
  }, []);

  useEffect(() => {
    // Configurer l'intercepteur API avec la fonction de déconnexion
    setupApiInterceptor(forceLogout);

    // Vérifier si l'utilisateur est déjà connecté au démarrage de l'app
    const token = getToken();
    const savedUser = getUser();
    
    if (token && savedUser) {
      // Simplement reconnecter l'utilisateur, le back vérifiera la validité du token
      setUser(savedUser);
    }
    
    setIsLoading(false);
  }, [forceLogout]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const response = await loginUser({ email, password });
      setUser(response.user);
    } catch (error) {
      throw error;
    }
  }, []);

  const register = useCallback(async (userData: { name: string; email: string; password: string; repassword: string }) => {
    try {
      await registerUser(userData);
    } catch (error) {
      throw error;
    }
  }, []);

  const logout = useCallback(() => {
    logoutUser();
    setUser(null);
  }, []);

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
    forceLogout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook exporté séparément pour éviter les problèmes de Fast Refresh
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}