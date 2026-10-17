import { useEffect, useState } from 'react';
import { FAVOURITES_CHANGED, FAVOURITES_KEY, readFavourites, toggleFavourite, type FavouriteTeam } from '../lib/favourites';

export function useFavourites() {
  const [favourites, setFavourites] = useState(readFavourites);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setFavourites(readFavourites());
    const storage = (event: StorageEvent) => { if (event.key === FAVOURITES_KEY || event.key === null) refresh(); };
    window.addEventListener(FAVOURITES_CHANGED, refresh);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(FAVOURITES_CHANGED, refresh);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return { favourites, error, toggle: (item: FavouriteTeam) => setError(toggleFavourite(item)) };
}
