/**
 * Natural Language Tag Parser for Sofa Images
 * Parses freeform text into structured facet tags
 */

(function() {
  'use strict';

  let facetsData = null;

  /**
   * Load facets data from JSON file
   */
  async function loadFacetsData() {
    if (facetsData) return facetsData;
    
    try {
      const response = await fetch('/js/facets.json');
      facetsData = await response.json();
      return facetsData;
    } catch (error) {
      console.error('[NL Parser] Failed to load facets.json:', error);
      return null;
    }
  }

  /**
   * Normalize text for matching (lowercase, trim, remove extra spaces)
   */
  function normalizeText(text) {
    return text.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Tokenize input text into words and phrases
   */
  function tokenize(text) {
    const normalized = normalizeText(text);
    // Split on spaces, but keep multi-word phrases together
    const tokens = normalized.split(/\s+/);
    // Also create 2-word and 3-word combinations for phrase matching
    const phrases = [];
    for (let i = 0; i < tokens.length; i++) {
      phrases.push(tokens[i]);
      if (i < tokens.length - 1) {
        phrases.push(tokens[i] + ' ' + tokens[i + 1]);
      }
      if (i < tokens.length - 2) {
        phrases.push(tokens[i] + ' ' + tokens[i + 1] + ' ' + tokens[i + 2]);
      }
    }
    return { tokens, phrases, fullText: normalized };
  }

  /**
   * Match tokens against synonyms and extract facets
   */
  function extractFacets(tokens, phrases, fullText, facetsConfig) {
    const result = {
      viewpoint: null,
      facets: {
        category: null,
        arms: null,
        armStyle: null,
        back: null,
        cushions: { seat: null, back: null },
        seats: null,
        orientation: null,
        extras: []
      },
      freeform: []
    };

    // Extract numbers for seats/arms
    const numbers = fullText.match(/\b(\d+)\b/g);
    
    // Check each facet category
    if (facetsConfig.facets) {
      for (const [facetKey, facetConfig] of Object.entries(facetsConfig.facets)) {
        if (!facetConfig || !facetConfig.synonyms) continue;
        
        if (facetKey === 'cushions') {
          // Handle nested cushions
          if (facetConfig.seat && facetConfig.seat.synonyms) {
            for (const [option, synonyms] of Object.entries(facetConfig.seat.synonyms)) {
              if (!Array.isArray(synonyms)) continue;
              for (const synonym of synonyms) {
                const pattern = new RegExp(`\\b${synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                if (pattern.test(fullText)) {
                  result.facets.cushions.seat = option;
                  break;
                }
              }
              if (result.facets.cushions.seat) break;
            }
          }
          if (facetConfig.back && facetConfig.back.synonyms) {
            for (const [option, synonyms] of Object.entries(facetConfig.back.synonyms)) {
              if (!Array.isArray(synonyms)) continue;
              for (const synonym of synonyms) {
                const pattern = new RegExp(`\\b${synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                if (pattern.test(fullText)) {
                  result.facets.cushions.back = option;
                  break;
                }
              }
              if (result.facets.cushions.back) break;
            }
          }
        } else {
          // Regular facets
          if (facetConfig.synonyms) {
            for (const [option, synonyms] of Object.entries(facetConfig.synonyms)) {
              if (!Array.isArray(synonyms)) continue;
              for (const synonym of synonyms) {
                const pattern = new RegExp(`\\b${synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                if (pattern.test(fullText)) {
                  if (facetKey === 'viewpoint') {
                    result.viewpoint = option;
                  } else {
                    result.facets[facetKey] = option;
                  }
                  break;
                }
              }
              if ((facetKey === 'viewpoint' && result.viewpoint) || result.facets[facetKey]) break;
            }
          }
        }
      }
    }

    // Extract numbers for seats/arms if not already set
    if (numbers) {
      const num = parseInt(numbers[0]);
      if (!result.facets.seats && (num >= 1 && num <= 4)) {
        result.facets.seats = num === 4 ? '4+' : num.toString();
      }
      if (!result.facets.arms && num === 1) {
        // Try to determine left/right from context
        const leftMatch = /\b(left|L)\b/i.test(fullText);
        const rightMatch = /\b(right|R)\b/i.test(fullText);
        if (leftMatch) {
          result.facets.arms = '1-arm-left';
        } else if (rightMatch) {
          result.facets.arms = '1-arm-right';
        } else {
          result.facets.arms = '2-arms'; // Default to 2 if ambiguous
        }
      }
      if (!result.facets.arms && num === 2) {
        result.facets.arms = '2-arms';
      }
    }

    // Apply pattern-based extractions
    if (facetsConfig.patterns) {
      for (const patternRule of facetsConfig.patterns) {
        const regex = new RegExp(patternRule.pattern, 'i');
        const match = fullText.match(regex);
        if (match) {
          for (const [key, value] of Object.entries(patternRule.extract)) {
            let finalValue = value;
            // Replace $1, $2, etc. with match groups
            for (let i = 1; i < match.length; i++) {
              finalValue = finalValue.replace(`$${i}`, match[i]);
            }
            if (key.includes('.')) {
              const [parent, child] = key.split('.');
              if (parent === 'cushions') {
                result.facets.cushions[child] = finalValue;
              }
            } else if (key === 'viewpoint') {
              result.viewpoint = finalValue;
            } else {
              result.facets[key] = finalValue;
            }
          }
        }
      }
    }

    // Collect unmatched tokens as freeform
    const matchedTerms = new Set();
    for (const [facetKey, facetConfig] of Object.entries(facetsConfig.facets)) {
      if (facetKey === 'cushions') continue;
      if (facetConfig && facetConfig.synonyms) {
        for (const synonyms of Object.values(facetConfig.synonyms)) {
          if (Array.isArray(synonyms)) {
            synonyms.forEach(s => matchedTerms.add(s.toLowerCase()));
          }
        }
      }
    }
    
    // Ensure extras array exists
    if (!result.facets.extras) {
      result.facets.extras = [];
    }
    
    if (tokens && tokens.tokens && Array.isArray(tokens.tokens)) {
      tokens.tokens.forEach(token => {
        if (!matchedTerms.has(token) && token.length > 2) {
          result.freeform.push(token);
        }
      });
    }

    return result;
  }

  /**
   * Parse natural language input into structured tags
   */
  async function parseTags(inputText) {
    if (!inputText || !inputText.trim()) {
      return {
        viewpoint: null,
        facets: {
          category: null,
          arms: null,
          armStyle: null,
          back: null,
          cushions: { seat: null, back: null },
          seats: null,
          orientation: null,
          extras: []
        },
        freeform: []
      };
    }

    const facetsConfig = await loadFacetsData();
    if (!facetsConfig) {
      console.warn('[NL Parser] No facets config available');
      return null;
    }

    const { tokens, phrases, fullText } = tokenize(inputText);
    const result = extractFacets(tokens, phrases, fullText, facetsConfig);

    // Fallback: if no viewpoint found, try to infer from filename or use 'front'
    if (!result.viewpoint && window.currentImageLabel) {
      const label = window.currentImageLabel.toLowerCase();
      if (label.includes('front')) result.viewpoint = 'front';
      else if (label.includes('side')) result.viewpoint = 'side-arm';
      else if (label.includes('back')) result.viewpoint = 'back';
      else if (label.includes('top')) result.viewpoint = 'top';
      else result.viewpoint = 'front'; // Default fallback
    }

    return result;
  }

  /**
   * Generate display chips from parsed facets
   */
  function generateChips(parsedResult) {
    const chips = [];
    
    if (parsedResult.viewpoint) {
      chips.push({ type: 'viewpoint', label: parsedResult.viewpoint, value: parsedResult.viewpoint });
    }
    
    if (parsedResult.facets.category) {
      chips.push({ type: 'category', label: parsedResult.facets.category, value: parsedResult.facets.category });
    }
    
    if (parsedResult.facets.arms) {
      chips.push({ type: 'arms', label: parsedResult.facets.arms, value: parsedResult.facets.arms });
    }
    
    if (parsedResult.facets.armStyle) {
      chips.push({ type: 'armStyle', label: parsedResult.facets.armStyle, value: parsedResult.facets.armStyle });
    }
    
    if (parsedResult.facets.back) {
      chips.push({ type: 'back', label: parsedResult.facets.back, value: parsedResult.facets.back });
    }
    
    if (parsedResult.facets.cushions.seat) {
      chips.push({ type: 'cushion-seat', label: `Seat: ${parsedResult.facets.cushions.seat}`, value: parsedResult.facets.cushions.seat });
    }
    
    if (parsedResult.facets.cushions.back) {
      chips.push({ type: 'cushion-back', label: `Back: ${parsedResult.facets.cushions.back}`, value: parsedResult.facets.cushions.back });
    }
    
    if (parsedResult.facets.seats) {
      chips.push({ type: 'seats', label: `${parsedResult.facets.seats} seats`, value: parsedResult.facets.seats });
    }
    
    if (parsedResult.facets.orientation) {
      chips.push({ type: 'orientation', label: parsedResult.facets.orientation, value: parsedResult.facets.orientation });
    }
    
    if (parsedResult.facets.extras && Array.isArray(parsedResult.facets.extras)) {
      parsedResult.facets.extras.forEach((extra, idx) => {
        chips.push({ type: 'extra', label: extra, value: extra, index: idx });
      });
    }

    return chips;
  }

  // Export to window
  window.nlTagParser = {
    parseTags,
    generateChips,
    loadFacetsData
  };

  console.log('[NL Parser] Natural language tag parser loaded');
})();

