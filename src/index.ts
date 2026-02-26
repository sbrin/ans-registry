import express, { Request, Response } from 'express';
import cors from 'cors';
import { initDatabase } from './database';
import { initCA, getCAFingerprint } from './ca';
import routes from './routes';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    service: 'ANS Registry',
    caFingerprint: getCAFingerprint(),
    timestamp: new Date().toISOString()
  });
});

// Registry metadata
app.get('/.well-known/ans-registry.json', (req: Request, res: Response) => {
  res.json({
    name: 'ANS Registry',
    version: '1.0.0',
    description: 'Self-hosted Agent Name Service Registry',
    caFingerprint: getCAFingerprint(),
    endpoints: [
      '/v1/agents/register',
      '/v1/agents/:agentId',
      '/v1/agents/:agentId/verify-dns',
      '/v1/agents',
      '/v1/log/checkpoint'
    ]
  });
});

// API routes
app.use('/', routes);

// Initialize and start server
async function start() {
  try {
    await initDatabase();
    await initCA();

    app.listen(PORT, () => {
      console.log(`ANS Registry running on port ${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
      console.log(`Registry: http://localhost:${PORT}/.well-known/ans-registry.json`);
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();
