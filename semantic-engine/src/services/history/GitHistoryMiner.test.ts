import { GitHistoryMiner } from './GitHistoryMiner';

describe('GitHistoryMiner (V2 Hotspots & Co-Churn)', () => {
  it('calculates hotspots and co-churn matrices from commit records', () => {
    const miner = new GitHistoryMiner();

    miner.recordCommit(['src/auth.ts', 'src/user.ts']);
    miner.recordCommit(['src/auth.ts', 'src/user.ts']);
    miner.recordCommit(['src/auth.ts', 'src/token.ts']);

    const hotspots = miner.getHotspots(5);
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots[0]?.filePath).toBe('src/auth.ts');

    const coChurn = miner.getCoChurn('src/auth.ts');
    expect(coChurn.length).toBe(2);
    expect(coChurn[0]?.targetFile).toBe('src/user.ts');
    expect(coChurn[0]?.coOccurrenceCount).toBe(2);
  });
});
