/**
 * تست OpenAILlmClient با mock کردن fetch.
 */

import { OpenAILlmClient } from './OpenAILlmClient';

const mockedFetch = jest.fn();
global.fetch = mockedFetch as any;

describe('OpenAILlmClient', () => {
  afterEach(() => {
    mockedFetch.mockReset();
  });

  it('should call OpenAI-compatible endpoint and parse response', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gpt-4o-mini',
        choices: [{ message: { content: '  Hello  ' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const client = new OpenAILlmClient({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });

    const result = await client.complete([
      { role: 'user', content: 'hi' },
    ]);

    expect(result.content).toBe('Hello');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });

    expect(mockedFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      })
    );
  });

  it('should support custom base URL', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
      }),
    });

    const client = new OpenAILlmClient({
      apiKey: 'test-key',
      baseUrl: 'http://localhost:11434/v1/',
      model: 'llama3',
    });

    await client.complete([{ role: 'user', content: 'hi' }]);

    expect(mockedFetch).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.any(Object)
    );
  });

  it('should throw on API error', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const client = new OpenAILlmClient({
      apiKey: 'bad-key',
      model: 'gpt-4o-mini',
    });

    await expect(client.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow('401');
  });
});
