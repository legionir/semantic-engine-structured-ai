import {
  IDependencyExtractor,
  DependencyExtractionResult,
} from './IDependencyExtractor';
import { ExtractionSource, Result, ok, err, IDisposable } from '../core/types/common.types';

/**
 * DependencyExtractorManager — مدیریت fallback chain بین extractors.
 *
 * طراحی مشابه SymbolExtractorManager:
 * - extractors بر اساس priority مرتب می‌شوند
 * - partial result → fallback به extractor بعدی
 * - آخرین partial اگر هیچ‌کامل نبود برگردانده می‌شود
 */
export class DependencyExtractorManager implements IDisposable {
  private readonly extractors: IDependencyExtractor[] = [];

  register(extractor: IDependencyExtractor): void {
    this.extractors.push(extractor);
    this.extractors.sort((a, b) => b.priority - a.priority);
  }

  async extract(
    fileId: string,
    filePath: string,
    content: string,
    languageId: string
  ): Promise<Result<DependencyExtractionResult>> {
    const errors: string[] = [];
    let lastPartialResult: DependencyExtractionResult | null = null;

    for (const extractor of this.extractors) {
      const available = await extractor.isAvailable(languageId);
      if (!available) continue;

      const result = await extractor.extractDependencies(fileId, filePath, content, languageId);
      if (!result.ok) {
        errors.push(`[${extractor.name}] ${result.error.message}`);
        continue;
      }

      if (!result.value.partial) {
        return result;
      }

      lastPartialResult = result.value;
      errors.push(`[${extractor.name}] returned partial result`);
    }

    if (lastPartialResult) {
      return ok(lastPartialResult);
    }

    return err(new Error(
      `No dependency extractor available for language "${languageId}". Tried: ${errors.join('; ')}`
    ));
  }

  async hasExtractorFor(languageId: string): Promise<boolean> {
    for (const extractor of this.extractors) {
      if (await extractor.isAvailable(languageId)) {
        return true;
      }
    }
    return false;
  }

  getRegisteredExtractors(): readonly { name: ExtractionSource; priority: number }[] {
    return this.extractors.map(e => ({ name: e.name, priority: e.priority }));
  }

  async dispose(): Promise<void> {
    for (const extractor of this.extractors) {
      await extractor.dispose();
    }
    this.extractors.length = 0;
  }
}
