import React, { createContext, useContext, useState, ReactNode } from 'react';

interface Theme {
  id: string;
  name: string;
  background: string;
  accent: string;
  description: string;
  subtitle: string;
}

interface ThemeContextType {
  currentTheme: Theme;
  setCurrentTheme: (theme: Theme) => void;
  themes: Theme[];
}

const defaultTheme: Theme = {
  id: 'desert',
  name: 'Desert Oasis',
  background: 'https://images.pexels.com/photos/2259917/pexels-photo-2259917.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop',
  accent: '#FF9D00',
  description: 'Explore the golden dunes and hidden oases of the world\'s most beautiful desert landscapes.',
  subtitle: 'From Sahara to Atacama'
};

export const themes: Theme[] = [
  {
    id: 'desert',
    name: 'Desert Oasis',
    background: 'https://images.pexels.com/photos/2259917/pexels-photo-2259917.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop',
    accent: '#FF9D00',
    description: 'Explore the golden dunes and hidden oases of the world\'s most beautiful desert landscapes.',
    subtitle: 'From Sahara to Atacama'
  },
  {
    id: 'plains',
    name: 'Rolling Plains',
    background: 'https://images.pexels.com/photos/1054218/pexels-photo-1054218.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop',
    accent: '#10B981',
    description: 'Journey through emerald hills and endless grasslands where nature paints in shades of green.',
    subtitle: 'From Ireland to New Zealand'
  },
  {
    id: 'coastal',
    name: 'Coastal Cliffs',
    background: 'https://images.pexels.com/photos/1535162/pexels-photo-1535162.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop',
    accent: '#0EA5E9',
    description: 'Discover dramatic coastlines where ancient cliffs meet the endless expanse of the ocean.',
    subtitle: 'Where land meets sea'
  },
  {
    id: 'jungle',
    name: 'Tropical Jungle',
    background: 'https://images.pexels.com/photos/1437819/pexels-photo-1437819.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop',
    accent: '#059669',
    description: 'Venture into lush rainforests where biodiversity thrives in every corner of green paradise.',
    subtitle: 'Into the wild'
  }
];

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState<Theme>(defaultTheme);

  const value = {
    currentTheme,
    setCurrentTheme,
    themes,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};