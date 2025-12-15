import { Request, Response, NextFunction } from 'express';

// Error handling middleware
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  console.error(`[${new Date().toISOString()}] Error ${status}: ${message}`);
  console.error(err.stack);

  res.status(status).json({ message });
}