import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { db, run, get, all } from './database';
import { issueIdentityCertificate, getCACertificate } from './ca';

const router = Router();

// Register new agent
router.post('/v1/agents/register', async (req: Request, res: Response) => {
  try {
    const { agentDisplayName, agentDescription, version, agentHost, endpoints, identityCsrPEM } = req.body;

    // Validate required fields
    if (!agentDisplayName || !version || !agentHost || !identityCsrPEM) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['agentDisplayName', 'version', 'agentHost', 'identityCsrPEM']
      });
    }

    // Generate agentId and ANS name
    const agentId = uuidv4();
    const ansName = `ans://v${version}.${agentHost}`;

    // Check if already exists
    const existing = await get('SELECT * FROM agents WHERE ansName = ?', [ansName]);
    if (existing) {
      return res.status(409).json({
        error: 'Agent with this version and host already exists',
        ansName
      });
    }

    // Generate DNS validation token
    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    // Insert agent
    await run(
      `INSERT INTO agents (agentId, ansName, agentDisplayName, agentDescription, version, agentHost, endpoints, identityCsrPEM, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_VALIDATION')`,
      [agentId, ansName, agentDisplayName, agentDescription, version, agentHost, JSON.stringify(endpoints || []), identityCsrPEM]
    );

    // Create validation challenge
    await run(
      'INSERT INTO validation_challenges (agentId, token, expiresAt) VALUES (?, ?, ?)',
      [agentId, token, expiresAt]
    );

    res.status(202).json({
      agentId,
      ansName,
      status: 'PENDING_VALIDATION',
      validationMethod: 'DNS-01',
      dnsRecord: {
        name: `_ans-challenge.${agentHost}`,
        type: 'TXT',
        value: token,
        ttl: 300
      },
      expiresAt
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify DNS and issue certificate
router.post('/v1/agents/:agentId/verify-dns', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    // Get agent
    const agent = await get('SELECT * FROM agents WHERE agentId = ?', [agentId]);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (agent.status !== 'PENDING_VALIDATION') {
      return res.status(400).json({ error: 'Agent already validated' });
    }

    // Get challenge
    const challenge = await get(
      'SELECT * FROM validation_challenges WHERE agentId = ? AND used = 0 AND expiresAt > ?',
      [agentId, new Date().toISOString()]
    );

    if (!challenge) {
      return res.status(400).json({ error: 'No valid challenge found' });
    }

    // For MVP: Skip actual DNS check, auto-validate
    // TODO: Implement real DNS TXT lookup
    const dnsValidated = true;

    if (!dnsValidated) {
      return res.status(400).json({ error: 'DNS validation failed' });
    }

    // Issue identity certificate
    const identityCertPEM = await issueIdentityCertificate(
      agent.identityCsrPEM,
      agent.ansName,
      agent.agentHost
    );

    // Update agent status
    await run(
      'UPDATE agents SET status = ?, identityCertPEM = ?, updatedAt = ? WHERE agentId = ?',
      ['ACTIVE', identityCertPEM, new Date().toISOString(), agentId]
    );

    // Mark challenge as used
    await run('UPDATE validation_challenges SET used = 1 WHERE id = ?', [challenge.id]);

    // Log to transparency log
    const merkleHash = randomBytes(32).toString('hex');
    await run(
      'INSERT INTO transparency_log (eventType, agentId, ansName, data, merkleHash) VALUES (?, ?, ?, ?, ?)',
      ['AGENT_REGISTERED', agentId, agent.ansName, JSON.stringify({ agentDisplayName: agent.agentDisplayName }), merkleHash]
    );

    res.json({
      agentId,
      ansName: agent.ansName,
      status: 'ACTIVE',
      certificates: {
        identityCert: identityCertPEM,
        caCert: getCACertificate()
      }
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get agent by ID
router.get('/v1/agents/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const agent = await get('SELECT * FROM agents WHERE agentId = ?', [agentId]);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({
      agentId: agent.agentId,
      ansName: agent.ansName,
      agentDisplayName: agent.agentDisplayName,
      agentDescription: agent.agentDescription,
      version: agent.version,
      agentHost: agent.agentHost,
      status: agent.status,
      endpoints: JSON.parse(agent.endpoints || '[]'),
      identityCertPEM: agent.identityCertPEM,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt
    });
  } catch (error) {
    console.error('Get agent error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search agents
router.get('/v1/agents', async (req: Request, res: Response) => {
  try {
    const { search, limit = '20' } = req.query;

    let sql = 'SELECT * FROM agents WHERE status = ?';
    const params: any[] = ['ACTIVE'];

    if (search) {
      sql += ' AND (agentDisplayName LIKE ? OR agentDescription LIKE ? OR agentHost LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    sql += ` ORDER BY createdAt DESC LIMIT ${parseInt(limit as string)}`;

    const agents = await all(sql, params);

    res.json({
      agents: agents.map(a => ({
        agentId: a.agentId,
        ansName: a.ansName,
        agentDisplayName: a.agentDisplayName,
        version: a.version,
        agentHost: a.agentHost
      })),
      count: agents.length
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get transparency log checkpoint
router.get('/v1/log/checkpoint', async (req: Request, res: Response) => {
  try {
    const result = await get('SELECT COUNT(*) as treeSize FROM transparency_log');
    const lastEntry = await get('SELECT merkleHash, timestamp FROM transparency_log ORDER BY id DESC LIMIT 1');

    res.json({
      treeSize: result?.treeSize || 0,
      rootHash: lastEntry?.merkleHash || '0'.repeat(64),
      timestamp: lastEntry?.timestamp || new Date().toISOString()
    });
  } catch (error) {
    console.error('Checkpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
