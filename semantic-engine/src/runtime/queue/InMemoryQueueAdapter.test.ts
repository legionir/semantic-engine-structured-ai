import { InMemoryQueueAdapter } from './InMemoryQueueAdapter';

describe('InMemoryQueueAdapter (V2 Priority Job Queue)', () => {
  it('enqueues jobs and prioritizes urgent tasks before normal tasks', async () => {
    const queue = new InMemoryQueueAdapter();

    await queue.enqueue('proj1', 'index', { file: 'all' }, { priority: 'normal' });
    await queue.enqueue('proj1', 'single_file', { file: 'auth.ts' }, { priority: 'urgent' });
    await queue.enqueue('proj1', 'low_priority', {}, { priority: 'low' });

    const first = await queue.getNextJob();
    expect(first).not.toBeNull();
    expect(first?.priority).toBe('urgent');
    expect(first?.type).toBe('single_file');

    const second = await queue.getNextJob();
    expect(second?.priority).toBe('normal');

    const third = await queue.getNextJob();
    expect(third?.priority).toBe('low');
  });

  it('cancels a queued job', async () => {
    const queue = new InMemoryQueueAdapter();
    const job = await queue.enqueue('proj1', 'index', {});

    expect(await queue.cancelJob(job.id)).toBe(true);
    const updated = await queue.getJob(job.id);
    expect(updated?.status).toBe('cancelled');
  });
});
