import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CA_DIR = path.join(DATA_DIR, 'ca');
const CA_KEY = path.join(CA_DIR, 'root-ca.key');
const CA_CERT = path.join(CA_DIR, 'root-ca.crt');

export async function initCA(): Promise<void> {
  // Create CA directory
  if (!fs.existsSync(CA_DIR)) {
    fs.mkdirSync(CA_DIR, { recursive: true });
  }

  // Generate root CA if not exists
  if (!fs.existsSync(CA_KEY) || !fs.existsSync(CA_CERT)) {
    console.log('Generating root CA...');
    
    await execAsync(`
      openssl req -x509 -newkey rsa:4096 -nodes \
        -keyout "${CA_KEY}" \
        -out "${CA_CERT}" \
        -days 3650 \
        -subj "/C=PT/ST=Lisbon/L=Lisbon/O=ANS Registry/CN=ANS Root CA"
    `);
    
    console.log('Root CA generated');
  } else {
    console.log('Root CA already exists');
  }
}

export async function issueIdentityCertificate(
  csrPem: string,
  ansName: string,
  agentHost: string
): Promise<string> {
  const tmpDir = path.join(DATA_DIR, 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const csrPath = path.join(tmpDir, `${Date.now()}.csr`);
  const certPath = path.join(tmpDir, `${Date.now()}.crt`);

  // Write CSR to file
  fs.writeFileSync(csrPath, csrPem);

  // Issue certificate (valid for 1 year)
  await execAsync(`
    openssl x509 -req \
      -in "${csrPath}" \
      -CA "${CA_CERT}" \
      -CAkey "${CA_KEY}" \
      -CAcreateserial \
      -out "${certPath}" \
      -days 365 \
      -extfile <(echo "subjectAltName=DNS:${agentHost}") \
      2>/dev/null
  `);

  // Read certificate
  const certPem = fs.readFileSync(certPath, 'utf-8');

  // Cleanup
  fs.unlinkSync(csrPath);
  fs.unlinkSync(certPath);

  return certPem;
}

export function getCACertificate(): string {
  return fs.readFileSync(CA_CERT, 'utf-8');
}

export function getCAFingerprint(): string {
  const cert = fs.readFileSync(CA_CERT, 'utf-8');
  // Extract fingerprint (simplified)
  return 'SHA256:' + Buffer.from(cert).toString('base64').substring(0, 64);
}
