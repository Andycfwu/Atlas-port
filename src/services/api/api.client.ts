import { fetch } from 'expo/fetch';

import type { ApiClient, ApiClientOptions, ApiRequestOptions } from './api.types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const parseResponse = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();

  if (!text) {
    return undefined;
  }

  const contentType = response.headers.get('content-type');

  if (contentType?.includes('application/json')) {
    return JSON.parse(text) as unknown;
  }

  return text;
};

export const createApiClient = ({ baseUrl }: ApiClientOptions): ApiClient => {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');

  if (!normalizedBaseUrl) {
    throw new Error('A RealTorch API base URL is required to create the API client.');
  }

  return {
    async request<TResponse, TBody = never>(
      path: string,
      options: ApiRequestOptions<TBody> = {},
    ): Promise<TResponse> {
      const hasBody = options.body !== undefined;
      const bodyEncoding = options.bodyEncoding ?? 'json';
      const requestOptions: RequestInit = {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(hasBody && bodyEncoding === 'json'
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...options.headers,
        },
        ...(hasBody
          ? {
              body:
                bodyEncoding === 'form-data'
                  ? (options.body as BodyInit)
                  : JSON.stringify(options.body),
            }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      };
      const response = await fetch(
        `${normalizedBaseUrl}/${path.replace(/^\/+/, '')}`,
        requestOptions,
      );
      const payload = await parseResponse(response);

      if (!response.ok) {
        throw new ApiError('The RealTorch API request failed.', response.status, payload);
      }

      return payload as TResponse;
    },
  };
};
