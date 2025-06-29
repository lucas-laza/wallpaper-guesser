// contexts/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, getToken, getUser, loginUser, registerUser, logoutUser } from '../services/api';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (userData: { name: string; email: string; password: string; repassword: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is already logged in on app start
    const token = getToken();
    const savedUser = getUser();
    
    if (token && savedUser) {
      setUser(savedUser);
    }
    
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const response = await loginUser({ email, password });
      setUser(response.user);
    } catch (error) {
      throw error;
    }
  };

  const register = async (userData: { name: string; email: string; password: string; repassword: string }) => {
    try {
      await registerUser(userData);
    } catch (error) {
      throw error;
    }
  };

  const logout = () => {
    logoutUser();
    setUser(null);
  };

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};