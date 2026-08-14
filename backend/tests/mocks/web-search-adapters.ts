/**
 * Mock Web Search Adapters for Testing
 */

import { WebSearchAdapter, WebSearchParams, WebSearchOutput } from '../../src/application/tools';

export class MockSearchAdapter implements WebSearchAdapter {
  readonly adapterName: string;
  private results: WebSearchOutput;
  private isConfiguredFlag: boolean;

  constructor(name: string, results: WebSearchOutput, isConfigured = true) {
    this.adapterName = name;
    this.results = results;
    this.isConfiguredFlag = isConfigured;
  }

  isConfigured(): boolean {
    return this.isConfiguredFlag;
  }

  async search(_params: WebSearchParams): Promise<WebSearchOutput> {
    return this.results;
  }
}
