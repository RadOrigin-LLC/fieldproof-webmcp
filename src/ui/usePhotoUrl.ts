import { useEffect, useState } from 'react';
import { getPhotoBytes } from '../data/repo.ts';

export function usePhotoUrl(photoId: string): string {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setUrl('');
    void getPhotoBytes(photoId).then((blob) => {
      if (!blob) return;
      objectUrl = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = '';
        return;
      }
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  return url;
}
