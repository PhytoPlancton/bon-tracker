#!/usr/bin/env node
/**
 * Tire au sort les secrets d'infrastructure. À exécuter une fois, en local,
 * puis à coller dans les variables d'environnement du stack.
 *
 *   npm run gen-secrets
 */
import { randomBytes } from 'node:crypto';

console.log('ENCRYPTION_KEY=' + randomBytes(32).toString('base64'));
console.log('SESSION_SECRET=' + randomBytes(48).toString('base64url'));
console.log('WORKER_TOKEN=' + randomBytes(32).toString('base64url'));
