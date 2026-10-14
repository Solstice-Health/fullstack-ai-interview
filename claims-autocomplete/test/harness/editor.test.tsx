// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaimsApiProvider, type AssetView, type ClaimsApi } from '../../web/api';
import { Editor } from '../../web/Editor';
import type { InsertResult, Suggestion } from '../../shared/types';

afterEach(cleanup);

const suggestion: Suggestion = { claimId: 'clm_000042', version: 3, text: 'Cardiovex® reduced the risk of MI by 26% (ORBIT_301).', score: 1, matchedBy: 'both' };
const view: AssetView = {
  asset: { id: 'as_0001', title: 'Cardiovex HCP email', brandId: 'br_001', clientId: 'cl_a', market: 'US', channel: 'email' },
  brand: { id: 'br_001', clientId: 'cl_a', name: 'Cardiovex' },
  content: [],
};

function setup(insertResult: InsertResult) {
  const api: ClaimsApi = {
    suggest: vi.fn(),
    insertClaim: vi.fn(async () => insertResult),
    listAssets: vi.fn(),
    getAsset: vi.fn(async () => view),
    addText: vi.fn(async () => {}),
    revokeClaim: vi.fn(async () => {}),
  };
  const useSuggestions = (q: string) => (q ? { suggestions: [suggestion], status: 'ready' as const } : { suggestions: [], status: 'idle' as const });
  render(
    <ClaimsApiProvider api={api}>
      <Editor assetId="as_0001" useSuggestions={useSuggestions} />
    </ClaimsApiProvider>,
  );
  return api;
}

describe('Editor shell', () => {
  it('shows suggestions and inserts the picked claim as a locked node with citations', async () => {
    const api = setup({
      ok: true,
      node: { type: 'claim', claimId: suggestion.claimId, version: 3, text: suggestion.text, citations: [{ id: 'CIT-1', ref: 'Ref' }], insertedBy: 'u_001', insertedAt: 0 },
    });
    await screen.findByText('Cardiovex HCP email');
    const input = screen.getByLabelText('Write copy');
    fireEvent.change(input, { target: { value: 'risk of MI' } });
    expect(screen.getByRole('option').textContent).toContain('ORBIT_301');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.insertClaim).toHaveBeenCalledWith('as_0001', 'clm_000042', 3));
    await screen.findByText('[CIT-1]');
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('explains why an insert was refused', async () => {
    setup({ ok: false, error: 'REVOKED' });
    await screen.findByText('Cardiovex HCP email');
    const input = screen.getByLabelText('Write copy');
    fireEvent.change(input, { target: { value: 'risk' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/revoked/);
  });
});
