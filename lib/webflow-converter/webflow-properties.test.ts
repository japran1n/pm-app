import { describe, expect, it } from 'vitest';
import {
  isWebflowSupportedProp,
  isWebflowSupportedValue,
  partitionByWebflowSupport,
  WEBFLOW_SUPPORTED_PROPS,
} from './webflow-properties';

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

  it('test_M7_text-decoration_is_removed_from_whitelist', () => {
    // text-decoration has no style-type entry in Webflow's buildStyleBlock
    // lookup table; routed to the CSS embed instead of styleLess.
    expect(isWebflowSupportedProp('text-decoration')).toBe(false);
    const { supported, unsupported } = partitionByWebflowSupport({ 'text-decoration': 'none', color: 'red' });
    expect(supported).toEqual({ color: 'red' });
    expect(unsupported).toEqual({ 'text-decoration': 'none' });
  });
});

describe('webflow-properties: isWebflowSupportedValue() — value-level validation', () => {
  it('test_M7_display_inline-flex_is_unsupported', () => {
    expect(isWebflowSupportedValue('display', 'inline-flex')).toBe(false);
  });

  it('test_M7_display_flex_is_supported', () => {
    expect(isWebflowSupportedValue('display', 'flex')).toBe(true);
  });

  it('test_M7_display_other_safe_values_are_supported', () => {
    for (const v of ['block', 'inline-block', 'inline', 'grid', 'none']) {
      expect(isWebflowSupportedValue('display', v)).toBe(true);
    }
  });

  it('test_M7_margin-top_auto_is_unsupported', () => {
    expect(isWebflowSupportedValue('margin-top', 'auto')).toBe(false);
  });

  it('test_M7_margin-top_unit_value_is_supported', () => {
    expect(isWebflowSupportedValue('margin-top', '1rem')).toBe(true);
  });

  it('test_M7_flex-basis_auto_is_unsupported', () => {
    expect(isWebflowSupportedValue('flex-basis', 'auto')).toBe(false);
  });

  it('test_M7_flex-basis_zero_is_supported', () => {
    // 0 is a valid unit value without an explicit unit.
    expect(isWebflowSupportedValue('flex-basis', '0')).toBe(true);
  });

  it('test_M7_unit-only_props_reject_auto', () => {
    for (const prop of ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'top', 'right', 'bottom', 'left', 'padding-left']) {
      expect(isWebflowSupportedValue(prop, 'auto')).toBe(false);
      expect(isWebflowSupportedValue(prop, '10px')).toBe(true);
    }
  });

  it('test_M7_align-items_center_is_supported', () => {
    expect(isWebflowSupportedValue('align-items', 'center')).toBe(true);
  });

  it('test_M7_unrelated_property_values_pass_through', () => {
    expect(isWebflowSupportedValue('color', 'red')).toBe(true);
    expect(isWebflowSupportedValue('opacity', '0.5')).toBe(true);
  });
});
