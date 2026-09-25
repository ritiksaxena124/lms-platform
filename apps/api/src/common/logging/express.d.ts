import 'express';

declare module 'express' {
  interface Request {
    /** Set once per request by the request-context middleware; echoed on every response. */
    requestId?: string;
  }
}

export {};
