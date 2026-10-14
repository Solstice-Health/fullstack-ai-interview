import { generateData } from '../data/generate';

// Makes sure data/*.json exist before any test file loads them.
export default function setup(): void {
  generateData({ ifMissing: true });
}
