import { useState, useCallback } from 'react';

interface RankStarsProps {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  readOnly?: boolean;
}

/**
 * RankStars -- 1-5 star rating display/editor.
 * Hover previews the rating, click sets it.
 * Clicking the same star resets to 0.
 */
export default function RankStars({
  value,
  onChange,
  size = 16,
  readOnly = false,
}: RankStarsProps) {
  const [hovered, setHovered] = useState(0);

  const handleClick = useCallback(
    (star: number) => {
      if (readOnly || !onChange) return;
      // Clicking the same star resets to 0
      onChange(star === value ? 0 : star);
    },
    [readOnly, onChange, value],
  );

  const handleMouseEnter = useCallback(
    (star: number) => {
      if (!readOnly) setHovered(star);
    },
    [readOnly],
  );

  const handleMouseLeave = useCallback(() => {
    setHovered(0);
  }, []);

  const display = hovered || value;

  return (
    <span
      style={{ display: 'inline-flex', gap: 2 }}
      onMouseLeave={handleMouseLeave}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          role="button"
          aria-label={`${star}星`}
          tabIndex={readOnly ? -1 : 0}
          style={{
            fontSize: size,
            lineHeight: 1,
            cursor: readOnly ? 'default' : 'pointer',
            color: star <= display ? 'var(--star-color)' : 'var(--text-dim)',
            transition: 'color 0.15s',
          }}
          onClick={() => handleClick(star)}
          onMouseEnter={() => handleMouseEnter(star)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleClick(star);
            }
          }}
        >
          ★
        </span>
      ))}
    </span>
  );
}
