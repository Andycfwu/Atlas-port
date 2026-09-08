import type { ApiClient } from '../../services/api';
import type { AtlasRequest, AtlasResponse } from './atlas.types';

export interface AtlasService {
  sendMessage(request: AtlasRequest): Promise<AtlasResponse>;
}

/**
 * Creates the mobile-facing Atlas service. It is intentionally not used by the
 * local chat shell. Wire an authenticated API client here when the backend is
 * available; local persistence and audio providers do not depend on this service.
 */
export const createAtlasService = (apiClient: ApiClient): AtlasService => ({
  sendMessage: (request) =>
    apiClient.request<AtlasResponse, AtlasRequest>('/v1/atlas/messages', {
      method: 'POST',
      body: request,
    }),
});
