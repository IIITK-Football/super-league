import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './AutocompleteInput.css';

export function AutocompleteInput({ value, onChange, onSelect, placeholder, positionFilter = '' }) {
  const [inputValue, setInputValue] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const wrapperRef = useRef(null);

  // Sync external value
  useEffect(() => {
    if (value !== undefined) {
      setInputValue(value);
    }
  }, [value]);

  // Handle clicking outside to close
  useEffect(() => {
    const handleClickOutside = (event) => {
      // If clicking outside the input AND the portal dropdown, close it.
      // We'll attach a specific class to the portal dropdown to identify it.
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        if (!event.target.closest('.portal-autocomplete-dropdown')) {
          setShowDropdown(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update portal position
  useEffect(() => {
    if (showDropdown && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 99999,
      });
    }
  }, [showDropdown, suggestions, isSearching]);

  // Handle scroll/resize to update or close portal
  useEffect(() => {
    const handleScrollOrResize = () => {
      if (showDropdown && wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        setDropdownStyle({
          position: 'fixed',
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          zIndex: 99999,
        });
      }
    };
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [showDropdown]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!inputValue || inputValue.length < 2 || !showDropdown) {
        setSuggestions([]);
        return;
      }

      setIsSearching(true);
      try {
        let url = `${import.meta.env.VITE_API_URL}/wc/players?q=${encodeURIComponent(inputValue)}`;
        if (positionFilter) {
          url += `&position=${encodeURIComponent(positionFilter)}`;
        }

        const res = await fetch(url);
        const json = await res.json();
        
        if (json.success && json.data) {
          setSuggestions(json.data);
        } else {
          setSuggestions([]);
        }
      } catch (err) {
        console.error('Failed to fetch player suggestions:', err);
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [inputValue, positionFilter, showDropdown]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    setShowDropdown(true);
    if (onChange) onChange(val);
  };

  const handleSelect = (player) => {
    const selectedName = player.name || `${player.first_name || ''} ${player.last_name || ''}`.trim();
    setInputValue(selectedName);
    setShowDropdown(false);
    if (onChange) onChange(selectedName);
    if (onSelect) onSelect(player);
  };

  return (
    <div className="autocomplete-wrapper" ref={wrapperRef}>
      <input
        type="text"
        className="team-card award-input-override"
        style={{ width: '100%', boxSizing: 'border-box' }}
        placeholder={placeholder}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => setShowDropdown(true)}
      />
      
      {showDropdown && (inputValue.length >= 2) && createPortal(
        <div className="autocomplete-dropdown portal-autocomplete-dropdown" style={dropdownStyle}>
          {isSearching ? (
            <div className="autocomplete-item loading">Searching...</div>
          ) : suggestions.length > 0 ? (
            suggestions.map((player) => {
              const displayName = player.name || `${player.first_name || ''} ${player.last_name || ''}`.trim();
              return (
                <div 
                  key={player.id} 
                  className="autocomplete-item"
                  onClick={() => handleSelect(player)}
                >
                  <div className="player-details">
                    <span className="player-name">{displayName}</span>
                    {player.position && positionFilter !== 'GK' && <span className="player-pos">{player.position}</span>}
                  </div>
                  {(player.country || player.team || player.teams?.name || player.wc_teams?.name) && (
                    <span className="player-country">{player.country || player.team || player.teams?.name || player.wc_teams?.name}</span>
                  )}
                </div>
              );
            })
          ) : (
            <div className="autocomplete-item empty">No players found</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
