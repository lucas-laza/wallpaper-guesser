import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

interface CountryAutocompleteProps {
  onSelect: (country: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

// Liste des pays les plus communs (vous pouvez l'étendre ou la charger depuis l'API)
const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahrain', 'Bangladesh', 'Belarus', 'Belgium', 'Bolivia', 'Bosnia and Herzegovina', 'Brazil', 'Bulgaria',
  'Cambodia', 'Canada', 'Chile', 'China', 'Colombia', 'Croatia', 'Czech Republic',
  'Denmark', 'Dominican Republic', 'Ecuador', 'Egypt', 'Estonia', 'Ethiopia',
  'Finland', 'France', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Guatemala',
  'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
  'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Kyrgyzstan',
  'Latvia', 'Lebanon', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malaysia', 'Mexico', 'Morocco',
  'Netherlands', 'New Zealand', 'Nigeria', 'North Korea', 'Norway',
  'Pakistan', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar', 'Romania', 'Russia', 'Saudi Arabia', 'Serbia', 'Singapore', 'Slovakia', 'Slovenia',
  'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sweden', 'Switzerland', 'Syria',
  'Taiwan', 'Thailand', 'Tunisia', 'Turkey', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Venezuela', 'Vietnam', 'Yemen', 'Zimbabwe'
].sort();

const CountryAutocomplete: React.FC<CountryAutocompleteProps> = ({
  onSelect,
  disabled = false,
  placeholder = "Type a country name...",
  className = ""
}) => {
  const [inputValue, setInputValue] = useState('');
  const [filteredCountries, setFilteredCountries] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inputValue.length > 0) {
      const filtered = COUNTRIES.filter(country =>
        country.toLowerCase().includes(inputValue.toLowerCase())
      ).slice(0, 10); // Limiter à 10 résultats
      setFilteredCountries(filtered);
      setIsOpen(filtered.length > 0);
      setSelectedIndex(-1);
    } else {
      setFilteredCountries([]);
      setIsOpen(false);
    }
  }, [inputValue]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < filteredCountries.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          selectCountry(filteredCountries[selectedIndex]);
        } else if (filteredCountries.length === 1) {
          selectCountry(filteredCountries[0]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const selectCountry = (country: string) => {
    setInputValue(country);
    setIsOpen(false);
    setSelectedIndex(-1);
    onSelect(country);
  };

  const clearInput = () => {
    setInputValue('');
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/60" size={18} />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:border-orange-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {inputValue && (
          <button
            onClick={clearInput}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/60 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {isOpen && filteredCountries.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg overflow-hidden z-50 max-h-60 overflow-y-auto">
          {filteredCountries.map((country, index) => (
            <button
              key={country}
              onClick={() => selectCountry(country)}
              className={`w-full p-3 text-left text-white hover:bg-white/20 transition-colors duration-200 ${
                index === selectedIndex ? 'bg-white/20' : ''
              }`}
            >
              {country}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CountryAutocomplete;