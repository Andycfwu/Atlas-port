export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions<TBody = never> {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: TBody;
  bodyEncoding?: 'form-data' | 'json';
  signal?: AbortSignal;
}

export interface ApiClient {
  request<TResponse, TBody = never>(
    path: string,
    options?: ApiRequestOptions<TBody>,
  ): Promise<TResponse>;
}

export interface ApiClientOptions {
  baseUrl: string;
}
