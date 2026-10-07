import { describe, expect, it } from 'vitest';
import { BuildRequestAdmission } from './build-request-admission';

describe('BuildRequestAdmission', () => {
  it('fails concurrent builds fast and releases capacity exactly once', () => {
    const admission = new BuildRequestAdmission(1);
    const release = admission.tryAcquire('https://first.example');

    expect(release).toBeTypeOf('function');
    expect(admission.tryAcquire('https://first.example')).toBeNull();
    expect(admission.tryAcquire('https://second.example')).toBeNull();

    release!();
    release!();
    expect(admission.tryAcquire('https://second.example')).toBeTypeOf('function');
  });
});
