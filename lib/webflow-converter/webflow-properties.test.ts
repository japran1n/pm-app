import { describe, expect, it } from 'vitest';
import { isWebflowSupportedProp, partitionByWebflowSupport, WEBFLOW_SUPPORTED_PROPS } from './webflow-properties';

describe('webflow-properties: whitelist of Webflow clipboard style-type props', () => {
  it('test_M7_known_designer_props_are_supported', () => {
    for (const prop of ['display', 'color', 'padding-top', 'grid-row-gap', 'transition', 'box-shadow']) {
      expect(isWebflowSupportedProp(prop)).toBe(true);
    }
  });

  it('test_M7_unknown_longhands_are_not_supported', () => {
    for (const prop of [
      'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
      'text-decoration-color', 'text-decoration-thickness', 'text-decoration-style',
      'row-gap', 'column-gap', 'aspect-ratio', 'mask-image',
    ]) {
      expect(isWebflowSupportedProp(prop)).toBe(false);
    }
  });

  it('test_M7_lookup_is_case_insensitive_and_trims_whitespace', () => {
    expect(isWebflowSupportedProp('  Color  ')).toBe(true);
    expect(isWebflowSupportedProp('DISPLAY')).toBe(true);
  });

  it('test_M7_partition_splits_supported_from_unsupported', () => {
    const { supported, unsupported } = partitionByWebflowSupport({
      color: 'red',
      'grid-template-columns': '1fr 1fr',
      'padding-top': '4px',
      'text-decoration-color': 'blue',
    });
    expect(supported).toEqual({ color: 'red', 'padding-top': '4px' });
    expect(unsupported).toEqual({ 'grid-template-columns': '1fr 1fr', 'text-decoration-color': 'blue' });
  });

  it('test_M7_partition_of_all-supported_decls_leaves_unsupported_empty', () => {
    const { supported, unsupported } = partitionByWebflowSupport({ color: 'red', opacity: '0.5' });
    expect(supported).toEqual({ color: 'red', opacity: '0.5' });
    expect(unsupported).toEqual({});
  });

  it('test_M7_whitelist_is_a_real_Set_not_accidentally_empty', () => {
    expect(WEBFLOW_SUPPORTED_PROPS.size).toBeGreaterThan(50);
  });
});
