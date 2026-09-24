// Offline example. Synthetic data only; no API credential or network needed.
import { readFile } from 'node:fs/promises';
import { protectChat } from '../src/core.js';

const input = JSON.parse(await readFile(new URL('./request.json', import.meta.url), 'utf8'));
const { body, counts } = protectChat(input);
console.log(JSON.stringify({ body, counts }, null, 2));
