import express from 'express';
import http from 'http';

export interface ReceivedRequest {
  body: any;
  headers: Record<string, string>;
  query: Record<string, string>;
  timestamp: number;
}

export interface MockReceiver {
  readonly port: number;
  readonly url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getReceived(): ReceivedRequest[];
  clearReceived(): void;
  waitForRequests(count: number, timeoutMs?: number): Promise<ReceivedRequest[]>;
}

export function createMockReceiver(port: number): MockReceiver {
  const received: ReceivedRequest[] = [];
  let server: http.Server | null = null;

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.post('*', (req, res) => {
    received.push({
      body: req.body,
      headers: req.headers as Record<string, string>,
      query: req.query as Record<string, string>,
      timestamp: Date.now(),
    });
    res.status(200).json({ code: 0, message: 'received' });
  });

  app.get('/received', (_req, res) => {
    res.json(received);
  });

  app.delete('/received', (_req, res) => {
    received.length = 0;
    res.json({ message: 'cleared' });
  });

  return {
    port,
    get url() {
      return `http://localhost:${port}`;
    },

    start() {
      return new Promise<void>((resolve, reject) => {
        server = app.listen(port, () => resolve());
        server.on('error', reject);
      });
    },

    stop() {
      return new Promise<void>((resolve) => {
        if (server) {
          server.close(() => resolve());
          server = null;
        } else {
          resolve();
        }
      });
    },

    getReceived() {
      return [...received];
    },

    clearReceived() {
      received.length = 0;
    },

    async waitForRequests(count: number, timeoutMs = 5000): Promise<ReceivedRequest[]> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (received.length >= count) {
          return [...received];
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return [...received];
    },
  };
}
