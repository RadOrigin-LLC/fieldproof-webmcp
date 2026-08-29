import {
  createDailyLogIfAbsent,
  getPhoto,
  getPhotoBytes,
  getPunchItem,
  readCloseoutSnapshot,
  savePunchItem,
} from './repo.ts';
import { createCloseoutService } from './closeoutService.ts';
import { getCloseoutSessionStore } from './closeoutSession.ts';

export const closeoutSessions = getCloseoutSessionStore();

export const closeoutService = createCloseoutService({
  repository: {
    readCloseoutSnapshot,
    getPhotoBytes,
    getPunchItem,
    getPhoto,
    savePunchItem,
    createDailyLogIfAbsent,
  },
  sessions: closeoutSessions,
});
