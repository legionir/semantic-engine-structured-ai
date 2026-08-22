/**
 * CodeIntelligenceService — Symbol 360 view, diagnostics, callers, impact, and tests service.
 */

import { ManagedProject } from './ProjectService';
import { ExplainSymbolTool, SymbolExplanation } from '../ai/tools/ExplainSymbolTool';
import { ImpactAnalysisTool } from '../ai/tools/ImpactAnalysisTool';
import { GetDependenciesTool } from '../ai/tools/GetDependenciesTool';
import { FindTestsTool } from '../ai/tools/FindTestsTool';
import { Diagnostic } from '../core/types/project-index.types';

export class CodeIntelligenceService {
  /**
   * دریافت نمای ۳۶۰ درجه نماد (Explain Symbol).
   */
  async explainSymbol(project: ManagedProject, symbolIdOrName: string): Promise<SymbolExplanation> {
    if (!project.reader) {
      throw new Error(`Project ${project.id} has no valid index loaded.`);
    }

    const tool = new ExplainSymbolTool(project.reader);

    const isId = symbolIdOrName.startsWith('sym-') || symbolIdOrName.startsWith('s_');
    const result = await tool.execute(isId ? { id: symbolIdOrName } : { name: symbolIdOrName });

    if (!result.success) {
      throw new Error(result.error || `Symbol not found: ${symbolIdOrName}`);
    }

    const item = result.items[0];
    if (!item || !item.metadata) {
      throw new Error(`Symbol not found: ${symbolIdOrName}`);
    }

    return item.metadata as unknown as SymbolExplanation;
  }

  /**
   * تحلیل شعاع اثر تغییر یک نماد (Impact Analysis).
   */
  async analyzeImpact(
    project: ManagedProject,
    symbol: string,
    maxDepth = 3
  ): Promise<{ symbol: string; impactedCount: number; items: unknown[] }> {
    if (!project.reader) {
      throw new Error(`Project ${project.id} has no valid index loaded.`);
    }

    const tool = new ImpactAnalysisTool(project.reader);

    const result = await tool.execute({ id: symbol, maxDepth });
    if (!result.success) {
      throw new Error(result.error || 'Impact analysis failed');
    }

    return {
      symbol,
      impactedCount: result.items.length,
      items: [...result.items],
    };
  }

  /**
   * دریافت گراف وابستگی‌های یک فایل یا نماد.
   */
  async getDependencies(
    project: ManagedProject,
    filePath: string,
    depth = 1,
    direction: 'in' | 'out' | 'both' = 'both'
  ): Promise<{ path: string; total: number; edges: unknown[] }> {
    if (!project.reader) {
      throw new Error(`Project ${project.id} has no valid index loaded.`);
    }

    const tool = new GetDependenciesTool(project.reader);

    const result = await tool.execute({
      id: `dep-${filePath}`,
      path: filePath,
      depth,
      direction: direction === 'in' ? 'backward' : 'forward',
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to extract dependencies');
    }

    return {
      path: filePath,
      total: result.items.length,
      edges: [...result.items],
    };
  }

  /**
   * یافتن تست‌های مرتبط با یک فایل یا نماد.
   */
  async findTests(
    project: ManagedProject,
    filePath?: string,
    symbolName?: string
  ): Promise<{ testsCount: number; items: unknown[] }> {
    if (!project.reader) {
      throw new Error(`Project ${project.id} has no valid index loaded.`);
    }

    const tool = new FindTestsTool(project.reader);

    const result = await tool.execute({ path: filePath, symbol: symbolName });
    if (!result.success) {
      throw new Error(result.error || 'Failed to find tests');
    }

    return {
      testsCount: result.items.length,
      items: [...result.items],
    };
  }

  /**
   * استخراج خطاهای کامپایلر از ایندکس.
   */
  async getDiagnostics(project: ManagedProject, filePaths?: string[]): Promise<Diagnostic[]> {
    if (!project.index) {
      return [];
    }

    const all = project.index.diagnostics || [];
    if (filePaths && filePaths.length > 0) {
      const set = new Set(filePaths);
      return all.filter(d => d.fileId && set.has(d.fileId));
    }
    return [...all];
  }
}
