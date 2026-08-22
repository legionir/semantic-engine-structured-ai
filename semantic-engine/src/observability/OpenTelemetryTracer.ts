/**
 * OpenTelemetryTracer — W3C TraceContext traceparent generator and context propagation.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error';
}

export class OpenTelemetryTracer {
  private readonly spans: Span[] = [];

  createTraceparent(traceId?: string, spanId?: string): string {
    const tId = traceId || crypto.randomBytes(16).toString('hex');
    const sId = spanId || crypto.randomBytes(8).toString('hex');
    return `00-${tId}-${sId}-01`;
  }

  parseTraceparent(header?: string): { traceId: string; parentSpanId?: string } | null {
    if (!header) return null;
    const parts = header.split('-');
    if (parts.length < 4) return null;
    return {
      traceId: parts[1]!,
      parentSpanId: parts[2],
    };
  }

  startSpan(name: string, parentHeader?: string): Span {
    const parsed = this.parseTraceparent(parentHeader);
    const traceId = parsed?.traceId || crypto.randomBytes(16).toString('hex');
    const spanId = crypto.randomBytes(8).toString('hex');

    const span: Span = {
      traceId,
      spanId,
      parentSpanId: parsed?.parentSpanId,
      name,
      startTime: Date.now(),
      attributes: {},
      status: 'ok',
    };

    this.spans.push(span);
    if (this.spans.length > 1000) {
      this.spans.splice(0, this.spans.length - 1000);
    }
    return span;
  }

  endSpan(span: Span, status: 'ok' | 'error' = 'ok'): void {
    span.endTime = Date.now();
    span.status = status;
  }

  async flush(outputPath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const tempPath = `${outputPath}.tmp-${process.pid}`;
    await fs.promises.writeFile(tempPath, `${JSON.stringify(this.spans)}\n`, 'utf8');
    await fs.promises.rename(tempPath, outputPath);
    this.spans.length = 0;
  }

  getRecentSpans(limit: number = 50): readonly Span[] {
    return this.spans.slice(-limit);
  }
}
