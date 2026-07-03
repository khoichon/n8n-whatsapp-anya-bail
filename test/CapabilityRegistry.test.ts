import {
  LEGACY_CAPABILITIES,
  OFFICIAL_CAPABILITIES,
  getCapabilities,
  buildUnsupportedFeatureError,
  findBackendSupporting,
} from '../shared/backends/CapabilityRegistry';

describe('CapabilityRegistry', () => {
  it('legacy backend supports anya-bail-exclusive features', () => {
    expect(LEGACY_CAPABILITIES.aiIcon).toBe(true);
    expect(LEGACY_CAPABILITIES.tableMessages).toBe(true);
    expect(LEGACY_CAPABILITIES.calls).toBe(true);
  });

  it('official backend does not claim anya-bail-exclusive features', () => {
    expect(OFFICIAL_CAPABILITIES.aiIcon).toBe(false);
    expect(OFFICIAL_CAPABILITIES.tableMessages).toBe(false);
  });

  it('both backends support the core feature set', () => {
    for (const caps of [LEGACY_CAPABILITIES, OFFICIAL_CAPABILITIES]) {
      expect(caps.messages).toBe(true);
      expect(caps.media).toBe(true);
      expect(caps.polls).toBe(true);
      expect(caps.reactions).toBe(true);
      expect(caps.groupManagement).toBe(true);
      expect(caps.qrLogin).toBe(true);
      expect(caps.pairingCode).toBe(true);
    }
  });

  it('getCapabilities returns the right table per backend id', () => {
    expect(getCapabilities('legacy')).toBe(LEGACY_CAPABILITIES);
    expect(getCapabilities('official')).toBe(OFFICIAL_CAPABILITIES);
  });

  it('buildUnsupportedFeatureError produces a descriptive, actionable message', () => {
    const info = buildUnsupportedFeatureError('official', 'aiIcon', 'legacy');
    expect(info.message).toContain('Official Baileys');
    expect(info.description).toContain('Feature:');
    expect(info.description).toContain('Switch Backend to "Legacy (anya-bail)"');
  });

  it('buildUnsupportedFeatureError degrades gracefully with no alternative backend', () => {
    const info = buildUnsupportedFeatureError('legacy', 'channels', undefined);
    expect(info.description).toContain('No other configured backend');
  });

  it('findBackendSupporting finds the backend that supports an exclusive feature', () => {
    expect(findBackendSupporting('aiIcon', 'official')).toBe('legacy');
    expect(findBackendSupporting('aiIcon', 'legacy')).toBeUndefined();
  });
});
