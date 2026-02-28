import axios, { AxiosRequestConfig } from 'axios';

export interface HttpPostOptions {
  url: string;
  data: any;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}

export interface HttpPostResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  duration: number;
  retryCount: number;
}

export async function httpPostWithRetry(options: HttpPostOptions): Promise<HttpPostResult> {
  const {
    url,
    data,
    headers = {},
    params,
    timeout = 10000,
    retryCount = 3,
    retryDelay = 1000,
  } = options;

  let lastError = '';
  let attempts = 0;
  const totalStart = Date.now();

  for (let i = 0; i <= retryCount; i++) {
    attempts = i;

    const config: AxiosRequestConfig = {
      url,
      method: 'POST',
      data,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      params,
      timeout,
    };

    const response = await axios(config).catch((err) => {
      lastError = err.message || 'Unknown error';
      return null;
    });

    if (response && response.status >= 200 && response.status < 300) {
      return {
        success: true,
        statusCode: response.status,
        duration: Date.now() - totalStart,
        retryCount: attempts,
      };
    }

    if (response) {
      lastError = `HTTP ${response.status}: ${response.statusText}`;
    }

    if (i < retryCount) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay * (i + 1)));
    }
  }

  return {
    success: false,
    error: lastError,
    duration: Date.now() - totalStart,
    retryCount: attempts,
  };
}
